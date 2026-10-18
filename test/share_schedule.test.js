const test = require('node:test');
const assert = require('node:assert/strict');
const { createShareSchedule, upcomingRaids, scheduleEmbeds, registrationLink, verifyRegistration } = require('../share_schedule');
const now = Date.parse('2027-01-01T00:00:00Z');
function records(count = 30) {
    return Array.from({ length: count }, (_, index) => ({ id: String(800000000000000000n + BigInt(index)), raid: {
        raidId: `stable-${index}`, guildId: '111111111111111111', channelId: '222222222222222222', creatorId: '333333333333333333',
        zindan: `Master Trial ${index}`, unixZamani: now / 1000 + 86400 * (index + 2), organizerTimeZone: 'Europe/Istanbul',
        publishAt: now / 1000 + 86400 * (index + 1), ...(index % 2 ? { status: 'scheduled', published: false } : {})
    } }));
}
function harness(count = 30) {
    const h = { records: records(count), now, sent: [], token: null, payload: null, allowed: true, missing: new Set(), failSend: false };
    const service = createShareSchedule({ getRaids: () => h.records, now: () => h.now, verify: async (_, record) => !h.missing.has(record.raid.raidId) });
    h.call = async (action, options = {}) => {
        const capture = payload => { h.payload = JSON.parse(JSON.stringify(payload)); return payload; };
        const acknowledge = () => { assert.ok(!i.replied && !i.deferred); i.replied = true; };
        const i = { user: { id: options.user || 'owner' }, guildId: options.guild || '111111111111111111', channelId: '222222222222222222',
            memberPermissions: { has: () => h.allowed }, commandName: 'share-schedule', locale: 'tr',
            isChatInputCommand: () => !action, customId: action ? `raid_share_${h.token}_${action}` : undefined, values: options.values || [],
            client: {}, channel: { send: async payload => { if (h.delay) await h.delay; if (h.failSend) throw new Error('send failed'); h.sent.push(JSON.parse(JSON.stringify(payload))); } },
            reply: async payload => { acknowledge(); return capture(payload); },
            update: async payload => { acknowledge(); return capture(payload); },
            deferReply: async payload => { assert.deepEqual(payload.flags, [64]); acknowledge(); i.deferred = true; },
            deferUpdate: async () => { acknowledge(); i.deferred = true; },
            editReply: async payload => { assert.ok(i.replied || i.deferred); return capture(payload); }
        };
        await service.handle(i);
        if (!action && h.payload.components?.length) h.token = h.payload.components[0].components[0].custom_id.split('_')[2];
    };
    return h;
}
test('future scheduled and legacy published raids sort chronologically; closed, expired and foreign raids are excluded', () => {
    const source = records(7).reverse();
    source[0].raid.status = 'completed'; source[1].raid.status = 'cancelled'; source[2].raid.deleted = true;
    source[3].raid.unixZamani = now / 1000; source[4].raid.guildId = 'other';
    const before = JSON.stringify(source);
    const eligible = upcomingRaids(source, '111111111111111111', now / 1000);
    assert.deepEqual(eligible.map(r => r.raid.raidId), ['stable-0', 'stable-1']);
    assert.equal(JSON.stringify(source), before);
});
test('25-option pages preserve multiple selections and deselections in both directions', async () => {
    const h = harness(55); await h.call();
    assert.equal(h.payload.embeds[0].title, 'Scheduled Raids');
    assert.equal(h.payload.components[0].components[0].options.length, 25);
    await h.call('select-0', { values: ['stable-0', 'stable-2'] });
    await h.call('next'); assert.equal(h.payload.components[0].components[0].options.length, 25);
    await h.call('select-1', { values: ['stable-26'] });
    await h.call('next'); assert.equal(h.payload.components[0].components[0].options.length, 5);
    await h.call('select-2', { values: ['stable-54'] });
    await h.call('previous'); await h.call('previous');
    assert.deepEqual(h.payload.components[0].components[0].options.filter(o => o.default).map(o => o.value), ['stable-0', 'stable-2']);
    await h.call('select-0', { values: ['stable-2'] });
    await h.call('share');
    const text = JSON.stringify(h.sent);
    assert.match(text, /MASTER TRIAL 2/); assert.match(text, /MASTER TRIAL 26/); assert.match(text, /MASTER TRIAL 54/);
    assert.doesNotMatch(text, /MASTER TRIAL 0/);
    assert.ok(text.indexOf('MASTER TRIAL 2') < text.indexOf('MASTER TRIAL 26'));
});
test('selection menu has no visible IDs and uses stable IDs even after publication rekeys the raid', async () => {
    const h = harness(2); await h.call();
    const options = h.payload.components[0].components[0].options;
    for (const option of options) { assert.doesNotMatch(option.label, /stable-|800000/); assert.doesNotMatch(option.description, /stable-|800000/); }
    await h.call('select-0', { values: ['stable-1'] });
    h.records[1].id = '900000000000000000'; h.records[1].raid.messageId = h.records[1].id;
    h.records[1].raid.published = true; h.records[1].raid.status = 'published';
    await h.call('share'); assert.match(JSON.stringify(h.sent), /900000000000000000/);
});
test('sharing is read-only and uses original registration links, never registration controls', async () => {
    const h = harness(3); const before = JSON.stringify(h.records);
    await h.call(); await h.call('select-0', { values: ['stable-0', 'stable-1'] }); await h.call('share');
    assert.equal(JSON.stringify(h.records), before);
    const text = h.sent[0].embeds[0].description;
    assert.ok(text.includes(`Date: <t:${h.records[0].raid.unixZamani}:D>`));
    assert.ok(text.includes(`Time: <t:${h.records[0].raid.unixZamani}:t>`));
    assert.ok(text.includes(`Registration Opens: <t:${h.records[1].raid.publishAt}:F>`));
    assert.ok(!text.includes('(Europe/Istanbul)'));
    assert.match(text, /Status: Registration Open/); assert.match(text, /Status: Registration Not Yet Open/);
    assert.match(text, /Registration Opens:/);
    assert.ok(text.includes('[Join Raid](https://discord.com/channels/111111111111111111/222222222222222222/800000000000000000)'));
    assert.equal(h.sent[0].components, undefined); assert.deepEqual(h.sent[0].allowedMentions, { parse: [] });
    await h.call('share'); assert.equal(h.sent.length, 1);
    await h.call(); await h.call('select-0', { values: ['stable-0'] }); await h.call('share');
    assert.equal(h.sent.length, 2); assert.equal(JSON.stringify(h.records), before);
});
test('unauthorized users, foreign sessions, forged page IDs and stale components cannot share', async () => {
    const h = harness(); h.allowed = false; await h.call(); assert.match(h.payload.content, /Manage Server/);
    h.allowed = true; await h.call(); await h.call('select-0', { values: ['stable-0'], user: 'other' });
    assert.match(h.payload.content, /another user/);
    await h.call('select-0', { values: ['stable-29'] }); assert.match(h.payload.content, /Invalid/);
    await h.call('share'); assert.equal(h.payload.content, 'Please select at least one raid.');
    await h.call('next'); await h.call('select-0', { values: ['stable-0'] }); assert.match(h.payload.content, /outdated/);
    h.now += 15 * 60_000; await h.call('share'); assert.match(h.payload.content, /expired/);
    assert.deepEqual(h.payload.components, []); assert.equal(h.sent.length, 0);
});
test('cancel, empty states and permission changes cannot send a schedule', async () => {
    const empty = harness(0); await empty.call(); assert.equal(empty.payload.content, 'No upcoming raids found.');
    const h = harness(); await h.call(); await h.call('select-0', { values: ['stable-0'] });
    h.allowed = false; await h.call('share'); assert.equal(h.sent.length, 0);
    h.allowed = true; await h.call('cancel'); await h.call('share'); assert.equal(h.sent.length, 0);
});
test('deleted, expired or cancelled selections are revalidated immediately before sending', async () => {
    for (const invalidate of [h => h.records.shift(), h => { h.records[0].raid.status = 'cancelled'; }, h => { h.records[0].raid.unixZamani = now / 1000; }, h => h.missing.add('stable-0')]) {
        const h = harness(); await h.call(); await h.call('select-0', { values: ['stable-0', 'stable-1'] });
        invalidate(h); await h.call('share'); assert.equal(h.sent.length, 0); assert.match(h.payload.content, /no longer available/);
        await h.call('share'); assert.equal(h.sent.length, 1); assert.doesNotMatch(JSON.stringify(h.sent), /MASTER TRIAL 0/);
    }
});
test('simultaneous confirmations and Discord failures cannot repeat a batch', async t => {
    t.mock.method(console, 'error', () => {});
    const h = harness(); await h.call(); await h.call('select-0', { values: ['stable-0'] });
    let release; h.delay = new Promise(resolve => { release = resolve; });
    const sending = h.call('share'); await h.call('share'); release(); await sending; assert.equal(h.sent.length, 1);
    const failed = harness(); await failed.call(); await failed.call('select-0', { values: ['stable-0'] });
    failed.failSend = true; await failed.call('share'); assert.equal(failed.payload.content, 'Failed to share schedule. Please try again.');
    failed.failSend = false; await failed.call('share'); assert.equal(failed.sent.length, 0);
});
test('large announcements split into complete English embeds within all Discord limits', () => {
    const all = records(100); const embeds = scheduleEmbeds(all);
    assert.ok(embeds.length > 1);
    const combined = embeds.map(embed => embed.toJSON().description).join('\n');
    for (const record of all) assert.ok(combined.includes(`**${record.raid.zindan.toUpperCase()}**`));
    for (const embed of embeds) {
        assert.ok(embed.length <= 6000); assert.ok(embed.toJSON().description.length <= 4096);
        assert.equal(embed.toJSON().title, 'Upcoming Raids');
        assert.doesNotMatch(JSON.stringify(embed), /[ğşİı]|Tarih|Saat|KAYIT|Ekim/);
    }
});
test('registration URLs require real IDs; deleted messages are excluded and network failures propagate', async () => {
    const [published, unpublished] = records(2);
    assert.ok(registrationLink(published)); assert.equal(registrationLink(unpublished), null);
    assert.equal(registrationLink({ id: 'temporary', raid: published.raid }), null);
    const client = { user: { id: 'bot' }, channels: { fetch: async () => ({ messages: { fetch: async () => ({ author: { id: 'bot' } }) } }) } };
    assert.equal(await verifyRegistration(client, published), true);
    client.channels.fetch = async () => { throw Object.assign(new Error('deleted'), { code: 10003 }); };
    assert.equal(await verifyRegistration(client, published), false);
    client.channels.fetch = async () => { throw new Error('network'); };
    await assert.rejects(verifyRegistration(client, published), /network/);
});
