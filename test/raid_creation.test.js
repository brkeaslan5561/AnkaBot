const test = require('node:test');
const assert = require('node:assert/strict');
const { createRaidCreation } = require('../raid_creation');
const { raidKomutu } = require('../raid');
const { safeEmojiPayload } = require('../raid_emojis');
const components = payload => (payload.components || []).flatMap(row => row.toJSON().components);
const control = (payload, action) => components(payload).find(item => item.custom_id.endsWith(`_${action}`));
const embedText = payload => JSON.stringify((payload.embeds || []).map(embed => embed.toJSON()));

function validate(payload) {
    if (payload?.toJSON) {
        const json = payload.toJSON();
        assert.ok(json.title.length <= 45);
        assert.ok(json.components.length <= 5);
        for (const row of json.components) for (const field of row.components) {
            assert.ok(field.label.length <= 45);
            assert.ok(!field.value || field.value.length <= field.max_length);
        }
        return;
    }
    assert.ok(!payload.content || payload.content.length <= 2000);
    for (const embed of payload.embeds || []) {
        assert.ok(embed.length <= 6000);
        const json = embed.toJSON();
        assert.ok(!json.title || json.title.length <= 256);
        assert.ok(!json.description || json.description.length <= 4096);
        assert.ok(!json.fields || json.fields.length <= 25);
        for (const field of json.fields || []) assert.ok(field.name.length <= 256 && field.value.length <= 1024);
    }
    assert.ok(!payload.components || payload.components.length <= 5);
    for (const row of payload.components || []) for (const item of row.toJSON().components) {
        assert.ok(item.custom_id.length <= 100);
        if (item.label) assert.ok(item.label.length <= 80);
        if (item.options) {
            assert.ok(item.options.length <= 25);
            for (const option of item.options) assert.ok(option.label.length <= 100);
        }
    }
}
function harness(options = {}) {
    const prefs = new Map();
    const published = [];
    const state = { published, prefs, payload: null, modal: null, token: null, publishDelay: null, failPublish: false,
        now: Date.parse('2026-01-01T00:00:00Z'), events: [] };
    const wizard = createRaidCreation({
        contents: options.contents || [{ value: 'MSH', label: 'MSH (Master Soul Harvester)', contentType: 'trial' }, { value: 'custom', label: 'Custom' }],
        preferences: { get: id => prefs.get(id), set: (id, value) => prefs.set(id, { ...value }) },
        now: () => state.now,
        publish: async (i, data) => {
            if (state.publishDelay) await state.publishDelay;
            if (state.failPublish) throw new Error('send failed');
            published.push(JSON.parse(JSON.stringify(data)));
        }
    });
    state.call = async (action = null, { values = [], fields = {}, user = 'leader', channel = 'channel', guild = 'guild', locale = 'en-US', token = state.token } = {}) => {
        const acknowledge = () => { assert.ok(!i.replied && !i.deferred); i.replied = true; };
        const response = method => async payload => {
            if (method === 'editReply') assert.ok(i.replied || i.deferred); else acknowledge();
            validate(payload); state.payload = payload; state.events.push({ method, payload }); return payload;
        };
        const i = {
            user: { id: user }, channelId: channel, guildId: guild, locale,
            client: { user: { displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' } },
            commandName: 'raid-oluştur', customId: action ? `raid_create_${token}_${action}` : undefined,
            isChatInputCommand: () => !action, values,
            fields: { getTextInputValue: name => fields[name] || '' },
            reply: response('reply'), update: response('update'), editReply: response('editReply'),
            deferUpdate: async () => { acknowledge(); i.deferred = true; },
            showModal: async modal => { acknowledge(); validate(modal); state.modal = modal.toJSON(); state.events.push({ method: 'showModal' }); }
        };
        const result = await wizard.handle(i);
        if (!action && state.payload.components?.length) state.token = state.payload.components[0].toJSON().components[0].custom_id.split('_')[2];
        return result;
    };
    state.setup = async zone => {
        await state.call();
        await state.call('content', { values: ['MSH'] });
        await state.call('zone', { values: [zone] });
    };
    state.submit = (fields = {}) => state.call('submit', { fields: { name: 'MSH', date: '2026-10-20', time: '21:00', description: '', ...fields } });
    return state;
}

test('one command uses Discord English localization; no duplicate command is needed', () => {
    const json = raidKomutu.toJSON();
    assert.equal(json.name, 'raid-oluştur');
    assert.equal(json.name_localizations['en-US'], 'create-raid');
});

for (const [zone, time, iso] of [
    ['Europe/Istanbul', '20:05', '2026-10-20T17:05:00.000Z'],
    ['America/New_York', '9:00 PM', '2026-10-21T01:00:00.000Z'],
    ['America/Los_Angeles', '10:30 PM', '2026-10-21T05:30:00.000Z']
]) test(`${zone}: bilingual workflow only publishes after explicit confirmation`, async () => {
    const h = harness();
    await h.setup(zone);
    assert.match(embedText(h.payload), /Choose your time zone/);
    await h.call('details');
    assert.equal(h.modal.title, 'Raid Details · Step 3/4');
    await h.submit({ time });
    assert.equal(h.published.length, 0);
    assert.ok(JSON.stringify(h.payload.embeds[0].toJSON()).includes('<t:'));
    await h.call('confirm');
    assert.equal(h.published.length, 1);
    assert.equal(new Date(h.published[0].unixZamani * 1000).toISOString(), iso);
    assert.equal(h.published[0].organizerTimeZone, zone);
    await h.call('confirm');
    assert.equal(h.published.length, 1);
    assert.match(h.payload.content, /expired/);
});

test('first-time timezone is mandatory; custom IANA and regional locale are supported', async () => {
    const h = harness();
    await h.call();
    await h.call('content', { values: ['MSH'] });
    assert.match(embedText(h.payload), /Please select your time zone/);
    assert.equal(control(h.payload, 'details').disabled, true);
    await h.call('zone', { values: ['other'] });
    assert.equal(h.modal.components.length, 2);
    await h.call('regionSubmit', { fields: { zone: 'Asia/Kathmandu', locale: 'en-GB' } });
    assert.ok(['Asia/Kathmandu', 'Asia/Katmandu'].includes(h.prefs.get('leader').preferredTimeZone));
    await h.call();
    await h.call('content', { values: ['MSH'] });
    assert.match(embedText(h.payload), /Asia\/Kath?mandu/);
    assert.equal(control(h.payload, 'details').disabled, false);
});

test('format changes only presentation; arbitrary minutes and AM/PM selection work', async () => {
    const h = harness();
    await h.setup('America/New_York');
    await h.submit({ time: '9:15 PM' });
    const before = JSON.stringify(h.payload.embeds[0].toJSON()).match(/<t:(\d+):F>/)[1];
    await h.call('settings');
    await h.call('format', { values: ['24'] });
    await h.call('details');
    assert.equal(h.modal.components[2].components[0].value, '21:15');
    await h.submit({ time: '21:15' });
    assert.ok(JSON.stringify(h.payload.embeds[0].toJSON()).includes(`<t:${before}:F>`));
    await h.call('confirm');
    assert.equal(h.published[0].organizerHourFormat, '24');
    assert.equal(h.published[0].unixZamani, Number(before));
});

test('DST gaps cannot publish; DST folds require choosing one of the actual instants', async () => {
    const h = harness();
    await h.setup('America/New_York');
    await h.submit({ date: '2026-03-08', time: '2:30 AM' });
    assert.match(h.payload.content, /does not exist/);
    await h.call('confirm');
    assert.equal(h.published.length, 0);
    await h.submit({ date: '2026-11-01', time: '1:30 AM' });
    assert.equal(control(h.payload, 'confirm').disabled, true);
    const choices = h.payload.components[0].toJSON().components[0].options;
    assert.equal(choices.length, 2);
    await h.call('confirm');
    assert.equal(h.published.length, 0);
    await h.call('fold', { values: [choices[1].value] });
    await h.call('confirm');
    assert.equal(h.published[0].unixZamani, Number(choices[1].value));
});

test('cancel, foreign user/channel, and simultaneous confirm never create extra raids', async () => {
    const h = harness();
    await h.setup('Europe/Istanbul');
    await h.submit();
    await h.call('confirm', { user: 'stranger' });
    await h.call('confirm', { channel: 'other' });
    assert.equal(h.published.length, 0);
    let release;
    h.publishDelay = new Promise(resolve => { release = resolve; });
    const first = h.call('confirm');
    await h.call('confirm');
    assert.match(h.payload.content, /in progress/);
    release();
    await first;
    assert.equal(h.published.length, 1);
    await h.setup('Europe/Istanbul');
    await h.call('cancel');
    await h.call('confirm');
    assert.equal(h.published.length, 1);
});

test('two leaders and later preference changes cannot alter a published raid', async () => {
    const h = harness();
    await h.setup('Europe/Istanbul');
    await h.submit({ time: '20:00' });
    await h.call('confirm');
    const before = JSON.stringify(h.published[0]);
    await h.call(null, { user: 'other' });
    await h.call('content', { values: ['MSH'], user: 'other' });
    await h.call('zone', { values: ['America/New_York'], user: 'other' });
    await h.call('submit', { user: 'other', fields: { name: 'MSH', date: '2026-10-20', time: '9:00 PM' } });
    await h.call('confirm', { user: 'other' });
    await h.setup('Europe/Berlin');
    assert.equal(JSON.stringify(h.published[0]), before);
    assert.notEqual(h.published[0].unixZamani, h.published[1].unixZamani);
});

test('custom dungeon, invalid input and AM/PM options stay within Discord limits', async () => {
    const h = harness();
    await h.call();
    await h.call('content', { values: ['custom'] });
    await h.call('type', { values: ['dungeon'] });
    await h.call('zone', { values: ['America/New_York'] });
    await h.call('period', { values: ['AM'] });
    await h.call('details');
    assert.equal(h.modal.components[2].components[0].value, undefined);
    assert.equal(h.modal.components[2].components[0].placeholder, '9:00 AM');
    await h.submit({ name: 'My Dungeon', time: '9:05' });
    await h.call('confirm');
    assert.equal(h.published[0].contentType, 'dungeon');
    assert.equal(h.published[0].originalLocalTime, '09:05');
    assert.equal(h.published[0].zindanKodu, 'My Dungeon');
});

test('invalid resubmission cannot publish using an earlier valid confirmation', async () => {
    const h = harness();
    await h.setup('Europe/Istanbul');
    await h.submit();
    await h.submit({ name: '' });
    await h.call('confirm');
    assert.equal(h.published.length, 0);
});

test('publish failure offers a controlled retry without allowing the confirmed data to change', async t => {
    t.mock.method(console, 'error', () => {});
    const h = harness();
    await h.setup('Europe/Istanbul');
    await h.submit();
    h.failPublish = true;
    await h.call('confirm');
    assert.equal(h.published.length, 0);
    assert.match(h.payload.content, /operation failed/);
    await h.call('zone', { values: ['America/New_York'] });
    assert.match(h.payload.content, /in progress/);
    h.failPublish = false;
    await h.call('confirm');
    assert.equal(h.published.length, 1);
    assert.equal(h.published[0].organizerTimeZone, 'Europe/Istanbul');
});

test('all four steps share branding, concise navigation and native component limits', async () => {
    const h = harness();
    await h.call();
    assert.deepEqual(h.payload.flags, [64]);
    const selection = h.payload.embeds[0].toJSON();
    assert.equal(selection.title, 'Raid Oluştur / Create Raid');
    assert.match(selection.description, /\*Step 1\/4 · Select Raid\*/);
    assert.match(selection.description, /\*\*Oluşturmak.*\*\*\n\*Choose/);
    assert.equal(control(h.payload, 'cancel').label, 'Cancel');
    await h.call('content', { values: ['MSH'] });
    await h.call('zone', { values: ['Europe/Istanbul'] });
    const settings = h.payload.embeds[0].toJSON();
    assert.equal(settings.title, 'Time Settings');
    assert.match(settings.description, /Step 2\/4/);
    assert.doesNotMatch(embedText(h.payload), /tr-TR|en-US|21:00|9:00/);
    assert.match(embedText(h.payload), /Time has not been entered/);
    assert.deepEqual(control(h.payload, 'format').options.map(o => o.value), ['auto', '24', '12']);
    assert.equal(control(h.payload, 'details').label, 'Continue');
    assert.equal(control(h.payload, 'region'), undefined);
    await h.call('details');
    assert.equal(h.modal.title, 'Raid Details · Step 3/4');
    assert.equal(h.modal.components[0].components[0].value, 'MSH (Master Soul Harvester)');
    assert.equal(h.modal.components[1].components[0].placeholder, 'YYYY-MM-DD');
    assert.equal(h.modal.components[3].components[0].style, 2);
    assert.equal(h.modal.components[3].components[0].required, false);
    await h.submit();
    const review = h.payload.embeds[0].toJSON();
    assert.equal(review.title, 'Raid Preview');
    assert.match(review.description, /Step 4\/4 · Final Review/);
    assert.doesNotMatch(review.description, /Description/);
    assert.equal(control(h.payload, 'confirm').style, 3);
    assert.equal(control(h.payload, 'details').label, 'Back');
    assert.equal(control(h.payload, 'details').style, 2);
    assert.equal(control(h.payload, 'cancel').style, 2);
    for (const embed of [selection, settings, review]) {
        assert.equal(embed.color, 0x5865F2);
        assert.equal(embed.author.icon_url, 'https://cdn.discordapp.com/embed/avatars/0.png');
        assert.equal(embed.author.name, 'Anka Bot');
    }
    // Normal progression updates the original ephemeral reply rather than sending new screens.
    assert.equal(h.events.filter(e => e.method === 'reply').length, 1);
    assert.equal(h.events.filter(e => e.method === 'update').length, 3);
});

test('Back preserves the edited raid name, description, date, time, zone and selected content', async () => {
    const h = harness();
    await h.setup('Europe/Istanbul');
    const draft = { name: 'MSH evening team', date: '2026-12-20', time: '22:45', description: 'Guild practice — deneme' };
    await h.submit(draft);
    await h.call('details');
    assert.deepEqual(h.modal.components.map(row => row.components[0].value), Object.values(draft));
    await h.call('settings');
    assert.match(embedText(h.payload), /22:45/);
    assert.equal(control(h.payload, 'zone').options.find(o => o.default).value, 'Europe/Istanbul');
    await h.call('back');
    assert.equal(control(h.payload, 'content').options.find(o => o.default).value, 'MSH');
    await h.call('content', { values: ['MSH'] });
    await h.call('details');
    assert.deepEqual(h.modal.components.map(row => row.components[0].value), Object.values(draft));
    await h.submit(draft);
    await h.call('confirm');
    assert.equal(h.published[0].aciklama, draft.description);
    assert.equal(h.published[0].originalLocalTime, draft.time);
});

test('regional preferences remain editable from the dropdown and persisted across sessions', async () => {
    const h = harness();
    await h.setup('America/New_York');
    await h.call('zone', { values: ['region'] });
    assert.equal(h.modal.components[0].components[0].value, 'America/New_York');
    assert.equal(h.modal.components[1].components[0].value, 'en-US');
    await h.call('regionSubmit', { fields: { zone: 'America/New_York', locale: 'en-GB' } });
    assert.match(embedText(h.payload), /24-Hour/);
    assert.equal(control(h.payload, 'period'), undefined);
    assert.equal(h.prefs.get('leader').preferredLocale, 'en-GB');
    await h.call(null, { guild: 'another-guild', locale: 'tr' });
    await h.call('content', { values: ['MSH'], guild: 'another-guild', locale: 'tr' });
    assert.match(embedText(h.payload), /24-Hour/);
    assert.equal(control(h.payload, 'zone').options.find(o => o.default).value, 'America/New_York');
});

test('AM/PM selection does not invent a time; explicit morning input updates the period', async () => {
    const h = harness();
    await h.setup('America/New_York');
    await h.call('period', { values: ['AM'] });
    assert.match(embedText(h.payload), /Time has not been entered/);
    assert.doesNotMatch(embedText(h.payload), /9:00|21:00/);
    await h.submit({ time: '7:05 AM' });
    await h.call('settings');
    assert.equal(control(h.payload, 'period').options.find(o => o.default).value, 'AM');
    await h.call('format', { values: ['24'] });
    assert.match(embedText(h.payload), /07:05/);
    await h.call('format', { values: ['12'] });
    await h.call('details');
    assert.equal(h.modal.components[2].components[0].value, '7:05 AM');
});

test('invalid inputs keep the complete draft available for correction and cannot publish', async t => {
    t.mock.method(console, 'error', () => {});
    for (const [zone, date, time, expected] of [
        ['Europe/Istanbul', '2026-02-30', '21:00', /valid date/],
        ['Europe/Istanbul', '2026-10-20', '25:10', /00:00–23:59/],
        ['America/New_York', '2026-10-20', '13:05 PM', /1:00–12:59/],
        ['America/New_York', '2026-03-08', '2:30 AM', /does not exist/]
    ]) {
        const h = harness();
        await h.setup(zone);
        await h.submit({ date, time, description: 'Keep this note' });
        assert.match(h.payload.content, expected);
        await h.call('confirm');
        assert.equal(h.published.length, 0);
        await h.call('details');
        const values = h.modal.components.map(row => row.components[0].value);
        assert.equal(values[1], date);
        assert.equal(values[2], time);
        assert.equal(values[3], 'Keep this note');
    }
});

test('long descriptions and markdown stay within limits without changing saved content', async () => {
    const h = harness();
    await h.setup('Europe/Istanbul');
    const description = '*'.repeat(500);
    const name = 'A'.repeat(80);
    await h.submit({ name, description });
    assert.ok(h.payload.embeds[0].toJSON().fields.at(-1).value.includes(description));
    await h.call('confirm');
    assert.equal(h.published[0].aciklama, description);
    assert.equal(h.published[0].zindan, name);
});

test('two simultaneous creation sessions in different guilds remain independent', async () => {
    const h = harness();
    await h.setup('Europe/Istanbul');
    const first = h.token;
    await h.submit({ time: '20:05' });
    await h.call(null, { user: 'second', guild: 'second-guild' });
    const second = h.token;
    await h.call('content', { user: 'second', guild: 'second-guild', values: ['MSH'] });
    await h.call('zone', { user: 'second', guild: 'second-guild', values: ['America/Los_Angeles'] });
    await h.call('submit', { user: 'second', guild: 'second-guild', fields: { name: 'MSH', date: '2026-10-20', time: '10:30 PM' } });
    await h.call('confirm', { token: first, guild: 'wrong-guild' });
    assert.equal(h.published.length, 0);
    await h.call('confirm', { token: first });
    await h.call('confirm', { token: second, user: 'second', guild: 'second-guild' });
    assert.equal(h.published.length, 2);
    assert.equal(h.published[0].originalLocalTime, '20:05');
    assert.equal(h.published[1].originalLocalTime, '22:30');
    assert.equal(h.published[0].organizerTimeZone, 'Europe/Istanbul');
    assert.equal(h.published[1].organizerTimeZone, 'America/Los_Angeles');
});

test('expired, cancelled and stale screens cannot publish or change another step', async () => {
    const h = harness();
    await h.setup('Europe/Istanbul');
    await h.submit();
    await h.call('format', { values: ['12'] });
    assert.match(h.payload.content, /expired/);
    h.now += 31 * 60_000;
    await h.call('confirm');
    assert.match(h.payload.content, /expired/);
    assert.equal(h.published.length, 0);
    await h.setup('Europe/Istanbul');
    await h.call('back');
    await h.submit();
    assert.match(h.payload.content, /expired/);
    await h.call('cancel');
    assert.deepEqual(h.payload.components, []);
    await h.call('details');
    assert.match(h.payload.content, /expired/);
    assert.equal(h.published.length, 0);
});

test('content emojis and catalog labels are preserved; existing emoji fallback handles missing access', async t => {
    t.mock.method(console, 'warn', () => {});
    const catalog = [{ value: 'trial', label: 'Existing Trial Name', contentType: 'trial', emoji: { id: '123456789012345678', name: 'trial' } }];
    const h = harness({ contents: catalog });
    await h.call();
    const option = control(h.payload, 'content').options[0];
    assert.equal(option.label, catalog[0].label);
    assert.equal(option.value, catalog[0].value);
    assert.equal(option.emoji.id, catalog[0].emoji.id);
    const fallback = safeEmojiPayload(h.payload, {});
    assert.equal(fallback.components[0].components[0].options[0].emoji.id, undefined);
    assert.equal(control(h.payload, 'content').options[0].emoji.id, catalog[0].emoji.id);
});
