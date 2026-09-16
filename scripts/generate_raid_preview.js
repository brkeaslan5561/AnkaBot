const fs = require('fs');
const path = require('path');
const { assignRaid } = require('../raid_assignment');
const { renderRaidTable } = require('../raid_table');

function player(id, displayName, role, klass, inventory) {
    return {
        userId: String(id),
        mention: `<@${id}>`,
        displayName,
        role,
        klas: klass,
        sira: Number(id),
        inventory: {
            artifacts: inventory.artifacts || [],
            mounts: inventory.mounts || [],
            companions: inventory.companions || [],
            auras: inventory.auras || []
        }
    };
}

const raid = {
    zindanKodu: 'MZC',
    zindan: 'MZC (Master Zariel)',
    contentType: 'trial',
    capacity: 10,
    unixZamani: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    creatorMention: '@AnkaRaidLideri',
    planApproved: true
};

const players = [
    player(1, 'Heironeous OP', 'tank', 'Paladin', {
        artifacts: ['Mythallar Fragment', 'Heart of the Volcano'], mounts: ['Swarm'],
        companions: ['Spined Devil'], auras: ['Pack Tactics']
    }),
    player(2, 'OPOp', 'tank', 'Fighter', {
        artifacts: ['Mythallar Fragment', 'Heart of the Volcano'], mounts: ['Eclipse Lion'],
        companions: ['Blue Fire Eye'], auras: ['Pack Tactics']
    }),
    player(3, 'Shield Co.', 'heal', 'Cleric', {
        artifacts: ["Xeleth's Blast Scepter"], mounts: ['Rex'],
        companions: ["Drizzt Do'Urden"], auras: ['Mystic Aura']
    }),
    player(4, 'VULNERE', 'heal', 'Bard', {
        artifacts: ['Dragonbone Blades'], mounts: ['Pegasus'],
        companions: ['Portobello'], auras: ['Runic Aura']
    }),
    player(5, 'Sussex', 'dps', 'Warlock', {
        artifacts: ["Demogorgon's Reach"], mounts: ['Demonic Gravehound'],
        companions: ['Black Death Scorpion']
    }),
    player(6, 'Frig', 'dps', 'Wizard', {
        artifacts: ['Nightflame Censer'], mounts: ['Demonic Gravehound'], companions: ['Tutor']
    }),
    player(7, 'Smirnoff', 'dps', 'Ranger', {
        artifacts: ["Crystal of Souls' Flight"], mounts: ['Tunnel Vision'], companions: ['Flapjack']
    }),
    player(8, 'PeterDawsonDPS', 'dps', 'Fighter', {
        artifacts: ["Marco's Mystic Marker"], mounts: ['Giant Toad'], companions: ['Harper Bard']
    }),
    player(9, 'MIMIKATZ', 'dps', 'Rogue', {
        artifacts: ['Beacon of Meteor Swarm'], mounts: ["Bigby's Crushing Hand"], companions: ['Elena']
    }),
    player(10, 'Heironeous Wiz', 'dps', 'Wizard', {
        artifacts: ['Lantern of Revelation'], mounts: ['Demonic Gravehound'], companions: ['Black Death Scorpion']
    })
];

async function main() {
    const requestedPath = process.argv[2] || path.join(__dirname, '..', 'Anka_Raid_Plan_Ornek.png');
    const outputPath = path.resolve(requestedPath);
    const plan = assignRaid(raid, players);
    const png = await renderRaidTable(raid, plan, { status: 'LİDER ONAYLI' });
    fs.writeFileSync(outputPath, png);
    console.log(outputPath);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

