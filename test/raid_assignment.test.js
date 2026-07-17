const test = require('node:test');
const assert = require('node:assert/strict');
const { assignRaid } = require('../raid_assignment');

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

