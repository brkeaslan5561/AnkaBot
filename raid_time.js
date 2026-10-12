const path = require('path');
const { JsonStore } = require('./storage');

// Locale is a formatting preference, not a time-zone detector. Unlisted zones
// use the user's explicit/Discord locale, never a continent-based heuristic.
const ZONE_LOCALES = {
    'Europe/Istanbul': 'tr-TR', 'Europe/London': 'en-GB', 'Europe/Berlin': 'de-DE',
    'Europe/Paris': 'fr-FR', 'Europe/Madrid': 'es-ES', 'Europe/Rome': 'it-IT',
    'Europe/Amsterdam': 'nl-NL', 'Europe/Warsaw': 'pl-PL', 'Europe/Moscow': 'ru-RU',
    'America/New_York': 'en-US', 'America/Los_Angeles': 'en-US', 'America/Chicago': 'en-US',
    'America/Denver': 'en-US', 'America/Phoenix': 'en-US', 'America/Anchorage': 'en-US',
    'Pacific/Honolulu': 'en-US', 'America/Toronto': 'en-CA', 'America/Vancouver': 'en-CA',
    'America/Sao_Paulo': 'pt-BR', 'America/Mexico_City': 'es-MX',
    'Asia/Tokyo': 'ja-JP', 'Asia/Seoul': 'ko-KR', 'Asia/Shanghai': 'zh-CN',
    'Asia/Kolkata': 'en-IN', 'Asia/Calcutta': 'en-IN', 'Australia/Sydney': 'en-AU',
    'Australia/Perth': 'en-AU', 'Pacific/Auckland': 'en-NZ', 'Africa/Johannesburg': 'en-ZA'
};
function validateTimeZone(value) {
    const zone = String(value || '').trim();
    if (!zone || /^[+-]/.test(zone)) throw new Error('timeZone');
    return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
}
function validateLocale(value) {
    const locale = Intl.getCanonicalLocales(String(value || 'en-GB'))[0];
    if (!Intl.DateTimeFormat.supportedLocalesOf([locale]).length) throw new Error('locale');
    return locale;
}
function localeForZone(zone, fallback = 'en-GB') {
    return ZONE_LOCALES[validateTimeZone(zone)] || validateLocale(fallback);
}
function hourFormat(preference = 'auto', locale = 'en-GB') {
    if (preference === '12' || preference === '24') return preference;
    const cycle = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: 'numeric' }).resolvedOptions().hourCycle;
    return ['h11', 'h12'].includes(cycle) ? '12' : '24';
}
function parseTime(value, format = '24', meridiem = null) {
    const text = String(value || '').trim().toUpperCase();
    if (format === '24') {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error('time24');
        return text;
    }
    const match = text.match(/^(0?[1-9]|1[0-2]):([0-5]\d)(?:\s*(AM|PM))?$/);
    const period = match?.[3] || meridiem;
    if (!match || !['AM', 'PM'].includes(period)) throw new Error('time12');
    return `${String(Number(match[1]) % 12 + (period === 'PM' ? 12 : 0)).padStart(2, '0')}:${match[2]}`;
}
function formatLocalTime(time, format) {
    const [hour, minute] = parseTime(time, '24').split(':');
    return format === '12' ? `${Number(hour) % 12 || 12}:${minute} ${Number(hour) < 12 ? 'AM' : 'PM'}` : time;
}
function dateParts(timestamp, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: validateTimeZone(timeZone), calendar: 'gregory', numberingSystem: 'latn',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(Number(timestamp) * 1000));
    const p = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, year: Number(p.year), month: Number(p.month), day: Number(p.day), second: Number(p.second) };
}
function localCandidates(localDate, localTime, timeZone) {
    validateTimeZone(timeZone);
    const match = String(localDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new Error('date');
    const [, y, m, d] = match.map(Number);
    const time = parseTime(localTime, '24');
    const [h, minute] = time.split(':').map(Number);
    const wall = Date.UTC(y, m - 1, d, h, minute) / 1000;
    if (y < 2000 || y > 2100 || new Date(wall * 1000).toISOString().slice(0, 10) !== localDate) throw new Error('date');
    // Discover the offsets on both sides of any nearby transition from ICU's
    // IANA data, then round-trip each candidate. Handles half-hour transitions
    // and date-line skips as well as normal one-hour DST folds/gaps.
    const offsets = new Set();
    for (let hours = -48; hours <= 48; hours += 6) {
        const instant = wall + hours * 3600;
        const p = dateParts(instant, timeZone);
        offsets.add(Date.parse(`${p.date}T${p.time}:${String(p.second).padStart(2, '0')}Z`) / 1000 - instant);
    }
    return [...offsets].map(offset => wall - offset).filter(instant => {
        const p = dateParts(instant, timeZone);
        return p.date === localDate && p.time === time;
    }).sort((a, b) => a - b);
}
function timeSnapshot(localDate, localTime, timeZone, format, locale, timestamp) {
    if (!localCandidates(localDate, localTime, timeZone).includes(timestamp)) throw new Error('instant');
    const [year, month, day] = localDate.split('-').map(Number);
    return {
        unixZamani: timestamp, organizerTimeZone: timeZone, organizerHourFormat: hourFormat(format, locale),
        organizerLocale: validateLocale(locale), originalLocalDate: localDate, originalLocalTime: localTime,
        yil: year, ay: String(month - 1), gun: String(day), saat: localTime
    };
}
function organizerTime(raid) {
    if (!raid.organizerTimeZone || !raid.originalLocalTime) return null;
    try { return `${raid.originalLocalDate} • ${formatLocalTime(raid.originalLocalTime, raid.organizerHourFormat)} – ${raid.organizerTimeZone}`; }
    catch { return null; }
}
function resolveRaidTimeEdit(raid, changes, now = Date.now() / 1000) {
    const zone = changes.zone || raid.organizerTimeZone;
    if (!zone) throw new Error('unknownZone');
    const previous = dateParts(raid.unixZamani, zone);
    const year = changes.year ?? previous.year;
    const month = changes.month ?? previous.month;
    const day = changes.day ?? previous.day;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // Accept canonical HH:mm as well as the organizer's explicit AM/PM input.
    const time = changes.time == null ? previous.time : parseTime(changes.time, /AM|PM/i.test(changes.time) ? '12' : '24');
    const candidates = localCandidates(date, time, zone);
    if (!candidates.length) throw new Error('gap');
    let timestamp = candidates[0];
    if (candidates.length > 1) {
        if (changes.fold === 'earlier') timestamp = candidates[0];
        else if (changes.fold === 'later') timestamp = candidates.at(-1);
        else if (candidates.includes(Number(raid.unixZamani))) timestamp = Number(raid.unixZamani);
        else throw new Error('fold');
    }
    if (timestamp <= now) throw new Error('past');
    return timeSnapshot(date, time, zone, raid.organizerHourFormat || 'auto', raid.organizerLocale || localeForZone(zone), timestamp);
}
function createTimePreferences(file = path.join(__dirname, 'user_time_preferences.json')) {
    const store = new JsonStore(file, { version: 1, users: {} });
    return {
        get: id => store.data.users[String(id)] ? { ...store.data.users[String(id)] } : null,
        set(id, data) {
            const preference = {
                preferredTimeZone: validateTimeZone(data.preferredTimeZone),
                preferredHourFormat: ['auto', '12', '24'].includes(data.preferredHourFormat) ? data.preferredHourFormat : 'auto',
                preferredLocale: validateLocale(data.preferredLocale)
            };
            const before = store.data.users[String(id)];
            store.data.users[String(id)] = preference;
            try { store.save(); } catch (error) {
                if (before) store.data.users[String(id)] = before; else delete store.data.users[String(id)];
                throw error;
            }
            return { ...preference };
        }
    };
}
module.exports = { validateTimeZone, validateLocale, localeForZone, hourFormat, parseTime, formatLocalTime, dateParts, localCandidates, timeSnapshot, organizerTime, resolveRaidTimeEdit, createTimePreferences };
