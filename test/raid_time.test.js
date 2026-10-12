const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { localCandidates, parseTime, formatLocalTime, hourFormat, localeForZone, dateParts, timeSnapshot, createTimePreferences, resolveRaidTimeEdit, organizerTime } = require('../raid_time');
const utc = value => Date.parse(value) / 1000;

for (const [zone, input, format, expected] of [
    ['Europe/Istanbul', '20:00', '24', '2026-10-20T17:00:00Z'],
    ['America/New_York', '9:00 PM', '12', '2026-10-21T01:00:00Z'],
    ['America/Los_Angeles', '10:30 PM', '12', '2026-10-21T05:30:00Z'],
    ['Asia/Kathmandu', '00:05', '24', '2026-10-19T18:20:00Z']
]) test(`${zone}: local ${input} converts to the exact UTC instant`, () => {
    assert.deepEqual(localCandidates('2026-10-20', parseTime(input, format), zone), [utc(expected)]);
});

test('AM/PM, all minutes, midnight and noon validate without silent normalization', () => {
    for (const [input, output] of [['12:00 AM', '00:00'], ['12:00 PM', '12:00'], ['1:05 am', '01:05'], ['9:45 PM', '21:45']]) {
        assert.equal(parseTime(input, '12'), output);
    }
    assert.equal(parseTime('8:15', '12', 'PM'), '20:15');
    assert.equal(parseTime('20:05'), '20:05');
    assert.equal(parseTime('23:59'), '23:59');
    for (const bad of ['0:00 AM', '13:00 PM', '9:60 PM', '9:00']) assert.throws(() => parseTime(bad, '12'));
    for (const bad of ['24:00', '20:60', '9:00', '9:00 PM']) assert.throws(() => parseTime(bad, '24'));
});

test('format choice is separate from zone; switching 12/24 does not change an instant', () => {
    for (const zone of ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Denver']) assert.equal(hourFormat('auto', localeForZone(zone)), '12');
    for (const zone of ['Europe/Istanbul', 'Europe/London', 'Europe/Berlin']) assert.equal(hourFormat('auto', localeForZone(zone)), '24');
    assert.equal(hourFormat('auto', 'en-US'), '12');
    assert.equal(hourFormat('auto', 'en-GB'), '24');
    assert.equal(hourFormat('auto', localeForZone('US/Eastern', 'tr-TR')), '12');
    assert.equal(hourFormat('24', 'en-US'), '24');
    assert.equal(hourFormat('12', 'tr-TR'), '12');
    assert.equal(formatLocalTime('21:00', '12'), '9:00 PM');
    assert.equal(formatLocalTime('00:00', '12'), '12:00 AM');
    assert.equal(formatLocalTime('21:00', '24'), '21:00');
    const timestamp = localCandidates('2026-10-20', '21:00', 'America/New_York')[0];
    assert.equal(timeSnapshot('2026-10-20', '21:00', 'America/New_York', '12', 'en-US', timestamp).unixZamani,
        timeSnapshot('2026-10-20', '21:00', 'America/New_York', '24', 'en-US', timestamp).unixZamani);
});

test('IANA data selects the actual winter/summer offsets', () => {
    assert.deepEqual(localCandidates('2026-01-20', '21:00', 'America/New_York'), [utc('2026-01-21T02:00:00Z')]);
    assert.deepEqual(localCandidates('2026-07-20', '21:00', 'America/New_York'), [utc('2026-07-21T01:00:00Z')]);
    assert.deepEqual(localCandidates('2026-01-20', '20:00', 'Europe/Berlin'), [utc('2026-01-20T19:00:00Z')]);
    assert.deepEqual(localCandidates('2026-07-20', '20:00', 'Europe/Berlin'), [utc('2026-07-20T18:00:00Z')]);
});

test('US and European gaps are rejected; repeated hours return both UTC choices', () => {
    assert.deepEqual(localCandidates('2026-03-08', '02:30', 'America/New_York'), []);
    assert.deepEqual(localCandidates('2026-03-29', '02:30', 'Europe/Berlin'), []);
    assert.deepEqual(localCandidates('2026-11-01', '01:30', 'America/New_York'), [utc('2026-11-01T05:30:00Z'), utc('2026-11-01T06:30:00Z')]);
    assert.deepEqual(localCandidates('2026-10-25', '02:30', 'Europe/Berlin'), [utc('2026-10-25T00:30:00Z'), utc('2026-10-25T01:30:00Z')]);
    const halfHour = localCandidates('2026-04-05', '01:45', 'Australia/Lord_Howe');
    assert.equal(halfHour.length, 2);
    assert.equal(halfHour[1] - halfHour[0], 1800);
    assert.deepEqual(localCandidates('2011-12-30', '12:00', 'Pacific/Apia'), []);
});

test('invalid dates and zones cannot silently roll into another date', () => {
    for (const date of ['2026-02-30', '2026-13-01', '2026-00-01', '2026-11-00', '20/10/2026']) assert.throws(() => localCandidates(date, '20:00', 'Europe/Istanbul'));
    assert.throws(() => localCandidates('2026-10-20', '20:00', 'Moon/Base'));
    assert.throws(() => localCandidates('2026-10-20', '20:00', '+03:00'));
});

test('per-user preferences persist across restart without changing existing independent raids', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anka-time-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'prefs.json');
    const prefs = createTimePreferences(file);
    prefs.set('leader-a', { preferredTimeZone: 'Europe/Istanbul', preferredHourFormat: '24', preferredLocale: 'tr-TR' });
    const first = timeSnapshot('2026-10-20', '20:00', 'Europe/Istanbul', '24', 'tr-TR', utc('2026-10-20T17:00:00Z'));
    const before = JSON.stringify(first);
    prefs.set('leader-b', { preferredTimeZone: 'America/New_York', preferredHourFormat: 'auto', preferredLocale: 'en-US' });
    const second = timeSnapshot('2026-10-20', '21:00', 'America/New_York', '12', 'en-US', utc('2026-10-21T01:00:00Z'));
    prefs.set('leader-a', { preferredTimeZone: 'Asia/Tokyo', preferredHourFormat: '12', preferredLocale: 'ja-JP' });
    assert.equal(JSON.stringify(first), before);
    assert.notEqual(second.unixZamani, first.unixZamani);
    const reloaded = createTimePreferences(file);
    assert.equal(reloaded.get('leader-a').preferredTimeZone, 'Asia/Tokyo');
    assert.equal(reloaded.get('leader-b').preferredTimeZone, 'America/New_York');
    reloaded.get('leader-a').preferredTimeZone = 'Europe/London';
    assert.equal(reloaded.get('leader-a').preferredTimeZone, 'Asia/Tokyo');
    assert.equal(JSON.parse(JSON.stringify(first)).unixZamani, first.unixZamani);
});

test('raid edits use the raid snapshot, reject unknown legacy zones and require a DST choice', () => {
    const raid = timeSnapshot('2026-10-20', '21:00', 'America/New_York', '12', 'en-US', utc('2026-10-21T01:00:00Z'));
    const now = utc('2026-01-01T00:00:00Z');
    const edited = resolveRaidTimeEdit(raid, { time: '10:15 PM' }, now);
    assert.equal(edited.unixZamani, utc('2026-10-21T02:15:00Z'));
    assert.equal(raid.unixZamani, utc('2026-10-21T01:00:00Z'));
    assert.match(organizerTime(edited), /10:15 PM – America\/New_York/);
    assert.throws(() => resolveRaidTimeEdit(raid, { month: 11, day: 1, time: '01:30' }, now), /fold/);
    assert.equal(resolveRaidTimeEdit(raid, { month: 11, day: 1, time: '01:30', fold: 'later' }, now).unixZamani, utc('2026-11-01T06:30:00Z'));
    const legacy = { unixZamani: raid.unixZamani };
    assert.throws(() => resolveRaidTimeEdit(legacy, { time: '20:00' }, now), /unknownZone/);
    assert.equal(legacy.unixZamani, raid.unixZamani);
    assert.equal(organizerTime(legacy), null);
});

test('UTC conversion is independent of the AWS host timezone', () => {
    const code = "console.log(require('./raid_time').localCandidates('2026-10-20','21:00','America/New_York')[0])";
    const results = ['UTC', 'Europe/Istanbul', 'America/Los_Angeles'].map(TZ => execFileSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), env: { ...process.env, TZ }, encoding: 'utf8' }).trim());
    assert.equal(new Set(results).size, 1);
    assert.equal(Number(results[0]), utc('2026-10-21T01:00:00Z'));
    assert.equal(dateParts(Number(results[0]), 'Europe/Istanbul').time, '04:00');
});
