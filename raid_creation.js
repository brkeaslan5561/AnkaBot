const { randomBytes } = require('node:crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { validateTimeZone, validateLocale, localeForZone, hourFormat, parseTime, formatLocalTime, dateParts, localCandidates, timeSnapshot } = require('./raid_time');

// Only the creation wizard uses this bilingual dictionary.
const TEXT = {
    name: ['Raid Adı', 'Raid Name'], type: ['Raid Türü', 'Raid Type'], date: ['Tarih', 'Date'],
    time: ['Raid Saati', 'Raid Time'], zone: ['Saat Dilimi', 'Time Zone'], format: ['Saat Biçimi', 'Hour Format'],
    locale: ['Bölgesel Biçim', 'Regional Locale'], description: ['Açıklama', 'Description'],
    next: ['Devam', 'Continue'], back: ['Geri', 'Back'], cancel: ['İptal', 'Cancel'], confirm: ['Onayla', 'Confirm'],
    custom: ['Özel Raid', 'Custom Raid'], dungeon: ['Zindan (5 kişi)', 'Dungeon (5 players)'], trial: ['Trial (10 kişi)', 'Trial (10 players)'],
    auto: ['Otomatik', 'Automatic'], twelve: ['12 saat (AM/PM)', '12 hour (AM/PM)'], twentyfour: ['24 saat', '24 hour'],
    other: ['Diğer / IANA adı gir', 'Other / Enter IANA name'], region: ['Bölgesel Ayar', 'Regional Setting'],
    enter: ['Tarih ve Saat Gir', 'Enter Date and Time'], details: ['Raid Bilgileri', 'Raid Details'],
    selected: ['Seçtiğiniz Saat', 'Selected Time'], preview: ['Yerel Görünüm', 'Local Preview'],
    choose: ['Bir raid seçin.', 'Choose a raid.'], setup: ['Saat dilimini ve saat biçimini seçin.', 'Choose a time zone and hour format.'],
    unknown: ['Saat diliminiz otomatik algılanmaz; lütfen seçin.', 'Your time zone is not detected automatically; please select it.'],
    expired: ['Bu ekranın süresi doldu. /raid-oluştur ile tekrar başlayın.', 'This screen expired. Start again with /create-raid.'],
    cancelled: ['Raid oluşturma iptal edildi.', 'Raid creation cancelled.'],
    success: ['Raid oluşturuldu.', 'Raid created.'],
    failed: ['İşlem tamamlanamadı. Tekrar deneyin.', 'The operation failed. Please try again.'],
    busy: ['İşlem sürüyor; lütfen bekleyin.', 'The operation is in progress; please wait.'],
    dateError: ['Geçerli bir tarih girin: YYYY-MM-DD.', 'Enter a valid date: YYYY-MM-DD.'],
    time24: ['Saat 00:00–23:59 arasında olmalı.', 'Time must be between 00:00 and 23:59.'],
    time12: ['1:00–12:59 girin ve AM/PM seçin.', 'Enter 1:00–12:59 and select AM/PM.'],
    zoneError: ['Geçerli IANA saat dilimi girin (ör. Asia/Tokyo).', 'Enter a valid IANA time zone (e.g. Asia/Tokyo).'],
    localeError: ['Geçerli bölgesel kod girin (ör. en-US, tr-TR).', 'Enter a valid regional locale (e.g. en-US, tr-TR).'],
    gap: ['Bu yerel saat saat değişimi nedeniyle mevcut değil. Başka saat seçin.', 'This local time does not exist due to a clock change. Choose another time.'],
    fold: ['Bu saat iki kez yaşanıyor. İstediğiniz UTC anını seçin.', 'This time occurs twice. Choose the intended UTC instant.'],
    past: ['Raid başlangıcı gelecekte olmalı.', 'The raid must start in the future.'],
    guild: ['Bu komutu bir sunucu kanalında kullanın.', 'Use this command in a server channel.'],
    invalidName: ['Raid adı boş olamaz.', 'Raid name cannot be empty.']
};
const text = key => TEXT[key].join(' / ');
const lines = key => `${TEXT[key][0]}\n${TEXT[key][1]}`;
const COMMON_ZONES = [
    ['Türkiye', 'Europe/Istanbul'], ['United Kingdom', 'Europe/London'], ['Germany', 'Europe/Berlin'],
    ['United States (New York)', 'America/New_York'], ['United States (Los Angeles)', 'America/Los_Angeles'],
    ['United States (Chicago)', 'America/Chicago'], ['United States (Denver)', 'America/Denver'],
    ['Japan', 'Asia/Tokyo'], ['Australia (Sydney)', 'Australia/Sydney']
];
const LEGACY_CREATION_IDS = new Set(['raid_content_select', 'raid_custom_type', 'raid_custom_name_modal', 'raid_date_day_1', 'raid_date_day_2', 'raid_date_month', 'raid_date_time', 'raid_description_modal']);
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const id = (s, action) => `raid_create_${s.token}_${action}`;
const button = (s, action, key, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id(s, action)).setLabel(text(key)).setStyle(style);
const input = (key, label, placeholder, value, required = true, max = 100) => {
    const item = new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
    if (placeholder) item.setPlaceholder(placeholder);
    if (value) item.setValue(value);
    return row(item);
};
function settings(s) {
    const zones = COMMON_ZONES.map(([country, zone]) => ({ label: `${country} – ${zone}`.slice(0, 100), value: zone, default: zone === s.zone }));
    if (s.zone && !zones.some(option => option.value === s.zone)) zones.push({ label: s.zone, value: s.zone, default: true });
    zones.push({ label: text('other'), value: 'other' });
    const components = [row(new StringSelectMenuBuilder().setCustomId(id(s, 'zone')).setPlaceholder(text('zone')).addOptions(zones)),
        row(new StringSelectMenuBuilder().setCustomId(id(s, 'format')).setPlaceholder(text('format')).addOptions(
            ['auto', '12', '24'].map((value, i) => ({ label: text(['auto', 'twelve', 'twentyfour'][i]), value, default: s.format === value }))
        ))];
    if (hourFormat(s.format, s.locale) === '12') components.push(row(new StringSelectMenuBuilder()
        .setCustomId(id(s, 'period')).setPlaceholder('AM / PM').addOptions(
            { label: 'AM', value: 'AM', default: s.period === 'AM' }, { label: 'PM', value: 'PM', default: s.period === 'PM' }
        )));
    components.push(row(button(s, 'details', 'enter', ButtonStyle.Primary).setDisabled(!s.zone), button(s, 'region', 'region'), button(s, 'back', 'back'), button(s, 'cancel', 'cancel')));
    return { content: `${lines('setup')}\n${s.zone || lines('unknown')} • ${s.locale}\n${text('selected')}: ${formatLocalTime(s.time || '21:00', hourFormat(s.format, s.locale))}`, embeds: [], components };
}
function detailsModal(s) {
    const format = hourFormat(s.format, s.locale);
    const displayed = formatLocalTime(s.time || '21:00', format);
    const description = new TextInputBuilder().setCustomId('description').setLabel(text('description')).setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false);
    if (s.description) description.setValue(s.description);
    return new ModalBuilder().setCustomId(id(s, 'submit')).setTitle(text('details')).addComponents(
        input('name', text('name'), null, s.name, true, 80),
        input('date', `${text('date')} (YYYY-MM-DD)`, '2026-10-20', s.date || dateParts(Date.now() / 1000, s.zone).date, true, 10),
        input('time', text('time'), format === '12' ? `9:00 ${s.period}` : '21:00', s.time ? displayed : null, true, 12),
        row(description)
    );
}
function confirmation(s) {
    const dateText = new Intl.DateTimeFormat(s.locale, { timeZone: s.zone, dateStyle: 'long' }).format(new Date(s.candidates[0] * 1000));
    const fields = [
        { name: text('name'), value: s.name },
        { name: text('date'), value: dateText, inline: true },
        { name: text('selected'), value: formatLocalTime(s.time, hourFormat(s.format, s.locale)), inline: true },
        { name: text('zone'), value: s.zone },
        { name: text('preview'), value: s.timestamp ? `<t:${s.timestamp}:F>\n<t:${s.timestamp}:t> • <t:${s.timestamp}:R>` : lines('fold') }
    ];
    const embed = new EmbedBuilder().setColor('#E58A3B').setTitle(text('details')).addFields(fields);
    if (s.description) embed.setDescription(s.description);
    const components = [];
    if (s.candidates.length > 1) components.push(row(new StringSelectMenuBuilder().setCustomId(id(s, 'fold')).setPlaceholder(text('selected')).addOptions(
        s.candidates.map(timestamp => ({ label: `${new Date(timestamp * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC`, value: String(timestamp), default: timestamp === s.timestamp }))
    )));
    components.push(row(button(s, 'confirm', 'confirm', ButtonStyle.Success).setDisabled(!s.timestamp), button(s, 'settings', 'back'), button(s, 'cancel', 'cancel')));
    return { content: '', embeds: [embed], components };
}
function createRaidCreation({ contents, preferences, publish, now = () => Date.now() }) {
    const sessions = new Map();
    function contentPayload(s) {
        return { content: lines('choose'), embeds: [], components: [row(new StringSelectMenuBuilder().setCustomId(id(s, 'content')).setPlaceholder(text('name')).addOptions(
            contents.map(item => ({ label: item.value === 'custom' ? text('custom') : item.label, value: item.value, description: text(item.contentType === 'dungeon' ? 'dungeon' : 'trial') }))
        )), row(button(s, 'cancel', 'cancel'))] };
    }
    const errorReply = (i, key) => i.reply({ content: lines(key), flags: [64] });
    async function handle(i) {
        const starting = i.isChatInputCommand() && i.commandName === 'raid-oluştur';
        if (LEGACY_CREATION_IDS.has(i.customId)) return errorReply(i, 'expired');
        if (!starting && !i.customId?.startsWith('raid_create_')) return null;
        if (starting) {
            if (!i.guildId) return errorReply(i, 'guild');
            for (const [key, session] of sessions) if (now() - session.created > 30 * 60_000 && !session.busy) sessions.delete(key);
            const preference = preferences.get(i.user.id);
            const s = { token: randomBytes(9).toString('hex'), userId: i.user.id, channelId: i.channelId, guildId: i.guildId, created: now(), stage: 'content',
                zone: preference?.preferredTimeZone || null, format: preference?.preferredHourFormat || 'auto',
                locale: preference?.preferredLocale || (i.locale === 'tr' ? 'tr-TR' : i.locale || 'en-GB'), period: 'PM' };
            sessions.set(s.token, s);
            return i.reply({ ...contentPayload(s), flags: [64] });
        }
        const [, , token, action] = i.customId.split('_');
        const s = sessions.get(token);
        if (!s || s.userId !== i.user.id || s.channelId !== i.channelId || s.guildId !== i.guildId || now() - s.created > 30 * 60_000) return errorReply(i, 'expired');
        if (s.busy) return errorReply(i, 'busy');
        if (s.publicationStarted && action !== 'confirm') return errorReply(i, 'busy');
        try {
            if (action === 'cancel') { sessions.delete(token); return i.update({ content: lines('cancelled'), embeds: [], components: [] }); }
            if (action === 'back') { s.stage = 'content'; return i.update(contentPayload(s)); }
            if (action === 'content') {
                s.stage = 'settings'; s.timestamp = null;
                const item = contents.find(entry => entry.value === i.values[0]);
                if (!item) return errorReply(i, 'expired');
                s.code = item.value; s.name = item.value === 'custom' ? '' : item.label;
                if (item.value === 'custom') return i.update({ content: text('type'), embeds: [], components: [row(new StringSelectMenuBuilder().setCustomId(id(s, 'type')).setPlaceholder(text('type')).addOptions(
                    { label: text('dungeon'), value: 'dungeon' }, { label: text('trial'), value: 'trial' }
                )), row(button(s, 'back', 'back'), button(s, 'cancel', 'cancel'))] });
                s.type = item.contentType;
                return i.update(settings(s));
            }
            if (action === 'type') { if (!['dungeon', 'trial'].includes(i.values[0])) return errorReply(i, 'expired'); s.type = i.values[0]; return i.update(settings(s)); }
            if (action === 'settings') { s.stage = 'settings'; return i.update(settings(s)); }
            if (action === 'zone' && i.values[0] === 'other' || action === 'region') {
                return i.showModal(new ModalBuilder().setCustomId(id(s, 'regionSubmit')).setTitle(text('zone')).addComponents(
                    input('zone', text('zone'), 'Asia/Tokyo', s.zone, true, 100),
                    input('locale', text('locale'), 'en-US / tr-TR / de-DE', action === 'region' ? s.locale : null, false, 35)
                ));
            }
            if (action === 'zone' || action === 'regionSubmit') {
                s.stage = 'settings';
                let zone = action === 'zone' ? i.values[0] : i.fields.getTextInputValue('zone').trim();
                try { zone = validateTimeZone(zone); } catch { return errorReply(i, 'zoneError'); }
                let locale;
                try { locale = action === 'regionSubmit' && i.fields.getTextInputValue('locale').trim()
                    ? validateLocale(i.fields.getTextInputValue('locale').trim()) : localeForZone(zone, i.locale === 'tr' ? 'tr-TR' : i.locale || 'en-GB');
                } catch { return errorReply(i, 'localeError'); }
                s.zone = zone; s.locale = locale; s.timestamp = null;
                preferences.set(s.userId, { preferredTimeZone: zone, preferredHourFormat: s.format, preferredLocale: locale });
                return i.update(settings(s));
            }
            if (action === 'format') {
                s.stage = 'settings';
                if (!['auto', '12', '24'].includes(i.values[0])) return errorReply(i, 'expired');
                s.format = i.values[0];
                if (s.zone) preferences.set(s.userId, { preferredTimeZone: s.zone, preferredHourFormat: s.format, preferredLocale: s.locale });
                return i.update(settings(s));
            }
            if (action === 'period') {
                s.stage = 'settings';
                s.period = i.values[0] === 'AM' ? 'AM' : 'PM';
                s.time = parseTime(formatLocalTime(s.time || '21:00', '12').replace(/ (AM|PM)$/, ''), '12', s.period);
                s.timestamp = null;
                return i.update(settings(s));
            }
            if (action === 'details') {
                s.stage = 'settings';
                if (!s.zone || !s.type) return errorReply(i, 'expired');
                return i.showModal(detailsModal(s));
            }
            if (action === 'submit') {
                s.stage = 'settings'; s.timestamp = null; s.candidates = [];
                s.name = i.fields.getTextInputValue('name').trim();
                if (!s.name) return errorReply(i, 'invalidName');
                s.date = i.fields.getTextInputValue('date').trim();
                s.time = parseTime(i.fields.getTextInputValue('time'), hourFormat(s.format, s.locale), s.period);
                s.description = i.fields.getTextInputValue('description').trim();
                s.candidates = localCandidates(s.date, s.time, s.zone);
                s.timestamp = s.candidates.length === 1 ? s.candidates[0] : null;
                if (!s.candidates.length) return errorReply(i, 'gap');
                if (s.candidates.every(candidate => candidate <= now() / 1000)) return errorReply(i, 'past');
                s.stage = 'preview';
                return i.update(confirmation(s));
            }
            if (action === 'fold') {
                const candidate = Number(i.values[0]);
                if (s.stage !== 'preview' || !s.candidates?.includes(candidate)) return errorReply(i, 'expired');
                s.timestamp = candidate;
                return i.update(confirmation(s));
            }
            if (action === 'confirm') {
                if (s.stage !== 'preview' || !s.timestamp || !s.candidates?.includes(s.timestamp)) return errorReply(i, 'expired');
                if (s.timestamp <= now() / 1000) return errorReply(i, 'past');
                s.busy = true;
                await i.deferUpdate();
                const snapshot = timeSnapshot(s.date, s.time, s.zone, s.format, s.locale, s.timestamp);
                s.publicationStarted = true;
                await publish(i, { ...snapshot, zindan: s.name, zindanKodu: s.code === 'custom' ? s.name : s.code, contentType: s.type, aciklama: s.description }, s);
                sessions.delete(token);
                return i.editReply({ content: lines('success'), embeds: [], components: [] });
            }
            return errorReply(i, 'expired');
        } catch (error) {
            console.error('Raid creation failed:', error.message);
            const key = ['time12', 'time24'].includes(error.message) ? error.message : error.message === 'date' ? 'dateError' : 'failed';
            if (i.deferred) return i.editReply({ content: lines(key), embeds: [], components: [row(button(s, 'confirm', 'confirm'))] });
            return errorReply(i, key);
        } finally { s.busy = false; }
    }
    return { handle };
}
module.exports = { createRaidCreation, text, settings, detailsModal, confirmation };
