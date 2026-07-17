const fs = require('fs');
const {
    catalog,
    assetPath,
    setCatalogEmoji
} = require('./raid_catalog');

const EMOJI_CATEGORIES = ['artifacts', 'mounts', 'companions'];
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
    const prefixes = { artifacts: 'aa', mounts: 'am', companions: 'ac' };
    const prefix = prefixes[category] || 'ai';
    const safeId = String(item.id || 'item').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    return `${prefix}_${safeId.slice(0, 22)}_${shortHash(`${category}:${safeId}`)}`.slice(0, 32);
}

async function syncCatalogEmojis(client) {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
        if (!client.application) throw new Error('Discord uygulaması henüz hazır değil.');
        const application = await client.application.fetch();
        const fetched = await application.emojis.fetch();
        const byName = new Map(fetched.map(emoji => [emoji.name, emoji]));
        let created = 0;
        let reused = 0;
        let failed = 0;

        for (const category of EMOJI_CATEGORIES) {
            for (const item of catalog[category] || []) {
                const iconPath = assetPath(item);
                if (!iconPath || !fs.existsSync(iconPath)) continue;

                const name = emojiNameFor(category, item);
                let emoji = byName.get(name) || null;
                if (!emoji) {
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

module.exports = {
    emojiNameFor,
    syncCatalogEmojis
};
