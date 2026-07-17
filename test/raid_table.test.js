const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { renderRaidTable, WIDTH } = require('../raid_table');
const sharp = require('sharp');

test('trial PNG çıktısı büyük boyutta bütün 10 satırı içerir', async () => {
    if (process.platform === 'linux') {
        assert.ok(process.env.FONTCONFIG_FILE);
        assert.equal(fs.existsSync(process.env.FONTCONFIG_FILE), true);
    }
    const raid = {
        zindanKodu: 'MZC',
        zindan: 'MZC',
        contentType: 'trial',
        capacity: 10,
        unixZamani: 1784311200,
        creatorMention: '@RaidLideri'
    };
    const plan = {
        capacity: 10,
        warnings: ['8 kadro yeri boş.'],
        rows: [
            {
                userId: '1', displayName: 'Anka Tank', role: 'tank', klass: 'Paladin',
                artifact: 'Mythallar Fragment', mount: 'Swarm', companion: 'Spined Devil', aura: 'Pack Tactics'
            },
            {
                userId: '2', displayName: 'Anka Healer', role: 'heal', klass: 'Cleric',
                artifact: 'Heart of the Volcano', mount: 'Eclipse Lion', companion: 'Drizzt Do\'Urden', aura: 'Mystic Aura'
            }
        ]
    };

    const png = await renderRaidTable(raid, plan, { status: 'TASLAK' });
    const metadata = await sharp(png).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, WIDTH);
    assert.equal(metadata.height, 1460);
    assert.ok(png.length > 100_000);
});
