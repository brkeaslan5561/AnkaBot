const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateLocalization } = require('../scripts/migrate_localization');

function activeRaid() {
    return {
        channelId: 'channel',
        guildId: 'guild',
        unixZamani: Math.floor(Date.now() / 1000) + 3600,
        zindan: 'Test Raid',
        tarih: '<t:2000000000:F>',
        aciklama: 'Test',
        contentType: 'trial',
        capacity: 10,
        tanklar: [], healerlar: [], dpsler: [], yedekler: []
    };
}

test('migration safely skips a deleted Discord raid message', async () => {
    const client = {
        user: { id: 'bot' },
        channels: { fetch: async () => ({ messages: { fetch: async () => { const error = new Error('Unknown Message'); error.code = 10008; throw error; } } }) }
    };
    const logs = [];
    const summary = await migrateLocalization(client, {
        dryRun: false,
        entries: [{ id: 'message', raid: activeRaid() }],
        logger: { log: message => logs.push(message), error: message => logs.push(message) }
    });
    assert.equal(summary.skipped, 1);
    assert.equal(summary.failed, 0);
    assert.match(logs.join('\n'), /no longer exists/);
});

test('migration dry-run verifies ownership but does not edit', async () => {
    let edits = 0;
    const client = {
        user: { id: 'bot' },
        channels: { fetch: async () => ({ messages: { fetch: async () => ({ author: { id: 'bot' }, edit: async () => { edits += 1; } }) } }) }
    };
    const summary = await migrateLocalization(client, {
        dryRun: true,
        entries: [{ id: 'message', raid: activeRaid() }],
        logger: { log() {}, error() {} }
    });
    assert.equal(summary.eligible, 1);
    assert.equal(summary.updated, 0);
    assert.equal(edits, 0);
});
