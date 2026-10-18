const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const discord = require('discord.js');
const { t } = require('../localization');
const { _test: { registerParticipant, hasRaidRoleSpace } } = require('../raid');
const source = fs.readFileSync(path.join(__dirname, '..', 'raid.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

function harness() {
    const raid = {
        creatorId: 'leader', zindan: 'MSH', capacity: 10,
        unixZamani: Math.floor(Date.now() / 1000) + 86400,
        tanklar: [], healerlar: [], dpsler: [],
        yedekler: [{ userId: 'reserve', mention: '<@reserve>', displayName: 'Reserve', klas: 'Fighter', role: 'yedek', intendedRole: 'tank', sira: 1 }]
    };
    const state = { raid, sent: [], failDM: false, events: [] };
    const client = { users: { fetch: async id => ({ send: async payload => {
        if (state.failDM) throw Object.assign(new Error('DM closed'), { code: 50007 });
        state.sent.push({ id, payload });
    } }) } };
    const deps = {
        ...discord, t, hasRaidRoleSpace, raidHafizasi: new Map([['message', raid]]),
        mainCount: r => r.tanklar.length + r.healerlar.length + r.dpsler.length,
        saveRaid: () => state.events.push('saved'), markPlanDirty: () => {},
        updateRaidCard: async () => {}, languageForUser: () => 'tr',
        roleLabel: (_, role) => role.toUpperCase(), interactionLanguage: () => 'tr',
        privateReply: async (_, payload) => payload,
        normalizeRaid: r => r, raidMesajininVarliginiDogrula: async () => true,
        rosterFingerprint: () => '', planPublicationAction: () => null,
        DRAFT_BEFORE_SECONDS: 3600, FINAL_BEFORE_SECONDS: 900
    };
    const code = [
        'let schedulerRunning = false;',
        between('function findReserveCandidate(', 'function attendanceRosterSnapshot('),
        between('function leaderOwnsRaid(', 'function planPlayerMenu('),
        between('async function schedulerTick(', 'function raidZamanlayicisiniBaslat('),
        between('async function handleReserveApproval(', 'async function handleAttendanceInteraction('),
        'return { requestReserveApproval, handleReserveApproval, schedulerTick };'
    ].join('\n');
    const api = new Function(...Object.keys(deps), code)(...Object.values(deps));
    state.request = () => api.requestReserveApproval(client, 'message', raid, 'tank');
    state.tick = () => api.schedulerTick(client);
    state.act = (action, user = 'leader') => api.handleReserveApproval({
        client, user: { id: user }, customId: `raid_reserve_${action}_message`, values: ['reserve'],
        isButton: () => action !== 'choose', isStringSelectMenu: () => action === 'choose',
        deferUpdate: async () => state.events.push('deferred'),
        editReply: async payload => payload, update: async payload => payload
    });
    return state;
}

test('reserve request leaves the slot empty indefinitely until approval', async () => {
    const h = harness();
    const result = await h.request();
    assert.equal(result.approvalSent, true);
    assert.equal(h.raid.pendingReserve.deadline, undefined);
    await h.tick();
    assert.equal(h.raid.tanklar.length, 0);
    assert.equal(h.raid.yedekler.length, 1);
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0].payload.content, /Siz onaylamadıkça/);
});

for (const [code, limit] of [['MSOD', 7], ['MSH', 6]]) test(`${code}: stale leader approval cannot promote beyond the DPS limit`, async () => {
    const h = harness(); h.raid.zindanKodu = code;
    for (let id = 1; id <= limit; id++) registerParticipant(h.raid, { id: String(id) }, `Player ${id}`, 'dps', 'Wizard', {});
    h.raid.pendingReserve = { role: 'dps', candidateUserId: 'reserve' };
    await h.act('accept');
    assert.equal(h.raid.dpsler.length, limit);
    assert.equal(h.raid.yedekler.length, 1);
    h.raid.dpsler.pop();
    await h.act('accept');
    assert.equal(h.raid.dpsler.length, limit);
    assert.equal(h.raid.yedekler.length, 0);
});

test('failed leader DM never promotes the reserve', async context => {
    context.mock.method(console, 'warn', () => {});
    const h = harness();
    h.failDM = true;
    const result = await h.request();
    await h.tick();
    assert.equal(result.approvalSent, false);
    assert.equal(h.raid.tanklar.length, 0);
    assert.equal(h.raid.yedekler.length, 1);
    assert.ok(h.raid.pendingReserve);
});

test('expired approval deadlines from old persisted raids no longer trigger promotion', async () => {
    const h = harness();
    h.raid.pendingReserve = JSON.parse(JSON.stringify({ role: 'tank', candidateUserId: 'reserve', deadline: 1 }));
    await h.tick();
    await h.tick();
    assert.equal(h.raid.tanklar.length, 0);
    assert.equal(h.raid.yedekler.length, 1);
    assert.equal(h.sent.length, 0);
});

for (const action of ['accept', 'choose']) {
    test(`leader ${action} explicitly promotes once; double click cannot repeat it`, async () => {
        const h = harness();
        await h.request();
        await Promise.all([h.act(action), h.act(action)]);
        assert.equal(h.raid.tanklar.length, 1);
        assert.equal(h.raid.yedekler.length, 0);
        assert.equal(h.raid.pendingReserve, null);
        assert.equal(h.sent.filter(m => m.id === 'reserve').length, 1);
        assert.ok(h.events.includes('deferred'));
    });
}

test('another user cannot approve; leader can leave the slot empty', async () => {
    const h = harness();
    await h.request();
    await h.act('accept', 'stranger');
    await h.act('choose', 'stranger');
    assert.equal(h.raid.tanklar.length, 0);
    await h.act('empty');
    await h.tick();
    await h.act('accept');
    assert.equal(h.raid.tanklar.length, 0);
    assert.equal(h.raid.yedekler.length, 1);
    assert.equal(h.raid.pendingReserve, null);
});

test('no candidate means no request; promotion call sites are only leader interactions', async () => {
    const h = harness();
    h.raid.yedekler = [];
    assert.equal((await h.request()).candidate, null);
    assert.equal(h.sent.length, 0);
    assert.equal((source.match(/await promoteReserve\(/g) || []).length, 2);
    assert.equal((between('async function handleReserveApproval(', 'async function handleAttendanceInteraction(').match(/await promoteReserve\(/g) || []).length, 2);
});

test('reserve can voluntarily join a vacant slot without leader approval; old approval cannot duplicate them', async () => {
    const h = harness();
    await h.request();
    const result = registerParticipant(h.raid, { id: 'reserve' }, 'Reserve', 'tank', 'Fighter', {});
    assert.equal(result.record.role, 'tank');
    assert.equal(h.raid.tanklar.length, 1);
    assert.equal(h.raid.yedekler.length, 0);
    await h.act('accept');
    assert.equal(h.raid.tanklar.length, 1);
    assert.equal(h.sent.filter(m => m.id === 'reserve').length, 0);
});

test('voluntary join still respects capacity; profile-only edit keeps reserve placement', () => {
    const h = harness();
    registerParticipant(h.raid, { id: 'reserve' }, 'Reserve', 'tank', 'Fighter', {}, { preservePlacement: true });
    assert.equal(h.raid.tanklar.length, 0);
    assert.equal(h.raid.yedekler.length, 1);
    h.raid.capacity = 1;
    registerParticipant(h.raid, { id: 'other' }, 'Other', 'tank', 'Fighter', {});
    const result = registerParticipant(h.raid, { id: 'reserve' }, 'Reserve', 'tank', 'Fighter', {});
    assert.equal(result.overflow, true);
    assert.equal(h.raid.tanklar.length, 1);
    assert.equal(h.raid.yedekler.length, 1);
});
