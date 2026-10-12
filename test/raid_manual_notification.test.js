const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const { _test: { buildManualRaidAddEmbed, sendManualRaidAddNotification, registerParticipant } } = require('../raid');

const messageId = '123456789012345678';
const userId = '223456789012345678';
const source = fs.readFileSync(path.join(__dirname, '..', 'raid.js'), 'utf8');
// Run the actual command body with in-memory persistence and Discord transports.
const handlerSource = source.slice(source.indexOf('async function raidManuelOyuncuEkle('), source.indexOf('async function raidDuzenleKomutuYonet('));
function fixture() {
    return {
        zindan: 'MSH (Master Soul Harvester)', contentType: 'trial', capacity: 10,
        unixZamani: Date.parse('2026-10-11T18:00:00Z') / 1000,
        guildId: '323456789012345678', channelId: '423456789012345678'
    };
}
function harness(raid = fixture()) {
    const sent = [], events = [], replies = [];
    const state = { raid, sent, events, replies, saveError: null, dmError: null, cardFails: false };
    const deps = {
        interactionLanguage: () => 'tr',
        raidHafizasi: new Map([[messageId, raid]]),
        isRaidClosed: () => false,
        raidPenaltyStatus: () => ({ blocked: false }),
        getProfile: () => null,
        normalizeInventory: () => ({}),
        registerParticipant,
        saveRaid: () => {
            if (state.saveError) throw state.saveError;
            events.push('saved');
        },
        updateRaidCard: async () => { events.push('card'); return state.cardFails ? null : {}; },
        sendManualRaidAddNotification,
        t: (language, key) => key
    };
    const handle = new Function(...Object.keys(deps), `${handlerSource}\nreturn raidManuelOyuncuEkle;`)(...Object.values(deps));
    state.add = (id = userId, role = 'dps') => handle({
        client: {}, channelId: raid.channelId,
        options: {
            getString: key => ({ id: messageId, role, klas: 'Wizard' })[key],
            getMember: () => null,
            getUser: () => ({ id, username: 'Player', async send(payload) {
                events.push('dm');
                if (state.dmError) throw state.dmError;
                sent.push({ id, payload });
            } })
        },
        deferReply: async payload => { assert.equal(payload.flags[0], 64); },
        editReply: async content => { replies.push(content); return content; }
    });
    return state;
}
function field(json, name) { return json.fields.find(item => item.name === name)?.value; }

test('real EmbedBuilder creates one bilingual orange embed, correct TR date and original link', () => {
    const embed = buildManualRaidAddEmbed({}, messageId, fixture(), { role: 'dps' });
    assert.ok(embed instanceof EmbedBuilder);
    const json = embed.toJSON();
    assert.equal(json.color, 0xE58A3B);
    assert.equal(json.title, "Raid'e Eklendiniz!");
    assert.ok(json.description.startsWith('*You Have Been Added to a Raid!*\n\nBir raid lideri'));
    assert.equal(field(json, 'Tarih / Date'), '11.10.2026');
    assert.equal(field(json, 'Saat / Time'), '21:00 (TR)');
    assert.equal(field(json, 'Rol / Role'), 'DPS');
    assert.ok(json.fields.some(f => f.value.includes(`https://discord.com/channels/323456789012345678/423456789012345678/${messageId}`)));
    assert.equal(json.footer.text, 'AnkaBot • Raid Notification');
});

test('long/missing data, missing link and bot avatar stay within Discord limits', () => {
    const raid = { zindan: 'Uzun raid adı '.repeat(500), unixZamani: 'invalid' };
    const client = { user: { displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' } };
    const embed = buildManualRaidAddEmbed(client, 'bad-id', raid, { role: 'yedek' });
    const json = embed.toJSON();
    assert.ok(embed.length < 6000);
    assert.ok(json.fields.length <= 25);
    assert.ok(json.fields.every(f => f.value.length <= 1024 && f.name.length <= 256));
    assert.equal(field(json, 'Tarih / Date'), '—');
    assert.equal(field(json, 'Saat / Time'), '—');
    assert.match(field(json, 'Rol / Role'), /\*RESERVE\*/);
    assert.ok(!JSON.stringify(json).includes('/channels/'));
    assert.equal(json.footer.icon_url, client.user.displayAvatarURL());
    assert.equal(field(buildManualRaidAddEmbed({}, messageId, {}, {}).toJSON(), 'Raid'), '—');
});

test('Istanbul conversion crosses midnight once, independent of host timezone', () => {
    const raid = { ...fixture(), unixZamani: Date.parse('2026-10-11T22:30:00Z') / 1000 };
    const json = buildManualRaidAddEmbed({}, messageId, raid, { role: 'heal' }).toJSON();
    assert.equal(field(json, 'Tarih / Date'), '12.10.2026');
    assert.equal(field(json, 'Saat / Time'), '01:30 (TR)');
    assert.equal(field(json, 'Rol / Role'), 'HEALER');
});

test('new manual addition persists before sending exactly one DM', async () => {
    const h = harness();
    await h.add();
    assert.deepEqual(h.events, ['saved', 'card', 'dm']);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].payload.embeds.length, 1);
    assert.equal(h.raid.dpsler[0].userId, userId);
});

test('simultaneous distinct additions each get one DM; same-player double click gets one', async () => {
    const h = harness();
    await Promise.all([h.add(), h.add(), h.add('523456789012345678')]);
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent.filter(item => item.id === userId).length, 1);
    assert.equal(h.raid.dpsler.length, 2);
});

test('existing record and role/class/inventory updates do not send another notification', async () => {
    const h = harness();
    await h.add();
    const order = h.raid.dpsler[0].sira;
    await h.add();
    await h.add(userId, 'tank');
    assert.equal(h.sent.length, 1);
    assert.equal(h.raid.tanklar[0].sira, order);
    assert.equal(h.raid.dpsler.length, 0);
});

test('removal followed by a new addition sends a new DM', async () => {
    const h = harness();
    await h.add();
    h.raid.dpsler = [];
    await h.add();
    assert.equal(h.sent.length, 2);
});

test('reloaded existing records do not receive a notification', async () => {
    const first = harness();
    await first.add();
    const restarted = harness(JSON.parse(JSON.stringify(first.raid)));
    await restarted.add();
    assert.equal(restarted.sent.length, 0);
});

test('failed persistence never sends a notification', async () => {
    const h = harness();
    h.saveError = new Error('disk full');
    await assert.rejects(h.add(), /disk full/);
    assert.equal(h.sent.length, 0);
    assert.ok(!h.events.includes('dm'));
});

test('closed DMs preserve registration and give the leader an ephemeral failure notice', async t => {
    const logs = [];
    t.mock.method(console, 'warn', (...args) => logs.push(args.join(' ')));
    const h = harness();
    h.dmError = Object.assign(new Error('Cannot send messages'), { code: 50007 });
    await h.add();
    assert.equal(h.raid.dpsler.length, 1);
    assert.match(h.replies[0], /özel mesaj gönderilemedi/);
    assert.match(logs[0], /kind=permanent/);
    await h.add();
    assert.equal(h.events.filter(e => e === 'dm').length, 1);
});

test('transient DM errors are logged without retrying or undoing registration', async t => {
    const logs = [];
    t.mock.method(console, 'warn', (...args) => logs.push(args.join(' ')));
    const h = harness();
    h.dmError = Object.assign(new Error('service unavailable'), { status: 503 });
    await h.add();
    assert.equal(h.raid.dpsler.length, 1);
    assert.equal(h.events.filter(e => e === 'dm').length, 1);
    assert.match(logs[0], /kind=transient/);
});

test('name-only participants, mismatched IDs and bot accounts are skipped safely', async () => {
    let attempts = 0;
    for (const user of [null, { id: 'manual-player' }, { id: userId, bot: true }, { id: '623456789012345678' }]) {
        const target = user && { ...user, send: async () => { attempts++; } };
        assert.equal(await sendManualRaidAddNotification({}, messageId, fixture(), target, { record: { userId } }), 'skipped');
    }
    assert.equal(attempts, 0);
});

test('full dungeon keeps reserve placement and reports actual reserve role in DM', async () => {
    const h = harness({ ...fixture(), contentType: 'dungeon', capacity: 5 });
    for (let i = 0; i < 6; i++) await h.add(String(723456789012345678n + BigInt(i)));
    assert.equal(h.raid.dpsler.length, 5);
    assert.equal(h.raid.yedekler.length, 1);
    assert.match(field(h.sent[5].payload.embeds[0].toJSON(), 'Rol / Role'), /RESERVE/);
});

test('raid card refresh failure does not prevent a successful addition notification', async () => {
    const h = harness();
    h.cardFails = true;
    await h.add();
    assert.equal(h.sent.length, 1);
});

test('manual notification has only one production call site; signup retains its own DM', () => {
    assert.equal((source.match(/await sendManualRaidAddNotification\(/g) || []).length, 1);
    assert.ok(!handlerSource.includes('sendRegistrationReminder('));
    const signup = source.slice(source.indexOf('async function completeRegistration('), source.indexOf('function findParticipant('));
    assert.ok(signup.includes('sendRegistrationReminder('));
    assert.ok(!signup.includes('sendManualRaidAddNotification('));
});
