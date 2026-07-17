const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../raid');
const { artifacts, catalog, selectOptions, setCatalogEmoji } = require('../raid_catalog');
const { emojiNameFor } = require('../raid_emojis');

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

test('son 15 dakikadaki plan değişiklikleri yalnızca T-5 ve başlangıç kontrol noktalarında yayınlanır', () => {
    const raid = emptyRaid('trial');
    raid.finalSent = true;
    raid.finalPlanFingerprint = _test.planInputFingerprint(raid);

    raid.planOverrides['1'] = { artifact: "Demogorgon's Reach" };
    assert.equal(_test.planPublicationAction(raid, 10 * 60), null);
    assert.equal(_test.planPublicationAction(raid, 5 * 60), 'checkpoint');

    raid.fiveMinuteCheckpointSent = true;
    raid.finalPlanFingerprint = _test.planInputFingerprint(raid);
    raid.planOverrides['2'] = { mount: 'Swarm' };
    assert.equal(_test.planPublicationAction(raid, 4 * 60), null);
    assert.equal(_test.planPublicationAction(raid, 0), 'kickoff');
});

test('değişiklik yoksa T-5 ve başlangıçta mükerrer tablo üretilmez', () => {
    const raid = emptyRaid('trial');
    raid.finalSent = true;
    raid.finalPlanFingerprint = _test.planInputFingerprint(raid);

    assert.equal(_test.planPublicationAction(raid, 5 * 60), 'mark-checkpoint');
    raid.fiveMinuteCheckpointSent = true;
    assert.equal(_test.planPublicationAction(raid, 0), null);
});

test('ilk T-15 paylaşımı kaçırılmışsa uygun ilk kontrol noktasında plan yayınlanır', () => {
    const raid = emptyRaid('trial');
    assert.equal(_test.planPublicationAction(raid, 14 * 60), 'initial');
    assert.equal(_test.planPublicationAction(raid, 4 * 60), 'checkpoint');
    assert.equal(_test.planPublicationAction(raid, 0), 'kickoff');
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
    for (const button of buttons.components) {
        assert.ok(button.emoji?.name);
        assert.match(button.emoji?.id, /^\d+$/);
    }
    for (const role of ['tank', 'heal', 'dps', 'yedek']) {
        for (const option of _test.klasSecenekleri[role]) {
            assert.match(option.emoji, /^<a?:[a-zA-Z0-9_]+:\d+>$/);
        }
    }
    assert.equal(artifacts.options.length, 20);
    assert.equal(_test.inventoryMenu('mounts', [], 'dps').toJSON().options.length, 5);
    assert.equal(_test.inventoryMenu('mounts', [], 'heal').toJSON().options.length, 11);
    assert.equal(dateRows.length, 3);
});

test('envanter seçenekleri role göre filtrelenir ve eser tooltipi içermez', () => {
    const dpsMounts = selectOptions('mounts', { role: 'dps' });
    const healerMounts = selectOptions('mounts', { role: 'heal' });
    assert.deepEqual(
        new Set(dpsMounts.map(option => option.value)),
        new Set(['Demonic Gravehound', 'Tunnel Vision', 'Giant Toad', "Bigby's Crushing Hand"])
    );
    assert.ok(healerMounts.every(option => !dpsMounts.some(dps => dps.value === option.value)));
    assert.ok(selectOptions('artifacts').every(option => !('description' in option)));
});

test('uygulama emojileri eşya isimlerinin yanında select seçeneğine eklenir', () => {
    const item = artifacts[0];
    setCatalogEmoji('artifacts', item.id, { id: '123456789012345678', name: 'anka_test' });
    const option = selectOptions('artifacts').find(entry => entry.value === item.name);
    assert.deepEqual(option.emoji, { id: '123456789012345678', name: 'anka_test', animated: false });
    const menuOption = _test.inventoryMenu('artifacts').toJSON().options.find(entry => entry.value === item.name);
    assert.equal(menuOption.emoji.id, '123456789012345678');
    setCatalogEmoji('artifacts', item.id, null);

    const names = [];
    for (const category of ['artifacts', 'mounts', 'companions']) {
        for (const catalogItem of catalog[category]) {
            const name = emojiNameFor(category, catalogItem);
            assert.ok(name.length <= 32);
            assert.match(name, /^[a-z0-9_]+$/);
            names.push(name);
        }
    }
    assert.equal(new Set(names).size, names.length);
});

test('profil sihirbazı role göre adım sayısı ve son onay ekranı üretir', () => {
    const session = {
        role: 'dps',
        className: 'Wizard',
        inventory: {
            artifacts: ["Demogorgon's Reach"],
            mounts: ['Demonic Gravehound'],
            companions: ['Black Death Scorpion'],
            auras: []
        }
    };
    const firstStep = _test.profileStepPayload(session, 'artifacts');
    const review = _test.profileReviewPayload(session);
    assert.match(firstStep.content, /1\/3/);
    assert.equal(firstStep.components.length, 2);
    assert.match(review.content, /profil özeti/);
    assert.equal(review.components[0].toJSON().components.length, 3);
});
