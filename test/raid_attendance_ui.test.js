const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const discord = require('discord.js');
const { t, formatDiscordTimestamp } = require('../localization');
const { _test } = require('../raid');
const source = fs.readFileSync(path.join(__dirname, '..', 'raid.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const roster = count => Array.from({ length: count }, (_, i) => ({
    userId: String(100000000000000000n + BigInt(i)), displayName: `Player ${i + 1}`, role: 'dps', klas: 'Wizard'
}));
const components = payload => payload.components.flatMap(row => row.toJSON().components);
const field = (payload, label) => payload.embeds[0].toJSON().fields.find(f => f.name.includes(label)).value;

function validate(payload) {
    for (const embed of payload.embeds || []) {
        const json = embed.toJSON();
        assert.ok(embed.length <= 6000);
        assert.ok(json.title.length <= 256);
        assert.ok(json.description.length <= 4096);
        assert.ok(json.fields.length <= 25);
        for (const f of json.fields) assert.ok(f.name.length <= 256 && f.value.length <= 1024);
    }
    assert.ok((payload.components || []).length <= 5);
    for (const row of payload.components || []) {
        const items = row.toJSON().components;
        assert.ok(items.length <= 5);
        assert.equal(new Set(items.map(item => item.custom_id)).size, items.length);
        for (const item of items) {
            assert.ok(item.custom_id.length <= 100);
            if (item.options) {
                assert.ok(item.options.length <= 25);
                assert.ok(item.max_values <= item.options.length);
                for (const option of item.options) assert.ok(option.label.length <= 100);
            }
            if (item.label) assert.ok(item.label.length <= 80);
        }
    }
}

// Exercise the real handler/finalizer/penalty code with in-memory persistence and Discord transports.
// Never touch the user's raid_attendance.json or send actual DMs.
function harness(count = 2) {
    const players = roster(count);
    const raid = { creatorId: 'leader', zindan: 'MSH (Master Soul Harvester)', unixZamani: 1792522800,
        channelId: 'channel', guildId: 'guild', tanklar: [], healerlar: [], dpsler: players,
        yedekler: [{ userId: 'reserve', displayName: 'Reserve' }], attendanceDraftAbsentIds: [] };
    const raids = new Map([['one', raid]]);
    const records = new Map();
    const state = { raid, players, raids, records, events: [], messages: [], failDM: false, failChannel: false,
        failEdit: false, warningWait: null, warnings: [], saved: new Map() };
    const client = {
        user: { displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
        users: { fetch: async userId => ({ send: async payload => {
            if (state.failDM) throw new Error('DM closed');
            validate(payload); state.messages.push({ userId, payload });
        } }) },
        channels: { fetch: async () => ({ send: async payload => {
            if (state.failChannel) throw new Error('No channel access');
            validate(payload); state.messages.push({ channel: true, payload });
        } }) }
    };
    const deps = {
        ...discord, t, formatDiscordTimestamp, raidHafizasi: raids,
        attendanceRosterSnapshot: _test.attendanceRosterSnapshot,
        attendanceRecord: id => {
            if (!records.has(id)) records.set(id, _test.normalizeAttendanceRecord());
            return records.get(id);
        },
        saveAttendance: () => state.events.push('saveAttendance'),
        saveRaid: (id, data) => { state.events.push('saveRaid'); state.saved.set(id, JSON.parse(JSON.stringify(data))); },
        sendAbsenceWarning: async (_, player) => { state.warnings.push(player.userId); if (state.warningWait) await state.warningWait; },
        leaderOwnsRaid: (i, r) => i.user.id === r.creatorId,
        interactionLanguage: () => 'tr', privateReply: (i, payload) => i.reply({ ...payload, flags: [64] }),
        normalizeRaid: _test.normalizeRaid, raidMesajininVarliginiDogrula: async () => true,
        planPublicationAction: () => null, ATTENDANCE_GRACE_SECONDS: 900,
        updateRaidCard: async () => {}, rosterFingerprint: () => '',
        DRAFT_BEFORE_SECONDS: 1800, FINAL_BEFORE_SECONDS: 900
    };
    const api = new Function(...Object.keys(deps), [
        between('const attendanceInProgress =', 'function buildAbsenceWarningEmbed('),
        between('function raidPenaltyStatus(', 'function penaltyMessage('),
        between('async function finalizeAttendance(', 'function buildRaidNotificationEmbed('),
        between('async function handleAttendanceInteraction(', 'async function handlePlanInteraction('),
        'let schedulerRunning = false;',
        between('async function schedulerTick(', 'function raidZamanlayicisiniBaslat('),
        'return { sendAttendancePrompt, handleAttendanceInteraction, raidPenaltyStatus, schedulerTick };'
    ].join('\n'))(...Object.values(deps));
    state.prompt = (id = 'one') => api.sendAttendancePrompt(client, id, raids.get(id));
    state.tick = () => api.schedulerTick(client);
    state.penalty = api.raidPenaltyStatus;
    state.act = async (action, { values = [], id = 'one', user = 'leader', page } = {}) => {
        let acknowledged = false;
        const ack = () => { assert.equal(acknowledged, false); acknowledged = true; };
        const respond = method => async payload => {
            if (method === 'editReply') assert.equal(acknowledged, true); else ack();
            if (method === 'editReply' && state.failEdit) throw new Error('Discord edit failed');
            validate(payload); state.events.push(method); state.payload = payload; return payload;
        };
        return api.handleAttendanceInteraction({
            client, user: { id: user }, values,
            customId: `raid_attendance_${action}_${id}${page === undefined ? '' : `_${page}`}`,
            isButton: () => action !== 'absent', isStringSelectMenu: () => action === 'absent',
            reply: respond('reply'), update: respond('update'), editReply: respond('editReply'),
            deferUpdate: async () => { ack(); state.events.push('defer'); }
        });
    };
    return state;
}

test('raid kickoff sends one bilingual branded attendance embed with the exact UTC timestamp', async () => {
    const h = harness();
    h.raid.unixZamani = Math.floor(Date.now() / 1000) - 1;
    h.raid.dpsler.push({ displayName: 'Name only guest', role: 'dps' });
    await h.tick();
    await h.tick();
    assert.equal(h.messages.length, 1);
    const { payload, userId } = h.messages[0];
    const embed = payload.embeds[0].toJSON();
    assert.equal(userId, 'leader');
    assert.equal(payload.content, undefined);
    assert.equal(embed.title, 'Raid Yoklaması / Raid Attendance');
    assert.match(embed.description, /MSH – Master Soul Harvester/);
    assert.match(embed.description, /\*\*Yoklama zamanı!\*\*\n\*It's time to take attendance!\*/);
    assert.equal(embed.color, 0x5865F2);
    assert.ok(embed.author.icon_url);
    assert.equal(field(payload, 'Raid Time'), `<t:${h.raid.unixZamani}:F>`);
    assert.equal(field(payload, 'Main Roster'), '2');
    assert.match(field(payload, 'Absent Players'), /\*Select the absent players/);
    const [menu, button] = components(payload);
    assert.equal(menu.placeholder, 'Select Absent Players');
    assert.deepEqual(menu.options.map(o => o.value), h.players.filter(p => p.userId).map(p => p.userId));
    assert.equal(button.label, 'All Present');
    assert.equal(button.style, 3);
});

test('selection previews absentees; confirmation saves once and replaces controls with actual counts', async () => {
    const h = harness(10);
    await h.prompt();
    const ids = h.players.slice(0, 2).map(p => p.userId);
    await h.act('absent', { values: ids });
    assert.equal(h.records.size, 0);
    assert.ok(field(h.payload, 'Absent Players').includes(ids[0]));
    assert.equal(h.payload.content, '');
    await h.act('confirm');
    assert.equal(field(h.payload, 'Main Roster'), '10');
    assert.equal(field(h.payload, '/ Present'), '8');
    assert.equal(field(h.payload, 'Absent Players'), '2');
    assert.match(h.payload.embeds[0].toJSON().title, /Attendance Completed/);
    assert.match(h.payload.embeds[0].toJSON().description, /\*Attendance has been recorded successfully/);
    assert.deepEqual(h.payload.components, []);
    assert.equal(h.events.indexOf('defer') < h.events.indexOf('saveAttendance'), true);
    assert.equal(h.records.get(ids[0]).strikeCount, 1);
    assert.deepEqual(h.warnings, ids);
    await h.act('confirm');
    assert.equal(h.records.get(ids[0]).strikeCount, 1);
    assert.equal(field(h.payload, 'Absent Players'), '2');
    assert.equal(h.warnings.length, 2);
});

test('All Present and Reset keep the existing attendance decisions without adding absences', async () => {
    const h = harness();
    await h.prompt();
    await h.act('absent', { values: [h.players[0].userId] });
    await h.act('reset');
    assert.deepEqual(h.raid.attendanceDraftAbsentIds, []);
    assert.equal(components(h.payload)[0].placeholder, 'Select Absent Players');
    await h.act('all');
    assert.equal(field(h.payload, '/ Present'), '2');
    assert.equal(field(h.payload, 'Absent Players'), '0');
    assert.equal(h.records.size, 0);
    assert.deepEqual(h.payload.components, []);
});

test('slow player DMs cannot cause a double confirmation or block a different raid', async () => {
    const h = harness();
    h.raids.set('two', { ...h.raid, attendanceDraftAbsentIds: [], unixZamani: h.raid.unixZamani + 3600 });
    await h.prompt();
    await h.prompt('two');
    await h.act('absent', { values: [h.players[0].userId] });
    let release;
    h.warningWait = new Promise(resolve => { release = resolve; });
    const first = h.act('confirm');
    await h.act('confirm');
    assert.match(h.payload.content, /please wait/);
    await h.act('all', { id: 'two' });
    assert.equal(h.raids.get('two').attendanceCompleted, true);
    assert.equal(h.raid.attendanceCompleted, undefined);
    release();
    await first;
    assert.equal(h.records.get(h.players[0].userId).totalAbsences, 1);
    assert.equal(h.warnings.length, 1);
});

test('three absences still issue exactly one next-raid restriction; persisted completion cannot repeat', async () => {
    const h = harness();
    const id = h.players[0].userId;
    for (const raidId of ['one', 'two', 'three']) {
        if (raidId !== 'one') h.raids.set(raidId, { ...h.raid, attendanceCompleted: false, attendancePromptSent: false, attendanceDraftAbsentIds: [] });
        await h.prompt(raidId);
        await h.act('absent', { id: raidId, values: [id] });
        await h.act('confirm', { id: raidId });
    }
    assert.equal(h.records.get(id).totalAbsences, 3);
    assert.equal(h.records.get(id).strikeCount, 0);
    assert.equal(h.records.get(id).pendingPenalties, 1);
    assert.equal(h.penalty(id, 'next').blocked, true);
    assert.equal(h.penalty(id, 'next').consumed, false);
    assert.equal(h.penalty(id, 'following').blocked, false);
    const reloaded = harness();
    reloaded.raids.set('one', JSON.parse(JSON.stringify(h.saved.get('three'))));
    await reloaded.act('confirm');
    assert.equal(reloaded.records.size, 0);
    assert.equal(field(reloaded.payload, 'Absent Players'), '1');
    assert.deepEqual(reloaded.payload.components, []);
});

test('large rosters preserve selections across pages, including the 26th player', async () => {
    const h = harness(60);
    await h.prompt();
    assert.equal(components(h.messages[0].payload)[0].options.length, 25);
    await h.act('absent', { values: [h.players[0].userId, 'reserve'] });
    await h.act('page', { page: 1 });
    assert.equal(components(h.payload)[0].options[0].value, h.players[25].userId);
    await h.act('absent', { page: 1, values: [h.players[25].userId] });
    await h.act('page', { page: 0 });
    assert.equal(components(h.payload)[0].options[0].default, true);
    await h.act('absent', { page: 0, values: [] });
    assert.deepEqual(h.raid.attendanceDraftAbsentIds, [h.players[25].userId]);
    await h.act('page', { page: 2 });
    assert.equal(components(h.payload)[0].options.length, 10);
    await h.act('confirm');
    assert.equal(field(h.payload, 'Absent Players'), '1');
    assert.equal(field(h.payload, '/ Present'), '59');
});

test('DM and response errors retain fallback, saved results and leader-only access', async context => {
    context.mock.method(console, 'warn', () => {});
    context.mock.method(console, 'error', () => {});
    const h = harness();
    h.failDM = true;
    h.failChannel = true;
    assert.equal(await h.prompt(), false);
    assert.equal(h.raid.attendancePromptSent, undefined);
    h.failChannel = false;
    assert.equal(await h.prompt(), true);
    assert.equal(h.messages[0].channel, true);
    assert.deepEqual(h.messages[0].payload.allowedMentions, { users: ['leader'] });
    await h.act('all', { user: 'stranger' });
    assert.match(h.payload.content, /raid lideri/);
    assert.equal(h.raid.attendanceCompleted, undefined);
    h.failEdit = true;
    await assert.rejects(h.act('all'), /Discord edit failed/);
    assert.equal(h.raid.attendanceCompleted, true);
    h.failEdit = false;
    await h.act('all');
    assert.equal(field(h.payload, '/ Present'), '2');
});

test('empty rosters, invalid dates, long names and numerous absentees remain within API limits', async () => {
    const h = harness(0);
    await h.prompt();
    assert.equal(h.messages.length, 0);
    assert.equal(h.raid.attendanceCompleted, true);
    const players = roster(100).map(p => ({ ...p, displayName: 'Long Name '.repeat(100) }));
    const data = { zindan: 'Long Raid '.repeat(100), unixZamani: NaN, attendanceDraftAbsentIds: players.map(p => p.userId) };
    const embed = _test.buildAttendanceEmbed({}, data, players, { selected: true });
    const payload = { embeds: [embed], components: _test.attendancePromptComponents('one', players, 'en', 3, data.attendanceDraftAbsentIds) };
    validate(payload);
    assert.equal(field(payload, 'Raid Time'), '—');
    assert.match(field(payload, 'Absent Players'), /more players/);
});
