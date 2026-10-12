const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');
const { resolveRaidTimeEdit, timeSnapshot } = require('../raid_time');
const { _test } = require('../raid');
const { buildLeaderEmbed } = require('../raid_leader');
const source = fs.readFileSync(path.join(__dirname, '..', 'raid.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const start = Date.parse('2027-10-20T17:00:00Z') / 1000;
function fixture() {
    return _test.normalizeRaid({ ...timeSnapshot('2027-10-20', '20:00', 'Europe/Istanbul', '24', 'tr-TR', start),
        zindan: 'MSH', creatorId: 'leader', guildId: 'guild', contentType: 'trial', capacity: 10 });
}

test('authorized editing keeps the raid zone; foreign users/guilds cannot edit its start time', async () => {
    const raid = fixture();
    let saves = 0;
    const deps = {
        interactionLanguage: () => 'en', raidHafizasi: new Map([['message', raid]]),
        leaderOwnsRaid: (i, r) => i.user.id === r.creatorId,
        PermissionFlagsBits, resolveRaidTimeEdit: (r, changes) => resolveRaidTimeEdit(r, changes, 0),
        discordTarihMetniOlustur: timestamp => `<t:${timestamp}:F>`,
        saveRaid: () => { saves++; }, updateRaidCard: async () => {}, t: (_, key) => key
    };
    const handler = new Function(...Object.keys(deps), between('async function raidDuzenleKomutuYonet(', 'const raidCreation =') + '\nreturn raidDuzenleKomutuYonet;')(...Object.values(deps));
    const interaction = (user, guildId = 'guild') => ({
        user: { id: user }, guildId, client: {}, channelId: 'channel',
        options: { getString: key => ({ id: 'message', saat: '21:15' })[key] ?? null, getInteger: () => null },
        deferReply: async () => {}, editReply: async payload => payload
    });
    await handler(interaction('stranger'));
    await handler(interaction('leader', 'foreign-guild'));
    assert.equal(saves, 0);
    assert.equal(raid.unixZamani, start);
    await handler(interaction('leader'));
    assert.equal(saves, 1);
    assert.equal(raid.unixZamani, start + 75 * 60);
    assert.equal(raid.organizerTimeZone, 'Europe/Istanbul');
    assert.equal(raid.originalLocalTime, '21:15');
});

test('raid card and all DMs show timestamps without organizer/local-time labels', () => {
    const raid = fixture();
    const snapshot = JSON.stringify(raid);
    const card = _test.raidEmbedOlustur(raid).toJSON();
    assert.ok(card.description.includes(`<t:${start}:F>`));
    const messages = [card];
    for (const variant of ['signup', 'manual', 'absence']) {
        const dm = _test.buildRaidNotificationEmbed({}, raid, { role: 'dps' }, variant).toJSON();
        assert.ok(dm.fields.some(f => f.value === `**Tarih** / Date\n<t:${start}:D>`));
        assert.ok(JSON.stringify(dm).includes(`<t:${start}:t>`));
        messages.push(dm);
    }
    const plans = { tr: { rows: [], capacity: 10, warnings: [] }, en: { warnings: [] } };
    const leader = buildLeaderEmbed(raid, plans);
    assert.ok(leader.toJSON().fields.find(f => f.name === 'Tarih / Date').value.includes(`<t:${start}:F>`));
    assert.ok(leader.length <= 6000);
    messages.push(leader.toJSON());
    for (const message of messages) {
        assert.doesNotMatch(JSON.stringify(message), /Organizer Time|Raid Liderinin Saati|Your Local Time|Yerel Saatiniz|Europe\/Istanbul/);
    }
    assert.equal(JSON.stringify(raid), snapshot);
});

test('reloaded raids independently trigger the same UTC scheduler checkpoints', async () => {
    const original = fixture();
    const second = { ...fixture(), unixZamani: start + 3600, organizerTimeZone: 'America/New_York' };
    const raids = new Map([['a', JSON.parse(JSON.stringify(original))], ['b', JSON.parse(JSON.stringify(second))]]);
    const events = [];
    const deps = {
        Date: { now: () => (start - 900) * 1000 }, raidHafizasi: raids,
        normalizeRaid: _test.normalizeRaid, raidMesajininVarliginiDogrula: async () => true,
        rosterFingerprint: _test.rosterFingerprint, planPublicationAction: _test.planPublicationAction,
        DRAFT_BEFORE_SECONDS: 1800, FINAL_BEFORE_SECONDS: 900,
        sendFinalPlan: async (_, id, __, phase) => events.push([id, phase]),
        sendDraft: async () => {}, saveRaid: () => {}
    };
    const tick = new Function(...Object.keys(deps), 'let schedulerRunning = false;\n' + between('async function schedulerTick(', 'function raidZamanlayicisiniBaslat(') + '\nreturn schedulerTick;')(...Object.values(deps));
    await tick({});
    assert.deepEqual(events, [['a', 'initial']]);
    assert.equal(raids.get('a').unixZamani, original.unixZamani);
    assert.equal(raids.get('b').unixZamani, second.unixZamani);
    const legacy = { unixZamani: start, tarih: `<t:${start}:F>` };
    _test.normalizeRaid(legacy);
    assert.equal(legacy.unixZamani, start);
    assert.equal(legacy.organizerTimeZone, undefined);
});
