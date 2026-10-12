const fs = require('fs');
const { PermissionFlagsBits } = require('discord.js');
const {
    catalog,
    assetPath,
    setCatalogEmoji,
    getCatalogEmoji
} = require('./raid_catalog');

const EMOJI_CATEGORIES = ['artifacts', 'mounts', 'companions', 'auras'];
let syncPromise = null;

function shortHash(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).padStart(5, '0').slice(0, 5);
}

function emojiNameFor(category, item) {
    const prefixes = { artifacts: 'aa', mounts: 'am', companions: 'ac', auras: 'au' };
    const prefix = prefixes[category] || 'ai';
    const safeId = String(item.id || 'item').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    return `${prefix}_${safeId.slice(0, 22)}_${shortHash(`${category}:${safeId}`)}`.slice(0, 32);
}

async function syncCatalogEmojis(client) {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
        let central = null;
        if (process.env.ANKABOT_EMOJI_GUILD_ID) {
            try {
                const guild = await client.guilds.fetch(process.env.ANKABOT_EMOJI_GUILD_ID);
                central = await guild.emojis.fetch();
            } catch (error) { console.warn('Central emoji guild unavailable; using accessible emojis:', error.message); }
        }
        let application = null;
        let fetched = new Map();
        try {
            application = await client.application.fetch();
            fetched = await application.emojis.fetch();
        } catch (error) { console.warn('Application emojis unavailable; using central guild or text:', error.message); }
        if (!application && !central) return { created: 0, reused: 0, failed: 1 };
        const byName = new Map([...fetched.values()].map(emoji => [emoji.name, emoji]));
        let created = 0;
        let reused = 0;
        let failed = 0;

        for (const category of EMOJI_CATEGORIES) {
            for (const item of catalog[category] || []) {
                const iconPath = assetPath(item);

                const name = emojiNameFor(category, item);
                const existing = getCatalogEmoji(category, item.id);
                let emoji = (existing && (fetched.get(existing.id) || central?.get(existing.id))) || byName.get(name)
                    || central?.find(emoji => emoji.name === name || emoji.name === item.id.replace(/-/g, '_')) || null;
                if (!emoji) {
                    if (!application || !iconPath || !fs.existsSync(iconPath)) continue;
                    try {
                        emoji = await application.emojis.create({ attachment: iconPath, name });
                        byName.set(name, emoji);
                        created += 1;
                    } catch (error) {
                        failed += 1;
                        console.error(`Raid eşya emojisi yüklenemedi (${item.name}):`, error.message);
                        continue;
                    }
                } else {
                    reused += 1;
                }

                setCatalogEmoji(category, item.id, emoji);
            }
        }

        console.log(`✅ Raid eşya emojileri hazır: ${created} yeni, ${reused} mevcut${failed ? `, ${failed} hatalı` : ''}.`);
        return { created, reused, failed };
    })().catch(error => {
        syncPromise = null;
        throw error;
    });
    return syncPromise;
}

const warned = new Set();
function warnFallback(id) {
    if (warned.has(id)) return;
    warned.add(id);
    console.warn(`Emoji ${id} unavailable or not permitted; using text/Unicode fallback.`);
}
function emojiAllowed(id, context) {
    const client = context?.client;
    if (!client) return false;
    if (client.application?.emojis?.cache?.has(id)) return true;
    const emoji = client.emojis?.cache?.get(id);
    if (!emoji || emoji.available === false) return false;
    if (emoji.roles?.cache?.size && !emoji.roles.cache.some(role => emoji.guild?.members?.me?.roles?.cache?.has(role.id))) return false;
    const channel = context.channel || context;
    const guildId = context.guildId || channel.guildId || channel.guild?.id;
    if (!guildId || emoji.guild?.id === guildId) return true;
    const permissions = context.appPermissions || channel.permissionsFor?.(client.user);
    return Boolean(permissions?.has(PermissionFlagsBits.UseExternalEmojis));
}
function safeEmojiPayload(payload, context, forcePlain = false) {
    const allowed = id => {
        const ok = !forcePlain && emojiAllowed(id, context);
        if (!ok) warnFallback(id);
        return ok;
    };
    const clean = value => {
        if (typeof value === 'string') return value.replace(/<a?:[a-zA-Z0-9_]+:(\d+)>/g, (match, id) => allowed(id) ? match : '▫️');
        if (Array.isArray(value)) return value.map(clean);
        if (!value || typeof value !== 'object') return value;
        const data = typeof value.toJSON === 'function' ? value.toJSON() : value;
        const result = {};
        for (const [key, entry] of Object.entries(data)) {
            if (key === 'emoji' && entry?.id && !allowed(String(entry.id))) result[key] = { name: '▫️' };
            else result[key] = clean(entry);
        }
        return result;
    };
    if (typeof payload === 'string') return clean(payload);
    // Preserve attachments, buffers, allowedMentions and all transport options.
    const result = { ...payload };
    for (const key of ['content', 'embeds', 'components']) if (result[key] !== undefined) result[key] = clean(result[key]);
    return result;
}
async function sendEmojiSafe(target, method, payload, context = target) {
    try { return await target[method](safeEmojiPayload(payload, context)); }
    catch (error) {
        const invalidEmoji = Number(error.code) === 10014 || Number(error.code) === 50035 && /emoji/i.test(JSON.stringify(error.rawError?.errors || {}));
        if (!invalidEmoji) throw error;
        console.warn('Discord rejected an emoji; retrying once with plain text.');
        return target[method](safeEmojiPayload(payload, context, true));
    }
}
function emojiSafeInteraction(interaction) {
    // Local proxy for raid responses only; no client-wide monkey patch.
    return new Proxy(interaction, {
        get(target, key) {
            if (['reply', 'update', 'editReply', 'followUp'].includes(key)) return payload => sendEmojiSafe(target, key, payload, target);
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, key, value) { return Reflect.set(target, key, value); }
    });
}

module.exports = {
    emojiNameFor,
    syncCatalogEmojis,
    safeEmojiPayload,
    sendEmojiSafe,
    emojiSafeInteraction
};
