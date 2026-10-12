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
    zindanKodu: 'MSH',
    zindan: 'MSH (Master Soul Harvester)',
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

function previewScenarios() {
    const make = (roster, event = raid, overrides = null) => ({ raid: event, plan: assignRaid(event, roster, overrides) });
    const full = make(players);
    const longNames = structuredClone(full);
    longNames.plan.rows[0].displayName = 'Çok Uzun Oyuncu Adı — Ashes of Anka Şifacısı ve Koruyucusu';
    longNames.plan.rows[1].displayName = 'VeryLongUnbrokenPlayerNameWithoutSpaces0123456789';
    const longEquipment = structuredClone(full);
    Object.assign(longEquipment.plan.rows[0], {
        artifact: "Frozen Storyteller's Journal", mount: "Bigby's Crushing Hand",
        companion: 'Black Death Scorpion'
    });
    const missingIcons = structuredClone(full);
    missingIcons.plan.rows[0].artifact = 'Custom Artifact Without An Icon';
    missingIcons.plan.rows[0].aura = null;
    const shuffled = [players[4], players[2], players[1], players[8], players[3], players[0], players[6], players[5], players[9], players[7]]
        .map((player, index) => ({ ...player, sira: index + 1 }));
    return {
        'trial-full-tr': { ...full, options: { language: 'tr' } },
        'trial-full-en': { ...structuredClone(full), options: { language: 'en' } },
        'trial-nine': make(players.slice(0, 9)),
        'trial-missing-tank': make(players.filter(player => player.userId !== '2')),
        'trial-missing-healer': make(players.filter(player => player.userId !== '4')),
        'trial-missing-dps': make(players.filter(player => !['9', '10'].includes(player.userId))),
        'trial-shuffled': make(shuffled),
        'trial-long-names': longNames,
        'trial-long-equipment': longEquipment,
        'trial-missing-icons': missingIcons,
        'trial-manual-equipment': make(players, raid, { '1': { artifact: 'Heart of the Volcano' } }),
        dungeon: make(players.filter(player => ['1', '3', '5', '6', '7'].includes(player.userId)), {
            ...raid, zindanKodu: 'MJS', zindan: 'MJS (Master Jotunskar)', contentType: 'dungeon', capacity: 5
        })
    };
}

async function main() {
    if (process.argv[2] === '--all') {
        const outputDirectory = path.resolve(process.argv[3] || path.join(__dirname, '..', 'previews'));
        fs.mkdirSync(outputDirectory, { recursive: true });
        for (const [name, scenario] of Object.entries(previewScenarios())) {
            const outputPath = path.join(outputDirectory, `${name}.png`);
            fs.writeFileSync(outputPath, await renderRaidTable(scenario.raid, scenario.plan, scenario.options));
            console.log(outputPath);
        }
        return;
    }
    const requestedPath = process.argv[2] || path.join(__dirname, '..', 'Anka_Raid_Plan_Ornek.png');
    const outputPath = path.resolve(requestedPath);
    const plan = assignRaid(raid, players);
    const png = await renderRaidTable(raid, plan, { status: 'LİDER ONAYLI' });
    fs.writeFileSync(outputPath, png);
    console.log(outputPath);
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { previewScenarios };

