const test = require('node:test');
const assert = require('node:assert/strict');
const { createRaidCreation } = require('../raid_creation');
const { raidKomutu } = require('../raid');

function validate(payload) {
    if (payload?.toJSON) {
        const json = payload.toJSON();
        assert.ok(json.title.length <= 45);
        assert.ok(json.components.length <= 5);
        for (const row of json.components) for (const field of row.components) assert.ok(field.label.length <= 45);
        return;
    }
    assert.ok(!payload.content || payload.content.length <= 2000);
    for (const embed of payload.embeds || []) assert.ok(embed.length <= 6000);
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
function harness() {
    const prefs = new Map();
    const published = [];
    const state = { published, prefs, payload: null, modal: null, token: null, publishDelay: null, failPublish: false };
    const wizard = createRaidCreation({
        contents: [{ value: 'MSH', label: 'MSH (Master Soul Harvester)', contentType: 'trial' }, { value: 'custom', label: 'Custom' }],
        preferences: { get: id => prefs.get(id), set: (id, value) => prefs.set(id, { ...value }) },
        now: () => Date.parse('2026-01-01T00:00:00Z'),
        publish: async (i, data) => {
            if (state.publishDelay) await state.publishDelay;
            if (state.failPublish) throw new Error('send failed');
            published.push(JSON.parse(JSON.stringify(data)));
        }
    });
    state.call = async (action = null, { values = [], fields = {}, user = 'leader', channel = 'channel', token = state.token } = {}) => {
        const response = async payload => { validate(payload); state.payload = payload; return payload; };
        const i = {
            user: { id: user }, channelId: channel, guildId: 'guild', locale: 'en-US',
            commandName: 'raid-oluştur', customId: action ? `raid_create_${token}_${action}` : undefined,
            isChatInputCommand: () => !action, values,
            fields: { getTextInputValue: name => fields[name] || '' },
            reply: response, update: response, editReply: response,
            deferUpdate: async () => { i.deferred = true; },
            showModal: async modal => { validate(modal); state.modal = modal.toJSON(); }
        };
        const result = await wizard.handle(i);
        if (!action) state.token = state.payload.components[0].toJSON().components[0].custom_id.split('_')[2];
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
    assert.match(h.payload.content, /Choose a time zone/);
    await h.call('details');
    assert.match(h.modal.title, /Raid Bilgileri \/ Raid Details/);
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
    assert.match(h.payload.content, /not detected automatically/);
    assert.equal(h.payload.components.at(-1).toJSON().components[0].disabled, true);
    await h.call('zone', { values: ['other'] });
    assert.equal(h.modal.components.length, 2);
    await h.call('regionSubmit', { fields: { zone: 'Asia/Kathmandu', locale: 'en-GB' } });
    assert.ok(['Asia/Kathmandu', 'Asia/Katmandu'].includes(h.prefs.get('leader').preferredTimeZone));
    await h.call();
    await h.call('content', { values: ['MSH'] });
    assert.match(h.payload.content, /Asia\/Kath?mandu/);
    assert.equal(h.payload.components.at(-1).toJSON().components[0].disabled, false);
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
    assert.equal(h.payload.components.at(-1).toJSON().components[0].disabled, true);
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
    assert.equal(h.modal.components[2].components[0].value, '9:00 AM');
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
