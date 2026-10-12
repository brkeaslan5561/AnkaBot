const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _test: { buildAbsenceWarningEmbed, sendAbsenceWarning } } = require('../raid');

const player = { userId: '123456789012345678', role: 'heal' };
const raid = { zindan: 'MSH (Master Soul Harvester)', unixZamani: 1792522800 };
const result = { strikeCount: 1, penaltyTriggered: false, pendingPenalties: 0, totalAbsences: 1 };
function validate(embed) {
    const json = embed.toJSON();
    assert.equal(json.color, 0xE58A3B);
    assert.ok(embed.length <= 6000);
    assert.ok(json.fields.length <= 25);
    assert.ok(json.fields.every(field => field.name.length <= 256 && field.value.length <= 1024));
    assert.equal(json.footer.text, 'AnkaBot • Raid Notification');
    return json;
}

test('absence warning shares notification theme, bilingual hierarchy and unbolded timestamp values', () => {
    const json = validate(buildAbsenceWarningEmbed({}, player, raid, result));
    assert.equal(json.title, 'Raid Katılım Uyarısı');
    assert.ok(json.description.startsWith('*Raid Attendance Warning*'));
    assert.match(json.description, /\*\*Kayıtlı/);
    assert.match(json.description, /\*The raid leader marked you as absent/);
    assert.ok(json.fields.some(f => f.value === '**Tarih** / Date\n<t:1792522800:D>'));
    assert.ok(json.fields.some(f => f.value === '**Saat** / Time\n<t:1792522800:t>'));
    assert.ok(json.fields.some(f => f.value === '**Rol** / Role\nHEALER'));
    const text = JSON.stringify(json);
    assert.ok(!text.includes('Time Left'));
    assert.ok(!text.includes('Signup Confirmed'));
    assert.ok(!text.includes('15 minutes early'));
    assert.ok(json.fields.some(f => f.value.includes('**Mevcut devamsızlık sayacınız: 1/3.')));
    assert.ok(json.fields.some(f => f.value.includes('*Current absence counter: 1/3.')));
});

test('second absence and triggered/stacked penalties preserve actual counters and consequences', () => {
    const second = validate(buildAbsenceWarningEmbed({}, player, raid, { ...result, strikeCount: 2, totalAbsences: 2 }));
    assert.match(JSON.stringify(second), /1 kez daha/);
    assert.match(JSON.stringify(second), /miss 1 more/);
    for (const pendingPenalties of [1, 3]) {
        const data = { strikeCount: 0, penaltyTriggered: true, pendingPenalties, totalAbsences: 9 };
        const before = JSON.stringify(data);
        const json = validate(buildAbsenceWarningEmbed({}, player, raid, data));
        const text = JSON.stringify(json);
        assert.match(text, /1 raid kayıt cezası/);
        assert.match(text, /one raid signup penalty/);
        assert.equal(text.includes('Total pending raid penalties'), pendingPenalties > 1);
        assert.ok(json.fields.some(f => f.value === '**Toplam Devamsızlık** / Total Absences\n9'));
        assert.equal(JSON.stringify(data), before);
    }
});

test('missing date and long raid name remain safe; organizer time and bot avatar are retained', () => {
    const client = { user: { displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' } };
    const json = validate(buildAbsenceWarningEmbed(client, {}, {
        zindan: 'Long raid name '.repeat(300), organizerTimeZone: 'America/New_York',
        originalLocalDate: '2026-10-20', originalLocalTime: '21:00', organizerHourFormat: '12'
    }, result));
    assert.ok(json.fields.some(f => f.value === '**Tarih** / Date\n—'));
    assert.match(JSON.stringify(json), /9:00 PM – America\/New_York/);
    assert.equal(json.footer.icon_url, client.user.displayAvatarURL());
});

test('warning sends exactly one embed and closed DMs keep existing error handling', async context => {
    const sent = [], logs = [];
    context.mock.method(console, 'warn', (...args) => logs.push(args.join(' ')));
    await sendAbsenceWarning({ users: { fetch: async id => {
        assert.equal(id, player.userId);
        return { send: async payload => sent.push(payload) };
    } } }, player, raid, result);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].embeds.length, 1);
    assert.equal(sent[0].content, undefined);
    await sendAbsenceWarning({ users: { fetch: async () => ({ send: async () => { throw new Error('DM closed'); } }) } }, player, raid, result);
    assert.match(logs[0], /Absence warning DM failed/);
});

test('finalizing attendance keeps penalties and deduplication while using the new DM', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'raid.js'), 'utf8');
    const body = source.slice(source.indexOf('async function finalizeAttendance('), source.indexOf('function buildRaidNotificationEmbed('));
    let applications = 0, saves = 0, messages = 0;
    const finalize = new Function('attendanceRosterSnapshot', 'absenceApplied', 'sendAbsenceWarning', 'saveRaid', body + '\nreturn finalizeAttendance;')(
        () => [player], () => { applications++; return result; }, sendAbsenceWarning, () => { saves++; }
    );
    const data = { ...raid };
    const client = { users: { fetch: async () => ({ send: async payload => { validate(payload.embeds[0]); messages++; } }) } };
    await finalize(client, 'raid-id', data, [player.userId, player.userId]);
    assert.equal((await finalize(client, 'raid-id', data, [player.userId])).alreadyCompleted, true);
    assert.equal(applications, 1);
    assert.equal(saves, 1);
    assert.equal(messages, 1);
    assert.equal(data.attendanceCompleted, true);
});
