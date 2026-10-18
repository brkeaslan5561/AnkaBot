const { randomBytes } = require('node:crypto');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown } = require('discord.js');
const { canManage, upcoming, englishDate } = require('./raid_schedule');

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const stableId = ({ id, raid }) => String(raid.raidId || id);
function upcomingRaids(records, guildId, now = Date.now() / 1000) {
    return records.filter(({ raid }) => String(raid.guildId) === String(guildId) && upcoming(raid, now))
        .sort((a, b) => a.raid.unixZamani - b.raid.unixZamani || stableId(a).localeCompare(stableId(b)));
}
function registrationLink({ id, raid }) {
    const messageId = raid.messageId || (raid.published !== false && raid.status !== 'scheduled' ? id : null);
    return [raid.guildId, raid.channelId, messageId].every(value => /^\d+$/.test(String(value || '')))
        ? `https://discord.com/channels/${raid.guildId}/${raid.channelId}/${messageId}` : null;
}
async function verifyRegistration(client, record) {
    if (!registrationLink(record)) return true;
    try {
        const channel = await client.channels.fetch(record.raid.channelId);
        const message = await channel.messages.fetch(record.raid.messageId || record.id);
        return message.author.id === client.user.id;
    } catch (error) {
        if ([10003, 10008].includes(Number(error.code))) return false;
        throw error; // Never turn a permission/network error into a broken link.
    }
}
function scheduleEmbeds(records) {
    const embeds = [];
    let description = 'Here are our upcoming scheduled raids.';
    const flush = () => {
        embeds.push(new EmbedBuilder().setColor('#5865F2').setTitle('Upcoming Raids')
            .setDescription(description).setFooter({ text: 'Anka Bot' }));
        description = 'Here are our upcoming scheduled raids.';
    };
    for (const record of records) {
        const { raid } = record;
        const zone = raid.organizerTimeZone || 'UTC';
        const time = englishDate(raid.unixZamani, zone);
        const link = registrationLink(record);
        let block = `\n\n**${escapeMarkdown(String(raid.zindan || raid.zindanKodu || 'Raid').toUpperCase())}**\nDate: ${time.date}\nTime: ${time.time} (${zone})\nLeader: <@${raid.leaderId || raid.creatorId}>\nStatus: ${link ? 'Registration Open' : 'Registration Not Yet Open'}`;
        if (link) block += `\n[Join Raid](${link})`;
        else if (Number.isFinite(raid.publishAt)) {
            const opens = englishDate(raid.publishAt, zone);
            block += `\nRegistration Opens: ${opens.date} at ${opens.time}`;
        }
        if (description.length + block.length > 4000) flush();
        // Titles created through the wizard are <=80 characters. Reject
        // oversized corrupt legacy data rather than silently truncating it.
        if (description.length + block.length > 4096) throw new Error('Raid information exceeds Discord embed limits.');
        description += block;
    }
    if (records.length) flush();
    return embeds;
}
function selectionPayload(s) {
    const pageCount = Math.ceil(s.records.length / 25);
    s.page = Math.max(0, Math.min(s.page, pageCount - 1));
    const page = s.records.slice(s.page * 25, (s.page + 1) * 25);
    const componentId = action => `raid_share_${s.token}_${action}`;
    const button = (action, label, disabled = false) => new ButtonBuilder().setCustomId(componentId(action)).setLabel(label).setStyle(action === 'share' ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(disabled);
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('Scheduled Raids')
        .setDescription('Select the raids you want to include in the schedule announcement.')
        .setFooter({ text: `Anka Bot • Page ${s.page + 1}/${pageCount} • ${s.selected.size} selected` });
    return { content: '', embeds: [embed], allowedMentions: { parse: [] }, components: [
        row(new StringSelectMenuBuilder().setCustomId(componentId(`select-${s.page}`)).setPlaceholder('Select upcoming raids')
            .setMinValues(0).setMaxValues(page.length).addOptions(page.map(record => {
                const time = englishDate(record.raid.unixZamani, record.raid.organizerTimeZone || 'UTC');
                return { label: `${record.raid.zindan || record.raid.zindanKodu || 'Raid'} — ${time.date}, ${time.time}`.slice(0, 100),
                    description: `${time.date} • ${time.time} • ${record.raid.organizerTimeZone || 'UTC'}`.slice(0, 100),
                    value: stableId(record), default: s.selected.has(stableId(record)) };
            }))),
        row(button('previous', 'Previous', s.page === 0), button('next', 'Next', s.page + 1 >= pageCount), button('share', 'Share Selected'), button('cancel', 'Cancel'))
    ] };
}
function createShareSchedule({ getRaids, now = () => Date.now(), verify = verifyRegistration }) {
    const sessions = new Map();
    async function handle(i) {
        const starting = i.isChatInputCommand() && i.commandName === 'share-schedule';
        if (!starting && !i.customId?.startsWith('raid_share_')) return null;
        const reply = content => i.reply({ content, flags: [64] });
        if (!canManage(i)) return reply('You need Manage Server permission to share schedules.');
        let s;
        try {
            if (starting) {
                await i.deferReply({ flags: [64] });
                for (const [token, entry] of sessions) if (!entry.busy && now() - entry.created > 14 * 60_000) sessions.delete(token);
                const records = upcomingRaids(getRaids(), i.guildId, now() / 1000);
                if (!records.length) return i.editReply({ content: 'No upcoming raids found.', embeds: [], components: [] });
                s = { token: randomBytes(9).toString('hex'), userId: i.user.id, guildId: i.guildId, channelId: i.channelId,
                    records, selected: new Set(), page: 0, created: now() };
                sessions.set(s.token, s);
                return i.editReply(selectionPayload(s));
            }
            const [, , token, action] = i.customId.split('_');
            s = sessions.get(token);
            if (!s || s.userId !== i.user.id || s.guildId !== i.guildId || s.channelId !== i.channelId) return reply('This selection is unavailable or belongs to another user.');
            if (now() - s.created > 14 * 60_000) {
                sessions.delete(token);
                return i.update({ content: 'This selection has expired. Run /share-schedule again.', embeds: [], components: [] });
            }
            if (s.busy) return reply('Your schedule announcement is already being shared.');
            if (action === 'cancel') {
                sessions.delete(token);
                return i.update({ content: 'Schedule sharing cancelled.', embeds: [], components: [] });
            }
            if (action.startsWith('select-')) {
                if (action !== `select-${s.page}`) return reply('This page is outdated. Please use the current selection menu.');
                const pageIds = s.records.slice(s.page * 25, (s.page + 1) * 25).map(stableId);
                if (i.values.some(value => !pageIds.includes(value))) return reply('Invalid raid selection.');
                pageIds.forEach(value => s.selected.delete(value));
                i.values.forEach(value => s.selected.add(value));
            } else if (action === 'next') s.page++;
            else if (action === 'previous') s.page--;
            else if (action === 'share') {
                if (!s.selected.size) return reply('Please select at least one raid.');
                s.busy = true;
                await i.deferUpdate();
                let current = upcomingRaids(getRaids(), i.guildId, now() / 1000);
                const missing = new Set();
                for (const record of current.filter(record => s.selected.has(stableId(record)))) {
                    if (!await verify(i.client, record)) missing.add(stableId(record));
                }
                current = upcomingRaids(getRaids(), i.guildId, now() / 1000).filter(record => !missing.has(stableId(record)));
                const records = current.filter(record => s.selected.has(stableId(record)));
                if (records.length !== s.selected.size) {
                    s.records = current;
                    s.selected = new Set(records.map(stableId));
                    if (!current.length) { sessions.delete(token); return i.editReply({ content: 'No upcoming raids found.', embeds: [], components: [] }); }
                    return i.editReply({ ...selectionPayload(s), content: 'Some selected raids are no longer available. Review your selection and share again.' });
                }
                // A failed or partially sent batch is not reused. A fresh command
                // may share again, but this confirmation cannot double-submit.
                sessions.delete(token);
                const embeds = scheduleEmbeds(records);
                for (const embed of embeds) await i.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
                return i.editReply({ content: 'Schedule shared successfully.', embeds: [], components: [] });
            } else return reply('This selection is no longer available.');
            await i.deferUpdate();
            return i.editReply(selectionPayload(s));
        } catch (error) {
            console.error('Schedule sharing failed:', error.message);
            const payload = { content: 'Failed to share schedule. Please try again.', embeds: [], components: [] };
            if (s) sessions.delete(s.token);
            if (i.deferred || i.replied) return i.editReply(payload).catch(() => {});
            return i.reply({ ...payload, flags: [64] }).catch(() => {});
        } finally { if (s) s.busy = false; }
    }
    return { handle };
}
module.exports = { createShareSchedule, upcomingRaids, registrationLink, scheduleEmbeds, selectionPayload, stableId, verifyRegistration };
