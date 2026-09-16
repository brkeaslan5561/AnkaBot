const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
    PermissionFlagsBits
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { selectOptions, findCatalogItem } = require('./raid_catalog');
const { assignRaid, inventoryOf } = require('./raid_assignment');
const { renderRaidTable } = require('./raid_table');
const {
    t,
    getGuildLanguage,
    languageForInteraction,
    languageForUser,
    formatDiscordTimestamp
} = require('./localization');

const ISTANBUL_UTC_OFFSET_HOURS = 3;
const RAID_DATA_DOSYASI = path.join(__dirname, 'raid_data.json');
const PROFIL_DATA_DOSYASI = path.join(__dirname, 'raid_profiles.json');
const KATILIM_DATA_DOSYASI = path.join(__dirname, 'raid_attendance.json');
const NONE_VALUE = '__none__';
const RESERVE_APPROVAL_MS = 5 * 60 * 1000;
const DRAFT_BEFORE_SECONDS = 30 * 60;
const FINAL_BEFORE_SECONDS = 15 * 60;
const CHECKPOINT_BEFORE_SECONDS = 5 * 60;
const ATTENDANCE_GRACE_SECONDS = 15 * 60;

const raidHafizasi = new Map();
const raidKurulumHafizasi = new Map();
const profilSecimHafizasi = new Map();
const dogrulanmisRaidMesajlari = new Map();
let profilVerisi = { profiles: {} };
let katilimVerisi = { players: {} };
let schedulerTimer = null;
let schedulerRunning = false;

const DUNGEON_CODES = new Set(['MJS', 'MTIC', 'MLOMD', 'AJS']);
const TRIAL_CODES = new Set(['MSH', 'MSOD', 'MGZM', 'MZC', 'TOMM', 'ASH']);

const zindanListesi = [
    { label: 'MJS (Master Jotunskar)', value: 'MJS', description: '5 kişilik zindan', contentType: 'dungeon' },
    { label: 'MTIC (Master Imperial Citadel)', value: 'MTIC', description: '5 kişilik zindan', contentType: 'dungeon' },
    { label: 'MLOMD (Master Lair of the Mad Mage)', value: 'MLOMD', description: '5 kişilik zindan', contentType: 'dungeon' },
    { label: 'AJS (Advanced Jotunskar)', value: 'AJS', description: '5 kişilik zindan', contentType: 'dungeon' },
    { label: 'MSH (Master Soul Harvester)', value: 'MSH', description: '10 kişilik trial', contentType: 'trial' },
    { label: 'MSOD (Master Shackles of Divinity)', value: 'MSOD', description: '10 kişilik trial', contentType: 'trial' },
    { label: 'MGZM (Master Gzemnid)', value: 'MGZM', description: '10 kişilik trial', contentType: 'trial' },
    { label: 'MZC (Master Zariel)', value: 'MZC', description: '10 kişilik trial', contentType: 'trial' },
    { label: 'TOMM (Tower of The Mad Mage)', value: 'TOMM', description: '10 kişilik trial', contentType: 'trial' },
    { label: 'ASH (Advanced Soul Harvester)', value: 'ASH', description: '10 kişilik trial', contentType: 'trial' },
    { label: 'Diğer (Kendin Yaz)', value: 'custom', description: 'Özel zindan veya trial adı' }
];

const klasSecenekleri = {
    tank: [
        { label: 'Paladin (Tank)', value: 'Paladin', emoji: '<:klaspaladin:1506316091322929163>' },
        { label: 'Fighter (Tank)', value: 'Fighter', emoji: '<:klasfighter:1506316057407655956>' },
        { label: 'Barbarian (Tank)', value: 'Barbarian', emoji: '<:klasbarbar:1506315488073093142>' }
    ],
    heal: [
        { label: 'Paladin (Heal)', value: 'Paladin', emoji: '<:klaspaladin:1506316091322929163>' },
        { label: 'Cleric (Heal)', value: 'Cleric', emoji: '<:klascleric:1506315663860568164>' },
        { label: 'Bard (Heal)', value: 'Bard', emoji: '<:klasbard:1506315579521372210>' },
        { label: 'Warlock (Heal)', value: 'Warlock', emoji: '<:klaswarlock:1511349605466378240>' }
    ],
    dps: [
        { label: 'Barbarian', value: 'Barbarian', emoji: '<:klasbarbar:1506315488073093142>' },
        { label: 'Cleric', value: 'Cleric', emoji: '<:klascleric:1506315663860568164>' },
        { label: 'Fighter', value: 'Fighter', emoji: '<:klasfighter:1506316057407655956>' },
        { label: 'Warlock', value: 'Warlock', emoji: '<:klaswarlock:1511349605466378240>' },
        { label: 'Rogue', value: 'Rogue', emoji: '<:klasrogue:1506316128090329099>' },
        { label: 'Wizard', value: 'Wizard', emoji: '<:klaswizard:1506316021664055408>' },
        { label: 'Ranger', value: 'Ranger', emoji: '<:klasranger:1506315982912753694>' },
        { label: 'Bard', value: 'Bard', emoji: '<:klasbard:1506315579521372210>' }
    ]
};
klasSecenekleri.yedek = [...new Map(
    Object.values(klasSecenekleri).flat().map(item => [item.value, {
        label: item.value,
        value: item.value,
        emoji: item.emoji
    }])
).values()];

const gunListesi = Array.from({ length: 31 }, (_, index) => ({ label: `${index + 1}`, value: `${index + 1}` }));
const ayListesi = [
    { label: 'Ocak', value: '0' }, { label: 'Şubat', value: '1' }, { label: 'Mart', value: '2' },
    { label: 'Nisan', value: '3' }, { label: 'Mayıs', value: '4' }, { label: 'Haziran', value: '5' },
    { label: 'Temmuz', value: '6' }, { label: 'Ağustos', value: '7' }, { label: 'Eylül', value: '8' },
    { label: 'Ekim', value: '9' }, { label: 'Kasım', value: '10' }, { label: 'Aralık', value: '11' }
];
const saatListesi = [
    { label: '20:00', value: '20:00' }, { label: '20:15', value: '20:15' }, { label: '20:30', value: '20:30' },
    { label: '21:00', value: '21:00' }, { label: '21:15', value: '21:15' }, { label: '21:30', value: '21:30' },
    { label: '22:00', value: '22:00' }, { label: '22:15', value: '22:15' }, { label: '22:30', value: '22:30' },
    { label: '23:00', value: '23:00' }, { label: '23:15', value: '23:15' }, { label: '23:30', value: '23:30' }
];

const raidKomutu = new SlashCommandBuilder()
    .setName('raid-oluştur')
    .setNameLocalizations({ 'en-US': 'create-raid', 'en-GB': 'create-raid' })
    .setDescription('Yeni bir trial veya zindan etkinlik kartı hazırlar.')
    .setDescriptionLocalizations({ 'en-US': 'Create a new trial or dungeon event card.', 'en-GB': 'Create a new trial or dungeon event card.' });

const raidOyuncuEkleKomutu = new SlashCommandBuilder()
    .setName('raid-oyuncu-ekle')
    .setNameLocalizations({ 'en-US': 'raid-add-player', 'en-GB': 'raid-add-player' })
    .setDescription('Oluşturulan bir raide yönetici tarafından manuel olarak oyuncu ekler.')
    .setDescriptionLocalizations({ 'en-US': 'Add a player to an existing raid as an officer.', 'en-GB': 'Add a player to an existing raid as an officer.' })
    .addStringOption(option => option.setName('id').setDescription('Raid ID bilgisini seçin.').setDescriptionLocalizations({ 'en-US': 'Select the raid ID.', 'en-GB': 'Select the raid ID.' }).setRequired(true).setAutocomplete(true))
    .addStringOption(option => option.setName('role').setDescription('Oyuncunun rolü').setDescriptionLocalizations({ 'en-US': 'Player role', 'en-GB': 'Player role' }).setRequired(true).addChoices(
        { name: 'TANK', value: 'tank' },
        { name: 'HEALER', value: 'heal' },
        { name: 'DPS', value: 'dps' },
        { name: 'YEDEK', value: 'yedek' }
    ))
    .addUserOption(option => option.setName('member').setDescription('Eklenecek oyuncuyu seçin.').setDescriptionLocalizations({ 'en-US': 'Choose the player to add.', 'en-GB': 'Choose the player to add.' }).setRequired(true))
    .addStringOption(option => option.setName('klas').setDescription('Oyuncunun klasını yazın.').setDescriptionLocalizations({ 'en-US': "Enter the player's class.", 'en-GB': "Enter the player's class." }).setRequired(true));

const raidDuzenleKomutu = new SlashCommandBuilder()
    .setName('düzenle')
    .setNameLocalizations({ 'en-US': 'edit-raid', 'en-GB': 'edit-raid' })
    .setDescription('Raid kartının gün, ay, saat veya açıklamasını düzenler.')
    .setDescriptionLocalizations({ 'en-US': 'Edit the date, time, or description of a raid.', 'en-GB': 'Edit the date, time, or description of a raid.' })
    .addStringOption(option => option.setName('id').setDescription('Düzenlenecek Raid ID bilgisini seçin.').setDescriptionLocalizations({ 'en-US': 'Select the raid ID to edit.', 'en-GB': 'Select the raid ID to edit.' }).setRequired(true).setAutocomplete(true))
    .addIntegerOption(option => option.setName('gun').setNameLocalizations({ 'en-US': 'day', 'en-GB': 'day' }).setDescription('Yeni gün').setDescriptionLocalizations({ 'en-US': 'New day', 'en-GB': 'New day' }).setMinValue(1).setMaxValue(31).setRequired(false))
    .addIntegerOption(option => option.setName('ay').setNameLocalizations({ 'en-US': 'month', 'en-GB': 'month' }).setDescription('Yeni ay').setDescriptionLocalizations({ 'en-US': 'New month', 'en-GB': 'New month' }).setMinValue(1).setMaxValue(12).setRequired(false))
    .addStringOption(option => option.setName('saat').setNameLocalizations({ 'en-US': 'time', 'en-GB': 'time' }).setDescription('Yeni saat, örn. 21:30').setDescriptionLocalizations({ 'en-US': 'New time, e.g. 21:30', 'en-GB': 'New time, e.g. 21:30' }).setRequired(false))
    .addStringOption(option => option.setName('aciklama').setNameLocalizations({ 'en-US': 'description', 'en-GB': 'description' }).setDescription('Yeni açıklama').setDescriptionLocalizations({ 'en-US': 'New description', 'en-GB': 'New description' }).setRequired(false));

function interactionLanguage(interaction) {
    return languageForInteraction(interaction);
}

function raidLanguage(raid) {
    return ['tr', 'en'].includes(raid?.displayLanguage)
        ? raid.displayLanguage
        : getGuildLanguage(raid?.guildId);
}

function roleLabel(language, role) {
    return t(language, `raid.role.${role === 'heal' ? 'heal' : role || 'dps'}`);
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function atomicJsonWrite(filePath, value) {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
}

function safeJsonRead(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return deepClone(fallback);
        const text = fs.readFileSync(filePath, 'utf8').trim();
        return text ? JSON.parse(text) : deepClone(fallback);
    } catch (error) {
        console.error(`${path.basename(filePath)} okunamadı:`, error);
        return deepClone(fallback);
    }
}

function currentIstanbulYear() {
    const shifted = new Date(Date.now() + ISTANBUL_UTC_OFFSET_HOURS * 60 * 60 * 1000);
    return shifted.getUTCFullYear();
}

function istanbulZamaniOlustur(gun, ay, saat, explicitYear = null, ensureFuture = true) {
    const [hour, minute] = String(saat).split(':').map(Number);
    let year = explicitYear || currentIstanbulYear();
    let timestamp = Math.floor(Date.UTC(year, Number(ay), Number(gun), hour - ISTANBUL_UTC_OFFSET_HOURS, minute) / 1000);
    if (!explicitYear && ensureFuture && timestamp <= Math.floor(Date.now() / 1000)) {
        year += 1;
        timestamp = Math.floor(Date.UTC(year, Number(ay), Number(gun), hour - ISTANBUL_UTC_OFFSET_HOURS, minute) / 1000);
    }
    return { timestamp, year };
}

function istanbulParcalariAl(unixZamani) {
    const date = new Date((Number(unixZamani) + ISTANBUL_UTC_OFFSET_HOURS * 60 * 60) * 1000);
    return {
        gun: date.getUTCDate(),
        ay: date.getUTCMonth(),
        yil: date.getUTCFullYear(),
        saat: `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
    };
}

function discordTarihMetniOlustur(unixZamani) {
    return `${formatDiscordTimestamp(unixZamani, 'F')} (${formatDiscordTimestamp(unixZamani, 'R')})`;
}

function saatFormatiniKontrolEt(saat) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(saat));
}

function contentTypeFromValue(value) {
    const upper = String(value || '').toUpperCase();
    const dungeon = [...DUNGEON_CODES].find(code => upper.includes(code));
    if (dungeon) return 'dungeon';
    const trial = [...TRIAL_CODES].find(code => upper.includes(code));
    if (trial) return 'trial';
    return 'trial';
}

function capacityForType(contentType) {
    return contentType === 'dungeon' ? 5 : 10;
}

function allClassOptions() {
    return Object.values(klasSecenekleri).flat();
}

function classEmoji(className) {
    const lower = String(className || '').toLowerCase();
    const match = allClassOptions().find(item => item.value.toLowerCase() === lower || item.label.toLowerCase().includes(lower));
    return match ? match.emoji : '🔹';
}

function normalizeInventory(inventory) {
    const source = inventory || {};
    return {
        artifacts: Array.isArray(source.artifacts) ? [...source.artifacts] : [],
        mounts: Array.isArray(source.mounts) ? [...source.mounts] : [],
        companions: Array.isArray(source.companions) ? [...source.companions] : [],
        auras: Array.isArray(source.auras) ? [...source.auras] : []
    };
}

function participantFromLegacy(record, order, role) {
    if (record && typeof record === 'object' && !Array.isArray(record)) {
        const userId = record.userId ? String(record.userId) : null;
        return {
            userId,
            mention: record.mention || (userId ? `<@${userId}>` : 'Bilinmeyen oyuncu'),
            displayName: record.displayName || record.name || record.mention || 'Bilinmeyen oyuncu',
            klas: record.klas || record.class || null,
            klasEmoji: record.klasEmoji || record.emoji || classEmoji(record.klas || record.class),
            role: role === 'yedek' ? 'yedek' : (record.role || role),
            intendedRole: record.intendedRole || record.hedefRol || (role === 'yedek' ? 'yedek' : role),
            inventory: normalizeInventory(record.inventory || record.envanter),
            sira: Number(record.sira || record.kayitSirasi || record.order || order)
        };
    }

    const text = String(record || '').trim();
    const id = text.match(/<@!?(\d+)>/)?.[1] || null;
    const mention = text.match(/<@!?\d+>/)?.[0] || text.replace(/\s*\([^)]*\)/g, '');
    const inside = text.match(/\((.*?)\)/)?.[1] || '';
    const emoji = inside.match(/<a?:[^>]+>/)?.[0] || '🔹';
    const className = inside.replace(/<a?:[^>]+>/g, '').trim() || null;
    return {
        userId: id,
        mention,
        displayName: mention,
        klas: className,
        klasEmoji: emoji,
        role: role === 'yedek' ? 'yedek' : role,
        intendedRole: role === 'yedek' ? 'yedek' : role,
        inventory: normalizeInventory(),
        sira: order
    };
}

function normalizeRaid(raid) {
    const lists = [
        ['tanklar', 'tank'],
        ['healerlar', 'heal'],
        ['dpsler', 'dps'],
        ['yedekler', 'yedek']
    ];
    let nextOrder = 1;
    let maxOrder = 0;

    for (const [listName, role] of lists) {
        const list = Array.isArray(raid[listName]) ? raid[listName] : [];
        raid[listName] = list.map(record => {
            const normalized = participantFromLegacy(record, nextOrder, role);
            normalized.sira = Number(normalized.sira) || nextOrder;
            maxOrder = Math.max(maxOrder, normalized.sira);
            nextOrder = Math.max(nextOrder + 1, maxOrder + 1);
            return normalized;
        });
    }

    raid.contentType = raid.contentType || contentTypeFromValue(raid.zindanKodu || raid.zindan);
    raid.capacity = Number(raid.capacity) || capacityForType(raid.contentType);
    raid.siradakiSira = Math.max(Number(raid.siradakiSira) || 1, maxOrder + 1);
    raid.planOverrides = raid.planOverrides && typeof raid.planOverrides === 'object' ? raid.planOverrides : {};
    raid.planNeedsRefresh = Boolean(raid.planNeedsRefresh);
    raid.draftSent = Boolean(raid.draftSent);
    raid.finalSent = Boolean(raid.finalSent);
    raid.fiveMinuteCheckpointSent = Boolean(raid.fiveMinuteCheckpointSent);
    raid.kickoffFinalSent = Boolean(raid.kickoffFinalSent);
    raid.planApproved = Boolean(raid.planApproved);
    raid.kapandi = Boolean(raid.kapandi);
    raid.attendancePromptSent = Boolean(raid.attendancePromptSent);
    raid.attendanceCompleted = Boolean(raid.attendanceCompleted);
    raid.attendanceRoster = Array.isArray(raid.attendanceRoster) ? raid.attendanceRoster : [];
    raid.attendanceDraftAbsentIds = Array.isArray(raid.attendanceDraftAbsentIds) ? raid.attendanceDraftAbsentIds.map(String) : [];
    raid.attendanceResult = raid.attendanceResult && typeof raid.attendanceResult === 'object' ? raid.attendanceResult : null;
    raid.registrationReminderSentUsers = Array.isArray(raid.registrationReminderSentUsers) ? raid.registrationReminderSentUsers.map(String) : [];
    return raid;
}

function loadRaids() {
    const data = safeJsonRead(RAID_DATA_DOSYASI, { raids: {} });
    const raids = Array.isArray(data) ? Object.fromEntries(data) : (data.raids || data);
    for (const [messageId, raid] of Object.entries(raids || {})) {
        if (messageId && raid && typeof raid === 'object') raidHafizasi.set(messageId, normalizeRaid(raid));
    }
    console.log(`✅ ${raidHafizasi.size} raid kaydı diskten yüklendi.`);
}

function saveAllRaids() {
    atomicJsonWrite(RAID_DATA_DOSYASI, { raids: Object.fromEntries(raidHafizasi.entries()) });
}

function saveRaid(messageId, raid) {
    raidHafizasi.set(String(messageId), normalizeRaid(raid));
    saveAllRaids();
}

function raidMesajKayitlariniSil(messageIds) {
    let silinenKayitSayisi = 0;
    for (const messageId of messageIds) {
        const normalizedId = String(messageId || '');
        if (!normalizedId) continue;
        dogrulanmisRaidMesajlari.delete(normalizedId);
        if (raidHafizasi.delete(normalizedId)) silinenKayitSayisi += 1;
    }
    if (silinenKayitSayisi > 0) saveAllRaids();
    return silinenKayitSayisi;
}

function raidMesajiSilindi(messageId) {
    return raidMesajKayitlariniSil([messageId]) > 0;
}

function loadProfiles() {
    profilVerisi = safeJsonRead(PROFIL_DATA_DOSYASI, { profiles: {} });
    if (!profilVerisi.profiles || typeof profilVerisi.profiles !== 'object') profilVerisi.profiles = {};
}

function normalizeAttendanceRecord(record = {}) {
    return {
        totalAbsences: Math.max(0, Number(record.totalAbsences) || 0),
        strikeCount: Math.max(0, Math.min(2, Number(record.strikeCount) || 0)),
        pendingPenalties: Math.max(0, Number(record.pendingPenalties) || 0),
        blockedRaidIds: Array.isArray(record.blockedRaidIds) ? record.blockedRaidIds.map(String).slice(-50) : [],
        history: Array.isArray(record.history) ? record.history.slice(-100) : []
    };
}

function loadAttendance() {
    katilimVerisi = safeJsonRead(KATILIM_DATA_DOSYASI, { players: {} });
    if (!katilimVerisi.players || typeof katilimVerisi.players !== 'object') katilimVerisi.players = {};
    for (const [userId, record] of Object.entries(katilimVerisi.players)) {
        katilimVerisi.players[userId] = normalizeAttendanceRecord(record);
    }
}

function saveAttendance() {
    atomicJsonWrite(KATILIM_DATA_DOSYASI, katilimVerisi);
}

function attendanceRecord(userId) {
    const id = String(userId);
    if (!katilimVerisi.players[id]) katilimVerisi.players[id] = normalizeAttendanceRecord();
    else katilimVerisi.players[id] = normalizeAttendanceRecord(katilimVerisi.players[id]);
    return katilimVerisi.players[id];
}

function raidPenaltyStatus(userId, messageId, consume = true) {
    const record = attendanceRecord(userId);
    const raidId = String(messageId);
    if (record.blockedRaidIds.includes(raidId)) {
        return { blocked: true, consumed: false, pendingPenalties: record.pendingPenalties, record };
    }
    if (record.pendingPenalties <= 0) {
        return { blocked: false, consumed: false, pendingPenalties: 0, record };
    }
    if (!consume) {
        return { blocked: true, consumed: false, pendingPenalties: record.pendingPenalties, record };
    }
    record.pendingPenalties -= 1;
    record.blockedRaidIds = [...record.blockedRaidIds.filter(id => id !== raidId), raidId].slice(-50);
    saveAttendance();
    return { blocked: true, consumed: true, pendingPenalties: record.pendingPenalties, record };
}

function absenceApplied(userId, raid, messageId) {
    const record = attendanceRecord(userId);
    record.totalAbsences += 1;
    record.strikeCount += 1;
    let penaltyTriggered = false;
    if (record.strikeCount >= 3) {
        record.strikeCount = 0;
        record.pendingPenalties += 1;
        penaltyTriggered = true;
    }
    record.history.push({
        raidId: String(messageId),
        raidName: raid.zindan || raid.zindanKodu || 'Raid',
        unixZamani: Number(raid.unixZamani) || null,
        markedAt: Date.now()
    });
    record.history = record.history.slice(-100);
    saveAttendance();
    return { ...record, penaltyTriggered };
}

function penaltyMessage(status, language = 'tr') {
    const remaining = Number(status.pendingPenalties) || 0;
    if (status.consumed) {
        return t(language, 'raid.penalty.consumed', {
            remaining: remaining > 0 ? `\n${language === 'tr' ? 'Bekleyen ek raid cezanız' : 'Additional pending raid penalties'}: **${remaining}**` : ''
        });
    }
    return t(language, 'raid.penalty.blocked', {
        remaining: remaining > 0 ? `\n${language === 'tr' ? 'Bekleyen ek raid cezanız' : 'Additional pending raid penalties'}: **${remaining}**` : ''
    });
}

function profileClassKey(className) {
    return String(className || '').trim().toLocaleLowerCase('tr-TR');
}

function getProfile(userId, className) {
    const profile = profilVerisi.profiles?.[String(userId)]?.[profileClassKey(className)];
    return profile ? deepClone(profile) : null;
}

function saveProfile(userId, className, inventory) {
    const id = String(userId);
    if (!profilVerisi.profiles[id]) profilVerisi.profiles[id] = {};
    profilVerisi.profiles[id][profileClassKey(className)] = {
        className,
        inventory: normalizeInventory(inventory),
        updatedAt: Date.now()
    };
    atomicJsonWrite(PROFIL_DATA_DOSYASI, profilVerisi);
}

function mainParticipants(raid) {
    return [...raid.tanklar, ...raid.healerlar, ...raid.dpsler]
        .sort((a, b) => (Number(a.sira) || 9999) - (Number(b.sira) || 9999));
}

function mainCount(raid) {
    return raid.tanklar.length + raid.healerlar.length + raid.dpsler.length;
}

function rosterFingerprint(raid) {
    return mainParticipants(raid).map(player => {
        const inventory = normalizeInventory(player.inventory);
        return [
            player.userId,
            player.role,
            player.klas,
            ...inventory.artifacts,
            ...inventory.mounts,
            ...inventory.companions,
            ...inventory.auras
        ].join('|');
    }).join('::');
}

function planInputFingerprint(raid) {
    return JSON.stringify({
        roster: rosterFingerprint(raid),
        overrides: raid.planOverrides || {},
        approved: Boolean(raid.planApproved)
    });
}

function markPlanDirty(raid) {
    raid.planNeedsRefresh = true;
    raid.planApproved = false;
}

function isRaidClosed(raid) {
    return Number(raid.unixZamani || 0) > 0 && Number(raid.unixZamani) <= Math.floor(Date.now() / 1000);
}

function listText(list, isReserve = false, language = 'tr') {
    if (!Array.isArray(list) || list.length === 0) return '\u200b';
    return [...list]
        .sort((a, b) => (Number(a.sira) || 9999) - (Number(b.sira) || 9999))
        .map(player => {
            const targetRole = isReserve && player.intendedRole && player.intendedRole !== 'yedek'
                ? ` • ${roleLabel(language, player.intendedRole)}`
                : '';
            return `${player.klasEmoji || classEmoji(player.klas)} **${player.sira || '?'}** ${player.mention}${targetRole}`;
        })
        .join('\n');
}

function raidEmbedOlustur(raid, language = raidLanguage(raid)) {
    normalizeRaid(raid);
    const closed = isRaidClosed(raid);
    const color = closed ? '#E53935' : '#1D8BD1';
    const title = closed ? '🔴 ASHES OF ANKA RAID · KAPANDI / CLOSED' : 'ASHES OF ANKA RAID · KAYIT / REGISTRATION';
    const typeLabel = raid.contentType === 'dungeon' ? 'ZİNDAN' : 'TRIAL';
    const joined = mainCount(raid);
    const linkedTitle = `[${String(raid.zindan || raid.zindanKodu || 'RAID').toUpperCase()}](https://discord.com)`;
    const statusLine = closed ? '\n\n**ETKİNLİK SONA ERDİ, KAYIT KAPALI. / THIS EVENT HAS ENDED; REGISTRATION IS CLOSED.**' : '';
    // Preserve descriptions saved by the previous bilingual-description version.
    const emptyDescriptions = new Set(['AÇIKLAMA YOK / NO DESCRIPTION', 'Açıklama yok / No description', t('tr', 'raid.creation.no_description'), t('en', 'raid.creation.no_description')]);
    const description = String(raid.aciklama ?? [raid.descriptions?.tr, raid.descriptions?.en].filter(Boolean).join('\n'))
        .split('\n').filter(line => !emptyDescriptions.has(line.trim())).join('\n').trim();
    const descriptionLine = description ? `\n\n<:zaciklama:1527641028171923537> **AÇIKLAMA / DESCRIPTION:**\n ${description}` : '';

    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(`## ${linkedTitle}\n\n**${typeLabel}**\n**PLAYERS:** ${joined}/${raid.capacity} • **RESERVE:** ${raid.yedekler.length}\n\n<:ztarih:1527640859380813945> **TARİH / DATE:**\n ${raid.tarih}${descriptionLine}${statusLine}`)
        .addFields(
            { name: `<:ztank:1527640905073295440> ${roleLabel(language, 'tank')} (${raid.tanklar.length})`, value: listText(raid.tanklar, false, language), inline: true },
            { name: `<:zhealer:1527640985520312440> ${roleLabel(language, 'heal')} (${raid.healerlar.length})`, value: listText(raid.healerlar, false, language), inline: true },
            { name: `<:zdps:1527640943191265310> ${roleLabel(language, 'dps')} (${raid.dpsler.length})`, value: listText(raid.dpsler, false, language), inline: true },
            { name: `<:zyedek:1527640786185879573> RESERVE (${raid.yedekler.length})`, value: listText(raid.yedekler, true, language), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: `ASHES OF ANKA • ${joined}/${raid.capacity}` });
}

function raidButtonRow(disabled = false, language = 'tr') {
    const tank = new ButtonBuilder().setCustomId('raid_join_tank').setLabel('TANK').setEmoji('<:ztank:1527640905073295440>').setStyle(ButtonStyle.Primary).setDisabled(disabled);
    const healer = new ButtonBuilder().setCustomId('raid_join_heal').setLabel('HEALER').setEmoji('<:zhealer:1527640985520312440>').setStyle(ButtonStyle.Success).setDisabled(disabled);
    const dps = new ButtonBuilder().setCustomId('raid_join_dps').setLabel('DPS').setEmoji('<:zdps:1527640943191265310>').setStyle(ButtonStyle.Danger).setDisabled(disabled);
    const reserve = new ButtonBuilder().setCustomId('raid_join_yedek').setLabel('RESERVE').setEmoji('<:zyedek:1527640786185879573>').setStyle(ButtonStyle.Secondary).setDisabled(disabled);
    const leave = new ButtonBuilder().setCustomId('raid_leave').setLabel('EXIT').setEmoji('<:zcikis:1527641065614741684>').setStyle(ButtonStyle.Secondary).setDisabled(disabled);
    return new ActionRowBuilder().addComponents(tank, healer, dps, reserve, leave);
}

function raidLanguageRow(language = 'tr', disabled = false) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('raid_language')
        .setPlaceholder(t('en', 'language.placeholder'))
        .setDisabled(disabled)
        .addOptions(
            { label: t('en', 'language.automatic'), value: 'auto', emoji: '🌐' },
            { label: 'Türkçe', value: 'tr', emoji: '🇹🇷' },
            { label: 'English', value: 'en', emoji: '🇬🇧' }
        );
    return new ActionRowBuilder().addComponents(menu);
}

function monthOptions(language) {
    return Array.from({ length: 12 }, (_, index) => ({ label: t(language, `raid.month.${index + 1}`), value: String(index) }));
}

function dayMenus(data = {}, language = 'tr') {
    const selected = data.gun ? t(language, 'raid.creation.selected_day', { day: data.gun }) : null;
    return [
        new StringSelectMenuBuilder().setCustomId('raid_date_day_1').setPlaceholder(selected || t(language, 'raid.creation.day_first')).addOptions(gunListesi.slice(0, 16)),
        new StringSelectMenuBuilder().setCustomId('raid_date_day_2').setPlaceholder(selected || t(language, 'raid.creation.day_second')).addOptions(gunListesi.slice(16))
    ];
}

function dateComponents(data = {}, language = 'tr') {
    const months = monthOptions(language);
    const [first, second] = dayMenus(data, language);
    const month = new StringSelectMenuBuilder()
        .setCustomId('raid_date_month')
        .setPlaceholder(data.ay !== null && data.ay !== undefined ? t(language, 'raid.creation.selected_month', { month: months.find(item => item.value === data.ay)?.label }) : t(language, 'raid.creation.month'))
        .addOptions(months);
    return [
        new ActionRowBuilder().addComponents(first),
        new ActionRowBuilder().addComponents(second),
        new ActionRowBuilder().addComponents(month)
    ];
}

function privateReply(interaction, payload) {
    return interaction.reply(interaction.guildId ? { ...payload, flags: [64] } : payload);
}

async function fetchRaidMessage(client, messageId, raid, fallbackChannelId = null) {
    const channelIds = [raid.channelId, fallbackChannelId].filter((value, index, array) => value && array.indexOf(value) === index);
    const errors = [];
    for (const channelId of channelIds) {
        try {
            const channel = await client.channels.fetch(channelId);
            if (channel?.messages) return await channel.messages.fetch(String(messageId));
        } catch (error) {
            errors.push(error);
        }
    }
    const error = new Error('Raid mesajı bulunamadı.');
    const lastError = errors.at(-1);
    if (lastError?.code !== undefined) error.code = lastError.code;
    if (lastError?.status !== undefined) error.status = lastError.status;
    error.cause = lastError;
    throw error;
}

function kayipDiscordKaynagiHatasi(error) {
    return [10003, 10008].includes(Number(error?.code)) || Number(error?.status) === 404;
}

async function raidMesajininVarliginiDogrula(client, messageId, raid, maxAgeMs = Infinity) {
    const normalizedId = String(messageId);
    const lastVerifiedAt = dogrulanmisRaidMesajlari.get(normalizedId);
    if (lastVerifiedAt !== undefined && Date.now() - lastVerifiedAt <= maxAgeMs) return true;

    try {
        await fetchRaidMessage(client, normalizedId, raid);
        dogrulanmisRaidMesajlari.set(normalizedId, Date.now());
        return true;
    } catch (error) {
        if (kayipDiscordKaynagiHatasi(error)) {
            raidMesajiSilindi(normalizedId);
            console.log(`🗑️ Silinmiş raid kartı kayıtlardan kaldırıldı: ${normalizedId}`);
        } else {
            console.error(`Raid kartının varlığı doğrulanamadı (${normalizedId}):`, error.message);
        }
        return false;
    }
}

async function updateRaidCard(client, messageId, raid, fallbackChannelId = null) {
    try {
        const message = await fetchRaidMessage(client, messageId, raid, fallbackChannelId);
        const language = raidLanguage(raid);
        const closed = isRaidClosed(raid);
        await message.edit({ embeds: [raidEmbedOlustur(raid, language)], components: [raidButtonRow(closed, language)] });
        return message;
    } catch (error) {
        console.error(`Raid kartı güncellenemedi (${messageId}):`, error.message);
        return null;
    }
}

function findAndRemoveParticipant(raid, userId) {
    const targets = [
        ['tanklar', 'tank'],
        ['healerlar', 'heal'],
        ['dpsler', 'dps'],
        ['yedekler', 'yedek']
    ];
    let removed = null;
    for (const [listName, role] of targets) {
        const next = [];
        for (const player of raid[listName]) {
            if (String(player.userId) === String(userId)) removed = { player, listName, role };
            else next.push(player);
        }
        raid[listName] = next;
    }
    return removed;
}

function displayNameFromInteraction(interaction, user) {
    return interaction.member?.displayName || user.globalName || user.displayName || user.username || user.tag || `Oyuncu ${user.id}`;
}

function registerParticipant(raid, user, displayName, requestedRole, className, inventory, options = {}) {
    normalizeRaid(raid);
    const existing = findAndRemoveParticipant(raid, user.id);
    const order = existing?.player?.sira || raid.siradakiSira++;
    let actualRole = requestedRole;

    if (options.preservePlacement && existing) {
        actualRole = existing.role === 'yedek' ? 'yedek' : existing.role;
    } else if (requestedRole !== 'yedek' && mainCount(raid) >= raid.capacity) {
        actualRole = 'yedek';
    }

    const record = {
        userId: String(user.id),
        mention: `<@${user.id}>`,
        displayName,
        klas: className,
        klasEmoji: classEmoji(className),
        role: actualRole,
        intendedRole: requestedRole,
        inventory: normalizeInventory(inventory),
        sira: order
    };

    if (actualRole === 'tank') raid.tanklar.push(record);
    else if (actualRole === 'heal') raid.healerlar.push(record);
    else if (actualRole === 'dps') raid.dpsler.push(record);
    else raid.yedekler.push(record);

    markPlanDirty(raid);
    return { record, overflow: actualRole === 'yedek' && requestedRole !== 'yedek', existing };
}

function profileFlow(session) {
    return session.role === 'dps'
        ? ['artifacts', 'mounts', 'companions']
        : ['artifacts', 'mounts', 'companions', 'auras'];
}

function inventoryMenu(category, selected = [], role = null, language = 'tr') {
    const titles = {
        artifacts: t(language, 'raid.inventory.artifacts'),
        mounts: t(language, 'raid.inventory.mounts'),
        companions: t(language, 'raid.inventory.companions'),
        auras: t(language, 'raid.inventory.auras')
    };
    const itemOptions = selectOptions(category, { role });
    const visibleValues = new Set(itemOptions.map(option => option.value));
    const visibleSelected = selected.filter(value => visibleValues.has(value));
    const options = [
        { label: t(language, 'raid.inventory.none'), value: NONE_VALUE, emoji: '🚫', default: visibleSelected.length === 0 },
        ...itemOptions.map(option => ({
            ...option,
            default: visibleSelected.includes(option.value)
        }))
    ];
    const selectedSuffix = visibleSelected.length ? t(language, 'raid.registration.selected_count', { count: visibleSelected.length }) : '';
    return new StringSelectMenuBuilder()
        .setCustomId(`raid_profile_${category}`)
        .setPlaceholder(`${titles[category]}${selectedSuffix}`)
        .setMinValues(1)
        .setMaxValues(options.length)
        .addOptions(options);
}

function selectionValues(interaction) {
    return interaction.values.includes(NONE_VALUE)
        ? interaction.values.filter(value => value !== NONE_VALUE)
        : [...interaction.values];
}

function mergeRoleFilteredSelection(session, category, selectedValues) {
    if (category !== 'mounts' || !['dps', 'tank', 'heal'].includes(session.role)) return selectedValues;
    const visibleValues = new Set(selectOptions(category, { role: session.role }).map(option => option.value));
    const hiddenOwnedValues = session.inventory.mounts.filter(value => !visibleValues.has(value));
    return [...new Set([...hiddenOwnedValues, ...selectedValues])];
}

function profileNavigationRow(session, category) {
    const language = session.language || 'tr';
    const flow = profileFlow(session);
    const index = flow.indexOf(category);
    const buttons = [];
    if (index > 0) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`raid_profile_back_${category}`)
                .setLabel(t(language, 'common.back'))
                .setStyle(ButtonStyle.Secondary)
        );
    }
    buttons.push(
        new ButtonBuilder()
            .setCustomId('raid_profile_cancel')
            .setLabel(t(language, 'common.cancel'))
            .setStyle(ButtonStyle.Secondary)
    );
    return new ActionRowBuilder().addComponents(buttons);
}

function profileStepPayload(session, category) {
    const language = session.language || 'tr';
    const flow = profileFlow(session);
    const step = Math.max(0, flow.indexOf(category)) + 1;
    const mountHint = category === 'mounts'
        ? session.role === 'dps'
            ? t(language, 'raid.registration.mount_hint_dps')
            : session.role === 'tank' || session.role === 'heal'
                ? t(language, 'raid.registration.mount_hint_support')
                : ''
        : '';
    return {
        content: `${t(language, 'raid.registration.profile_title', { className: session.className, step, total: flow.length })}\n${t(language, 'raid.registration.profile_instruction', { category: t(language, `raid.registration.category.${category}`) })}${mountHint}`,
        components: [
            new ActionRowBuilder().addComponents(inventoryMenu(category, session.inventory[category], session.role, language)),
            profileNavigationRow(session, category)
        ]
    };
}

function profileReviewPayload(session) {
    const language = session.language || 'tr';
    const lines = profileFlow(session).map(category => {
        let values = session.inventory[category] || [];
        if (category === 'mounts') {
            const visible = new Set(selectOptions('mounts', { role: session.role }).map(option => option.value));
            values = values.filter(value => visible.has(value));
        }
        const summary = values.length ? values.join(', ') : t(language, 'common.none');
        return `**${t(language, `raid.registration.category.${category}`)} (${values.length}):** ${summary}`;
    });
    return {
        content: `${t(language, 'raid.registration.review_title', { className: session.className })}\n${lines.join('\n')}\n\n${t(language, 'raid.registration.review_instruction')}`,
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('raid_profile_confirm')
                .setLabel(t(language, 'raid.registration.save_join'))
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('raid_profile_review_back')
                .setLabel(t(language, 'common.back'))
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('raid_profile_cancel')
                .setLabel(t(language, 'common.cancel'))
                .setStyle(ButtonStyle.Secondary)
        )]
    };
}

async function startProfileSelection(interaction, session, useUpdate = true) {
    profilSecimHafizasi.set(interaction.user.id, session);
    const payload = profileStepPayload(session, 'artifacts');
    return useUpdate ? interaction.update(payload) : privateReply(interaction, payload);
}

function profileUpdateButton(role, messageId, language = 'tr') {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`raid_profile_update_${role}_${messageId}`)
            .setLabel(t(language, 'raid.registration.profile_update'))
            .setStyle(ButtonStyle.Secondary)
    );
}

async function completeRegistration(interaction, session, profileWasLoaded = false) {
    const language = session.language || interactionLanguage(interaction);
    const raid = raidHafizasi.get(String(session.messageId));
    if (!raid || isRaidClosed(raid)) {
        profilSecimHafizasi.delete(interaction.user.id);
        return interaction.update({ content: t(language, 'raid.registration.closed'), components: [] });
    }

    const profile = normalizeInventory(session.inventory);
    saveProfile(interaction.user.id, session.className, profile);
    const result = registerParticipant(
        raid,
        interaction.user,
        session.displayName || displayNameFromInteraction(interaction, interaction.user),
        session.role,
        session.className,
        profile,
        { preservePlacement: session.preservePlacement }
    );
    saveRaid(session.messageId, raid);
    await updateRaidCard(interaction.client, session.messageId, raid, interaction.channelId);
    if (!session.preservePlacement) {
        await sendRegistrationReminder(interaction.client, session.messageId, raid, interaction.user, session.role, result.record.role === 'yedek');
    }
    profilSecimHafizasi.delete(interaction.user.id);

    const message = result.overflow
        ? t(language, 'raid.registration.overflow', { capacity: raid.capacity, role: roleLabel(language, session.role) })
        : t(language, 'raid.registration.success', {
            className: session.className,
            profileNote: t(language, profileWasLoaded ? 'raid.registration.profile_loaded' : 'raid.registration.profile_saved')
        });

    return interaction.update({
        content: message,
        components: [profileUpdateButton(session.role, session.messageId, language)]
    });
}

function findParticipant(raid, userId) {
    return [...raid.tanklar, ...raid.healerlar, ...raid.dpsler, ...raid.yedekler]
        .find(player => String(player.userId) === String(userId)) || null;
}

function findReserveCandidate(raid, role) {
    const ordered = [...raid.yedekler].sort((a, b) => (Number(a.sira) || 9999) - (Number(b.sira) || 9999));
    return ordered.find(player => player.intendedRole === role) || ordered[0] || null;
}

function reserveApprovalRow(messageId, language = 'tr') {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`raid_reserve_accept_${messageId}`).setLabel(t(language, 'raid.reserve.approve')).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`raid_reserve_other_${messageId}`).setLabel(t(language, 'raid.reserve.other')).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`raid_reserve_empty_${messageId}`).setLabel(t(language, 'raid.reserve.empty')).setStyle(ButtonStyle.Secondary)
    );
}

async function promoteReserve(client, messageId, selectedUserId = null) {
    const raid = raidHafizasi.get(String(messageId));
    if (!raid || !raid.pendingReserve || mainCount(raid) >= raid.capacity) return null;
    const candidateId = selectedUserId || raid.pendingReserve.candidateUserId;
    const candidateIndex = raid.yedekler.findIndex(player => String(player.userId) === String(candidateId));
    if (candidateIndex < 0) {
        raid.pendingReserve = null;
        saveRaid(messageId, raid);
        return null;
    }

    const [candidate] = raid.yedekler.splice(candidateIndex, 1);
    const role = raid.pendingReserve.role;
    candidate.role = role;
    candidate.intendedRole = role;
    if (role === 'tank') raid.tanklar.push(candidate);
    else if (role === 'heal') raid.healerlar.push(candidate);
    else raid.dpsler.push(candidate);
    raid.pendingReserve = null;
    markPlanDirty(raid);
    saveRaid(messageId, raid);
    await updateRaidCard(client, messageId, raid);

    try {
        const user = await client.users.fetch(candidate.userId);
        const language = languageForUser(candidate.userId, { guildId: raid.guildId });
        await user.send(t(language, 'raid.reserve.promoted_dm', { raidName: raid.zindan, role: roleLabel(language, role) }));
    } catch (error) {
        console.warn(`Reserve promotion DM failed (${candidate.userId}):`, error.message);
    }
    return candidate;
}

async function requestReserveApproval(client, messageId, raid, role) {
    const candidate = findReserveCandidate(raid, role);
    if (!candidate) return { candidate: null, autoPromoted: false };
    raid.pendingReserve = {
        role,
        candidateUserId: candidate.userId,
        deadline: Date.now() + RESERVE_APPROVAL_MS
    };
    saveRaid(messageId, raid);

    try {
        if (!raid.creatorId) throw new Error('Raid lideri bilinmiyor.');
        const leader = await client.users.fetch(raid.creatorId);
        const language = languageForUser(raid.creatorId, { guildId: raid.guildId });
        await leader.send({
            content: t(language, 'raid.reserve.request', { raidName: raid.zindan, role: roleLabel(language, role), player: candidate.mention }),
            components: [reserveApprovalRow(messageId, language)]
        });
        return { candidate, autoPromoted: false };
    } catch (error) {
        console.warn(`Reserve approval DM failed (${messageId}); promoting automatically:`, error.message);
        const promoted = await promoteReserve(client, messageId, candidate.userId);
        return { candidate: promoted, autoPromoted: true };
    }
}

function attendanceRosterSnapshot(raid) {
    return mainParticipants(raid)
        .filter(player => player.userId)
        .map(player => ({
            userId: String(player.userId),
            mention: player.mention || `<@${player.userId}>`,
            displayName: player.displayName || player.klas || `Oyuncu ${player.userId}`,
            role: player.role,
            klas: player.klas || null
        }));
}

function attendancePromptComponents(messageId, roster, language = 'tr') {
    if (!roster.length) return [];
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`raid_attendance_absent_${messageId}`)
        .setPlaceholder(t(language, 'raid.attendance.absent_placeholder'))
        .setMinValues(1)
        .setMaxValues(Math.min(25, roster.length))
        .addOptions(roster.slice(0, 25).map(player => ({
            label: String(player.displayName || player.userId).substring(0, 100),
            value: String(player.userId),
            description: `${player.role === 'heal' ? 'HEALER' : String(player.role || '').toUpperCase()}${player.klas ? ` • ${player.klas}` : ''}`.substring(0, 100)
        })));
    const allPresent = new ButtonBuilder()
        .setCustomId(`raid_attendance_all_${messageId}`)
        .setLabel(t(language, 'raid.attendance.everyone'))
        .setStyle(ButtonStyle.Success);
    return [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(allPresent)
    ];
}

function attendanceConfirmRow(messageId, language = 'tr') {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`raid_attendance_confirm_${messageId}`).setLabel(t(language, 'raid.attendance.confirm')).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`raid_attendance_reset_${messageId}`).setLabel(t(language, 'raid.attendance.reset')).setStyle(ButtonStyle.Secondary)
    );
}

async function sendAttendancePrompt(client, messageId, raid) {
    if (raid.attendancePromptSent || raid.attendanceCompleted) return true;
    const roster = attendanceRosterSnapshot(raid);
    raid.attendanceRoster = roster;
    raid.attendanceDraftAbsentIds = [];

    if (!roster.length) {
        raid.attendancePromptSent = true;
        raid.attendanceCompleted = true;
        raid.attendanceResult = { completedAt: Date.now(), absentUserIds: [], presentUserIds: [] };
        saveRaid(messageId, raid);
        return true;
    }

    const leaderLanguage = languageForUser(raid.creatorId, { guildId: raid.guildId });
    const content = `${t(leaderLanguage, 'raid.attendance.title', { raidName: raid.zindan })}\n${raid.tarih}\n\n${t(leaderLanguage, 'raid.attendance.prompt', { count: roster.length })}`;
    const payload = { content, components: attendancePromptComponents(messageId, roster, leaderLanguage) };
    let sent = false;
    try {
        if (!raid.creatorId) throw new Error('Raid lideri bilinmiyor.');
        const leader = await client.users.fetch(raid.creatorId);
        await leader.send(payload);
        sent = true;
    } catch (error) {
        console.warn(`Attendance DM failed (${messageId}); falling back to channel:`, error.message);
        try {
            const channel = await client.channels.fetch(raid.channelId);
            if (channel?.send) {
                const sharedLanguage = raidLanguage(raid);
                const sharedContent = `${t(sharedLanguage, 'raid.attendance.title', { raidName: raid.zindan })}\n${raid.tarih}\n\n${t(sharedLanguage, 'raid.attendance.prompt', { count: roster.length })}`;
                await channel.send({
                    content: `${raid.creatorMention || `<@${raid.creatorId}>`}\n${sharedContent}`,
                    components: attendancePromptComponents(messageId, roster, sharedLanguage),
                    allowedMentions: raid.creatorId ? { users: [String(raid.creatorId)] } : undefined
                });
                sent = true;
            }
        } catch (error) {
            console.error(`Raid yoklaması gönderilemedi (${messageId}):`, error.message);
        }
    }
    if (sent) {
        raid.attendancePromptSent = true;
        saveRaid(messageId, raid);
    }
    return sent;
}

async function sendAbsenceWarning(client, player, raid, result) {
    try {
        const user = await client.users.fetch(player.userId);
        const language = languageForUser(player.userId, { guildId: raid.guildId });
        let consequence;
        if (result.penaltyTriggered) {
            consequence = t(language, 'raid.attendance.penalty_triggered', {
                extra: result.pendingPenalties > 1 ? `\n${language === 'tr' ? 'Toplam bekleyen raid cezanız' : 'Total pending raid penalties'}: **${result.pendingPenalties}**` : ''
            });
        } else {
            const remaining = 3 - result.strikeCount;
            consequence = t(language, 'raid.attendance.penalty_pending', { strikes: result.strikeCount, remaining });
        }
        await user.send(`${t(language, 'raid.attendance.warning_title')}\n\n${t(language, 'raid.attendance.warning_body', { raidName: raid.zindan, raidDate: raid.tarih, consequence, total: result.totalAbsences })}`);
    } catch (error) {
        console.warn(`Absence warning DM failed (${player.userId}):`, error.message);
    }
}

async function finalizeAttendance(client, messageId, raid, absentUserIds = []) {
    if (raid.attendanceCompleted) return { alreadyCompleted: true, absent: [], present: [] };
    const roster = Array.isArray(raid.attendanceRoster) && raid.attendanceRoster.length
        ? raid.attendanceRoster
        : attendanceRosterSnapshot(raid);
    const rosterIds = new Set(roster.map(player => String(player.userId)));
    const absentIds = [...new Set(absentUserIds.map(String))].filter(id => rosterIds.has(id));
    const absentSet = new Set(absentIds);
    const absent = roster.filter(player => absentSet.has(String(player.userId)));
    const present = roster.filter(player => !absentSet.has(String(player.userId)));
    const absenceResults = [];

    for (const player of absent) {
        const result = absenceApplied(player.userId, raid, messageId);
        absenceResults.push({ player, result });
        await sendAbsenceWarning(client, player, raid, result);
    }

    raid.attendanceCompleted = true;
    raid.attendanceDraftAbsentIds = [];
    raid.attendanceResult = {
        completedAt: Date.now(),
        absentUserIds: absentIds,
        presentUserIds: present.map(player => String(player.userId))
    };
    saveRaid(messageId, raid);
    return { alreadyCompleted: false, absent, present, absenceResults };
}

async function sendRegistrationReminder(client, messageId, raid, user, role, isReserve = false) {
    const userId = String(user.id);
    if (raid.registrationReminderSentUsers.includes(userId)) return false;
    try {
        const versions = ['tr', 'en'].map(language => t(language, 'raid.registration.dm', {
            raidName: raid.zindan,
            raidDate: raid.tarih,
            role: isReserve ? roleLabel(language, 'yedek') : roleLabel(language, role)
        }));
        await user.send(`${versions[0]}\n\n**For English speakers:**\n${versions[1]}`);
        raid.registrationReminderSentUsers.push(userId);
        raid.registrationReminderSentUsers = raid.registrationReminderSentUsers.slice(-100);
        saveRaid(messageId, raid);
        return true;
    } catch (error) {
        console.warn(`Registration reminder DM failed (${userId}):`, error.message);
        return false;
    }
}

function generatePlan(raid, language = raidLanguage(raid)) {
    const plan = assignRaid(raid, mainParticipants(raid), raid.planOverrides, language);
    raid.plan = plan;
    raid.planRosterFingerprint = rosterFingerprint(raid);
    return plan;
}

function warningText(plan, language = 'tr') {
    if (!plan.warnings?.length) return t(language, 'raid.plan.no_warnings');
    const lines = plan.warnings.map(warning => `• ${warning}`);
    let text = `${t(language, 'raid.plan.warning_heading', { count: plan.warnings.length })}\n`;
    for (const line of lines) {
        if ((text + line).length > 1700) {
            text += `\n${t(language, 'raid.plan.more_warnings', { count: lines.length - text.split('\n').length + 1 })}`;
            break;
        }
        text += `${line}\n`;
    }
    return text.trim();
}

function planActionRow(messageId, language = 'tr') {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`raid_plan_approve_${messageId}`).setLabel(t(language, 'raid.plan.approve')).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`raid_plan_edit_${messageId}`).setLabel(t(language, 'raid.plan.edit')).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`raid_plan_recalc_${messageId}`).setLabel(t(language, 'raid.plan.recalculate')).setStyle(ButtonStyle.Secondary)
    );
}

async function sendDraft(client, messageId, raid, reasonKey = null) {
    const language = languageForUser(raid.creatorId, { guildId: raid.guildId });
    const plan = generatePlan(raid, language);
    const image = await renderRaidTable(raid, plan, { status: t(language, raid.planApproved ? 'raid.table.approved' : 'raid.table.draft'), language });
    const attachment = new AttachmentBuilder(image, { name: `anka-${String(raid.zindanKodu || 'raid').toLowerCase()}-taslak.png` });
    const content = `${t(language, 'raid.plan.draft_heading', { raidName: raid.zindan })}${reasonKey ? `\n${t(language, reasonKey)}` : ''}\n\n${warningText(plan, language)}`;
    const payload = { content, files: [attachment], components: [planActionRow(messageId, language)] };
    let sent = false;

    try {
        if (!raid.creatorId) throw new Error('Raid lideri bilinmiyor.');
        const leader = await client.users.fetch(raid.creatorId);
        await leader.send(payload);
        sent = true;
    } catch (error) {
        console.warn(`Raid plan draft DM failed (${messageId}); falling back to channel:`, error.message);
        try {
            const channel = await client.channels.fetch(raid.channelId);
            if (channel?.send) {
                const sharedLanguage = raidLanguage(raid);
                const leaderLine = raid.creatorMention || (raid.creatorId
                    ? `<@${raid.creatorId}>`
                    : t(sharedLanguage, 'raid.plan.leader_missing'));
                const sharedPlan = generatePlan(raid, sharedLanguage);
                const sharedImage = await renderRaidTable(raid, sharedPlan, {
                    status: t(sharedLanguage, raid.planApproved ? 'raid.table.approved' : 'raid.table.draft'),
                    language: sharedLanguage
                });
                const sharedAttachment = new AttachmentBuilder(sharedImage, { name: `anka-${String(raid.zindanKodu || 'raid').toLowerCase()}-taslak.png` });
                const sharedContent = `${t(sharedLanguage, 'raid.plan.draft_heading', { raidName: raid.zindan })}${reasonKey ? `\n${t(sharedLanguage, reasonKey)}` : ''}\n\n${warningText(sharedPlan, sharedLanguage)}`;
                await channel.send({
                    content: `${leaderLine}\n${sharedContent}`,
                    files: [sharedAttachment],
                    components: [planActionRow(messageId, sharedLanguage)],
                    allowedMentions: raid.creatorId ? { users: [String(raid.creatorId)] } : undefined
                });
                sent = true;
            }
        } catch (error) {
            console.error(`Taslak gönderilemedi (${messageId}):`, error.message);
        }
    }

    raid.draftSent = sent || raid.draftSent;
    raid.planNeedsRefresh = false;
    saveRaid(messageId, raid);
    return sent;
}

async function sendFinalPlan(client, messageId, raid, phase = 'initial') {
    const language = raidLanguage(raid);
    const plan = generatePlan(raid, language);
    const status = t(language, raid.planApproved ? 'raid.table.approved' : 'raid.table.auto');
    const image = await renderRaidTable(raid, plan, { status, language });
    const phaseDetails = {
        initial: {
            heading: t(language, 'raid.plan.initial'),
            fileSuffix: 'plan'
        },
        checkpoint: {
            heading: t(language, 'raid.plan.checkpoint'),
            fileSuffix: 'plan-5dk'
        },
        kickoff: {
            heading: t(language, 'raid.plan.kickoff'),
            fileSuffix: 'nihai-plan'
        }
    }[phase] || {
        heading: t(language, 'raid.plan.initial'),
        fileSuffix: 'plan'
    };
    const attachment = new AttachmentBuilder(image, {
        name: `anka-${String(raid.zindanKodu || 'raid').toLowerCase()}-${phaseDetails.fileSuffix}.png`
    });
    const users = plan.rows.map(row => row.userId).filter(Boolean);
    const mentions = users.map(userId => `<@${userId}>`).join(' ');
    const channel = await client.channels.fetch(raid.channelId);
    if (!channel?.send) throw new Error('Raid kanalı bulunamadı.');

    const content = `${phaseDetails.heading}\n${mentions}`.trim();
    const message = await channel.send({
        content,
        files: [attachment],
        allowedMentions: { users }
    });
    raid.finalSent = true;
    if (phase === 'checkpoint') raid.fiveMinuteCheckpointSent = true;
    if (phase === 'kickoff') raid.kickoffFinalSent = true;
    raid.finalMessageId = message.id;
    raid.finalPlanFingerprint = planInputFingerprint(raid);
    raid.planNeedsRefresh = false;
    saveRaid(messageId, raid);
    return message;
}

function planPublicationAction(raid, secondsUntil) {
    const planChangedSincePublished = !raid.finalSent
        || raid.finalPlanFingerprint !== planInputFingerprint(raid);

    if (secondsUntil <= 0) {
        if (!raid.kapandi && !raid.kickoffFinalSent && planChangedSincePublished) return 'kickoff';
        return null;
    }

    if (secondsUntil <= CHECKPOINT_BEFORE_SECONDS) {
        if (raid.fiveMinuteCheckpointSent) return null;
        return planChangedSincePublished ? 'checkpoint' : 'mark-checkpoint';
    }

    if (secondsUntil <= FINAL_BEFORE_SECONDS && !raid.finalSent) return 'initial';
    return null;
}

function leaderOwnsRaid(interaction, raid) {
    if (!raid) return false;
    if (raid.creatorId) return String(raid.creatorId) === String(interaction.user.id);
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function planPlayerMenu(messageId, raid, language = 'tr') {
    const options = mainParticipants(raid).map(player => ({
        label: String(player.displayName || player.klas || 'Oyuncu').substring(0, 100),
        value: String(player.userId),
        description: `${player.role === 'heal' ? 'HEALER' : player.role.toUpperCase()} • ${player.klas}`.substring(0, 100)
    }));
    return new StringSelectMenuBuilder()
        .setCustomId(`raid_plan_player_${messageId}`)
        .setPlaceholder(t(language, 'raid.plan.player_placeholder'))
        .addOptions(options);
}

function planCategoryMenu(messageId, userId, language = 'tr') {
    return new StringSelectMenuBuilder()
        .setCustomId(`raid_plan_category_${messageId}_${userId}`)
        .setPlaceholder(t(language, 'raid.plan.field_placeholder'))
        .addOptions(
            { label: t(language, 'raid.table.artifact'), value: 'artifact' },
            { label: t(language, 'raid.table.mount'), value: 'mount' },
            { label: t(language, 'raid.table.companion'), value: 'companion' },
            { label: t(language, 'raid.table.aura'), value: 'aura' }
        );
}

function planValueMenu(messageId, player, category, language = 'tr') {
    const inventoryKey = { artifact: 'artifacts', mount: 'mounts', companion: 'companions', aura: 'auras' }[category];
    const values = inventoryOf(player, inventoryKey);
    const options = [
        { label: t(language, 'raid.reserve.empty'), value: NONE_VALUE },
        ...values.slice(0, 24).map(value => ({ label: String(value).substring(0, 100), value: String(value).substring(0, 100) }))
    ];
    return new StringSelectMenuBuilder()
        .setCustomId(`raid_plan_value_${messageId}_${player.userId}_${category}`)
        .setPlaceholder(t(language, 'raid.plan.value_placeholder'))
        .addOptions(options);
}

async function schedulerTick(client) {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
        const nowSeconds = Math.floor(Date.now() / 1000);
        for (const [messageId, raid] of raidHafizasi.entries()) {
            normalizeRaid(raid);
            if (!await raidMesajininVarliginiDogrula(client, messageId, raid)) continue;

            if (raid.pendingReserve?.deadline && Date.now() >= raid.pendingReserve.deadline) {
                await promoteReserve(client, messageId).catch(error => console.error('Yedek yükseltme hatası:', error));
            }

            const secondsUntil = Number(raid.unixZamani || 0) - nowSeconds;
            if (secondsUntil <= 0) {
                if (!await raidMesajininVarliginiDogrula(client, messageId, raid, 15_000)) continue;
                const publicationAction = planPublicationAction(raid, secondsUntil);
                if (publicationAction === 'kickoff') {
                    try {
                        await sendFinalPlan(client, messageId, raid, 'kickoff');
                    } catch (error) {
                        console.error(`Nihai raid planı gönderilemedi (${messageId}):`, error);
                    }
                }
                if (!raid.kapandi && secondsUntil >= -ATTENDANCE_GRACE_SECONDS && !raid.attendancePromptSent && !raid.attendanceCompleted) {
                    await sendAttendancePrompt(client, messageId, raid).catch(error => console.error(`Raid yoklaması gönderilemedi (${messageId}):`, error));
                }
                if (!raid.kapandi) {
                    raid.kapandi = true;
                    saveRaid(messageId, raid);
                    await updateRaidCard(client, messageId, raid);
                }
                continue;
            }

            const currentFingerprint = rosterFingerprint(raid);
            if (raid.planRosterFingerprint && currentFingerprint !== raid.planRosterFingerprint) raid.planNeedsRefresh = true;
            const shouldRefreshDraft = !raid.draftSent || raid.planNeedsRefresh;

            if (secondsUntil <= DRAFT_BEFORE_SECONDS
                && secondsUntil > FINAL_BEFORE_SECONDS
                && shouldRefreshDraft) {
                if (!await raidMesajininVarliginiDogrula(client, messageId, raid, 15_000)) continue;
                await sendDraft(client, messageId, raid, raid.draftSent ? 'raid.plan.reason_roster' : null);
            }

            const publicationAction = planPublicationAction(raid, secondsUntil);
            if (publicationAction === 'initial' || publicationAction === 'checkpoint') {
                if (!await raidMesajininVarliginiDogrula(client, messageId, raid, 15_000)) continue;
                await sendFinalPlan(client, messageId, raid, publicationAction);
            } else if (publicationAction === 'mark-checkpoint') {
                raid.fiveMinuteCheckpointSent = true;
                raid.planNeedsRefresh = false;
                saveRaid(messageId, raid);
            }
        }
    } catch (error) {
        console.error('Raid zamanlayıcısı hata verdi:', error);
    } finally {
        schedulerRunning = false;
    }
}

function raidZamanlayicisiniBaslat(client) {
    if (schedulerTimer) return;
    schedulerTick(client).catch(console.error);
    schedulerTimer = setInterval(() => schedulerTick(client), 30_000);
    if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref();
}

async function raidAutocompleteYonet(interaction) {
    if (!interaction.isAutocomplete()) return;
    const choices = raidAutocompleteChoices(
        raidHafizasi.entries(),
        interaction.commandName,
        interaction.options.getFocused(),
        interactionLanguage(interaction)
    );
    await interaction.respond(choices).catch(error => {
        console.error('Raid otomatik tamamlama yanıtı gönderilemedi:', error.message);
    });
}

function raidMessageIdDesc(a, b) {
    if (/^\d+$/.test(String(a)) && /^\d+$/.test(String(b))) {
        const first = BigInt(a);
        const second = BigInt(b);
        return first === second ? 0 : first > second ? -1 : 1;
    }
    return String(b).localeCompare(String(a));
}

function raidAutocompleteChoices(entries, commandName, focusedValue = '', language = 'tr') {
    const focused = String(focusedValue || '').trim().toLocaleLowerCase('tr-TR');
    const manualAdd = commandName === 'raid-oyuncu-ekle';

    return [...entries]
        .map(([messageId, raid]) => [String(messageId), raid])
        .filter(([, raid]) => !manualAdd || !isRaidClosed(raid))
        .sort(([firstId, firstRaid], [secondId, secondRaid]) => {
            const firstClosed = isRaidClosed(firstRaid);
            const secondClosed = isRaidClosed(secondRaid);
            if (firstClosed !== secondClosed) return firstClosed ? 1 : -1;
            return raidMessageIdDesc(firstId, secondId);
        })
        .map(([messageId, raid]) => {
            const date = raid.gun && raid.ay !== undefined && raid.saat ? `${raid.gun}/${Number(raid.ay) + 1} ${raid.saat}` : t(language, 'raid.autocomplete.no_date');
            const closed = isRaidClosed(raid) ? t(language, 'raid.status.closed') : `${mainCount(raid)}/${raid.capacity}`;
            const label = `${messageId} | ${date} | ${raid.zindanKodu || raid.zindan} | ${closed}`;
            return { name: label.substring(0, 100), value: messageId, searchText: label.toLocaleLowerCase('tr-TR') };
        })
        .filter(choice => !focused || choice.searchText.includes(focused))
        .slice(0, 25)
        .map(({ name, value }) => ({ name, value }));
}

function getRaid(messageId) {
    return raidHafizasi.get(String(messageId)) || null;
}

function getRecentRaids({ guildId = null, limit = 10, includeClosed = false } = {}) {
    return [...raidHafizasi.entries()]
        .filter(([, raid]) => (!guildId || String(raid.guildId) === String(guildId)) && (includeClosed || !isRaidClosed(raid)))
        .sort(([firstId], [secondId]) => raidMessageIdDesc(firstId, secondId))
        .slice(0, Math.max(1, Math.min(25, Number(limit) || 10)))
        .map(([id, raid]) => ({ id, raid }));
}

function getAllRaids() {
    return [...raidHafizasi.entries()].map(([id, raid]) => ({ id, raid }));
}

function buildRaidMessagePayload(raid) {
    const language = raidLanguage(raid);
    const closed = isRaidClosed(raid);
    return {
        embeds: [raidEmbedOlustur(raid, language)],
        components: [raidButtonRow(closed, language)]
    };
}

async function raidManuelOyuncuEkle(interaction) {
    await interaction.deferReply({ flags: [64] });
    const language = interactionLanguage(interaction);
    const messageId = interaction.options.getString('id');
    const requestedRole = interaction.options.getString('role');
    const user = interaction.options.getUser('member');
    const member = interaction.options.getMember('member');
    const className = interaction.options.getString('klas').trim();
    const raid = raidHafizasi.get(String(messageId));
    if (!raid) return interaction.editReply(t(language, 'raid.manual.not_found'));
    if (isRaidClosed(raid)) return interaction.editReply(t(language, 'raid.manual.closed'));
    const penalty = raidPenaltyStatus(user.id, messageId, true);
    if (penalty.blocked) return interaction.editReply(t(language, 'raid.manual.blocked', { user, reason: penaltyMessage(penalty, language) }));

    const profile = getProfile(user.id, className);
    const inventory = profile ? profile.inventory : normalizeInventory();
    const displayName = member?.displayName || user.globalName || user.username;
    const result = registerParticipant(raid, user, displayName, requestedRole, className, inventory);
    saveRaid(messageId, raid);
    await updateRaidCard(interaction.client, messageId, raid, interaction.channelId);

    await sendRegistrationReminder(interaction.client, messageId, raid, user, requestedRole, result.record.role === 'yedek');

    return interaction.editReply(result.overflow
        ? t(language, 'raid.manual.overflow', { capacity: raid.capacity, user })
        : t(language, 'raid.manual.success', { user }));
}

async function raidDuzenleKomutuYonet(interaction) {
    await interaction.deferReply({ flags: [64] });
    const language = interactionLanguage(interaction);
    const messageId = interaction.options.getString('id');
    const raid = raidHafizasi.get(String(messageId));
    if (!raid) return interaction.editReply(t(language, 'raid.manual.not_found'));

    const newDay = interaction.options.getInteger('gun');
    const newMonth = interaction.options.getInteger('ay');
    const newTime = interaction.options.getString('saat');
    const newDescription = interaction.options.getString('aciklama');
    const dateChanges = newDay !== null || newMonth !== null || newTime !== null;
    if (!dateChanges && newDescription === null) return interaction.editReply(t(language, 'raid.edit.no_fields'));
    if (newTime !== null && !saatFormatiniKontrolEt(newTime)) return interaction.editReply(t(language, 'raid.edit.time_format'));

    if (dateChanges) {
        const day = newDay !== null ? newDay : Number(raid.gun);
        const month = newMonth !== null ? newMonth - 1 : Number(raid.ay);
        const time = newTime !== null ? newTime : raid.saat;
        if (!day || Number.isNaN(month) || !time) return interaction.editReply(t(language, 'raid.edit.legacy_date'));
        const created = istanbulZamaniOlustur(day, month, time, null, true);
        const check = istanbulParcalariAl(created.timestamp);
        if (check.gun !== day || check.ay !== month || check.saat !== time) return interaction.editReply(t(language, 'raid.edit.invalid_date'));
        raid.gun = String(day);
        raid.ay = String(month);
        raid.saat = time;
        raid.yil = created.year;
        raid.unixZamani = created.timestamp;
        raid.tarih = discordTarihMetniOlustur(created.timestamp);
        raid.kapandi = false;
        raid.draftSent = false;
        raid.finalSent = false;
        raid.fiveMinuteCheckpointSent = false;
        raid.kickoffFinalSent = false;
        raid.finalMessageId = null;
        raid.finalPlanFingerprint = null;
        raid.planApproved = false;
        raid.planNeedsRefresh = true;
        raid.attendancePromptSent = false;
        raid.attendanceCompleted = false;
        raid.attendanceRoster = [];
        raid.attendanceDraftAbsentIds = [];
        raid.attendanceResult = null;
    }
    if (newDescription !== null) raid.aciklama = newDescription.trim();
    saveRaid(messageId, raid);
    await updateRaidCard(interaction.client, messageId, raid, interaction.channelId);
    return interaction.editReply(t(language, 'raid.edit.success', { raidName: raid.zindan }));
}

async function handleRaidCreation(interaction) {
    if (interaction.isChatInputCommand() && interaction.commandName === 'raid-oluştur') {
        const language = interactionLanguage(interaction);
        const contentOptions = zindanListesi.map(item => item.value === 'custom' ? {
            ...item,
            label: t(language, 'raid.creation.custom'),
            description: t(language, 'raid.creation.custom_description')
        } : {
            ...item,
            description: t(language, item.contentType === 'dungeon' ? 'raid.creation.dungeon_description' : 'raid.creation.trial_description')
        });
        const menu = new StringSelectMenuBuilder()
            .setCustomId('raid_content_select')
            .setPlaceholder(t(language, 'raid.creation.content_placeholder'))
            .addOptions(contentOptions);
        return privateReply(interaction, {
            content: t(language, 'raid.creation.choose_content'),
            components: [new ActionRowBuilder().addComponents(menu)]
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'raid_content_select') {
        const language = interactionLanguage(interaction);
        const selected = interaction.values[0];
        if (selected === 'custom') {
            raidKurulumHafizasi.set(interaction.user.id, { gun: null, ay: null, saat: null });
            const typeMenu = new StringSelectMenuBuilder()
                .setCustomId('raid_custom_type')
                .setPlaceholder(t(language, 'raid.creation.custom_type_placeholder'))
                .addOptions(
                    { label: t(language, 'raid.type.dungeon'), value: 'dungeon', description: t(language, 'raid.creation.dungeon_description') },
                    { label: t(language, 'raid.type.trial'), value: 'trial', description: t(language, 'raid.creation.trial_description') }
                );
            return interaction.update({ content: t(language, 'raid.creation.custom_type_prompt'), components: [new ActionRowBuilder().addComponents(typeMenu)] });
        }

        const item = zindanListesi.find(entry => entry.value === selected);
        raidKurulumHafizasi.set(interaction.user.id, {
            zindanKodu: item.value,
            zindan: item.label,
            contentType: item.contentType,
            gun: null,
            ay: null,
            saat: null
        });
        return interaction.update({ content: t(language, 'raid.creation.choose_date', { raidName: item.label }), components: dateComponents({}, language) });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'raid_custom_type') {
        const session = raidKurulumHafizasi.get(interaction.user.id) || {};
        const language = interactionLanguage(interaction);
        session.contentType = interaction.values[0];
        raidKurulumHafizasi.set(interaction.user.id, session);
        const modal = new ModalBuilder().setCustomId('raid_custom_name_modal').setTitle(t(language, 'raid.creation.custom_modal_title'));
        const input = new TextInputBuilder()
            .setCustomId('raid_custom_name')
            .setLabel(t(language, 'raid.creation.custom_name_label'))
            .setStyle(TextInputStyle.Short)
            .setMaxLength(80)
            .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'raid_custom_name_modal') {
        const session = raidKurulumHafizasi.get(interaction.user.id);
        const language = interactionLanguage(interaction);
        if (!session) return privateReply(interaction, { content: t(language, 'common.expired') });
        const name = interaction.fields.getTextInputValue('raid_custom_name').trim();
        session.zindanKodu = name;
        session.zindan = name;
        raidKurulumHafizasi.set(interaction.user.id, session);
        return interaction.update({ content: t(language, 'raid.creation.choose_date', { raidName: name }), components: dateComponents(session, language) });
    }

    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('raid_date_day_') || interaction.customId === 'raid_date_month')) {
        const session = raidKurulumHafizasi.get(interaction.user.id);
        const language = interactionLanguage(interaction);
        if (!session) return privateReply(interaction, { content: t(language, 'common.expired') });
        if (interaction.customId.startsWith('raid_date_day_')) session.gun = interaction.values[0];
        else session.ay = interaction.values[0];
        raidKurulumHafizasi.set(interaction.user.id, session);

        if (session.gun && session.ay !== null && session.ay !== undefined) {
            const timeMenu = new StringSelectMenuBuilder().setCustomId('raid_date_time').setPlaceholder(t(language, 'raid.creation.time_placeholder')).addOptions(saatListesi);
            const month = monthOptions(language).find(item => item.value === session.ay)?.label;
            return interaction.update({
                content: t(language, 'raid.creation.choose_time', { day: session.gun, month }),
                components: [new ActionRowBuilder().addComponents(timeMenu)]
            });
        }
        return interaction.update({ content: t(language, 'raid.creation.choose_both'), components: dateComponents(session, language) });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'raid_date_time') {
        const session = raidKurulumHafizasi.get(interaction.user.id);
        const language = interactionLanguage(interaction);
        if (!session) return privateReply(interaction, { content: t(language, 'common.expired') });
        session.saat = interaction.values[0];
        raidKurulumHafizasi.set(interaction.user.id, session);
        const modal = new ModalBuilder().setCustomId('raid_description_modal').setTitle(t(language, 'raid.creation.description_title'));
        const input = new TextInputBuilder()
            .setCustomId('raid_description')
            .setLabel(t(language, 'raid.creation.description_label'))
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500)
            .setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'raid_description_modal') {
        await interaction.deferUpdate();
        const session = raidKurulumHafizasi.get(interaction.user.id);
        const language = interactionLanguage(interaction);
        if (!session) return interaction.editReply({ content: t(language, 'common.expired'), components: [] });
        const description = interaction.fields.getTextInputValue('raid_description').trim();
        const created = istanbulZamaniOlustur(session.gun, session.ay, session.saat, null, true);
        const checked = istanbulParcalariAl(created.timestamp);
        if (checked.gun !== Number(session.gun) || checked.ay !== Number(session.ay) || checked.saat !== session.saat) {
            return interaction.editReply({ content: t(language, 'raid.creation.invalid_date'), components: [] });
        }
        const raid = normalizeRaid({
            zindanKodu: session.zindanKodu,
            zindan: session.zindan,
            contentType: session.contentType,
            capacity: capacityForType(session.contentType),
            tarih: discordTarihMetniOlustur(created.timestamp),
            aciklama: description,
            gun: String(session.gun),
            ay: String(session.ay),
            yil: created.year,
            saat: session.saat,
            unixZamani: created.timestamp,
            channelId: interaction.channelId,
            guildId: interaction.guildId,
            creatorId: interaction.user.id,
            creatorMention: `<@${interaction.user.id}>`,
            displayLanguage: language,
            tanklar: [], healerlar: [], dpsler: [], yedekler: [],
            siradakiSira: 1,
            planOverrides: {},
            planNeedsRefresh: true
        });
        const sharedLanguage = raidLanguage(raid);
        const message = await interaction.channel.send({
            embeds: [raidEmbedOlustur(raid, sharedLanguage)],
            components: [raidButtonRow(false, sharedLanguage)]
        });
        saveRaid(message.id, raid);
        raidKurulumHafizasi.delete(interaction.user.id);
        await interaction.editReply({ content: t(language, 'raid.creation.success', { capacity: raid.capacity }), components: [] });
        return;
    }
    return null;
}

async function handleRegistration(interaction) {
    if (interaction.isStringSelectMenu() && interaction.customId === 'raid_language') {
        const selected = interaction.values[0];
        const language = selected === 'tr' || selected === 'en'
            ? selected
            : interactionLanguage(interaction);
        const messageId = interaction.message.id;
        const raid = raidHafizasi.get(String(messageId));
        if (!raid) return privateReply(interaction, { content: t(language, 'raid.manual.not_found') });
        const label = selected === 'auto' ? t(language, 'language.auto_name') : selected === 'tr' ? 'Türkçe' : 'English';
        return privateReply(interaction, {
            content: t(language, 'language.saved', { language: label }),
            embeds: [raidEmbedOlustur(raid, language)]
        });
    }

    if (interaction.isButton() && (interaction.customId.startsWith('raid_join_') || interaction.customId.startsWith('raid_bas_'))) {
        const language = interactionLanguage(interaction);
        const role = interaction.customId.split('_')[2];
        const messageId = interaction.message.id;
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || isRaidClosed(raid)) return privateReply(interaction, { content: t(language, 'raid.registration.closed') });
        const penalty = raidPenaltyStatus(interaction.user.id, messageId, true);
        if (penalty.blocked) return privateReply(interaction, { content: penaltyMessage(penalty, language) });
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`raid_class_${role}_${messageId}`)
            .setPlaceholder(t(language, 'raid.registration.class_placeholder'))
            .addOptions(klasSecenekleri[role]);
        return privateReply(interaction, {
            content: t(language, 'raid.registration.choose_class', { role: roleLabel(language, role) }),
            components: [new ActionRowBuilder().addComponents(menu)]
        });
    }

    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('raid_class_') || interaction.customId.startsWith('raid_klas_secim_'))) {
        const language = interactionLanguage(interaction);
        const parts = interaction.customId.split('_');
        const legacyMenu = interaction.customId.startsWith('raid_klas_secim_');
        const role = parts[legacyMenu ? 3 : 2];
        const messageId = parts[legacyMenu ? 4 : 3];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || isRaidClosed(raid)) return interaction.update({ content: t(language, 'raid.registration.closed'), components: [] });
        const className = interaction.values[0];
        const profile = getProfile(interaction.user.id, className);
        const session = {
            messageId,
            role,
            className,
            displayName: displayNameFromInteraction(interaction, interaction.user),
            inventory: profile ? normalizeInventory(profile.inventory) : normalizeInventory(),
            language
        };
        if (profile) return completeRegistration(interaction, session, true);
        return startProfileSelection(interaction, session, true);
    }

    if (interaction.isButton() && interaction.customId.startsWith('raid_profile_update_')) {
        const language = interactionLanguage(interaction);
        const parts = interaction.customId.split('_');
        const role = parts[3];
        const messageId = parts[4];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || isRaidClosed(raid)) return privateReply(interaction, { content: t(language, 'raid.registration.closed') });
        const participant = findParticipant(raid, interaction.user.id);
        if (!participant) return privateReply(interaction, { content: t(language, 'raid.registration.profile_missing') });
        return startProfileSelection(interaction, {
            messageId,
            role: participant.intendedRole || role,
            className: participant.klas,
            displayName: participant.displayName,
            inventory: normalizeInventory(participant.inventory),
            preservePlacement: true,
            language
        }, false);
    }

    if (interaction.isButton() && interaction.customId === 'raid_profile_cancel') {
        const language = interactionLanguage(interaction);
        profilSecimHafizasi.delete(interaction.user.id);
        return interaction.update({ content: t(language, 'raid.registration.profile_cancelled'), components: [] });
    }

    if (interaction.isButton() && interaction.customId === 'raid_profile_confirm') {
        const session = profilSecimHafizasi.get(interaction.user.id);
        if (!session) return interaction.update({ content: t(interactionLanguage(interaction), 'raid.registration.profile_expired'), components: [] });
        return completeRegistration(interaction, session, false);
    }

    if (interaction.isButton() && interaction.customId === 'raid_profile_review_back') {
        const session = profilSecimHafizasi.get(interaction.user.id);
        if (!session) return interaction.update({ content: t(interactionLanguage(interaction), 'raid.registration.profile_expired'), components: [] });
        const flow = profileFlow(session);
        return interaction.update(profileStepPayload(session, flow[flow.length - 1]));
    }

    if (interaction.isButton() && interaction.customId.startsWith('raid_profile_back_')) {
        const session = profilSecimHafizasi.get(interaction.user.id);
        if (!session) return interaction.update({ content: t(interactionLanguage(interaction), 'raid.registration.profile_expired'), components: [] });
        const currentCategory = interaction.customId.replace('raid_profile_back_', '');
        const flow = profileFlow(session);
        const currentIndex = flow.indexOf(currentCategory);
        const previousCategory = currentIndex > 0 ? flow[currentIndex - 1] : flow[0];
        return interaction.update(profileStepPayload(session, previousCategory));
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_profile_')) {
        const session = profilSecimHafizasi.get(interaction.user.id);
        if (!session) return interaction.update({ content: t(interactionLanguage(interaction), 'raid.registration.profile_expired'), components: [] });
        const category = interaction.customId.replace('raid_profile_', '');
        if (!['artifacts', 'mounts', 'companions', 'auras'].includes(category)) return null;
        session.inventory[category] = mergeRoleFilteredSelection(session, category, selectionValues(interaction));
        profilSecimHafizasi.set(interaction.user.id, session);

        const flow = profileFlow(session);
        const currentIndex = flow.indexOf(category);
        if (currentIndex >= 0 && currentIndex < flow.length - 1) {
            return interaction.update(profileStepPayload(session, flow[currentIndex + 1]));
        }
        return interaction.update(profileReviewPayload(session));
    }

    if (interaction.isButton() && (interaction.customId === 'raid_leave' || interaction.customId === 'raid_cikis')) {
        await interaction.deferReply({ flags: [64] });
        const language = interactionLanguage(interaction);
        const messageId = interaction.message.id;
        const raid = raidHafizasi.get(String(messageId));
        if (!raid) return interaction.editReply(t(language, 'raid.manual.not_found'));
        const removed = findAndRemoveParticipant(raid, interaction.user.id);
        if (!removed) return interaction.editReply(t(language, 'raid.leave.not_joined'));
        markPlanDirty(raid);
        saveRaid(messageId, raid);
        await updateRaidCard(interaction.client, messageId, raid, interaction.channelId);

        if (removed.role !== 'yedek') {
            const approval = await requestReserveApproval(interaction.client, messageId, raid, removed.role);
            if (approval.candidate) {
                return interaction.editReply(approval.autoPromoted
                    ? t(language, 'raid.leave.promoted', { player: approval.candidate.mention })
                    : t(language, 'raid.leave.approval_sent', { player: approval.candidate.mention }));
            }
        }
        return interaction.editReply(t(language, 'raid.leave.success'));
    }
    return null;
}

async function handleReserveApproval(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith('raid_reserve_')) {
        const language = interactionLanguage(interaction);
        const parts = interaction.customId.split('_');
        const action = parts[2];
        const messageId = parts[3];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || !leaderOwnsRaid(interaction, raid)) return privateReply(interaction, { content: t(language, 'raid.reserve.leader_only') });

        if (action === 'accept') {
            const candidate = await promoteReserve(interaction.client, messageId);
            return interaction.update({ content: candidate ? t(language, 'raid.reserve.promoted', { player: candidate.mention }) : t(language, 'raid.reserve.not_found'), components: [] });
        }
        if (action === 'empty') {
            raid.pendingReserve = null;
            saveRaid(messageId, raid);
            return interaction.update({ content: t(language, 'raid.reserve.left_empty'), components: [] });
        }
        if (action === 'other') {
            if (!raid.yedekler.length) return interaction.update({ content: t(language, 'raid.reserve.not_found'), components: [] });
            const options = raid.yedekler.slice(0, 25).map(player => ({
                label: String(player.displayName || player.klas).substring(0, 100),
                value: String(player.userId),
                description: `${player.intendedRole === 'heal' ? 'HEALER' : String(player.intendedRole).toUpperCase()} • ${player.klas}`.substring(0, 100)
            }));
            const menu = new StringSelectMenuBuilder().setCustomId(`raid_reserve_choose_${messageId}`).setPlaceholder(t(language, 'raid.reserve.choose_placeholder')).addOptions(options);
            return interaction.update({ content: t(language, 'raid.reserve.choose_prompt'), components: [new ActionRowBuilder().addComponents(menu)] });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_reserve_choose_')) {
        const language = interactionLanguage(interaction);
        const messageId = interaction.customId.split('_')[3];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || !leaderOwnsRaid(interaction, raid)) return privateReply(interaction, { content: t(language, 'common.no_permission') });
        const candidate = await promoteReserve(interaction.client, messageId, interaction.values[0]);
        return interaction.update({ content: candidate ? t(language, 'raid.reserve.promoted', { player: candidate.mention }) : t(language, 'raid.reserve.not_found'), components: [] });
    }
    return null;
}

async function handleAttendanceInteraction(interaction) {
    const isAttendanceSelect = interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_attendance_absent_');
    const isAttendanceButton = interaction.isButton() && interaction.customId.startsWith('raid_attendance_');
    if (!isAttendanceSelect && !isAttendanceButton) return null;
    const language = interactionLanguage(interaction);

    const parts = interaction.customId.split('_');
    const action = parts[2];
    const messageId = parts[3];
    const raid = raidHafizasi.get(String(messageId));
    if (!raid || !leaderOwnsRaid(interaction, raid)) {
        return privateReply(interaction, { content: t(language, 'raid.attendance.leader_only') });
    }
    if (raid.attendanceCompleted) {
        return interaction.update({ content: t(language, 'raid.attendance.completed_before'), components: [] });
    }

    const roster = Array.isArray(raid.attendanceRoster) && raid.attendanceRoster.length
        ? raid.attendanceRoster
        : attendanceRosterSnapshot(raid);

    if (isAttendanceSelect && action === 'absent') {
        raid.attendanceDraftAbsentIds = interaction.values.map(String);
        saveRaid(messageId, raid);
        const selected = roster.filter(player => raid.attendanceDraftAbsentIds.includes(String(player.userId)));
        const lines = selected.map(player => `• ${player.mention || `<@${player.userId}>`} (${player.displayName})`).join('\n');
        return interaction.update({
            content: t(language, 'raid.attendance.selected', { players: lines || t(language, 'raid.attendance.no_selection') }),
            components: [attendanceConfirmRow(messageId, language)]
        });
    }

    if (action === 'reset') {
        raid.attendanceDraftAbsentIds = [];
        saveRaid(messageId, raid);
        return interaction.update({
            content: t(language, 'raid.attendance.reset_prompt', { raidName: raid.zindan }),
            components: attendancePromptComponents(messageId, roster, language)
        });
    }

    if (action === 'all') {
        const result = await finalizeAttendance(interaction.client, messageId, raid, []);
        return interaction.update({
            content: t(language, 'raid.attendance.all_present', { count: result.present.length }),
            components: []
        });
    }

    if (action === 'confirm') {
        const result = await finalizeAttendance(interaction.client, messageId, raid, raid.attendanceDraftAbsentIds || []);
        const penaltyLines = result.absenceResults
            .filter(item => item.result.penaltyTriggered)
            .map(item => `• ${item.player.mention || `<@${item.player.userId}>`} → **${t(language, 'raid.attendance.one_penalty')}**`);
        const penalties = penaltyLines.length ? t(language, 'raid.attendance.penalties', { players: penaltyLines.join('\n') }) : '';
        const summary = t(language, 'raid.attendance.summary', { present: result.present.length, absent: result.absent.length, penalties });
        return interaction.update({ content: summary, components: [] });
    }

    return null;
}

async function handlePlanInteraction(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith('raid_plan_')) {
        const language = interactionLanguage(interaction);
        const parts = interaction.customId.split('_');
        const action = parts[2];
        const messageId = parts[3];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || !leaderOwnsRaid(interaction, raid)) return privateReply(interaction, { content: t(language, 'raid.plan.leader_only') });

        if (action === 'approve') {
            raid.planApproved = true;
            saveRaid(messageId, raid);
            return interaction.update({ content: t(language, 'raid.plan.approved', { raidName: raid.zindan }), components: [] });
        }
        if (action === 'recalc') {
            raid.planOverrides = {};
            raid.planApproved = false;
            raid.planNeedsRefresh = true;
            saveRaid(messageId, raid);
            await interaction.update({ content: t(language, 'raid.plan.recalculated'), components: [] });
            await sendDraft(interaction.client, messageId, raid, 'raid.plan.reason_recalculated');
            return;
        }
        if (action === 'edit') {
            const players = mainParticipants(raid);
            if (!players.length) return privateReply(interaction, { content: t(language, 'raid.plan.no_players') });
            return privateReply(interaction, {
                content: t(language, 'raid.plan.choose_player'),
                components: [new ActionRowBuilder().addComponents(planPlayerMenu(messageId, raid, language))]
            });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_plan_player_')) {
        const language = interactionLanguage(interaction);
        const messageId = interaction.customId.split('_')[3];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || !leaderOwnsRaid(interaction, raid)) return privateReply(interaction, { content: t(language, 'common.no_permission') });
        const userId = interaction.values[0];
        return interaction.update({
            content: t(language, 'raid.plan.choose_field'),
            components: [new ActionRowBuilder().addComponents(planCategoryMenu(messageId, userId, language))]
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_plan_category_')) {
        const language = interactionLanguage(interaction);
        const parts = interaction.customId.split('_');
        const messageId = parts[3];
        const userId = parts[4];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || !leaderOwnsRaid(interaction, raid)) return privateReply(interaction, { content: t(language, 'common.no_permission') });
        const player = findParticipant(raid, userId);
        if (!player) return interaction.update({ content: t(language, 'raid.plan.player_not_found'), components: [] });
        const category = interaction.values[0];
        return interaction.update({
            content: t(language, 'raid.plan.new_value', { player: player.displayName }),
            components: [new ActionRowBuilder().addComponents(planValueMenu(messageId, player, category, language))]
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_plan_value_')) {
        const language = interactionLanguage(interaction);
        const parts = interaction.customId.split('_');
        const messageId = parts[3];
        const userId = parts[4];
        const category = parts[5];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || !leaderOwnsRaid(interaction, raid)) return privateReply(interaction, { content: t(language, 'common.no_permission') });
        if (!raid.planOverrides[userId]) raid.planOverrides[userId] = {};
        raid.planOverrides[userId][category] = interaction.values[0] === NONE_VALUE ? null : interaction.values[0];
        raid.planApproved = false;
        raid.planNeedsRefresh = true;
        saveRaid(messageId, raid);
        await interaction.update({ content: t(language, 'raid.plan.saved'), components: [] });
        await sendDraft(interaction.client, messageId, raid, 'raid.plan.reason_manual');
        return;
    }
    return null;
}

async function raidSisteminiYonet(interaction) {
    try {
        const creationHandled = await handleRaidCreation(interaction);
        if (creationHandled !== null) return creationHandled;
        const registrationHandled = await handleRegistration(interaction);
        if (registrationHandled !== null) return registrationHandled;
        const reserveHandled = await handleReserveApproval(interaction);
        if (reserveHandled !== null) return reserveHandled;
        const attendanceHandled = await handleAttendanceInteraction(interaction);
        if (attendanceHandled !== null) return attendanceHandled;
        return await handlePlanInteraction(interaction);
    } catch (error) {
        console.error('Raid sisteminde hata oluştu:', error);
        const payload = { content: t(interactionLanguage(interaction), 'common.error'), components: [] };
        if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(replyError => console.error('Raid error reply failed:', replyError));
        return privateReply(interaction, payload).catch(replyError => console.error('Raid error reply failed:', replyError));
    }
}

loadRaids();
loadProfiles();
loadAttendance();

module.exports = {
    raidKomutu,
    raidOyuncuEkleKomutu,
    raidDuzenleKomutu,
    raidSisteminiYonet,
    raidAutocompleteYonet,
    raidManuelOyuncuEkle,
    raidDuzenleKomutuYonet,
    raidZamanlayicisiniBaslat,
    raidMesajiSilindi,
    raidMesajKayitlariniSil,
    getRaid,
    getRecentRaids,
    getAllRaids,
    buildRaidMessagePayload,
    _test: {
        normalizeRaid,
        registerParticipant,
        isRaidClosed,
        contentTypeFromValue,
        capacityForType,
        rosterFingerprint,
        planInputFingerprint,
        planPublicationAction,
        raidAutocompleteChoices,
        kayipDiscordKaynagiHatasi,
        generatePlan,
        raidLanguage,
        raidEmbedOlustur,
        raidButtonRow,
        raidLanguageRow,
        inventoryMenu,
        dateComponents,
        klasSecenekleri,
        profileStepPayload,
        profileReviewPayload,
        normalizeAttendanceRecord,
        raidPenaltyStatus,
        absenceApplied,
        attendanceRosterSnapshot
    }
};
