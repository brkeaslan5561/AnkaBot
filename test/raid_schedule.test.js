const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Collection, PermissionFlagsBits } = require('discord.js');
const { createPublicationWorker, publicationTime, publicationMarker, recoverPublication, scheduleCommand, shareScheduleCommand } = require('../raid_schedule');
const { acquireProcessLock } = require('../process_lock');
const time = require('../raid_time');
const repo = path.join(__dirname, '..');
const start = Date.parse('2027-10-25T18:00:00Z') / 1000;
const fixture = overrides => ({ raidId: 'aabbccddeeff001122', zindan: 'Master Jotunskar', contentType: 'dungeon',
    unixZamani: start, publishAt: start - 86400, organizerTimeZone: 'Europe/Istanbul',
    guildId: '111111111111111111', channelId: '222222222222222222', creatorId: '333333333333333333',
    status: 'scheduled', published: false, englishOnly: true, ...overrides });
const json = value => JSON.parse(JSON.stringify(value));

function workerHarness(t, overrides = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anka-worker-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'raids.json');
    const state = { now: start - 86401, sends: 0, failSend: false, failCommit: false, failSave: false,
        raids: new Map([['pending', fixture(overrides)]]), history: new Collection(), fetchDelay: null };
    const save = () => {
        if (state.failSave) throw new Error('disk failed');
        fs.writeFileSync(file, JSON.stringify([...state.raids]));
    };
    save();
    const channel = { guildId: fixture().guildId, send() {}, messages: { fetch: async () => {
        if (state.failHistory) throw new Error('history unavailable');
        return state.history;
    } } };
    const client = { user: { id: 'bot' }, channels: { fetch: async () => {
        if (state.fetchDelay) await state.fetchDelay;
        if (state.failFetch) throw new Error('channel lookup failed');
        return state.missingChannel ? null : channel;
    } } };
    const makeWorker = () => createPublicationWorker({
        entries: () => [...state.raids], save, now: () => state.now,
        buildPayload: raid => ({ embeds: [{ footer: { text: publicationMarker(raid) } }] }),
        send: async (_, payload) => {
            assert.equal(payload.enforceNonce, true);
            assert.equal(JSON.parse(fs.readFileSync(file))[0][1].published, false);
            assert.ok(JSON.parse(fs.readFileSync(file))[0][1].publicationAttempt);
            state.sends++;
            const message = { id: String(900000000000000000n + BigInt(state.sends)), author: { id: 'bot' },
                embeds: payload.embeds, createdTimestamp: state.now * 1000 };
            state.history.set(message.id, message);
            if (state.failSend) throw new Error('transport timed out after acceptance');
            return message;
        },
        commit(id, raid, messageId, publishedAt) {
            if (state.failCommit) throw new Error('commit failed');
            const updated = { ...raid, status: 'published', published: true, messageId, publishedAt };
            delete updated.publicationAttempt;
            state.raids.delete(id); state.raids.set(messageId, updated); save();
        }
    });
    state.worker = makeWorker();
    state.tick = () => state.worker.tick(client);
    state.restart = () => { state.raids = new Map(JSON.parse(fs.readFileSync(file))); state.worker = makeWorker(); };
    t.mock.method(console, 'error', () => {});
    return state;
}

test('publication is persistent, due exactly 24 hours before UTC start, and concurrent ticks publish once', async t => {
    const h = workerHarness(t);
    await h.tick(); assert.equal(h.sends, 0);
    h.restart(); h.now++;
    await Promise.all([h.tick(), h.tick(), h.tick()]);
    assert.equal(h.sends, 1);
    const raid = [...h.raids.values()][0];
    assert.equal(raid.published, true); assert.equal(raid.publishedAt, start - 86400);
    h.restart(); await h.tick(); assert.equal(h.sends, 1);
});
test('offline catch-up publishes before start but never sends expired raids', async t => {
    const h = workerHarness(t); h.now = start - 1; h.restart(); await h.tick(); assert.equal(h.sends, 1);
    const expired = workerHarness(t); expired.now = start; await expired.tick(); assert.equal(expired.sends, 0);
});
for (const status of ['deleted', 'cancelled', 'completed', 'expired']) test(`${status} raids are never published`, async t => {
    const h = workerHarness(t, { status }); h.now = start - 1; await h.tick(); assert.equal(h.sends, 0);
});
test('deletion or editing during asynchronous channel lookup invalidates a queued publication', async t => {
    for (const change of ['delete', 'edit']) {
        const h = workerHarness(t); h.now++;
        let release; h.fetchDelay = new Promise(resolve => { release = resolve; });
        const tick = h.tick();
        if (change === 'delete') h.raids.delete('pending');
        else { const raid = h.raids.get('pending'); raid.unixZamani += 86400; raid.publishAt = publicationTime(raid); }
        release(); await tick; assert.equal(h.sends, 0);
    }
});
test('a channel failure after deletion cannot resurrect the deleted scheduled record', async t => {
    const h = workerHarness(t); h.now++; h.failFetch = true;
    let release; h.fetchDelay = new Promise(resolve => { release = resolve; });
    const tick = h.tick(); h.raids.delete('pending'); release(); await tick;
    assert.equal(h.raids.size, 0); assert.equal(h.sends, 0);
});
test('ambiguous Discord send is recovered after restart and nonce expiry without sending twice', async t => {
    const h = workerHarness(t); h.now++; h.failSend = true;
    await h.tick(); assert.equal(h.sends, 1); assert.equal(h.raids.get('pending').published, false);
    h.now += 3600; h.restart(); h.failSend = false;
    await h.tick(); assert.equal(h.sends, 1); assert.equal([...h.raids.values()][0].published, true);
});
test('successful send with failed database commit is reconciled after restart', async t => {
    const h = workerHarness(t); h.now++; h.failCommit = true;
    await h.tick(); assert.equal(h.sends, 1);
    h.now += 3600; h.restart(); h.failCommit = false;
    await h.tick(); assert.equal(h.sends, 1); assert.equal([...h.raids.values()][0].published, true);
});
test('recover a previously sent card after start without sending an expired announcement', async t => {
    const h = workerHarness(t); h.now++; h.failCommit = true; await h.tick();
    h.now = start + 1; h.restart(); h.failCommit = false; await h.tick();
    assert.equal(h.sends, 1); assert.equal([...h.raids.values()][0].published, true);
});
test('database failures, missing channels and inaccessible history never trigger blind sends', async t => {
    const h = workerHarness(t); h.now++; h.failSave = true; await h.tick(); assert.equal(h.sends, 0);
    h.failSave = false; h.now += 61; h.missingChannel = true; await h.tick(); assert.equal(h.sends, 0);
    h.now += 61; h.missingChannel = false; h.failHistory = true; await h.tick(); assert.equal(h.sends, 0);
    h.now += 61; h.failHistory = false; await h.tick(); assert.equal(h.sends, 1);
});
test('invalid persisted publication timestamps cannot publish', async t => {
    for (const publishAt of [null, undefined, NaN, 1]) {
        const h = workerHarness(t, { publishAt }); h.now++; await h.tick(); assert.equal(h.sends, 0);
    }
});
test('publication recovery searches multiple history pages and only accepts this bot and marker', async () => {
    const raid = fixture({ publicationAttempt: { startedAt: start - 1000 } });
    const newest = new Collection(Array.from({ length: 100 }, (_, n) => {
        const id = String(900000000000000000n - BigInt(n));
        return [id, { id, author: { id: 'other' }, createdTimestamp: start * 1000, embeds: [{ footer: { text: publicationMarker(raid) } }] }];
    }));
    const target = { id: '800000000000000000', author: { id: 'bot' }, createdTimestamp: (start - 100) * 1000, embeds: [{ footer: { text: publicationMarker(raid) } }] };
    const calls = [];
    const channel = { messages: { fetch: async options => { calls.push(options); return options.before ? new Collection([[target.id, target]]) : newest; } } };
    assert.equal(await recoverPublication(channel, raid, 'bot'), target);
    assert.equal(calls.length, 2); assert.equal(calls[1].before, '899999999999999901');
});
test('process lock atomically excludes a second writer and recovers dead owners', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anka-lock-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'lock');
    const release = acquireProcessLock(file);
    assert.throws(() => acquireProcessLock(file), /already owns/);
    release();
    fs.writeFileSync(file, JSON.stringify({ pid: 2147483647, host: os.hostname() }));
    const next = acquireProcessLock(file); next(); assert.equal(fs.existsSync(file), false);
});

// Load the actual integration module against isolated data files. Discord is
// mocked; no bot login, production file writes, or command registration occurs.
function integrationHarness(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anka-integration-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const state = { now: Date.parse('2027-10-01T00:00:00Z'), records: [], sent: [], token: null, events: [], messages: new Collection(), edits: [] };
    const localRequire = createRequire(path.join(repo, 'raid.js'));
    class Clock extends Date { static now() { return state.now; } }
    state.reload = () => {
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(path.join(repo, 'raid.js'), 'utf8') + '\nmodule.exports._publicationWorker = publicationWorker;', {
            module, exports: module.exports, __dirname: directory, Date: Clock, console,
            setInterval, setImmediate, clearInterval,
            require: name => name === './raid_time' ? { ...time, createTimePreferences: () => time.createTimePreferences(path.join(directory, 'preferences.json')) }
                : name === './raid_creation' ? { createRaidCreation: options => require('../raid_creation').createRaidCreation({ ...options, now: () => state.now }) }
                : name === './raid_schedule' ? { ...require('../raid_schedule'), createPublicationWorker: options => createPublicationWorker({ ...options, now: () => state.now / 1000 }) }
                : localRequire(name)
        });
        state.api = module.exports;
    };
    state.channel = { guildId: fixture().guildId, messages: { fetch: async id => typeof id === 'string' ? state.messages.get(id) : state.messages }, send: async payload => {
        state.sent.push(json(payload));
        const id = String(800000000000000000n + BigInt(state.sent.length));
        const message = { id, author: { id: 'bot' }, channel: state.channel, embeds: json(payload).embeds,
            url: `https://discord.com/channels/${fixture().guildId}/${fixture().channelId}/${id}`,
            edit: async payload => { state.edits.push(json(payload)); return message; } };
        state.messages.set(id, message); return message;
    } };
    state.client = { user: { id: 'bot' }, channels: { fetch: async () => state.channel } };
    state.call = async (action, options = {}) => {
        const record = payload => { state.payload = json(payload); state.events.push(state.payload); return payload; };
        const i = { user: { id: options.user || fixture().creatorId }, guildId: fixture().guildId, channelId: fixture().channelId,
            locale: 'tr', memberPermissions: { has: () => options.allowed !== false }, client: state.client, channel: state.channel,
            commandName: 'schedule', customId: action ? `raid_schedule_${state.token}_${action}` : undefined,
            isChatInputCommand: () => !action, isButton: () => Boolean(action), isStringSelectMenu: () => Boolean(options.values),
            values: options.values || [], fields: { getTextInputValue: key => options.fields?.[key] || '' },
            reply: async payload => { assert.ok(!i.replied && !i.deferred); i.replied = true; return record(payload); },
            update: async payload => { assert.ok(!i.replied && !i.deferred); i.replied = true; return record(payload); },
            deferUpdate: async () => { assert.ok(!i.replied && !i.deferred); i.deferred = true; },
            editReply: async payload => { assert.ok(i.replied || i.deferred); return record(payload); },
            showModal: async payload => { i.replied = true; return record(payload); }
        };
        await state.api.raidSisteminiYonet(i);
        if (!action && state.payload.components?.length) state.token = state.payload.components[0].components[0].custom_id.split('_')[2];
    };
    state.setup = async (date = '2027-10-25') => {
        await state.call(); await state.call('content', { values: ['MJS'] });
        await state.call('zone', { values: ['Europe/Istanbul'] });
        await state.call('details');
        await state.call('submit', { fields: { name: 'Master Jotunskar', date, time: '21:00', description: 'Practice run' } });
    };
    state.reload();
    return state;
}
test('real /schedule saves the existing model, English UI and UTC snapshot, then restarts and publishes normally', async t => {
    const h = integrationHarness(t); await h.setup(); await h.call('confirm');
    assert.equal(h.sent.length, 0);
    assert.equal(h.payload.embeds[0].title, 'Raid Scheduled Successfully');
    assert.deepEqual(h.payload.embeds[0].fields.map(f => f.name), ['Raid', 'Start Date', 'Start Time', 'Timezone', 'Publication Date', 'Publication Time', 'Announcement Channel', 'Raid Leader']);
    const [{ id, raid }] = h.api.getAllRaids();
    assert.equal(raid.unixZamani, start); assert.equal(raid.publishAt, start - 86400);
    assert.equal(raid.organizerTimeZone, 'Europe/Istanbul'); assert.equal(raid.capacity, 5);
    assert.equal(raid.published, false); assert.deepEqual(Array.from(raid.tanklar), []);
    assert.ok(h.events.some(payload => JSON.stringify(payload).includes('Schedule Raid')));
    for (const event of h.events) assert.doesNotMatch(JSON.stringify(event), /[ğşİı]|Türkiye|KAYIT|AÇIKLAMA|TARİH|Ekim|Oluştur|Kendin/);
    await h.call('confirm'); assert.equal(h.api.getAllRaids().length, 1);
    h.reload(); assert.equal(h.api.getRaid(id).publishAt, start - 86400);
    h.now = (start - 86400) * 1000; await h.api._publicationWorker.tick(h.client);
    assert.equal(h.sent.length, 1); assert.equal(h.api.getRaid(id), null);
    const published = h.api.getAllRaids()[0];
    assert.equal(published.raid.raidId, id); assert.equal(published.id, published.raid.messageId);
    assert.doesNotMatch(JSON.stringify(h.sent[0]), /KAYIT|ZİNDAN|AÇIKLAMA|TARİH/);
    assert.equal(h.sent[0].components[0].components[0].custom_id, 'raid_join_tank');
    const choices = h.api._test.raidAutocompleteChoices([[published.id, published.raid]], 'raid-oyuncu-ekle');
    assert.equal(choices[0].value, published.id);
    h.api._test.registerParticipant(published.raid, { id: 'player' }, 'Player', 'tank', 'Fighter', { artifacts: [], mounts: [], companions: [] });
    assert.equal(published.raid.tanklar[0].userId, 'player');
});
test('less-than-24-hour scheduling needs a separate explicit confirmation; unauthorized users cannot start', async t => {
    const h = integrationHarness(t);
    await h.call(null, { allowed: false }); assert.match(h.payload.content, /Manage Server/);
    await h.setup('2027-10-01'); await h.call('confirm');
    assert.match(h.payload.content, /published immediately/); assert.equal(h.api.getAllRaids().length, 0);
    await h.call('immediate', { user: 'stranger' }); assert.equal(h.api.getAllRaids().length, 0);
    await h.call('immediate'); assert.equal(h.api.getAllRaids().length, 1);
    await new Promise(resolve => setImmediate(resolve));
});
test('automatically published raids support ordinary registration, actual manual addition and editing the same card', async t => {
    const h = integrationHarness(t); await h.setup(); await h.call('confirm');
    h.now = (start - 86400) * 1000; await h.api._publicationWorker.tick(h.client);
    const { id } = h.api.getAllRaids()[0];
    let reply;
    await h.api.raidSisteminiYonet({ customId: 'raid_join_dps', message: { id }, user: { id: '444444444444444444' },
        locale: 'en-US', client: h.client, channel: h.channel, guildId: fixture().guildId,
        memberPermissions: { has: () => false }, isChatInputCommand: () => false, isButton: () => true, isStringSelectMenu: () => false,
        reply: async payload => { reply = json(payload); } });
    assert.equal(reply.components[0].components[0].custom_id, `raid_class_dps_${id}`);
    const dms = [];
    const player = { id: '444444444444444444', username: 'Player', send: async payload => dms.push(json(payload)) };
    await h.api.raidManuelOyuncuEkle({ locale: 'en-US', client: h.client, guildId: fixture().guildId, channelId: fixture().channelId,
        options: { getString: key => ({ id, role: 'dps', klas: 'Wizard' })[key], getUser: () => player, getMember: () => null },
        deferReply: async () => {}, editReply: async () => {} });
    assert.equal(h.api.getRaid(id).dpsler[0].userId, player.id); assert.equal(dms.length, 1);
    await h.api.raidDuzenleKomutuYonet({ user: { id: fixture().creatorId }, locale: 'en-US', client: h.client,
        guildId: fixture().guildId, channelId: fixture().channelId, memberPermissions: { has: () => true },
        options: { getString: key => ({ id, saat: '22:00' })[key] ?? null, getInteger: () => null, getBoolean: () => null },
        deferReply: async () => {}, editReply: async () => {} });
    assert.equal(h.sent.length, 1); assert.equal(h.edits.length, 2);
    assert.equal(h.api.getRaid(id).unixZamani, start + 3600); assert.equal(h.api.getRaid(id).messageId, id);
});
test('schedule validation, custom content, DST gaps/folds and expired errors stay English on a Turkish client', async t => {
    t.mock.method(console, 'error', () => {});
    const h = integrationHarness(t);
    h.now = Date.parse('2027-01-01T00:00:00Z');
    await h.call(); await h.call('content', { values: ['custom'] }); await h.call('type', { values: ['dungeon'] });
    await h.call('zone', { values: ['other'] });
    await h.call('regionSubmit', { fields: { zone: 'Invalid/Zone', locale: 'en-US' } });
    assert.match(h.payload.content, /valid IANA/);
    await h.call('zone', { values: ['America/New_York'] });
    for (const [date, clock, pattern] of [
        ['2027-02-30', '9:00 PM', /valid date/], ['2027-03-14', '2:30 AM', /does not exist/],
        ['2026-01-01', '9:00 PM', /future/], ['2027-10-25', '25:00', /1:00/]
    ]) {
        await h.call('submit', { fields: { name: 'Custom Trial', date, time: clock } });
        assert.match(h.payload.content, pattern); assert.equal(h.api.getAllRaids().length, 0);
    }
    await h.call('submit', { fields: { name: 'Custom Trial', date: '2027-11-07', time: '1:30 AM' } });
    const options = h.payload.components[0].components[0].options;
    assert.equal(options.length, 2); await h.call('confirm'); assert.equal(h.api.getAllRaids().length, 0);
    await h.call('fold', { values: [options[1].value] }); await h.call('confirm');
    assert.equal(h.api.getAllRaids()[0].raid.unixZamani, Number(options[1].value));
    await h.call('confirm'); assert.match(h.payload.content, /\/schedule/);
    for (const event of h.events) assert.doesNotMatch(JSON.stringify(event), /[ğşİı]|Türkiye|Oluştur|Kendin|\/create-raid/);
});
test('editing and cancelling use the existing management handler and update persistent publication times', async t => {
    const h = integrationHarness(t); await h.setup(); await h.call('confirm');
    const id = h.api.getAllRaids()[0].id;
    const edit = changes => h.api.raidDuzenleKomutuYonet({ user: { id: fixture().creatorId }, guildId: fixture().guildId,
        client: h.client, channelId: fixture().channelId, locale: 'en-US', memberPermissions: { has: () => true },
        options: { getString: key => ({ id, ...changes })[key] ?? null, getInteger: key => changes[key] ?? null, getBoolean: key => changes[key] ?? null },
        deferReply: async () => {}, editReply: async payload => payload });
    await edit({ gun: 26 });
    assert.equal(h.api.getRaid(id).publishAt, start); assert.equal(h.sent.length, 0);
    h.reload(); assert.equal(h.api.getRaid(id).unixZamani, start + 86400);
    await edit({ 'cancel-scheduled': true }); h.reload();
    h.now = start * 1000; await h.api._publicationWorker.tick(h.client);
    assert.equal(h.api.getAllRaids().length, 0); assert.equal(h.sent.length, 0);
});
test('English commands are exported, registered and routed without translation overrides', () => {
    for (const command of [scheduleCommand, shareScheduleCommand]) {
        const value = command.toJSON();
        assert.equal(value.default_member_permissions, String(PermissionFlagsBits.ManageGuild));
        assert.equal(value.description_localizations, undefined); assert.equal(value.name_localizations, undefined);
    }
    const source = fs.readFileSync(path.join(repo, 'index.js'), 'utf8');
    assert.match(source, /raidKomutu,\s+scheduleCommand,\s+shareScheduleCommand,/);
    assert.match(source, /\['raid-oluştur', 'schedule', 'share-schedule'\]\.includes/);
});
