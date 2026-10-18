const { randomBytes } = require('node:crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, escapeMarkdown } = require('discord.js');
const { validateTimeZone, validateLocale, localeForZone, hourFormat, parseTime, formatLocalTime, localCandidates, timeSnapshot } = require('./raid_time');

// Existing creation stays bilingual; scheduling explicitly requests English.
const { t } = require('./localization');
const translated = (language, key, variables) => t(language, `raid.creation.ui.${key}`, variables);
const schedulingText = {
    create: 'Schedule Raid', choose: 'Choose the raid you want to schedule.',
    reviewPrompt: 'Review the raid details before scheduling.',
    expired: 'This screen expired. Start again with /schedule.',
    cancelled: 'Raid scheduling cancelled.',
    localeError: 'Enter a valid regional locale (e.g. en-US, en-GB).'
};
const englishText = (key, s) => s?.scheduled && schedulingText[key] || translated('en', key);
const text = (key, s) => s?.englishOnly ? englishText(key, s) : `${translated('tr', key)} / ${translated('en', key)}`;
const lines = (key, s) => s?.englishOnly ? englishText(key, s) : `**${translated('tr', key)}**\n*${translated('en', key)}*`;
const COMMON_ZONES = [
    ['Türkiye', 'Europe/Istanbul'], ['United Kingdom', 'Europe/London'], ['Germany', 'Europe/Berlin'],
    ['United States (New York)', 'America/New_York'], ['United States (Los Angeles)', 'America/Los_Angeles'],
    ['United States (Chicago)', 'America/Chicago'], ['United States (Denver)', 'America/Denver'],
    ['Japan', 'Asia/Tokyo'], ['Australia (Sydney)', 'Australia/Sydney']
];
const LEGACY_CREATION_IDS = new Set(['raid_content_select', 'raid_custom_type', 'raid_custom_name_modal', 'raid_date_day_1', 'raid_date_day_2', 'raid_date_month', 'raid_date_time', 'raid_description_modal']);
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const id = (s, action) => `${s.scheduled ? 'raid_schedule' : 'raid_create'}_${s.token}_${action}`;
const button = (s, action, key, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id(s, action)).setLabel(s.scheduled && action === 'confirm' ? 'Schedule Raid' : translated('en', key)).setStyle(style);
const THEME = { color: '#5865F2', brand: 'Anka Bot' };
const zoneLabel = (zone, s) => {
    const country = COMMON_ZONES.find(([, value]) => value === zone)?.[0];
    return country ? `${s?.englishOnly && country === 'Türkiye' ? 'Turkey' : country} — ${zone}` : zone;
};
function screen(s, step, title, stage, body = '') {
    const embed = new EmbedBuilder().setColor(THEME.color).setTitle(title)
        .setAuthor({ name: THEME.brand, ...(s.avatar ? { iconURL: s.avatar } : {}) })
        .setDescription(`*${translated('en', 'step', { step })} · ${translated('en', stage)}*${body ? `\n\n${body}` : ''}`);
    return embed;
}
const field = (s, key, value, inline = false) => ({
    name: '\u200b', value: `${s.englishOnly ? `**${translated('en', key)}**` : `**${translated('tr', key)}** / *${translated('en', key)}*`}\n${value}`, inline
});
const payload = (embed, components = []) => ({ content: '', embeds: [embed], components, allowedMentions: { parse: [] } });
function contentPayload(s, contents) {
    const embed = screen(s, 1, text('create', s), 'selectRaid', lines('choose', s));
    return payload(embed, [row(new StringSelectMenuBuilder().setCustomId(id(s, 'content')).setPlaceholder(text('selectRaid', s)).addOptions(
        contents.map(item => ({ label: item.value === 'custom' ? text('custom', s) : item.label, value: item.value,
            description: text(item.value === 'custom' ? 'custom' : item.contentType === 'dungeon' ? 'dungeon' : 'trial', s),
            default: item.value === s.code, ...(item.emoji ? { emoji: item.emoji } : {}) }))
    )), row(button(s, 'cancel', 'cancel'))]);
}
function typePayload(s) {
    return payload(screen(s, 1, text('create', s), 'selectRaid', lines('chooseType', s)), [
        row(new StringSelectMenuBuilder().setCustomId(id(s, 'type')).setPlaceholder(text('type', s)).addOptions(
            { label: text('dungeon', s), value: 'dungeon', default: s.type === 'dungeon' },
            { label: text('trial', s), value: 'trial', default: s.type === 'trial' }
        )), row(button(s, 'back', 'back'), button(s, 'cancel', 'cancel'))
    ]);
}
const input = (key, label, placeholder, value, required = true, max = 100) => {
    const item = new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
    if (placeholder) item.setPlaceholder(placeholder);
    if (value) item.setValue(value);
    return row(item);
};
function settings(s) {
    const zones = COMMON_ZONES.map(([country, zone]) => ({ label: `${s.englishOnly && country === 'Türkiye' ? 'Turkey' : country} – ${zone}`.slice(0, 100), value: zone, default: zone === s.zone }));
    if (s.zone && !zones.some(option => option.value === s.zone)) zones.push({ label: s.zone, value: s.zone, default: true });
    zones.push({ label: text('other', s), value: 'other' });
    zones.push({ label: text('region', s), value: 'region' });
    const components = [row(new StringSelectMenuBuilder().setCustomId(id(s, 'zone')).setPlaceholder(text('zone', s)).addOptions(zones)),
        row(new StringSelectMenuBuilder().setCustomId(id(s, 'format')).setPlaceholder(text('format', s)).addOptions(
            ['auto', '24', '12'].map((value, i) => ({ label: text(['auto', 'twentyfour', 'twelve'][i], s), value, default: s.format === value }))
        ))];
    if (hourFormat(s.format, s.locale) === '12') components.push(row(new StringSelectMenuBuilder()
        .setCustomId(id(s, 'period')).setPlaceholder('AM / PM').addOptions(
            { label: 'AM', value: 'AM', default: s.period === 'AM' }, { label: 'PM', value: 'PM', default: s.period === 'PM' }
        )));
    components.push(row(button(s, 'details', 'next', ButtonStyle.Primary).setDisabled(!s.zone)),
        row(button(s, 'back', 'back'), button(s, 'cancel', 'cancel')));
    const format = hourFormat(s.format, s.locale);
    const summary = s.zone
        ? `${zoneLabel(s.zone, s)}\n${text(format === '12' ? 'twelve' : 'twentyfour', s)}${s.time ? ` · ${formatLocalTime(s.time, format)}` : `\n${lines('noTime', s)}`}`
        : lines('unknown', s);
    return payload(screen(s, 2, translated('en', 'timeSettings'), 'timeSettings', lines('setup', s))
        .addFields(field(s, 'current', summary)), components);
}
function detailsModal(s) {
    const format = hourFormat(s.format, s.locale);
    const displayed = s.timeInput ?? (s.time ? formatLocalTime(s.time, format) : null);
    const description = new TextInputBuilder().setCustomId('description').setLabel(text('description', s)).setPlaceholder(text('optional', s)).setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false);
    if (s.description) description.setValue(s.description);
    return new ModalBuilder().setCustomId(id(s, 'submit')).setTitle(`${translated('en', 'details')} · ${translated('en', 'step', { step: 3 })}`).addComponents(
        input('name', text('name', s), null, s.name, true, 80),
        input('date', text('date', s), 'YYYY-MM-DD', s.date, true, 10),
        input('time', `${text('time', s)} · ${format === '12' ? 'AM/PM' : '24h'}`, format === '12' ? `9:00 ${s.period}` : '21:00', displayed, true, 12),
        row(description)
    );
}
function confirmation(s) {
    const dateText = new Intl.DateTimeFormat(s.englishOnly ? 'en-US' : s.locale, { timeZone: s.zone, dateStyle: 'long' }).format(new Date(s.candidates[0] * 1000));
    const fields = [
        field(s, 'date', `${dateText}\n${s.timestamp ? `<t:${s.timestamp}:F>` : lines('fold', s)}`),
        field(s, 'time', formatLocalTime(s.time, hourFormat(s.format, s.locale))),
        field(s, 'zone', zoneLabel(s.zone, s))
    ];
    const embed = screen(s, 4, translated('en', 'review'), 'finalReview', `**${escapeMarkdown(s.name)}**\n\n${lines('reviewPrompt', s)}`).addFields(fields);
    if (s.description) embed.addFields(field(s, 'description', s.description));
    const components = [];
    if (s.candidates.length > 1) components.push(row(new StringSelectMenuBuilder().setCustomId(id(s, 'fold')).setPlaceholder(text('foldChoice', s)).addOptions(
        s.candidates.map(timestamp => ({ label: `${new Date(timestamp * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC`, value: String(timestamp), default: timestamp === s.timestamp }))
    )));
    components.push(row(button(s, 'confirm', 'confirm', ButtonStyle.Success).setDisabled(!s.timestamp)),
        row(button(s, 'details', 'back'), button(s, 'settings', 'timeSettings'), button(s, 'cancel', 'cancel')));
    return payload(embed, components);
}
function createRaidCreation({ contents, preferences, publish, schedule, canManage, now = () => Date.now() }) {
    const sessions = new Map();
    const errorReply = (i, key) => {
        const englishOnly = i.commandName === 'schedule' || i.customId?.startsWith('raid_schedule_');
        return i.reply({ content: englishOnly && key === 'failed' ? 'Failed to schedule raid. Please try again.' : lines(key, { englishOnly, scheduled: englishOnly }), flags: [64] });
    };
    async function handle(i) {
        const starting = i.isChatInputCommand() && ['raid-oluştur', 'schedule'].includes(i.commandName);
        if (LEGACY_CREATION_IDS.has(i.customId)) return errorReply(i, 'expired');
        if (!starting && !/^raid_(create|schedule)_/.test(i.customId || '')) return null;
        if ((i.commandName === 'schedule' || i.customId?.startsWith('raid_schedule_')) && !canManage?.(i)) return i.reply({ content: 'You need Manage Server permission to schedule raids.', flags: [64] });
        if (starting) {
            if (!i.guildId) return errorReply(i, 'guild');
            for (const [key, session] of sessions) if (now() - session.created > 30 * 60_000 && !session.busy) sessions.delete(key);
            const preference = preferences.get(i.user.id);
            const s = { scheduled: i.commandName === 'schedule', englishOnly: i.commandName === 'schedule', token: randomBytes(9).toString('hex'), userId: i.user.id, channelId: i.channelId, guildId: i.guildId, created: now(), stage: 'content',
                zone: preference?.preferredTimeZone || null, format: preference?.preferredHourFormat || 'auto',
                locale: preference?.preferredLocale || (i.locale === 'tr' ? 'tr-TR' : i.locale || 'en-GB'), period: 'PM',
                avatar: i.client?.user?.displayAvatarURL?.({ extension: 'png', size: 64 }) };
            sessions.set(s.token, s);
            return i.reply({ ...contentPayload(s, contents), flags: [64] });
        }
        const [, , token, action] = i.customId.split('_');
        const s = sessions.get(token);
        if (!s || s.userId !== i.user.id || s.channelId !== i.channelId || s.guildId !== i.guildId || now() - s.created > 30 * 60_000) return errorReply(i, 'expired');
        if (s.busy) return errorReply(i, 'busy');
        if (s.publicationStarted && !['confirm', 'immediate'].includes(action)) return errorReply(i, 'busy');
        try {
            if (action === 'cancel') { sessions.delete(token); return i.update({ content: lines('cancelled', s), embeds: [], components: [] }); }
            if (action === 'back') { s.stage = 'content'; return i.update(contentPayload(s, contents)); }
            if (action === 'content') {
                if (s.stage !== 'content') return errorReply(i, 'expired');
                const item = contents.find(entry => entry.value === i.values[0]);
                if (!item) return errorReply(i, 'expired');
                s.stage = 'settings'; s.timestamp = null;
                if (s.code !== item.value) { s.name = item.value === 'custom' ? '' : item.label; s.type = null; }
                s.code = item.value;
                if (item.value === 'custom') { s.stage = 'type'; return i.update(typePayload(s)); }
                s.type = item.contentType;
                return i.update(settings(s));
            }
            if (action === 'type') {
                if (s.stage !== 'type' || !['dungeon', 'trial'].includes(i.values[0])) return errorReply(i, 'expired');
                s.type = i.values[0]; s.stage = 'settings'; return i.update(settings(s));
            }
            if (action === 'settings') { s.stage = 'settings'; return i.update(settings(s)); }
            if (['zone', 'format', 'period', 'region', 'regionSubmit'].includes(action) && s.stage !== 'settings') return errorReply(i, 'expired');
            if (action === 'zone' && ['other', 'region'].includes(i.values[0]) || action === 'region') {
                return i.showModal(new ModalBuilder().setCustomId(id(s, 'regionSubmit')).setTitle(text('zone', s)).addComponents(
                    input('zone', text('zone', s), 'Asia/Tokyo', s.zone, true, 100),
                    input('locale', text('locale', s), s.englishOnly ? 'en-US / en-GB' : 'en-US / tr-TR / de-DE', action === 'region' || i.values?.[0] === 'region' ? s.locale : null, false, 35)
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
                if (s.time) s.timeInput = null;
                preferences.set(s.userId, { preferredTimeZone: zone, preferredHourFormat: s.format, preferredLocale: locale });
                return i.update(settings(s));
            }
            if (action === 'format') {
                s.stage = 'settings';
                if (!['auto', '12', '24'].includes(i.values[0])) return errorReply(i, 'expired');
                s.format = i.values[0];
                if (s.time) s.timeInput = null;
                if (s.zone) preferences.set(s.userId, { preferredTimeZone: s.zone, preferredHourFormat: s.format, preferredLocale: s.locale });
                return i.update(settings(s));
            }
            if (action === 'period') {
                s.stage = 'settings';
                s.period = i.values[0] === 'AM' ? 'AM' : 'PM';
                if (s.time) {
                    s.time = parseTime(formatLocalTime(s.time, '12').replace(/ (AM|PM)$/, ''), '12', s.period);
                    s.timeInput = null;
                }
                s.timestamp = null;
                return i.update(settings(s));
            }
            if (action === 'details') {
                if (!['settings', 'preview'].includes(s.stage) || !s.zone || !s.type) return errorReply(i, 'expired');
                return i.showModal(detailsModal(s));
            }
            if (action === 'submit') {
                if (!['settings', 'preview'].includes(s.stage) || !s.zone || !s.type) return errorReply(i, 'expired');
                s.stage = 'settings'; s.timestamp = null; s.candidates = [];
                s.name = i.fields.getTextInputValue('name').trim();
                s.date = i.fields.getTextInputValue('date').trim();
                s.timeInput = i.fields.getTextInputValue('time').trim();
                s.description = i.fields.getTextInputValue('description').trim();
                s.time = null;
                if (!s.name) return errorReply(i, 'invalidName');
                s.time = parseTime(s.timeInput, hourFormat(s.format, s.locale), s.period);
                s.timeInput = null;
                s.period = Number(s.time.slice(0, 2)) < 12 ? 'AM' : 'PM';
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
            if (action === 'confirm' || action === 'immediate') {
                if (s.stage !== 'preview' || !s.timestamp || !s.candidates?.includes(s.timestamp)) return errorReply(i, 'expired');
                if (s.timestamp <= now() / 1000) return errorReply(i, 'past');
                if (s.scheduled && s.timestamp - 86400 <= now() / 1000 && !s.immediateConfirmed) {
                    if (action !== 'immediate' || s.immediateTimestamp !== s.timestamp) {
                        s.immediateTimestamp = s.timestamp;
                        return i.update({ content: 'This raid starts in less than 24 hours. Its registration message will be published immediately. Confirm to continue.', embeds: [],
                            components: [row(new ButtonBuilder().setCustomId(id(s, 'immediate')).setLabel('Confirm Immediate Publication').setStyle(ButtonStyle.Success), button(s, 'cancel', 'cancel'))] });
                    }
                    s.immediateConfirmed = true;
                }
                s.busy = true;
                await i.deferUpdate();
                const snapshot = timeSnapshot(s.date, s.time, s.zone, s.format, s.locale, s.timestamp);
                s.publicationStarted = true;
                const result = await (s.scheduled ? schedule : publish)(i, { ...snapshot, zindan: s.name, zindanKodu: s.code === 'custom' ? s.name : s.code, contentType: s.type, aciklama: s.description }, s);
                sessions.delete(token);
                return i.editReply(s.scheduled ? { content: '', embeds: [result], components: [] } : { content: lines('success'), embeds: [], components: [] });
            }
            return errorReply(i, 'expired');
        } catch (error) {
            console.error('Raid creation failed:', error.message);
            const key = ['time12', 'time24'].includes(error.message) ? error.message : error.message === 'date' ? 'dateError' : 'failed';
            if (i.deferred) return i.editReply({ ...confirmation(s), content: s.scheduled ? 'Failed to schedule raid. Please try again.' : lines(key), components: [row(button(s, 'confirm', 'confirm', ButtonStyle.Success))] });
            return errorReply(i, key);
        } finally { s.busy = false; }
    }
    return { handle };
}
module.exports = { createRaidCreation, text, settings, detailsModal, confirmation };
