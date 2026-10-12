const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { renderRaidTable, WIDTH, _test } = require('../raid_table');
const { previewScenarios } = require('../scripts/generate_raid_preview');

const scenarios = previewScenarios();
const roles = ['tank', 'heal', 'dps', 'dps', 'dps', 'tank', 'heal', 'dps', 'dps', 'dps'];

for (const [name, missingPositions] of [
    ['trial-full-tr', []], ['trial-nine', [9]], ['trial-missing-tank', [5]],
    ['trial-missing-healer', [6]], ['trial-missing-dps', [8, 9]], ['trial-shuffled', []]
]) {
    test(`${name}: roller doğru slotta, ekipmanlar oyuncuda ve kayıt sırası değişmiyor`, () => {
        const { raid, plan } = scenarios[name];
        const before = structuredClone({ raid, plan });
        const { slots } = _test.prepareDisplayRows(raid, plan);
        assert.equal(slots.length, 10);
        assert.deepEqual(slots.map(slot => slot.role), roles);
        assert.deepEqual(slots.flatMap((slot, index) => slot.row ? [] : [index]), missingPositions);
        for (const role of ['tank', 'heal', 'dps']) {
            assert.deepEqual(slots.filter(slot => slot.row?.role === role).map(slot => slot.row.userId),
                plan.rows.filter(row => row.role === role).map(row => row.userId));
        }
        for (const slot of slots.filter(slot => slot.row)) {
            assert.strictEqual(slot.row, plan.rows.find(row => row.userId === slot.row.userId));
        }
        assert.deepEqual({ raid, plan }, before);
    });
}

test('normal kapasite dışındaki roller kaybolmaz ve eksik rolü doldurmaz', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ userId: String(i), role: 'dps' }));
    const { slots } = _test.prepareDisplayRows({ capacity: 10, contentType: 'trial' }, { rows });
    assert.equal(slots.filter(slot => slot.row).length, 10);
    assert.deepEqual([0, 1, 5, 6].map(index => slots[index].row), [null, null, null, null]);
    assert.equal(new Set(slots.filter(slot => slot.row).map(slot => slot.row.userId)).size, 10);
});

test('manuel ekipman atamaları PNG sıralaması boyunca aynı oyuncuda kalır', () => {
    const { raid, plan } = scenarios['trial-manual-equipment'];
    const before = structuredClone(plan);
    const { slots } = _test.prepareDisplayRows(raid, plan);
    assert.equal(slots[0].row.userId, '1');
    assert.equal(slots[0].row.artifact, 'Heart of the Volcano');
    assert.deepEqual(plan, before);
});

test('dungeon beş slot, özel kapasiteler mevcut kayıt sırası ile çizilir', () => {
    const { raid, plan } = scenarios.dungeon;
    const display = _test.prepareDisplayRows(raid, plan);
    assert.equal(display.grouped, false);
    assert.equal(display.slots.length, 5);
    assert.deepEqual(display.slots.map(slot => slot.role), roles.slice(0, 5));
    const custom = _test.prepareDisplayRows({ capacity: 7, contentType: 'custom' }, { rows: plan.rows });
    assert.equal(custom.slots.length, 7);
    assert.deepEqual(custom.slots.slice(0, 5).map(slot => slot.row), plan.rows);
    assert.equal(custom.grouped, false);
    assert.equal(_test.prepareDisplayRows({}, {}).slots.length, 10);
});

test('uzun isimler ve ekipman metni kesilmez, hücre sınırlarında kalır', async () => {
    const { raid, plan } = structuredClone(scenarios['trial-long-names']);
    const equipmentName = 'Very Long Equipment Name With Multiple Words And No Loss Of Any Text';
    plan.rows[0].artifact = equipmentName;
    plan.rows[0].displayName += ' WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW';
    const layout = await _test.buildRaidTableSvg(raid, plan);
    const tank = layout.slots.find(slot => slot.row?.userId === '1');
    assert.equal(tank.cells[0].image.text, plan.rows[0].displayName);
    assert.equal(tank.cells[3].image.text, equipmentName);
    assert.ok(layout.rowHeight > 96);
    for (const slot of layout.slots) {
        slot.cells.forEach((cell, index) => {
            assert.ok(cell.image.width + (cell.inset || 0) <= _test.COLUMN_WIDTHS[index + 1] - 32);
            assert.ok(cell.image.height <= layout.rowHeight - 28);
        });
    }
    const png = await sharp(Buffer.from(layout.svg)).png().toBuffer();
    assert.equal((await sharp(png).metadata()).height, layout.height);
});

test('TR/EN seçenekleri iki dilli PNG üretir; eski paneller ve meta bilgiler yoktur', async () => {
    const { raid, plan } = scenarios['trial-full-tr'];
    const tr = await _test.buildRaidTableSvg(raid, plan, { language: 'tr' });
    const en = await _test.buildRaidTableSvg(raid, plan, { language: 'en' });
    assert.equal(tr.svg, en.svg);
    for (const label of ['OYUNCU', 'PLAYER', 'ROL', 'ROLE', 'KLAS', 'CLASS', 'ESER', 'ARTIFACT', 'BİNEK GÜCÜ', 'MOUNT POWER', 'YOLDAŞ', 'COMPANION', 'AURA', 'GRUP 1', 'GRUP 2']) {
        assert.ok(tr.svg.includes(`>${label}</text>`));
    }
    assert.doesNotMatch(tr.svg, /<circle|rx=|AUTOMATIC PLAN|OTOMATİK PLAN|UYARI|KATILIM|RaidLideri|TRIAL/);
    const empty = await _test.buildRaidTableSvg(raid, { rows: [], warnings: ['Warning content must stay out of PNG'] });
    assert.ok(empty.slots.every(slot => slot.cells[0].image.text === 'BOŞ SLOT\nEMPTY SLOT'));
    assert.doesNotMatch(empty.svg, /Warning content/);
});

test('yeni ikonlar kare ve eşit boyutta, aura yoksa yalnızca çizgi görünür', async () => {
    const { raid, plan } = scenarios['trial-full-tr'];
    const { slots } = await _test.buildRaidTableSvg(raid, plan);
    let count = 0;
    for (const slot of slots) {
        for (const cell of slot.cells) {
            if (!cell.icon) continue;
            const metadata = await sharp(Buffer.from(cell.icon.split(',')[1], 'base64')).metadata();
            assert.equal(metadata.width, 56);
            assert.equal(metadata.height, 56);
            count++;
        }
    }
    assert.equal(count, 34);
    assert.equal(slots[2].cells[6].image.text, '—');
    assert.equal(slots[2].cells[6].icon, null);
    assert.equal(slots[2].cells[6].inset, 0);
});

test('eksik/bozuk ikon güvenli; dosya adlarında harf farkları ve yeni içerik desteklenir', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anka-icons-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.mkdirSync(path.join(directory, 'AuRaS'));
    const file = path.join(directory, 'AuRaS', 'PACK-TACTICS.PNG');
    const makeIcon = color => sharp({ create: { width: 8, height: 8, channels: 4, background: color } }).png().toBuffer();
    fs.writeFileSync(file, await makeIcon('#ff0000'));
    assert.equal(_test.resolveAssetPath('auras/pack-tactics.png', directory), file);
    const first = await _test.imageDataUri(file);
    fs.writeFileSync(file, await makeIcon('#00ff00'));
    assert.notEqual(await _test.imageDataUri(file), first);
    fs.writeFileSync(file, 'invalid png');
    assert.equal(await _test.imageDataUri(file), null);
    assert.equal(await _test.imageDataUri(path.join(directory, 'missing.png')), null);
    const { raid, plan } = scenarios['trial-missing-icons'];
    const layout = await _test.buildRaidTableSvg(raid, plan);
    assert.equal(layout.slots[0].cells[3].icon, null);
    assert.equal(layout.slots[0].cells[3].image.text, 'Custom Artifact Without An Icon');
    const png = await sharp(Buffer.from(layout.svg)).png().toBuffer();
    assert.equal((await sharp(png).metadata()).format, 'png');
});

test('yeni yerel logo önceliklidir; yoksa avatar kullanılır, CDN hatası renderı durdurmaz', async t => {
    const { raid, plan } = scenarios.dungeon;
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    const buffer = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#2fba81' } }).png().toBuffer();
    const expected = await _test.imageDataUri(buffer, 112);
    let calls = 0;
    global.fetch = async () => { calls++; return { ok: true, arrayBuffer: async () => buffer }; };
    const botUser = { avatar: 'avatar-a', displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/avatar-a.png' };
    const localLogo = await _test.imageDataUri(_test.resolveAssetPath('anka-logo.png'), 112);
    const branded = await _test.buildRaidTableSvg(raid, plan, { botUser });
    assert.ok(branded.svg.includes(localLogo));
    assert.equal(calls, 0);
    const readdirSync = fs.readdirSync;
    t.mock.method(fs, 'readdirSync', (...args) => readdirSync(...args).filter(name => name !== 'anka-logo.png'));
    const avatar = await _test.buildRaidTableSvg(raid, plan, { botUser });
    assert.ok(avatar.svg.includes(expected));
    await _test.buildRaidTableSvg(raid, plan, { botUser });
    assert.equal(calls, 1);
    global.fetch = async () => { throw new Error('CDN offline'); };
    const offline = await _test.buildRaidTableSvg(raid, plan, { botUser: { avatar: 'b', displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/b.png' } });
    assert.ok(!offline.svg.includes(localLogo));
    assert.ok(offline.svg.includes('ANKA RAID PLANI'));
});

test('gerçek PNG çıktıları kapasiteye göre boyutlanır ve Linux font ayarı korunur', async () => {
    if (process.platform === 'linux') assert.equal(fs.existsSync(process.env.FONTCONFIG_FILE), true);
    const full = scenarios['trial-full-tr'];
    const dungeon = scenarios.dungeon;
    const trialPng = await renderRaidTable(full.raid, full.plan);
    const dungeonPng = await renderRaidTable(dungeon.raid, dungeon.plan);
    const trialInfo = await sharp(trialPng).metadata();
    const dungeonInfo = await sharp(dungeonPng).metadata();
    assert.equal(trialInfo.format, 'png');
    assert.equal(trialInfo.width, WIDTH);
    assert.equal(trialInfo.height, 1332);
    assert.equal(dungeonInfo.width, WIDTH);
    assert.equal(dungeonInfo.height, 768);
});
