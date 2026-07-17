const path = require('path');

const ASSET_ROOT = path.join(__dirname, 'assets', 'raid');

const artifacts = [
    { id: 'demogorgons_reach', name: "Demogorgon's Reach", group: 'demogorgons_reach', buff: 18, rank: 1, icon: 'artifacts/demogorgons-reach.png', priorityRoles: ['dps'] },
    { id: 'mythallar_fragment', name: 'Mythallar Fragment', group: 'mythallar_fragment', buff: 15, rank: 2, icon: 'artifacts/mythallar-fragment.png', priorityRoles: ['tank'] },
    { id: 'xeleths_blast_scepter', name: "Xeleth's Blast Scepter", group: 'blast_scepter', buff: 15, rank: 3, icon: 'artifacts/xeleths-blast-scepter.png' },
    { id: 'halasters_blast_scepter', name: "Halaster's Blast Scepter", group: 'blast_scepter', buff: 15, rank: 3, icon: 'artifacts/halasters-blast-scepter.png' },
    { id: 'dragonbone_blades', name: 'Dragonbone Blades', group: 'dragonbone_or_wyvern', buff: 12.5, rank: 4, icon: 'artifacts/dragonbone-blades.png' },
    { id: 'wyvern_knives', name: 'Wyvern-Venom Coated Knives', group: 'dragonbone_or_wyvern', buff: 12.5, rank: 4, icon: 'artifacts/wyvern-venom-coated-knives.png' },
    { id: 'nightflame_censer', name: 'Nightflame Censer', group: 'nightflame_censer', buff: 12.5, rank: 4, icon: 'artifacts/nightflame-censer.png', priorityRoles: ['dps'] },
    { id: 'crystal_of_souls_flight', name: "Crystal of Souls' Flight", group: 'crystal_of_souls_flight', buff: 10, rank: 5, icon: 'artifacts/crystal-of-souls-flight.png', priorityRoles: ['dps'] },
    { id: 'marcos_mystic_marker', name: "Marco's Mystic Marker", group: 'marcos_mystic_marker', buff: 10, rank: 6, icon: 'artifacts/marcos-mystic-marker.png', priorityRoles: ['dps'] },
    { id: 'beacon_of_meteor_swarm', name: 'Beacon of Meteor Swarm', group: 'beacon_of_meteor_swarm', buff: 10, rank: 7, icon: 'artifacts/beacon-of-meteor-swarm.png' },
    { id: 'portable_spelljammer', name: 'Portable Spelljammer', group: 'portable_spelljammer', buff: 10, rank: 8, icon: 'artifacts/portable-spelljammer-detector.png' },
    { id: 'heart_of_the_volcano', name: 'Heart of the Volcano', group: 'heart_artifact', buff: 10, rank: 9, icon: 'artifacts/heart-of-the-volcano.png', priorityRoles: ['tank'] },
    { id: 'heart_of_the_black_dragon', name: 'Heart of the Black Dragon', group: 'heart_artifact', buff: 10, rank: 9, icon: 'artifacts/heart-of-the-black-dragon.png', priorityRoles: ['tank'] },
    { id: 'frozen_storytellers_journal', name: "Frozen Storyteller's Journal", group: 'frozen_storytellers_journal', buff: 10, rank: 10, icon: 'artifacts/frozen-storytellers-journal.png' },
    { id: 'lantern_of_revelation', name: 'Lantern of Revelation', group: 'lantern_of_revelation', buff: 10, rank: 11, icon: 'artifacts/lantern-of-revelation.png' },
    { id: 'black_dragons_mark', name: "Black Dragon's Mark", group: 'black_dragons_mark', buff: 10, rank: 12, icon: 'artifacts/black-dragons-mark.png' },
    { id: 'charm_of_the_serpent', name: 'Charm of the Serpent', group: 'charm_of_the_serpent', buff: 10, rank: 13, icon: null },
    { id: 'marilith_mask', name: 'Marilith Mask', group: 'marilith_mask', buff: 7.5, rank: 14, icon: 'artifacts/marilith-mask.png' },
    { id: 'grace_of_pelor', name: 'Grace of Pelor', group: 'grace_of_pelor', buff: 7.5, rank: 15, icon: 'artifacts/grace-of-pelor.png' }
];

const mounts = [
    { id: 'demonic_gravehound', name: 'Demonic Gravehound', group: 'demonic_gravehound', kind: 'dps', rank: 1, icon: 'mounts/demonic-gravehound.png' },
    { id: 'tunnel_vision', name: 'Tunnel Vision', group: 'tunnel_vision', kind: 'dps', rank: 2, icon: 'mounts/tunnel-vision.png' },
    { id: 'giant_toad', name: 'Giant Toad', group: 'giant_toad', kind: 'dps', rank: 2, icon: 'mounts/giant-toad-tongue-lash.png' },
    { id: 'bigbys_crushing_hand', name: "Bigby's Crushing Hand", group: 'bigbys_crushing_hand', kind: 'dps', rank: 2, icon: 'mounts/bigbys-crushing-hand.png' },
    { id: 'swarm', name: 'Swarm', group: 'swarm', kind: 'debuff', rank: 1, icon: 'mounts/swarm.png' },
    { id: 'eclipse_lion', name: 'Eclipse Lion', group: 'eclipse_lion', kind: 'debuff', rank: 2, icon: 'mounts/eclipse-lion.png' },
    { id: 'rex', name: 'Rex', group: 'rex', kind: 'debuff', rank: 3, icon: 'mounts/trex.png' },
    { id: 'pegasus', name: 'Pegasus', group: 'pegasus', kind: 'debuff', rank: 4, icon: 'mounts/pegasus.png' },
    { id: 'enhanced_cauldron', name: 'Enhanced Cauldron', group: 'enhanced_cauldron', kind: 'debuff', rank: 5, icon: 'mounts/enhanced-cauldron.png' },
    { id: 'twice_pale', name: 'Twice-Pale', group: 'twice_pale', kind: 'debuff', rank: 6, icon: 'mounts/Twice-pale.png' },
    { id: 'brain_stealer_dragon', name: 'Brain Stealer Dragon', group: 'brain_stealer_dragon', kind: 'debuff', rank: 7, icon: 'mounts/brain-stealer-dragon.png' },
    { id: 'glorious_undead_lion', name: 'Glorious Undead Lion', group: 'glorious_undead_lion', kind: 'debuff', rank: 8, icon: 'mounts/glorious-undead-lion.png' },
    { id: 'red_dragon', name: 'Red Dragon', group: 'red_dragon', kind: 'debuff', rank: 9, icon: 'mounts/red-dragon.png' },
    { id: 'phantom_panther', name: 'Phantom Panther', group: 'phantom_panther', kind: 'debuff', rank: 10, icon: null }
];

const companions = [
    { id: 'black_death_scorpion', name: 'Black Death Scorpion', group: 'black_death_scorpion', rank: 1, icon: 'companions/black-death-scorpion.png', dpsPriority: true },
    { id: 'drizzt', name: "Drizzt Do'Urden", group: 'drizzt', rank: 2, icon: 'companions/drizzt-dourden.png', supportPriority: true },
    { id: 'portobello', name: 'Portobello', group: 'portobello', rank: 3, icon: 'companions/portobello-davinci.png', supportPriority: true },
    { id: 'spined_devil', name: 'Spined Devil', group: 'spined_devil', rank: 4, icon: 'companions/spined-devil.png', supportPriority: true },
    { id: 'tutor', name: 'Tutor', group: 'tutor', rank: 5, icon: 'companions/tutor.png', dpsPriority: true },
    { id: 'flapjack', name: 'Flapjack', group: 'flapjack', rank: 6, icon: 'companions/flapjack.png', dpsPriority: true },
    { id: 'harper_bard', name: 'Harper Bard', group: 'harper_or_etrien', rank: 7, icon: 'companions/harper-bard.png', dpsPriority: true },
    { id: 'etrien', name: 'Etrien', group: 'harper_or_etrien', rank: 7, icon: 'companions/etrien.png', dpsPriority: true },
    { id: 'minsc', name: 'Minsc', group: 'minsc', rank: 8, icon: 'companions/minsc.png', dpsPriority: true },
    { id: 'blue_fire_eye', name: 'Blue Fire Eye', group: 'blue_fire_eye', rank: 9, icon: 'companions/blue-fire-eye.png', supportPriority: true },
    { id: 'elena', name: 'Elena', group: 'elena', rank: 10, icon: 'companions/elena.png', dpsPriority: true }
];

const auras = [
    { id: 'mystic_aura', name: 'Mystic Aura', group: 'mystic_aura', rank: 1, icon: null },
    { id: 'runic_aura', name: 'Runic Aura', group: 'runic_aura', rank: 2, icon: null },
    { id: 'pack_tactics', name: 'Pack Tactics', group: 'pack_tactics', rank: 3, icon: null }
];

const catalog = { artifacts, mounts, companions, auras };

function normalizeName(value) {
    return String(value || '')
        .trim()
        .toLocaleLowerCase('en-US')
        .replace(/[’']/g, "'");
}

function findCatalogItem(category, value) {
    const items = catalog[category] || [];
    const normalized = normalizeName(value);
    return items.find(item => normalizeName(item.name) === normalized || item.id === value) || null;
}

function assetPath(item) {
    return item && item.icon ? path.join(ASSET_ROOT, item.icon) : null;
}

function selectOptions(category) {
    return (catalog[category] || []).map(item => {
        const option = {
            label: item.name.substring(0, 100),
            value: item.name
        };
        if (category === 'artifacts') option.description = `%${item.buff} takım hasarı desteği`;
        return option;
    });
}

module.exports = {
    ASSET_ROOT,
    artifacts,
    mounts,
    companions,
    auras,
    catalog,
    normalizeName,
    findCatalogItem,
    assetPath,
    selectOptions
};
