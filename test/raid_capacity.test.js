const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../raid');

function emptyRaid(contentType = 'dungeon') {
    return _test.normalizeRaid({
        zindan: 'Test',
        contentType,
        capacity: contentType === 'dungeon' ? 5 : 10,
        unixZamani: Math.floor(Date.now() / 1000) + 3600,
        tanklar: [], healerlar: [], dpsler: [], yedekler: []
    });
}

function user(id) {
    return { id: String(id) };
}

test('5 kişilik zindan dolunca sonraki oyuncu otomatik yedeğe alınır', () => {
    const raid = emptyRaid('dungeon');
    let lastResult;
    for (let id = 1; id <= 6; id += 1) {
        lastResult = _test.registerParticipant(
            raid,
            user(id),
            `Oyuncu ${id}`,
            'dps',
            'Wizard',
            { artifacts: [], mounts: [], companions: [], auras: [] }
        );
    }

    assert.equal(raid.dpsler.length, 5);
    assert.equal(raid.yedekler.length, 1);
    assert.equal(raid.yedekler[0].intendedRole, 'dps');
    assert.equal(lastResult.overflow, true);
});

test('aynı oyuncu yeniden rol seçtiğinde eski kaydı çoğalmaz', () => {
    const raid = emptyRaid('dungeon');
    _test.registerParticipant(raid, user(1), 'Oyuncu 1', 'dps', 'Wizard', {});
    _test.registerParticipant(raid, user(1), 'Oyuncu 1', 'tank', 'Paladin', {});
    assert.equal(raid.dpsler.length, 0);
    assert.equal(raid.tanklar.length, 1);
    assert.equal(raid.tanklar[0].sira, 1);
});

test('MJS/AJS zindan, MZC ve diğer bilinen kodlar trial kapasitesi alır', () => {
    assert.equal(_test.contentTypeFromValue('MJS'), 'dungeon');
    assert.equal(_test.contentTypeFromValue('AJS'), 'dungeon');
    assert.equal(_test.contentTypeFromValue('MZC'), 'trial');
    assert.equal(_test.capacityForType('dungeon'), 5);
    assert.equal(_test.capacityForType('trial'), 10);
});

test('zamanı geçen raid kapalı kabul edilir', () => {
    assert.equal(_test.isRaidClosed({ unixZamani: Math.floor(Date.now() / 1000) - 1 }), true);
    assert.equal(_test.isRaidClosed({ unixZamani: Math.floor(Date.now() / 1000) + 60 }), false);
});

test('manuel atama veya lider onayı final plan parmak izini değiştirir', () => {
    const raid = emptyRaid('trial');
    const first = _test.planInputFingerprint(raid);
    raid.planOverrides['1'] = { artifact: "Demogorgon's Reach" };
    const second = _test.planInputFingerprint(raid);
    raid.planApproved = true;
    const third = _test.planInputFingerprint(raid);
    assert.notEqual(first, second);
    assert.notEqual(second, third);
});

test('Discord raid kartı ve profil seçim bileşenleri geçerli JSON üretir', () => {
    const raid = emptyRaid('trial');
    raid.tarih = '<t:1784311200:F>';
    raid.aciklama = 'Test açıklaması';
    const embed = _test.raidEmbedOlustur(raid).toJSON();
    const buttons = _test.raidButtonRow(false).toJSON();
    const artifacts = _test.inventoryMenu('artifacts').toJSON();
    const dateRows = _test.dateComponents().map(row => row.toJSON());

    assert.equal(embed.color, 1936337);
    assert.equal(buttons.components.length, 5);
    assert.equal(artifacts.options.length, 20);
    assert.equal(dateRows.length, 3);
});
