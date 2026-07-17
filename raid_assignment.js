const {
    artifacts,
    mounts,
    companions,
    auras,
    findCatalogItem,
    normalizeName
} = require('./raid_catalog');

const ASSIGNMENT_BASE = 1_000_000;

function roleOf(player) {
    return player.role || player.kayitRolu || player.intendedRole || 'dps';
}

function inventoryOf(player, category) {
    const inventory = player.inventory || player.envanter || {};
    return Array.isArray(inventory[category]) ? inventory[category] : [];
}

function owns(player, category, item) {
    const wanted = normalizeName(item.name);
    return inventoryOf(player, category).some(value => normalizeName(value) === wanted || value === item.id);
}

function groupSlots(items) {
    const byGroup = new Map();
    for (const item of items) {
        if (!byGroup.has(item.group)) {
            byGroup.set(item.group, { id: item.group, group: item.group, items: [] });
        }
        byGroup.get(item.group).items.push(item);
    }
    return [...byGroup.values()];
}

function bestOwnedItem(player, category, slot, scoreItem) {
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const item of slot.items) {
        if (!owns(player, category, item)) continue;
        const score = scoreItem(item);
        if (score > bestScore) {
            best = item;
            bestScore = score;
        }
    }

    return best ? { item: best, score: bestScore } : null;
}

function assignUnique(players, slots, candidateFor) {
    const memo = new Map();
    const choices = new Map();

    function visit(playerIndex, usedMask) {
        if (playerIndex >= players.length) return 0;
        const key = `${playerIndex}:${usedMask}`;
        if (memo.has(key)) return memo.get(key);

        let bestScore = visit(playerIndex + 1, usedMask);
        let bestChoice = null;

        for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
            const bit = 1 << slotIndex;
            if ((usedMask & bit) !== 0) continue;

            const candidate = candidateFor(players[playerIndex], slots[slotIndex], slotIndex, playerIndex);
            if (!candidate) continue;

            const score = candidate.score + visit(playerIndex + 1, usedMask | bit);
            if (score > bestScore) {
                bestScore = score;
                bestChoice = { slotIndex, item: candidate.item };
            }
        }

        memo.set(key, bestScore);
        choices.set(key, bestChoice);
        return bestScore;
    }

    visit(0, 0);

    const result = new Map();
    let mask = 0;
    for (let playerIndex = 0; playerIndex < players.length; playerIndex += 1) {
        const key = `${playerIndex}:${mask}`;
        const choice = choices.get(key);
        if (!choice) continue;
        result.set(players[playerIndex].userId, choice.item.name);
        mask |= 1 << choice.slotIndex;
    }

    return result;
}

function artifactScore(player, item, playerIndex) {
    const role = roleOf(player);
    let roleBonus = 0;
    if (item.priorityRoles && item.priorityRoles.includes(role)) roleBonus += 5_000;
    return ASSIGNMENT_BASE + Math.round(item.buff * 1_000) + roleBonus + (100 - item.rank) * 10 + (100 - playerIndex);
}

function assignArtifacts(players) {
    const slots = groupSlots(artifacts);
    return assignUnique(players, slots, (player, slot, _slotIndex, playerIndex) => {
        const candidate = bestOwnedItem(player, 'artifacts', slot, item => artifactScore(player, item, playerIndex));
        if (!candidate) return null;
        return { item: candidate.item, score: candidate.score };
    });
}

function assignMounts(players) {
    const result = new Map();
    const dpsMounts = mounts.filter(item => item.kind === 'dps').sort((a, b) => a.rank - b.rank);
    const supportPlayers = [];

    for (const player of players) {
        if (roleOf(player) === 'dps') {
            const selected = dpsMounts.find(item => owns(player, 'mounts', item));
            if (selected) result.set(player.userId, selected.name);
        } else {
            supportPlayers.push(player);
        }
    }

    const supportSlots = mounts
        .filter(item => item.kind === 'debuff')
        .sort((a, b) => a.rank - b.rank)
        .map(item => ({ id: item.group, group: item.group, items: [item] }));

    const supportAssignments = assignUnique(supportPlayers, supportSlots, (player, slot, _slotIndex, playerIndex) => {
        const item = slot.items[0];
        if (!owns(player, 'mounts', item)) return null;
        return {
            item,
            score: ASSIGNMENT_BASE + (100 - item.rank) * 100 + (100 - playerIndex)
        };
    });

    for (const [userId, name] of supportAssignments.entries()) result.set(userId, name);
    return result;
}

function companionSlots(contentType) {
    const slots = groupSlots(companions);
    if (contentType === 'trial') {
        const blackDeath = companions.find(item => item.id === 'black_death_scorpion');
        slots.push({ id: 'black_death_scorpion_second', group: 'black_death_scorpion', items: [blackDeath], secondCopy: true });
    }
    return slots;
}

function companionScore(player, item, slot, contentType, playerIndex) {
    const role = roleOf(player);
    let score = ASSIGNMENT_BASE + (100 - item.rank) * 50 + (100 - playerIndex);

    if (role === 'dps' && item.dpsPriority) score += 5_000;
    if (role !== 'dps' && item.supportPriority) score += 5_000;

    if (contentType === 'dungeon') {
        const desired = new Set(['drizzt', 'portobello', 'black_death_scorpion', 'tutor', 'flapjack']);
        if (desired.has(item.group)) score += 10_000;
    }

    if (contentType === 'trial') {
        if (slot.secondCopy) score += 2_500;
        if (item.group === 'minsc') score -= 1_000;
    }

    return score;
}

function assignCompanions(players, contentType) {
    const slots = companionSlots(contentType);
    return assignUnique(players, slots, (player, slot, _slotIndex, playerIndex) => {
        const candidate = bestOwnedItem(
            player,
            'companions',
            slot,
            item => companionScore(player, item, slot, contentType, playerIndex)
        );
        if (!candidate) return null;
        return { item: candidate.item, score: candidate.score };
    });
}

function auraSlots(contentType) {
    const pack = auras.find(item => item.id === 'pack_tactics');
    const mystic = auras.find(item => item.id === 'mystic_aura');
    const runic = auras.find(item => item.id === 'runic_aura');
    const slots = [
        { id: 'pack_1', group: pack.group, items: [pack], kind: 'pack' },
        { id: 'mystic_1', group: mystic.group, items: [mystic], kind: 'healer' },
        { id: 'runic_1', group: runic.group, items: [runic], kind: 'healer' }
    ];
    if (contentType === 'trial') {
        slots.push({ id: 'pack_2', group: pack.group, items: [pack], kind: 'pack' });
    }
    return slots;
}

function assignAuras(players, contentType) {
    const supportPlayers = players.filter(player => roleOf(player) !== 'dps');
    const slots = auraSlots(contentType);

    return assignUnique(supportPlayers, slots, (player, slot, _slotIndex, playerIndex) => {
        const role = roleOf(player);
        const item = slot.items[0];
        if (!owns(player, 'auras', item)) return null;

        if (slot.kind === 'healer' && role !== 'heal') return null;
        if (slot.kind === 'pack' && contentType === 'dungeon' && role !== 'tank') return null;

        let roleBonus = 0;
        if (slot.kind === 'pack') roleBonus = role === 'tank' ? 7_000 : 3_000;
        if (slot.kind === 'healer') roleBonus = item.id === 'mystic_aura' ? 6_000 : 4_000;

        return {
            item,
            score: ASSIGNMENT_BASE + roleBonus + (100 - item.rank) * 100 + (100 - playerIndex)
        };
    });
}

function assignmentLimit(category, item, rowRole, contentType) {
    if (!item) return 1;
    if (category === 'mount' && rowRole === 'dps' && item.kind === 'dps') return Number.POSITIVE_INFINITY;
    if (category === 'companion' && item.group === 'black_death_scorpion' && contentType === 'trial') return 2;
    if (category === 'aura' && item.group === 'pack_tactics' && contentType === 'trial') return 2;
    return 1;
}

function categoryInfo(category) {
    if (category === 'artifact') return { inventory: 'artifacts', catalog: 'artifacts' };
    if (category === 'mount') return { inventory: 'mounts', catalog: 'mounts' };
    if (category === 'companion') return { inventory: 'companions', catalog: 'companions' };
    if (category === 'aura') return { inventory: 'auras', catalog: 'auras' };
    return null;
}

function applyOverrides(plan, overrides, players, contentType) {
    if (!overrides || typeof overrides !== 'object') return plan;
    const playerMap = new Map(players.map(player => [String(player.userId), player]));
    const rowMap = new Map(plan.rows.map(row => [String(row.userId), row]));
    const overrideWarnings = [];

    for (const [userId, categories] of Object.entries(overrides)) {
        const row = rowMap.get(String(userId));
        const player = playerMap.get(String(userId));
        if (!row || !player || !categories) continue;

        for (const [category, requestedValue] of Object.entries(categories)) {
            const info = categoryInfo(category);
            if (!info) continue;

            if (requestedValue === null || requestedValue === '') {
                row[category] = null;
                continue;
            }

            const item = findCatalogItem(info.catalog, requestedValue);
            if (!item || !owns(player, info.inventory, item)) {
                overrideWarnings.push(`${row.displayName}: seçilen ${category} artık profilde bulunmuyor.`);
                continue;
            }

            const limit = assignmentLimit(category, item, row.role, contentType);
            const conflicts = plan.rows.filter(otherRow => {
                if (otherRow.userId === row.userId || !otherRow[category]) return false;
                const otherItem = findCatalogItem(info.catalog, otherRow[category]);
                return otherItem && otherItem.group === item.group;
            });

            const mustClear = Math.max(0, conflicts.length - limit + 1);
            for (let index = 0; index < mustClear; index += 1) {
                conflicts[index][category] = null;
                overrideWarnings.push(`${conflicts[index].displayName}: ${requestedValue} lider ataması nedeniyle boş bırakıldı.`);
            }
            row[category] = item.name;
        }
    }

    plan.overrideWarnings = overrideWarnings;
    return plan;
}

function buildWarnings(rows, capacity, overrideWarnings = []) {
    const warnings = [...overrideWarnings];
    const missingCount = Math.max(0, capacity - rows.length);
    if (missingCount > 0) warnings.push(`${missingCount} kadro yeri boş.`);

    for (const row of rows) {
        if (!row.artifact) warnings.push(`${row.displayName}: uygun ve çakışmayan eser bulunamadı.`);
        if (!row.mount) warnings.push(`${row.displayName}: role uygun binek gücü bulunamadı.`);
        if (!row.companion) warnings.push(`${row.displayName}: uygun ve çakışmayan yoldaş bulunamadı.`);
        if (row.role !== 'dps' && !row.aura) warnings.push(`${row.displayName}: role uygun aura bulunamadı.`);
    }

    return [...new Set(warnings)];
}

function assignRaid(raid, players, overrides = null) {
    const contentType = raid.contentType === 'dungeon' ? 'dungeon' : 'trial';
    const capacity = Number(raid.capacity) || (contentType === 'trial' ? 10 : 5);
    const orderedPlayers = [...players]
        .filter(player => player && player.userId)
        .sort((a, b) => (Number(a.sira) || 9999) - (Number(b.sira) || 9999));

    const artifactAssignments = assignArtifacts(orderedPlayers);
    const mountAssignments = assignMounts(orderedPlayers);
    const companionAssignments = assignCompanions(orderedPlayers, contentType);
    const auraAssignments = assignAuras(orderedPlayers, contentType);

    const rows = orderedPlayers.map(player => ({
        userId: String(player.userId),
        displayName: player.displayName || player.mention || `Oyuncu ${player.sira || ''}`.trim(),
        mention: player.mention || `<@${player.userId}>`,
        role: roleOf(player),
        klass: player.klas || player.class || '',
        artifact: artifactAssignments.get(player.userId) || null,
        mount: mountAssignments.get(player.userId) || null,
        companion: companionAssignments.get(player.userId) || null,
        aura: auraAssignments.get(player.userId) || null
    }));

    const plan = {
        contentType,
        capacity,
        rows,
        warnings: [],
        createdAt: Date.now()
    };

    applyOverrides(plan, overrides, orderedPlayers, contentType);
    plan.warnings = buildWarnings(plan.rows, capacity, plan.overrideWarnings || []);
    delete plan.overrideWarnings;
    return plan;
}

module.exports = {
    assignRaid,
    applyOverrides,
    assignmentLimit,
    buildWarnings,
    roleOf,
    inventoryOf
};
