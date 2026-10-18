const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

const scheduleCommand = new SlashCommandBuilder().setName('schedule')
    .setDescription('Schedule a raid to open registration 24 hours before it starts.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false);
const shareScheduleCommand = new SlashCommandBuilder().setName('share-schedule')
    .setDescription('Select upcoming raids and share a schedule announcement.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false);
const canManage = i => Boolean(i.guildId && i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
const inactive = raid => raid.kapandi || raid.deleted || raid.cancelled || raid.completed || raid.attendanceCompleted ||
    ['deleted', 'cancelled', 'canceled', 'completed', 'expired'].includes(raid.status);
const upcoming = (raid, now = Date.now() / 1000) => !inactive(raid) && Number(raid.unixZamani) > now;
const pending = raid => raid.status === 'scheduled' && raid.published === false && !raid.messageId;
const publicationTime = raid => {
    const time = Number(raid.unixZamani) - 86400;
    if (!Number.isSafeInteger(time) || !Number.isFinite(new Date(time * 1000).getTime())) throw new Error('Invalid publication time.');
    return time;
};
function englishDate(timestamp, zone = 'UTC') {
    const date = new Date(timestamp * 1000);
    return {
        date: new Intl.DateTimeFormat('en-US', { timeZone: zone, dateStyle: 'long' }).format(date),
        time: new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(date)
    };
}
function scheduledConfirmation(raid) {
    const start = englishDate(raid.unixZamani, raid.organizerTimeZone);
    const publication = englishDate(Math.max(raid.publishAt, raid.createdAt || 0), raid.organizerTimeZone);
    return new EmbedBuilder().setColor('#5865F2').setAuthor({ name: 'Anka Bot' })
        .setTitle('Raid Scheduled Successfully')
        .setDescription('Your raid has been scheduled and will automatically be published 24 hours before it starts.' +
            (raid.publishAt <= raid.createdAt ? '\n\nImmediate publication was confirmed. Registration will open as soon as the announcement channel is available.' : ''))
        .addFields(Object.entries({ Raid: raid.zindan, 'Start Date': start.date, 'Start Time': start.time,
            Timezone: raid.organizerTimeZone, 'Publication Date': publication.date, 'Publication Time': publication.time,
            'Announcement Channel': `<#${raid.channelId}>`, 'Raid Leader': `<@${raid.creatorId}>`
        }).map(([name, value]) => ({ name, value, inline: name !== 'Raid' })));
}

// The marker survives nonce expiry and restarts. It is kept on subsequent card edits.
const publicationMarker = raid => `Schedule ${raid.raidId}`;
async function recoverPublication(channel, raid, botId) {
    let before;
    const since = raid.publicationAttempt.startedAt * 1000 - 60_000;
    for (;;) {
        const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (!messages.size) return null;
        for (const message of messages.values()) {
            if (message.author?.id === botId && message.embeds?.some(embed => embed.footer?.text?.endsWith(publicationMarker(raid)))) return message;
        }
        const oldest = [...messages.values()].reduce((a, b) => BigInt(a.id) < BigInt(b.id) ? a : b);
        if (oldest.createdTimestamp < since || messages.size < 100) return null;
        if (before === oldest.id) throw new Error('Message history did not advance.');
        before = oldest.id;
    }
}

// All raid writes are owned by one process (see process_lock.js). Claims are
// persisted before sending; the synchronous busy claim also serializes callers.
function createPublicationWorker({ entries, save, commit, buildPayload, send, now = () => Date.now() / 1000 }) {
    const busy = new Set();
    async function publish(client, id) {
        const raid = entries().find(([key]) => key === id)?.[1];
        if (!raid || busy.has(id) || !pending(raid) || inactive(raid) ||
            (!upcoming(raid, now()) && !raid.publicationAttempt) ||
            !Number.isSafeInteger(raid.publishAt) || raid.publishAt !== Number(raid.unixZamani) - 86400 || raid.publishAt > now() || raid.retryAt > now()) return;
        busy.add(id);
        try {
            const channel = await client.channels.fetch(raid.channelId);
            if (!channel?.send || String(channel.guildId) !== String(raid.guildId)) throw new Error('Announcement channel is unavailable.');
            const permissions = channel.permissionsFor?.(client.user);
            if (permissions && !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks,
                channel.isThread?.() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages])) throw new Error('Missing announcement channel permissions.');
            let message;
            if (raid.publicationAttempt) message = await recoverPublication(channel, raid, client.user.id);
            // Re-check after every asynchronous lookup: deleted/edited/expired
            // records must never be sent using a previously queued snapshot.
            const current = entries().find(([key]) => key === id)?.[1];
            if (current !== raid || !pending(raid) || inactive(raid) || raid.publishAt > now()) return;
            if (!message) {
                if (!upcoming(raid, now())) { delete raid.publicationAttempt; save(id, raid); return; }
                raid.publicationAttempt = { startedAt: now() };
                save(id, raid); // if persistence fails, no Discord side effect
                message = await send(channel, { ...buildPayload(raid), nonce: raid.raidId, enforceNonce: true, allowedMentions: { parse: [] } }, client);
            }
            if (entries().find(([key]) => key === id)?.[1] !== raid || !pending(raid) || inactive(raid)) {
                await message.delete();
                return;
            }
            commit(id, raid, message.id, now());
        } catch (error) {
            raid.retryAt = now() + 60;
            // Keep an ambiguous send's claim for history reconciliation. Never
            // assume a transport timeout means Discord did not accept a message.
            try {
                if (entries().find(([key]) => key === id)?.[1] === raid && pending(raid) && !inactive(raid)) save(id, raid);
            } catch (saveError) { console.error('Publication state could not be saved:', saveError.message); }
            console.error(`Scheduled raid publication failed (${id}):`, error.message);
        } finally { busy.delete(id); }
    }
    async function tick(client) {
        for (const [id] of entries()) await publish(client, id);
    }
    return { tick, publish, isBusy: id => busy.has(id) };
}
module.exports = { scheduleCommand, shareScheduleCommand, canManage, upcoming, pending, publicationTime,
    englishDate, scheduledConfirmation, publicationMarker, recoverPublication, createPublicationWorker };
