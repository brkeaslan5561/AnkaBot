const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { safeEmojiPayload, sendEmojiSafe, emojiSafeInteraction, emojiNameFor } = require('../raid_emojis');
const { catalog, getCatalogEmoji, setCatalogEmoji } = require('../raid_catalog');

const emojiId = '123456789012345678';
const custom = `<:ztank:${emojiId}>`;
function context({ external = true, app = false, available = true, source = 'central', target = 'other' } = {}) {
    return {
        guildId: target,
        client: {
            user: { id: 'bot' }, application: { emojis: { cache: new Collection(app ? [[emojiId, {}]] : []) } },
            emojis: { cache: new Collection([[emojiId, { id: emojiId, guild: { id: source }, available }]]) }
        },
        appPermissions: { has: permission => permission === PermissionFlagsBits.UseExternalEmojis && external }
    };
}
function payload() {
    return { content: `Tank ${custom}`, embeds: [new EmbedBuilder().setDescription(custom)],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('join').setLabel('Tank').setStyle(ButtonStyle.Primary).setEmoji(custom))],
        files: [Buffer.from('png-unchanged')] };
}

test('central guild emoji works across guilds with external emoji permission and keeps its ID', () => {
    const clean = safeEmojiPayload(payload(), context());
    assert.equal(clean.content, `Tank ${custom}`);
    assert.equal(clean.components[0].components[0].emoji.id, emojiId);
});

test('no external permission or unavailable emoji falls back without modifying source builders or PNG', t => {
    t.mock.method(console, 'warn', () => {});
    const original = payload();
    for (const options of [{ external: false }, { available: false }]) {
        const clean = safeEmojiPayload(original, context(options));
        assert.equal(clean.content, 'Tank ▫️');
        assert.equal(clean.components[0].components[0].emoji.id, undefined);
        assert.equal(clean.embeds[0].description, '▫️');
        assert.equal(clean.files, original.files);
        assert.equal(original.embeds[0].toJSON().description, custom);
    }
});

test('own application emojis do not require external permission; same-server emojis remain usable', () => {
    assert.equal(safeEmojiPayload(custom, context({ app: true, external: false })), custom);
    assert.equal(safeEmojiPayload(custom, context({ source: 'same', target: 'same', external: false })), custom);
});

test('unknown and role-restricted custom emojis safely degrade to text', t => {
    t.mock.method(console, 'warn', () => {});
    assert.equal(safeEmojiPayload(custom, {}), '▫️');
    const ctx = context();
    ctx.client.emojis.cache.get(emojiId).roles = { cache: new Collection([['restricted', { id: 'restricted' }]]) };
    assert.equal(safeEmojiPayload(custom, ctx), '▫️');
});

test('Discord invalid-emoji rejection retries once without emojis; network failures never resend', async t => {
    t.mock.method(console, 'warn', () => {});
    const seen = [];
    const target = { send: async message => {
        seen.push(message);
        if (seen.length === 1) throw Object.assign(new Error('Invalid emoji'), { code: 50035, rawError: { errors: { components: { emoji: { code: 'BUTTON_COMPONENT_INVALID_EMOJI' } } } } });
        return 'sent';
    } };
    assert.equal(await sendEmojiSafe(target, 'send', payload(), context()), 'sent');
    assert.equal(seen.length, 2);
    assert.equal(seen[1].content, 'Tank ▫️');
    let attempts = 0;
    await assert.rejects(sendEmojiSafe({ send: async () => { attempts++; throw new Error('network'); } }, 'send', payload(), context()), /network/);
    assert.equal(attempts, 1);
});

test('raid interaction proxy keeps acknowledgement state and sanitizes only response data', async t => {
    t.mock.method(console, 'warn', () => {});
    const original = { ...context({ external: false }), deferred: false,
        async deferUpdate() { this.deferred = true; },
        async update(message) { return message; }
    };
    const wrapped = emojiSafeInteraction(original);
    await wrapped.deferUpdate();
    assert.equal(wrapped.deferred, true);
    assert.equal((await wrapped.update(payload())).content, 'Tank ▫️');
});

test('existing application catalog emoji IDs are reused, including aura icons', async () => {
    delete require.cache[require.resolve('../raid_emojis')];
    const { syncCatalogEmojis } = require('../raid_emojis');
    const emojis = new Collection();
    let serial = 100000000000000000n;
    for (const category of ['artifacts', 'mounts', 'companions', 'auras']) for (const item of catalog[category]) {
        const emoji = { id: String(serial++), name: emojiNameFor(category, item) };
        emojis.set(emoji.id, emoji);
    }
    let creates = 0;
    const client = { application: { fetch: async () => ({ emojis: { fetch: async () => emojis, create: async () => { creates++; throw new Error('unexpected'); } } }) } };
    await syncCatalogEmojis(client);
    assert.equal(creates, 0);
    const item = catalog.artifacts[0];
    assert.equal(getCatalogEmoji('artifacts', item.id).id, [...emojis.values()].find(e => e.name === emojiNameFor('artifacts', item)).id);
});

test('central guild remains usable if application emoji API fails', async t => {
    t.mock.method(console, 'warn', () => {});
    const previous = process.env.ANKABOT_EMOJI_GUILD_ID;
    process.env.ANKABOT_EMOJI_GUILD_ID = 'central';
    t.after(() => { if (previous === undefined) delete process.env.ANKABOT_EMOJI_GUILD_ID; else process.env.ANKABOT_EMOJI_GUILD_ID = previous; });
    delete require.cache[require.resolve('../raid_emojis')];
    const { syncCatalogEmojis } = require('../raid_emojis');
    const item = catalog.artifacts[0];
    setCatalogEmoji('artifacts', item.id, null);
    const central = new Collection([[emojiId, { id: emojiId, name: item.id }]]);
    await syncCatalogEmojis({
        guilds: { fetch: async id => { assert.equal(id, 'central'); return { emojis: { fetch: async () => central } }; } },
        application: { fetch: async () => { throw new Error('offline'); } }
    });
    assert.equal(getCatalogEmoji('artifacts', item.id).id, emojiId);
});
