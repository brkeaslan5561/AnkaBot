const test = require('node:test');
const assert = require('node:assert/strict');
const { assignRaid, setRaidOverride } = require('../raid_assignment');

function player(id, role, inventory = {}) {
    return {
        userId: String(id),
        displayName: `Oyuncu ${id}`,
        mention: `<@${id}>`,
        role,
        klas: role === 'tank' ? 'Paladin' : role === 'heal' ? 'Cleric' : 'Wizard',
        sira: Number(id),
        inventory: {
            artifacts: inventory.artifacts || [],
            mounts: inventory.mounts || [],
            companions: inventory.companions || [],
            auras: inventory.auras || []
        }
    };
}

function planFor(contentType, players) {
    return assignRaid({ contentType, capacity: contentType === 'trial' ? 10 : 5 }, players);
}

test('moving an artifact or companion pins the new owner and refills the displaced player from owned alternatives', () => {
    for (const [category, inventory, primary, fallback] of [
        ['artifact', 'artifacts', 'Mythallar Fragment', 'Lantern of Revelation'],
        ['companion', 'companions', 'Tutor', 'Minsc'],
        ['mount', 'mounts', 'Swarm', 'Eclipse Lion']
    ]) {
        const players = [player(1, 'tank', { [inventory]: [primary, fallback] }), player(2, 'heal', { [inventory]: [primary, fallback] })];
        const raid = { contentType: 'dungeon', capacity: 5 };
        const initial = assignRaid(raid, players);
        const previous = initial.rows.find(row => row[category] === primary);
        const receiver = initial.rows.find(row => row.userId !== previous.userId);
        setRaidOverride(raid, players, receiver.userId, category, primary);
        const updated = assignRaid(raid, players, raid.planOverrides);
        assert.equal(updated.rows.find(row => row.userId === receiver.userId)[category], primary);
        assert.equal(updated.rows.find(row => row.userId === previous.userId)[category], fallback);
    }
});

test('transferring an already pinned item releases its old override and permits chained automatic reassignment', () => {
    const players = [
        player(1, 'tank', { artifacts: ['Mythallar Fragment', 'Lantern of Revelation'] }),
        player(2, 'heal', { artifacts: ['Lantern of Revelation', 'Heart of the Volcano'] }),
        player(3, 'dps', { artifacts: ['Mythallar Fragment'] })
    ];
    const raid = { contentType: 'dungeon', planOverrides: { '1': { artifact: 'Mythallar Fragment' } } };
    setRaidOverride(raid, players, '3', 'artifact', 'Mythallar Fragment');
    assert.equal(raid.planOverrides['1'].artifact, undefined);
    const plan = assignRaid(raid, players, raid.planOverrides);
    assert.deepEqual(plan.rows.map(row => row.artifact), ['Lantern of Revelation', 'Heart of the Volcano', 'Mythallar Fragment']);
});

test('refill keeps explicit empty cells, respects ownership and preserves the trial Scorpion limit', () => {
    const players = [
        player(1, 'dps', { companions: ['Black Death Scorpion', 'Tutor'] }),
        player(2, 'dps', { companions: ['Black Death Scorpion', 'Minsc'] }),
        player(3, 'dps', { companions: ['Black Death Scorpion'] }),
        player(4, 'dps', { companions: ['Tutor'] })
    ];
    const raid = { contentType: 'trial', planOverrides: { '1': { companion: 'Black Death Scorpion' }, '2': { companion: 'Black Death Scorpion' }, '4': { companion: null } } };
    const before = structuredClone(players);
    setRaidOverride(raid, players, '3', 'companion', 'Black Death Scorpion');
    const plan = assignRaid(raid, players, raid.planOverrides);
    assert.equal(plan.rows.filter(row => row.companion === 'Black Death Scorpion').length, 2);
    assert.equal(plan.rows[0].companion, 'Tutor');
    assert.equal(plan.rows[3].companion, null);
    assert.deepEqual(players, before);
    assert.throws(() => setRaidOverride(raid, players, '3', 'companion', 'Minsc'), /does not own/);
});

test('displaced players without compatible alternatives stay unassigned rather than receive unowned or duplicate items', () => {
    const players = [player(1, 'tank', { artifacts: ['Dragonbone Blades'] }), player(2, 'dps', { artifacts: ['Wyvern-Venom Coated Knives'] })];
    const plan = assignRaid({ contentType: 'dungeon' }, players, { '2': { artifact: 'Wyvern-Venom Coated Knives' } });
    assert.equal(plan.rows[0].artifact, null);
    assert.equal(plan.rows[1].artifact, 'Wyvern-Venom Coated Knives');
});

test('Dragonbone ile Wyvern tek gruptur; Nightflame aynı tabloda ayrıca atanabilir', () => {
    const plan = planFor('trial', [
        player(1, 'dps', { artifacts: ['Dragonbone Blades'] }),
        player(2, 'dps', { artifacts: ['Wyvern-Venom Coated Knives'] }),
        player(3, 'dps', { artifacts: ['Nightflame Censer'] })
    ]);

    const artifacts = plan.rows.map(row => row.artifact).filter(Boolean);
    const dragonboneOrWyvern = artifacts.filter(name =>
        name === 'Dragonbone Blades' || name === 'Wyvern-Venom Coated Knives'
    );
    assert.equal(dragonboneOrWyvern.length, 1);
    assert.ok(artifacts.includes('Nightflame Censer'));
});

test('tankların Mythallar ve Heart öncelikleri birlikte değerlendirilebilir', () => {
    const inventory = { artifacts: ['Mythallar Fragment', 'Heart of the Volcano'] };
    const plan = planFor('dungeon', [player(1, 'tank', inventory), player(2, 'tank', inventory)]);
    const artifacts = new Set(plan.rows.map(row => row.artifact));
    assert.deepEqual(artifacts, new Set(['Mythallar Fragment', 'Heart of the Volcano']));
});

test('DPS oyuncuları Demonic Gravehound bineğini aynı anda kullanabilir', () => {
    const inventory = { mounts: ['Demonic Gravehound', 'Tunnel Vision'] };
    const plan = planFor('dungeon', [player(1, 'dps', inventory), player(2, 'dps', inventory)]);
    assert.deepEqual(plan.rows.map(row => row.mount), ['Demonic Gravehound', 'Demonic Gravehound']);
});

test('support debuff binekleri tekil atanır ve güç sırasını izler', () => {
    const plan = planFor('dungeon', [
        player(1, 'tank', { mounts: ['Swarm'] }),
        player(2, 'heal', { mounts: ['Swarm', 'Eclipse Lion'] })
    ]);
    assert.deepEqual(new Set(plan.rows.map(row => row.mount)), new Set(['Swarm', 'Eclipse Lion']));
});

test('zindanda tank Pack Tactics, healer öncelikle Mystic Aura kullanır', () => {
    const plan = planFor('dungeon', [
        player(1, 'tank', { auras: ['Pack Tactics', 'Mystic Aura'] }),
        player(2, 'heal', { auras: ['Pack Tactics', 'Mystic Aura', 'Runic Aura'] }),
        player(3, 'dps', { auras: ['Mystic Aura'] })
    ]);
    assert.equal(plan.rows[0].aura, 'Pack Tactics');
    assert.equal(plan.rows[1].aura, 'Mystic Aura');
    assert.equal(plan.rows[2].aura, null);
});

test('trialde ikinci tank yoksa ikinci Pack Tactics healera geçebilir', () => {
    const plan = planFor('trial', [
        player(1, 'tank', { auras: ['Pack Tactics'] }),
        player(2, 'heal', { auras: ['Pack Tactics'] }),
        player(3, 'heal', { auras: ['Mystic Aura'] }),
        player(4, 'heal', { auras: ['Runic Aura'] })
    ]);
    assert.equal(plan.rows[0].aura, 'Pack Tactics');
    assert.equal(plan.rows[1].aura, 'Pack Tactics');
    assert.equal(plan.rows[2].aura, 'Mystic Aura');
    assert.equal(plan.rows[3].aura, 'Runic Aura');
});

test('trialde iki Black Death Scorpion atanabilir', () => {
    const plan = planFor('trial', [
        player(1, 'dps', { companions: ['Black Death Scorpion'] }),
        player(2, 'dps', { companions: ['Black Death Scorpion'] }),
        player(3, 'dps', { companions: ['Minsc'] })
    ]);
    assert.equal(plan.rows.filter(row => row.companion === 'Black Death Scorpion').length, 2);
    assert.equal(plan.rows[2].companion, 'Minsc');
});

test('Pack Tactics sahibi her tank önceliklidir; healer ve eski manuel atamalar tank aurasını silemez', () => {
    const players = [
        player(1, 'heal', { auras: ['Pack Tactics', 'Mystic Aura'] }),
        player(2, 'tank', { auras: ['pack_tactics', 'Runic Aura'] }),
        player(3, 'heal', { auras: ['Pack Tactics', 'Runic Aura'] }),
        player(4, 'tank', { auras: ['PACK TACTICS', 'Mystic Aura'] })
    ];
    const before = structuredClone(players);
    for (const overrides of [null, { '2': { aura: null }, '4': { aura: 'Mystic Aura' } }, { '1': { aura: 'Pack Tactics' }, '3': { aura: 'Pack Tactics' } }]) {
        const plan = assignRaid({ contentType: 'trial', capacity: 10 }, players, overrides);
        assert.equal(plan.rows.find(row => row.userId === '2').aura, 'Pack Tactics');
        assert.equal(plan.rows.find(row => row.userId === '4').aura, 'Pack Tactics');
        assert.equal(plan.rows.find(row => row.userId === '1').aura, 'Mystic Aura');
        assert.equal(plan.rows.find(row => row.userId === '3').aura, 'Runic Aura');
        assert.equal(plan.rows.filter(row => row.aura === 'Pack Tactics').length, 2);
    }
    assert.deepEqual(players, before);
});

test('Pack Tactics envanterde yoksa tanka verilmez; boş Pack hakkı healera kalabilir', () => {
    const plan = planFor('trial', [
        player(1, 'tank', { auras: [] }),
        player(2, 'tank', { auras: ['Pack Tactics'] }),
        player(3, 'heal', { auras: ['Pack Tactics'] })
    ]);
    assert.equal(plan.rows[0].aura, null);
    assert.equal(plan.rows[1].aura, 'Pack Tactics');
    assert.equal(plan.rows[2].aura, 'Pack Tactics');
});

test('standart dışı dungeon kadrosunda da Pack Tactics sahibi iki tank korunur', () => {
    const plan = planFor('dungeon', [
        player(1, 'tank', { auras: ['Pack Tactics'] }),
        player(2, 'tank', { auras: ['Pack Tactics'] }),
        player(3, 'heal', { auras: ['Mystic Aura'] })
    ]);
    assert.deepEqual(plan.rows.map(row => row.aura), ['Pack Tactics', 'Pack Tactics', 'Mystic Aura']);
});
