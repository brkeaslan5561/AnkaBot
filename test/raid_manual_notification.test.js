const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const { _test: { buildRaidNotificationEmbed, buildManualRaidAddEmbed, manualRaidLinkRow, sendManualRaidAddNotification, registerParticipant, manualPlayerInventory, dpsLimitForRaid, findSavedProfile, profileClassKey } } = require('../raid');

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
    const state = { raid, sent, events, replies, saveError: null, dmError: null, cardFails: false,
        message: { id: messageId, url: `https://discord.com/channels/323456789012345678/423456789012345678/${messageId}` } };
    const deps = {
        interactionLanguage: () => 'tr',
        raidHafizasi: new Map([[messageId, raid]]),
        isRaidClosed: () => false,
        raidPenaltyStatus: () => ({ blocked: false }),
        getProfile: () => state.profile || null,
        manualPlayerInventory, dpsLimitForRaid,
        normalizeInventory: () => ({}),
        registerParticipant,
        saveRaid: () => {
            if (state.saveError) throw state.saveError;
            events.push('saved');
        },
        updateRaidCard: async () => { events.push('card'); return state.cardFails ? null : state.message; },
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
function field(json, name) {
    const [tr, en] = name.split(' / ');
    const label = `**${tr}**${en ? ` / ${en}` : ''}\n`;
    return json.fields.find(item => item.value.startsWith(label))?.value.slice(label.length);
}

test('real EmbedBuilder creates one bilingual orange embed with unbolded Discord timestamps', () => {
    const embed = buildManualRaidAddEmbed({}, messageId, fixture(), { role: 'dps' });
    assert.ok(embed instanceof EmbedBuilder);
    const json = embed.toJSON();
    assert.equal(json.color, 0xE58A3B);
    assert.equal(json.title, "Raid'e Eklendiniz!");
    assert.ok(json.description.startsWith('*You Have Been Added to a Raid!*\n\n**Bir raid lideri'));
    assert.equal(field(json, 'Tarih / Date'), `<t:${fixture().unixZamani}:D>`);
    assert.equal(field(json, 'Saat / Time'), `<t:${fixture().unixZamani}:t>`);
    assert.equal(field(json, 'Rol / Role'), 'DPS');
    assert.ok(json.fields.every(f => f.name === '\u200b'));
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

test('raid instant is preserved without a second timezone offset', () => {
    const raid = { ...fixture(), unixZamani: Date.parse('2026-10-11T22:30:00Z') / 1000 };
    const json = buildManualRaidAddEmbed({}, messageId, raid, { role: 'heal' }).toJSON();
    assert.equal(field(json, 'Tarih / Date'), `<t:${raid.unixZamani}:D>`);
    assert.equal(field(json, 'Saat / Time'), `<t:${raid.unixZamani}:t>`);
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

test('profile lookup handles uppercase English class names, Turkish I and role labels without mixing classes', () => {
    const inventory = { artifacts: ['Mythallar Fragment'], mounts: ['Swarm'], companions: ['Tutor'], auras: [] };
    const profiles = {
        'wızard': { className: 'WIZARD', inventory, updatedAt: 1 },
        'wizard': { className: 'Wizard', inventory: { ...inventory, mounts: ['Tunnel Vision'] }, updatedAt: 2 },
        'fighter': { className: 'Fighter', inventory: {}, updatedAt: 3 }
    };
    assert.equal(profileClassKey(' WIZARD (DPS) '), 'wizard');
    assert.equal(profileClassKey('Fighter (Tank)'), 'fighter');
    assert.deepEqual(findSavedProfile(profiles, 'WIZARD (DPS)').inventory.mounts, ['Tunnel Vision']);
    assert.equal(findSavedProfile(profiles, 'Paladin'), null);
});

test('manual addition loads all saved equipment and repeated addition does not erase raid inventory when the profile is missing', async () => {
    const h = harness();
    const inventory = { artifacts: ['Lantern of Revelation'], mounts: ['Demonic Gravehound'], companions: ['Tutor'], auras: [] };
    h.profile = { inventory };
    await h.add();
    assert.deepEqual(h.raid.dpsler[0].inventory, inventory);
    h.profile = null;
    await h.add();
    assert.deepEqual(h.raid.dpsler[0].inventory, inventory);
    assert.equal(h.sent.length, 1);
    assert.deepEqual(manualPlayerInventory(h.raid, userId, 'Paladin', null), { artifacts: [], mounts: [], companions: [], auras: [] });
});

test('missing equipment is reported to the manager instead of silently presenting an empty profile', async () => {
    const h = harness(); await h.add();
    assert.match(h.replies.at(-1), /raid.manual.missing_inventory/);
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
    assert.equal(h.sent[0].payload.components, undefined);
});

test('raid link uses the actual fetched message, not stale stored guild/channel IDs', async () => {
    const h = harness({ ...fixture(), guildId: '823456789012345678', channelId: '923456789012345678' });
    await h.add();
    const button = h.sent[0].payload.components[0].toJSON().components[0];
    assert.equal(button.style, 5);
    assert.equal(button.label, "Raid'e Git / View Raid");
    assert.equal(button.url, h.message.url);
    assert.ok(!button.custom_id);
});

test('unverified, wrong-message and external links are omitted', () => {
    for (const message of [null, {},
        { id: messageId, url: 'https://example.com/' },
        { id: messageId, url: 'https://discord.com/channels/323456789012345678/423456789012345678/523456789012345678' },
        { id: 'wrong', url: `https://discord.com/channels/323456789012345678/423456789012345678/${messageId}` }
    ]) assert.equal(manualRaidLinkRow(messageId, message), null);
});

test('signup matches manual theme; Turkish labels are bold while English and values are regular', () => {
    const raid = fixture();
    const signup = buildRaidNotificationEmbed({}, raid, { role: 'heal' });
    const json = signup.toJSON();
    const manual = buildManualRaidAddEmbed({}, messageId, raid, { role: 'heal' }).toJSON();
    assert.equal(json.color, manual.color);
    assert.equal(json.title, 'Kayıt Başarılı');
    assert.ok(json.description.startsWith('*Signup Confirmed*'));
    assert.deepEqual(json.footer, manual.footer);
    assert.deepEqual(json.fields.slice(0, 6), manual.fields.slice(0, 6));
    assert.equal(field(json, 'Kalan / Time Left'), `<t:${raid.unixZamani}:R>`);
    assert.equal(field(json, 'Rol / Role'), 'HEALER');
    for (const name of ['Tarih / Date', 'Saat / Time', 'Rol / Role', 'Kalan / Time Left']) {
        assert.ok(!field(json, name).includes('**'));
    }
    assert.ok(!JSON.stringify(json).includes('Remaining'));
    assert.ok(signup.length < 6000);
});

test('past raid retains its actual relative timestamp; invalid dates use safe placeholders', () => {
    const raid = { ...fixture(), unixZamani: 1_600_000_000 };
    assert.equal(field(buildRaidNotificationEmbed({}, raid, {}).toJSON(), 'Kalan / Time Left'), '<t:1600000000:R>');
    for (const unixZamani of [undefined, null, '', 'bad', -1, Infinity, 1e99]) {
        const json = buildRaidNotificationEmbed({}, { unixZamani }, {}).toJSON();
        for (const label of ['Tarih / Date', 'Saat / Time', 'Kalan / Time Left']) assert.equal(field(json, label), '—');
    }
});

test('manual notification has only one production call site; signup retains its own DM', () => {
    assert.equal((source.match(/await sendManualRaidAddNotification\(/g) || []).length, 1);
    assert.ok(!handlerSource.includes('sendRegistrationReminder('));
    const signup = source.slice(source.indexOf('async function completeRegistration('), source.indexOf('function findParticipant('));
    assert.ok(signup.includes('sendRegistrationReminder('));
    assert.ok(!signup.includes('sendManualRaidAddNotification('));
});

test('signup sender uses the shared design once and preserves its existing sent-user tracking', async () => {
    let saves = 0;
    const sent = [];
    const senderSource = source.slice(source.indexOf('async function sendRegistrationReminder('), source.indexOf('function generatePlan('));
    const send = new Function('buildRaidNotificationEmbed', 'saveRaid', `${senderSource}\nreturn sendRegistrationReminder;`)(
        buildRaidNotificationEmbed, () => { saves++; }
    );
    const raid = { ...fixture(), registrationReminderSentUsers: [] };
    const user = { id: userId, send: async payload => sent.push(payload) };
    assert.equal(await send({}, messageId, raid, user, 'heal'), true);
    assert.equal(await send({}, messageId, raid, user, 'heal'), false);
    assert.equal(sent.length, 1);
    assert.equal(saves, 1);
    assert.equal(sent[0].embeds[0].toJSON().color, 0xE58A3B);
    assert.equal(field(sent[0].embeds[0].toJSON(), 'Rol / Role'), 'HEALER');
});
