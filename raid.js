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

const ISTANBUL_UTC_OFFSET_HOURS = 3;
const RAID_DATA_DOSYASI = path.join(__dirname, 'raid_data.json');
const PROFIL_DATA_DOSYASI = path.join(__dirname, 'raid_profiles.json');
const NONE_VALUE = '__none__';
const RESERVE_APPROVAL_MS = 5 * 60 * 1000;
const DRAFT_BEFORE_SECONDS = 30 * 60;
const FINAL_BEFORE_SECONDS = 15 * 60;

const raidHafizasi = new Map();
const raidKurulumHafizasi = new Map();
const profilSecimHafizasi = new Map();
let profilVerisi = { profiles: {} };
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
    .setDescription('Yeni bir trial veya zindan etkinlik kartı hazırlar.');

const raidOyuncuEkleKomutu = new SlashCommandBuilder()
    .setName('raid-oyuncu-ekle')
    .setDescription('Oluşturulan bir raide yönetici tarafından manuel olarak oyuncu ekler.')
    .addStringOption(option => option.setName('id').setDescription('Raid ID bilgisini seçin.').setRequired(true).setAutocomplete(true))
    .addStringOption(option => option.setName('role').setDescription('Oyuncunun rolü').setRequired(true).addChoices(
        { name: 'TANK', value: 'tank' },
        { name: 'HEALER', value: 'heal' },
        { name: 'DPS', value: 'dps' },
        { name: 'YEDEK', value: 'yedek' }
    ))
    .addUserOption(option => option.setName('member').setDescription('Eklenecek oyuncuyu seçin.').setRequired(true))
    .addStringOption(option => option.setName('klas').setDescription('Oyuncunun klasını yazın.').setRequired(true));

const raidDuzenleKomutu = new SlashCommandBuilder()
    .setName('düzenle')
    .setDescription('Raid kartının gün, ay, saat veya açıklamasını düzenler.')
    .addStringOption(option => option.setName('id').setDescription('Düzenlenecek Raid ID bilgisini seçin.').setRequired(true).setAutocomplete(true))
    .addIntegerOption(option => option.setName('gun').setDescription('Yeni gün').setMinValue(1).setMaxValue(31).setRequired(false))
    .addIntegerOption(option => option.setName('ay').setDescription('Yeni ay').setMinValue(1).setMaxValue(12).setRequired(false))
    .addStringOption(option => option.setName('saat').setDescription('Yeni saat, örn. 21:30').setRequired(false))
    .addStringOption(option => option.setName('aciklama').setDescription('Yeni açıklama').setRequired(false));

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
    return `<t:${unixZamani}:F> (<t:${unixZamani}:R>)`;
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
    raid.planApproved = Boolean(raid.planApproved);
    raid.kapandi = Boolean(raid.kapandi);
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

function loadProfiles() {
    profilVerisi = safeJsonRead(PROFIL_DATA_DOSYASI, { profiles: {} });
    if (!profilVerisi.profiles || typeof profilVerisi.profiles !== 'object') profilVerisi.profiles = {};
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

function listText(list, isReserve = false) {
    if (!Array.isArray(list) || list.length === 0) return 'Boş';
    return [...list]
        .sort((a, b) => (Number(a.sira) || 9999) - (Number(b.sira) || 9999))
        .map(player => {
            const targetRole = isReserve && player.intendedRole && player.intendedRole !== 'yedek'
                ? ` • ${player.intendedRole === 'heal' ? 'HEALER' : player.intendedRole.toUpperCase()}`
                : '';
            return `${player.klasEmoji || classEmoji(player.klas)} **${player.sira || '?'}** ${player.mention}${targetRole}`;
        })
        .join('\n');
}

function raidEmbedOlustur(raid) {
    normalizeRaid(raid);
    const closed = isRaidClosed(raid);
    const color = closed ? '#E53935' : '#1D8BD1';
    const title = closed ? '🔴 ASHES OF ANKA RAID • KAPANDI' : 'ASHES OF ANKA RAID OLUŞTURUCU';
    const typeLabel = raid.contentType === 'dungeon' ? 'ZİNDAN' : 'TRIAL';
    const joined = mainCount(raid);
    const linkedTitle = `[${String(raid.zindan || raid.zindanKodu || 'RAID').toUpperCase()}](https://discord.com)`;
    const statusLine = closed ? '\n\n**Bu etkinliğin süresi doldu. Yeni kayıt alınmıyor.**' : '';

    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(`## ${linkedTitle}\n\n**TÜR:** ${typeLabel}\n**KATILIM:** ${joined}/${raid.capacity} • **YEDEK:** ${raid.yedekler.length}\n\n<:ztarih:1527640859380813945> **TARİH:**\n ${raid.tarih}\n\n<:zaciklama:1527641028171923537> **AÇIKLAMA:**\n ${raid.aciklama}${statusLine}`)
        .addFields(
            { name: `<:ztank:1527640905073295440> TANK (${raid.tanklar.length})`, value: listText(raid.tanklar), inline: true },
            { name: `<:zhealer:1527640985520312440> HEALER (${raid.healerlar.length})`, value: listText(raid.healerlar), inline: true },
            { name: `<:zdps:1527640943191265310> DPS (${raid.dpsler.length})`, value: listText(raid.dpsler), inline: true },
            { name: `<:zyedek:1527640786185879573> YEDEK (${raid.yedekler.length})`, value: listText(raid.yedekler, true), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: `Ashes of Anka • ${joined}/${raid.capacity}` });
}

function raidButtonRow(disabled = false) {
    const tank = new ButtonBuilder().setCustomId('raid_join_tank').setLabel('TANK').setEmoji('<:ztank:1527640905073295440>').setStyle(ButtonStyle.Primary).setDisabled(disabled);
    const healer = new ButtonBuilder().setCustomId('raid_join_heal').setLabel('HEALER').setEmoji('<:zhealer:1527640985520312440>').setStyle(ButtonStyle.Success).setDisabled(disabled);
    const dps = new ButtonBuilder().setCustomId('raid_join_dps').setLabel('DPS').setEmoji('<:zdps:1527640943191265310>').setStyle(ButtonStyle.Danger).setDisabled(disabled);
    const reserve = new ButtonBuilder().setCustomId('raid_join_yedek').setLabel('YEDEK').setEmoji('<:zyedek:1527640786185879573>').setStyle(ButtonStyle.Secondary).setDisabled(disabled);
    const leave = new ButtonBuilder().setCustomId('raid_leave').setLabel('ÇIKIŞ').setEmoji('<:zcikis:1527641065614741684>').setStyle(ButtonStyle.Secondary).setDisabled(disabled);
    return new ActionRowBuilder().addComponents(tank, healer, dps, reserve, leave);
}

function dayMenus(data = {}) {
    const selected = data.gun ? `Seçilen Gün: ${data.gun}` : null;
    return [
        new StringSelectMenuBuilder().setCustomId('raid_date_day_1').setPlaceholder(selected || 'Günü Seçin (1-16)').addOptions(gunListesi.slice(0, 16)),
        new StringSelectMenuBuilder().setCustomId('raid_date_day_2').setPlaceholder(selected || 'Günü Seçin (17-31)').addOptions(gunListesi.slice(16))
    ];
}

function dateComponents(data = {}) {
    const [first, second] = dayMenus(data);
    const month = new StringSelectMenuBuilder()
        .setCustomId('raid_date_month')
        .setPlaceholder(data.ay !== null && data.ay !== undefined ? `Seçilen Ay: ${ayListesi.find(item => item.value === data.ay)?.label}` : 'Ayı Seçin')
        .addOptions(ayListesi);
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
    for (const channelId of channelIds) {
        try {
            const channel = await client.channels.fetch(channelId);
            if (channel?.messages) return await channel.messages.fetch(String(messageId));
        } catch (_) {}
    }
    throw new Error('Raid mesajı bulunamadı.');
}

async function updateRaidCard(client, messageId, raid, fallbackChannelId = null) {
    try {
        const message = await fetchRaidMessage(client, messageId, raid, fallbackChannelId);
        await message.edit({ embeds: [raidEmbedOlustur(raid)], components: [raidButtonRow(isRaidClosed(raid))] });
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

function inventoryMenu(category, selected = [], role = null) {
    const titles = {
        artifacts: 'Sahip olduğunuz eserleri seçin',
        mounts: 'Sahip olduğunuz binek güçlerini seçin',
        companions: 'Sahip olduğunuz yoldaşları seçin',
        auras: 'Sahip olduğunuz auraları seçin'
    };
    const itemOptions = selectOptions(category, { role });
    const visibleValues = new Set(itemOptions.map(option => option.value));
    const visibleSelected = selected.filter(value => visibleValues.has(value));
    const options = [
        { label: 'Hiçbiri', value: NONE_VALUE, emoji: '🚫', default: visibleSelected.length === 0 },
        ...itemOptions.map(option => ({
            ...option,
            default: visibleSelected.includes(option.value)
        }))
    ];
    const selectedSuffix = visibleSelected.length ? ` • ${visibleSelected.length} seçili` : '';
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
    const flow = profileFlow(session);
    const index = flow.indexOf(category);
    const buttons = [];
    if (index > 0) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`raid_profile_back_${category}`)
                .setLabel('Geri')
                .setStyle(ButtonStyle.Secondary)
        );
    }
    buttons.push(
        new ButtonBuilder()
            .setCustomId('raid_profile_cancel')
            .setLabel('İptal')
            .setStyle(ButtonStyle.Secondary)
    );
    return new ActionRowBuilder().addComponents(buttons);
}

function profileStepPayload(session, category) {
    const labels = {
        artifacts: 'Eser',
        mounts: 'Binek gücü',
        companions: 'Yoldaş',
        auras: 'Aura'
    };
    const flow = profileFlow(session);
    const step = Math.max(0, flow.indexOf(category)) + 1;
    const mountHint = category === 'mounts'
        ? session.role === 'dps'
            ? '\nYalnızca DPS kişisel hasar binekleri gösteriliyor.'
            : session.role === 'tank' || session.role === 'heal'
                ? '\nYalnızca takım debuff binekleri gösteriliyor.'
                : ''
        : '';
    return {
        content: `**${session.className} profili • ${step}/${flow.length}**\n${labels[category]} seçimlerinizi yapın. Birden fazla seçenek işaretleyebilirsiniz.${mountHint}`,
        components: [
            new ActionRowBuilder().addComponents(inventoryMenu(category, session.inventory[category], session.role)),
            profileNavigationRow(session, category)
        ]
    };
}

function profileReviewPayload(session) {
    const labels = {
        artifacts: 'Eserler',
        mounts: 'Binek güçleri',
        companions: 'Yoldaşlar',
        auras: 'Auralar'
    };
    const lines = profileFlow(session).map(category => {
        let values = session.inventory[category] || [];
        if (category === 'mounts') {
            const visible = new Set(selectOptions('mounts', { role: session.role }).map(option => option.value));
            values = values.filter(value => visible.has(value));
        }
        const summary = values.length ? values.join(', ') : 'Yok';
        return `**${labels[category]} (${values.length}):** ${summary}`;
    });
    return {
        content: `**${session.className} profil özeti**\n${lines.join('\n')}\n\nBilgiler doğruysa kaydedip raide katılın.`,
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('raid_profile_confirm')
                .setLabel('Kaydet ve Katıl')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('raid_profile_review_back')
                .setLabel('Geri')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('raid_profile_cancel')
                .setLabel('İptal')
                .setStyle(ButtonStyle.Secondary)
        )]
    };
}

async function startProfileSelection(interaction, session, useUpdate = true) {
    profilSecimHafizasi.set(interaction.user.id, session);
    const payload = profileStepPayload(session, 'artifacts');
    return useUpdate ? interaction.update(payload) : privateReply(interaction, payload);
}

function profileUpdateButton(role, messageId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`raid_profile_update_${role}_${messageId}`)
            .setLabel('Profilimi Güncelle')
            .setStyle(ButtonStyle.Secondary)
    );
}

async function completeRegistration(interaction, session, profileWasLoaded = false) {
    const raid = raidHafizasi.get(String(session.messageId));
    if (!raid || isRaidClosed(raid)) {
        profilSecimHafizasi.delete(interaction.user.id);
        return interaction.update({ content: '❌ Raid kapanmış veya kayıt verisi bulunamıyor.', components: [] });
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
    profilSecimHafizasi.delete(interaction.user.id);

    const message = result.overflow
        ? `⚠️ **${raid.capacity} kişilik ana kadro dolu olduğu için yedeğe gönderildiniz.** Hedef rolünüz **${session.role === 'heal' ? 'HEALER' : session.role.toUpperCase()}** olarak kaydedildi.`
        : `✅ **${session.className}** olarak başarıyla kaydoldunuz.${profileWasLoaded ? ' Kayıtlı profiliniz otomatik kullanıldı.' : ' Profiliniz sonraki kayıtlar için kaydedilmiştir. Bu klas için ek olarak profil ayarlaması yapmanıza gerek yoktur.'}`;

    return interaction.update({
        content: message,
        components: [profileUpdateButton(session.role, session.messageId)]
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

function reserveApprovalRow(messageId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`raid_reserve_accept_${messageId}`).setLabel('Onayla').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`raid_reserve_other_${messageId}`).setLabel('Başka Yedek Seç').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`raid_reserve_empty_${messageId}`).setLabel('Boş Bırak').setStyle(ButtonStyle.Secondary)
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
        await user.send(`✅ **${raid.zindan}** ana kadrosuna **${role === 'heal' ? 'HEALER' : role.toUpperCase()}** olarak geçirildiniz.`);
    } catch (_) {}
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
        await leader.send({
            content: `**${raid.zindan}** kadrosunda **${role === 'heal' ? 'HEALER' : role.toUpperCase()}** yeri boşaldı. Önerilen yedek: ${candidate.mention}\n5 dakika içinde cevap verilmezse otomatik geçirilecek.`,
            components: [reserveApprovalRow(messageId)]
        });
        return { candidate, autoPromoted: false };
    } catch (_) {
        const promoted = await promoteReserve(client, messageId, candidate.userId);
        return { candidate: promoted, autoPromoted: true };
    }
}

function generatePlan(raid) {
    const plan = assignRaid(raid, mainParticipants(raid), raid.planOverrides);
    raid.plan = plan;
    raid.planRosterFingerprint = rosterFingerprint(raid);
    return plan;
}

function warningText(plan) {
    if (!plan.warnings?.length) return '✅ Eksik atama bulunmuyor.';
    const lines = plan.warnings.map(warning => `• ${warning}`);
    let text = `⚠️ **${plan.warnings.length} uyarı:**\n`;
    for (const line of lines) {
        if ((text + line).length > 1700) {
            text += `\n• …ve ${lines.length - text.split('\n').length + 1} uyarı daha.`;
            break;
        }
        text += `${line}\n`;
    }
    return text.trim();
}

function planActionRow(messageId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`raid_plan_approve_${messageId}`).setLabel('Tabloyu Onayla').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`raid_plan_edit_${messageId}`).setLabel('Atamayı Düzenle').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`raid_plan_recalc_${messageId}`).setLabel('Otomatik Yenile').setStyle(ButtonStyle.Secondary)
    );
}

async function sendDraft(client, messageId, raid, reason = null) {
    const plan = generatePlan(raid);
    const image = await renderRaidTable(raid, plan, { status: raid.planApproved ? 'LİDER ONAYLI' : 'TASLAK' });
    const attachment = new AttachmentBuilder(image, { name: `anka-${String(raid.zindanKodu || 'raid').toLowerCase()}-taslak.png` });
    const content = `📋 **${raid.zindan} tablo taslağı hazır.**${reason ? `\n${reason}` : ''}\n\n${warningText(plan)}`;
    const payload = { content, files: [attachment], components: [planActionRow(messageId)] };
    let sent = false;

    try {
        if (!raid.creatorId) throw new Error('Raid lideri bilinmiyor.');
        const leader = await client.users.fetch(raid.creatorId);
        await leader.send(payload);
        sent = true;
    } catch (_) {
        try {
            const channel = await client.channels.fetch(raid.channelId);
            if (channel?.send) {
                const leaderLine = raid.creatorMention || (raid.creatorId
                    ? `<@${raid.creatorId}>`
                    : '⚠️ Bu eski raid kaydında lider bilgisi bulunmuyor.');
                await channel.send({ ...payload, content: `${leaderLine}\n${content}` });
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

async function sendFinalPlan(client, messageId, raid, updated = false) {
    const plan = generatePlan(raid);
    const status = raid.planApproved ? 'LİDER ONAYLI' : 'OTOMATİK PLAN';
    const image = await renderRaidTable(raid, plan, { status });
    const attachment = new AttachmentBuilder(image, { name: `anka-${String(raid.zindanKodu || 'raid').toLowerCase()}-plan.png` });
    const users = plan.rows.map(row => row.userId).filter(Boolean);
    const mentions = users.map(userId => `<@${userId}>`).join(' ');
    const channel = await client.channels.fetch(raid.channelId);
    if (!channel?.send) throw new Error('Raid kanalı bulunamadı.');

    const heading = updated ? '🔄 **Güncellenmiş raid planı**' : '**Trial/Zindan Tablosu Hazırlanmıştır. Lütfen Aşağıdaki Binek, Eser ve Yoldaşla Birlikte Oyunda Hazır Olunuz.**';
    const content = `${heading}\n${mentions}`.trim();
    const message = await channel.send({
        content,
        files: [attachment],
        allowedMentions: { users }
    });
    raid.finalSent = true;
    raid.finalMessageId = message.id;
    raid.finalPlanFingerprint = planInputFingerprint(raid);
    raid.planNeedsRefresh = false;
    saveRaid(messageId, raid);
    return message;
}

function leaderOwnsRaid(interaction, raid) {
    if (!raid) return false;
    if (raid.creatorId) return String(raid.creatorId) === String(interaction.user.id);
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function planPlayerMenu(messageId, raid) {
    const options = mainParticipants(raid).map(player => ({
        label: String(player.displayName || player.klas || 'Oyuncu').substring(0, 100),
        value: String(player.userId),
        description: `${player.role === 'heal' ? 'HEALER' : player.role.toUpperCase()} • ${player.klas}`.substring(0, 100)
    }));
    return new StringSelectMenuBuilder()
        .setCustomId(`raid_plan_player_${messageId}`)
        .setPlaceholder('Düzenlenecek oyuncuyu seçin')
        .addOptions(options);
}

function planCategoryMenu(messageId, userId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`raid_plan_category_${messageId}_${userId}`)
        .setPlaceholder('Düzenlenecek alanı seçin')
        .addOptions(
            { label: 'Eser', value: 'artifact' },
            { label: 'Binek Gücü', value: 'mount' },
            { label: 'Yoldaş', value: 'companion' },
            { label: 'Aura', value: 'aura' }
        );
}

function planValueMenu(messageId, player, category) {
    const inventoryKey = { artifact: 'artifacts', mount: 'mounts', companion: 'companions', aura: 'auras' }[category];
    const values = inventoryOf(player, inventoryKey);
    const options = [
        { label: 'Boş Bırak', value: NONE_VALUE },
        ...values.slice(0, 24).map(value => ({ label: String(value).substring(0, 100), value: String(value).substring(0, 100) }))
    ];
    return new StringSelectMenuBuilder()
        .setCustomId(`raid_plan_value_${messageId}_${player.userId}_${category}`)
        .setPlaceholder('Yeni atamayı seçin')
        .addOptions(options);
}

async function schedulerTick(client) {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
        const nowSeconds = Math.floor(Date.now() / 1000);
        for (const [messageId, raid] of raidHafizasi.entries()) {
            normalizeRaid(raid);

            if (raid.pendingReserve?.deadline && Date.now() >= raid.pendingReserve.deadline) {
                await promoteReserve(client, messageId).catch(error => console.error('Yedek yükseltme hatası:', error));
            }

            const secondsUntil = Number(raid.unixZamani || 0) - nowSeconds;
            if (secondsUntil <= 0) {
                if (!raid.kapandi) {
                    raid.kapandi = true;
                    saveRaid(messageId, raid);
                    await updateRaidCard(client, messageId, raid);
                }
                continue;
            }

            const currentFingerprint = rosterFingerprint(raid);
            if (raid.planRosterFingerprint && currentFingerprint !== raid.planRosterFingerprint) raid.planNeedsRefresh = true;
            const planChangedSinceFinal = raid.finalPlanFingerprint !== planInputFingerprint(raid);
            const shouldRefreshDraft = !raid.draftSent || raid.planNeedsRefresh;
            const shouldRefreshFinal = !raid.finalSent || planChangedSinceFinal;

            if (secondsUntil <= DRAFT_BEFORE_SECONDS && shouldRefreshDraft) {
                await sendDraft(client, messageId, raid, raid.draftSent ? 'Kadro değişti; taslak yenilendi.' : null);
            }

            if (secondsUntil <= FINAL_BEFORE_SECONDS && shouldRefreshFinal) {
                await sendFinalPlan(client, messageId, raid, raid.finalSent);
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
    const focused = String(interaction.options.getFocused() || '').toLowerCase();
    const choices = [];
    for (const [messageId, raid] of raidHafizasi.entries()) {
        const date = raid.gun && raid.ay !== undefined && raid.saat ? `${raid.gun}/${Number(raid.ay) + 1} ${raid.saat}` : 'Tarih yok';
        const closed = isRaidClosed(raid) ? 'KAPANDI' : `${mainCount(raid)}/${raid.capacity}`;
        const label = `${messageId} | ${date} | ${raid.zindanKodu || raid.zindan} | ${closed}`;
        if (!focused || label.toLowerCase().includes(focused)) choices.push({ name: label.substring(0, 100), value: messageId });
    }
    await interaction.respond(choices.slice(0, 25)).catch(() => {});
}

async function raidManuelOyuncuEkle(interaction) {
    await interaction.deferReply({ flags: [64] });
    const messageId = interaction.options.getString('id');
    const requestedRole = interaction.options.getString('role');
    const user = interaction.options.getUser('member');
    const member = interaction.options.getMember('member');
    const className = interaction.options.getString('klas').trim();
    const raid = raidHafizasi.get(String(messageId));
    if (!raid) return interaction.editReply('❌ Raid verisi bulunamadı.');
    if (isRaidClosed(raid)) return interaction.editReply('❌ Bu raid kapandı; manuel kayıt yapılamaz.');

    const profile = getProfile(user.id, className);
    const inventory = profile ? profile.inventory : normalizeInventory();
    const displayName = member?.displayName || user.globalName || user.username;
    const result = registerParticipant(raid, user, displayName, requestedRole, className, inventory);
    saveRaid(messageId, raid);
    await updateRaidCard(interaction.client, messageId, raid, interaction.channelId);

    try {
        await user.send(`📅 **${raid.zindan}** etkinliğine ${result.overflow ? 'yedek' : requestedRole === 'heal' ? 'HEALER' : requestedRole.toUpperCase()} olarak kaydedildiniz.${profile ? ' Kayıtlı ekipman profiliniz kullanıldı.' : ' Henüz ekipman profiliniz olmadığı için atamalar boş kalabilir.'}`);
    } catch (_) {}

    return interaction.editReply(result.overflow
        ? `⚠️ Ana kadro ${raid.capacity} kişi olduğu için ${user} yedeğe eklendi.`
        : `✅ ${user} başarıyla eklendi.`);
}

async function raidDuzenleKomutuYonet(interaction) {
    await interaction.deferReply({ flags: [64] });
    const messageId = interaction.options.getString('id');
    const raid = raidHafizasi.get(String(messageId));
    if (!raid) return interaction.editReply('❌ Raid verisi bulunamadı.');

    const newDay = interaction.options.getInteger('gun');
    const newMonth = interaction.options.getInteger('ay');
    const newTime = interaction.options.getString('saat');
    const newDescription = interaction.options.getString('aciklama');
    const dateChanges = newDay !== null || newMonth !== null || newTime !== null;
    if (!dateChanges && newDescription === null) return interaction.editReply('❌ En az bir alan girmelisiniz.');
    if (newTime !== null && !saatFormatiniKontrolEt(newTime)) return interaction.editReply('❌ Saat `21:30` biçiminde olmalı.');

    if (dateChanges) {
        const day = newDay !== null ? newDay : Number(raid.gun);
        const month = newMonth !== null ? newMonth - 1 : Number(raid.ay);
        const time = newTime !== null ? newTime : raid.saat;
        if (!day || Number.isNaN(month) || !time) return interaction.editReply('❌ Eski kayıt için gün, ay ve saatin tümünü girin.');
        const created = istanbulZamaniOlustur(day, month, time, null, true);
        const check = istanbulParcalariAl(created.timestamp);
        if (check.gun !== day || check.ay !== month || check.saat !== time) return interaction.editReply('❌ Geçersiz tarih girdiniz.');
        raid.gun = String(day);
        raid.ay = String(month);
        raid.saat = time;
        raid.yil = created.year;
        raid.unixZamani = created.timestamp;
        raid.tarih = discordTarihMetniOlustur(created.timestamp);
        raid.kapandi = false;
        raid.draftSent = false;
        raid.finalSent = false;
        raid.planApproved = false;
        raid.planNeedsRefresh = true;
    }
    if (newDescription !== null) raid.aciklama = newDescription.trim() || 'Herhangi bir açıklama girilmedi.';
    saveRaid(messageId, raid);
    await updateRaidCard(interaction.client, messageId, raid, interaction.channelId);
    return interaction.editReply(`✅ **${raid.zindan}** kartı güncellendi.`);
}

async function handleRaidCreation(interaction) {
    if (interaction.isChatInputCommand() && interaction.commandName === 'raid-oluştur') {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('raid_content_select')
            .setPlaceholder('Zindan veya trial seçin')
            .addOptions(zindanListesi);
        return privateReply(interaction, {
            content: '**Ashes of Anka:** Planlamak istediğiniz içeriği seçin.',
            components: [new ActionRowBuilder().addComponents(menu)]
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'raid_content_select') {
        const selected = interaction.values[0];
        if (selected === 'custom') {
            raidKurulumHafizasi.set(interaction.user.id, { gun: null, ay: null, saat: null });
            const typeMenu = new StringSelectMenuBuilder()
                .setCustomId('raid_custom_type')
                .setPlaceholder('İçerik türünü seçin')
                .addOptions(
                    { label: 'Zindan', value: 'dungeon', description: '5 kişilik ana kadro' },
                    { label: 'Trial', value: 'trial', description: '10 kişilik ana kadro' }
                );
            return interaction.update({ content: 'Özel içeriğin türünü seçin.', components: [new ActionRowBuilder().addComponents(typeMenu)] });
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
        return interaction.update({ content: 'Raid için gün ve ay seçin.', components: dateComponents() });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'raid_custom_type') {
        const session = raidKurulumHafizasi.get(interaction.user.id) || {};
        session.contentType = interaction.values[0];
        raidKurulumHafizasi.set(interaction.user.id, session);
        const modal = new ModalBuilder().setCustomId('raid_custom_name_modal').setTitle('Özel İçerik');
        const input = new TextInputBuilder()
            .setCustomId('raid_custom_name')
            .setLabel('Zindan / Trial Adı')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(80)
            .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'raid_custom_name_modal') {
        const session = raidKurulumHafizasi.get(interaction.user.id);
        if (!session) return privateReply(interaction, { content: '❌ İşlem zaman aşımına uğradı.' });
        const name = interaction.fields.getTextInputValue('raid_custom_name').trim();
        session.zindanKodu = name;
        session.zindan = name;
        raidKurulumHafizasi.set(interaction.user.id, session);
        return interaction.update({ content: `**${name}** için gün ve ay seçin.`, components: dateComponents(session) });
    }

    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('raid_date_day_') || interaction.customId === 'raid_date_month')) {
        const session = raidKurulumHafizasi.get(interaction.user.id);
        if (!session) return privateReply(interaction, { content: '❌ İşlem zaman aşımına uğradı.' });
        if (interaction.customId.startsWith('raid_date_day_')) session.gun = interaction.values[0];
        else session.ay = interaction.values[0];
        raidKurulumHafizasi.set(interaction.user.id, session);

        if (session.gun && session.ay !== null && session.ay !== undefined) {
            const timeMenu = new StringSelectMenuBuilder().setCustomId('raid_date_time').setPlaceholder('Saati seçin').addOptions(saatListesi);
            return interaction.update({
                content: `${session.gun} ${ayListesi.find(item => item.value === session.ay)?.label} seçildi. Saati belirleyin.`,
                components: [new ActionRowBuilder().addComponents(timeMenu)]
            });
        }
        return interaction.update({ content: 'Gün ve ayın ikisini de seçin.', components: dateComponents(session) });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'raid_date_time') {
        const session = raidKurulumHafizasi.get(interaction.user.id);
        if (!session) return privateReply(interaction, { content: '❌ İşlem zaman aşımına uğradı.' });
        session.saat = interaction.values[0];
        raidKurulumHafizasi.set(interaction.user.id, session);
        const modal = new ModalBuilder().setCustomId('raid_description_modal').setTitle('Raid Açıklaması');
        const input = new TextInputBuilder()
            .setCustomId('raid_description')
            .setLabel('Açıklama / Yönetici Notu')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500)
            .setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'raid_description_modal') {
        await interaction.deferUpdate();
        const session = raidKurulumHafizasi.get(interaction.user.id);
        if (!session) return interaction.editReply({ content: '❌ Kurulum verisi bulunamadı.', components: [] });
        const description = interaction.fields.getTextInputValue('raid_description') || 'Herhangi bir açıklama girilmedi.';
        const created = istanbulZamaniOlustur(session.gun, session.ay, session.saat, null, true);
        const checked = istanbulParcalariAl(created.timestamp);
        if (checked.gun !== Number(session.gun) || checked.ay !== Number(session.ay) || checked.saat !== session.saat) {
            return interaction.editReply({ content: '❌ Seçilen gün bu ay için geçerli değil. Lütfen `/raid-oluştur` ile yeniden deneyin.', components: [] });
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
            tanklar: [], healerlar: [], dpsler: [], yedekler: [],
            siradakiSira: 1,
            planOverrides: {},
            planNeedsRefresh: true
        });
        const message = await interaction.channel.send({ embeds: [raidEmbedOlustur(raid)], components: [raidButtonRow(false)] });
        saveRaid(message.id, raid);
        raidKurulumHafizasi.delete(interaction.user.id);
        await interaction.editReply({ content: `✅ ${raid.contentType === 'trial' ? '10' : '5'} kişilik etkinlik kartı oluşturuldu.`, components: [] });
        return;
    }
    return null;
}

async function handleRegistration(interaction) {
    if (interaction.isButton() && (interaction.customId.startsWith('raid_join_') || interaction.customId.startsWith('raid_bas_'))) {
        const role = interaction.customId.split('_')[2];
        const messageId = interaction.message.id;
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || isRaidClosed(raid)) return privateReply(interaction, { content: '❌ Bu raid kapandı; kayıt yapılamaz.' });
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`raid_class_${role}_${messageId}`)
            .setPlaceholder('Katılacağınız klası seçin')
            .addOptions(klasSecenekleri[role]);
        return privateReply(interaction, {
            content: `**${role === 'heal' ? 'HEALER' : role.toUpperCase()}** için klasınızı seçin.`,
            components: [new ActionRowBuilder().addComponents(menu)]
        });
    }

    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('raid_class_') || interaction.customId.startsWith('raid_klas_secim_'))) {
        const parts = interaction.customId.split('_');
        const legacyMenu = interaction.customId.startsWith('raid_klas_secim_');
        const role = parts[legacyMenu ? 3 : 2];
        const messageId = parts[legacyMenu ? 4 : 3];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || isRaidClosed(raid)) return interaction.update({ content: '❌ Bu raid kapandı; kayıt yapılamaz.', components: [] });
        const className = interaction.values[0];
        const profile = getProfile(interaction.user.id, className);
        const session = {
            messageId,
            role,
            className,
            displayName: displayNameFromInteraction(interaction, interaction.user),
            inventory: profile ? normalizeInventory(profile.inventory) : normalizeInventory()
        };
        if (profile) return completeRegistration(interaction, session, true);
        return startProfileSelection(interaction, session, true);
    }

    if (interaction.isButton() && interaction.customId.startsWith('raid_profile_update_')) {
        const parts = interaction.customId.split('_');
        const role = parts[3];
        const messageId = parts[4];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || isRaidClosed(raid)) return privateReply(interaction, { content: '❌ Raid kapalı veya bulunamadı.' });
        const participant = findParticipant(raid, interaction.user.id);
        if (!participant) return privateReply(interaction, { content: '❌ Raid kaydınız bulunamadı.' });
        return startProfileSelection(interaction, {
            messageId,
            role: participant.intendedRole || role,
            className: participant.klas,
            displayName: participant.displayName,
            inventory: normalizeInventory(participant.inventory),
            preservePlacement: true
        }, false);
    }

    if (interaction.isButton() && interaction.customId === 'raid_profile_cancel') {
        profilSecimHafizasi.delete(interaction.user.id);
        return interaction.update({ content: 'Profil düzenleme işlemi iptal edildi.', components: [] });
    }

    if (interaction.isButton() && interaction.customId === 'raid_profile_confirm') {
        const session = profilSecimHafizasi.get(interaction.user.id);
        if (!session) return interaction.update({ content: '❌ Profil seçimi zaman aşımına uğradı.', components: [] });
        return completeRegistration(interaction, session, false);
    }

    if (interaction.isButton() && interaction.customId === 'raid_profile_review_back') {
        const session = profilSecimHafizasi.get(interaction.user.id);
        if (!session) return interaction.update({ content: '❌ Profil seçimi zaman aşımına uğradı.', components: [] });
        const flow = profileFlow(session);
        return interaction.update(profileStepPayload(session, flow[flow.length - 1]));
    }

    if (interaction.isButton() && interaction.customId.startsWith('raid_profile_back_')) {
        const session = profilSecimHafizasi.get(interaction.user.id);
        if (!session) return interaction.update({ content: '❌ Profil seçimi zaman aşımına uğradı.', components: [] });
        const currentCategory = interaction.customId.replace('raid_profile_back_', '');
        const flow = profileFlow(session);
        const currentIndex = flow.indexOf(currentCategory);
        const previousCategory = currentIndex > 0 ? flow[currentIndex - 1] : flow[0];
        return interaction.update(profileStepPayload(session, previousCategory));
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_profile_')) {
        const session = profilSecimHafizasi.get(interaction.user.id);
        if (!session) return interaction.update({ content: '❌ Profil seçimi zaman aşımına uğradı.', components: [] });
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
        const messageId = interaction.message.id;
        const raid = raidHafizasi.get(String(messageId));
        if (!raid) return interaction.editReply('❌ Raid verisi bulunamadı.');
        const removed = findAndRemoveParticipant(raid, interaction.user.id);
        if (!removed) return interaction.editReply('❌ Bu raidde kayıtlı değilsiniz.');
        markPlanDirty(raid);
        saveRaid(messageId, raid);
        await updateRaidCard(interaction.client, messageId, raid, interaction.channelId);

        if (removed.role !== 'yedek') {
            const approval = await requestReserveApproval(interaction.client, messageId, raid, removed.role);
            if (approval.candidate) {
                return interaction.editReply(approval.autoPromoted
                    ? `✅ Kaydınız silindi; ${approval.candidate.mention} otomatik olarak ana kadroya geçirildi.`
                    : `✅ Kaydınız silindi. Raid liderine ${approval.candidate.mention} için yedek onayı gönderildi.`);
            }
        }
        return interaction.editReply('✅ Raid kaydınız silindi.');
    }
    return null;
}

async function handleReserveApproval(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith('raid_reserve_')) {
        const parts = interaction.customId.split('_');
        const action = parts[2];
        const messageId = parts[3];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || !leaderOwnsRaid(interaction, raid)) return privateReply(interaction, { content: '❌ Bu işlem yalnızca raid liderine ait.' });

        if (action === 'accept') {
            const candidate = await promoteReserve(interaction.client, messageId);
            return interaction.update({ content: candidate ? `✅ ${candidate.mention} ana kadroya geçirildi.` : '❌ Yedek bulunamadı.', components: [] });
        }
        if (action === 'empty') {
            raid.pendingReserve = null;
            saveRaid(messageId, raid);
            return interaction.update({ content: 'Ana kadro yeri boş bırakıldı.', components: [] });
        }
        if (action === 'other') {
            if (!raid.yedekler.length) return interaction.update({ content: '❌ Seçilebilecek yedek yok.', components: [] });
            const options = raid.yedekler.slice(0, 25).map(player => ({
                label: String(player.displayName || player.klas).substring(0, 100),
                value: String(player.userId),
                description: `${player.intendedRole === 'heal' ? 'HEALER' : String(player.intendedRole).toUpperCase()} • ${player.klas}`.substring(0, 100)
            }));
            const menu = new StringSelectMenuBuilder().setCustomId(`raid_reserve_choose_${messageId}`).setPlaceholder('Yedeği seçin').addOptions(options);
            return interaction.update({ content: 'Ana kadroya geçirilecek yedeği seçin.', components: [new ActionRowBuilder().addComponents(menu)] });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_reserve_choose_')) {
        const messageId = interaction.customId.split('_')[3];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || !leaderOwnsRaid(interaction, raid)) return privateReply(interaction, { content: '❌ Yetkiniz yok.' });
        const candidate = await promoteReserve(interaction.client, messageId, interaction.values[0]);
        return interaction.update({ content: candidate ? `✅ ${candidate.mention} ana kadroya geçirildi.` : '❌ Yedek bulunamadı.', components: [] });
    }
    return null;
}

async function handlePlanInteraction(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith('raid_plan_')) {
        const parts = interaction.customId.split('_');
        const action = parts[2];
        const messageId = parts[3];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || !leaderOwnsRaid(interaction, raid)) return privateReply(interaction, { content: '❌ Bu tabloyu yalnızca raid lideri değiştirebilir.' });

        if (action === 'approve') {
            raid.planApproved = true;
            saveRaid(messageId, raid);
            return interaction.update({ content: `✅ **${raid.zindan}** tablosu onaylandı. T−15 zamanında kanalda paylaşılacak.`, components: [] });
        }
        if (action === 'recalc') {
            raid.planOverrides = {};
            raid.planApproved = false;
            raid.planNeedsRefresh = true;
            saveRaid(messageId, raid);
            await interaction.update({ content: '♻️ Otomatik atama yeniden hesaplandı. Yeni taslak ayrı mesaj olarak gönderiliyor.', components: [] });
            await sendDraft(interaction.client, messageId, raid, 'Raid lideri otomatik yenileme istedi.');
            return;
        }
        if (action === 'edit') {
            const players = mainParticipants(raid);
            if (!players.length) return privateReply(interaction, { content: '❌ Ana kadroda oyuncu yok.' });
            return privateReply(interaction, {
                content: 'Ataması değiştirilecek oyuncuyu seçin.',
                components: [new ActionRowBuilder().addComponents(planPlayerMenu(messageId, raid))]
            });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_plan_player_')) {
        const messageId = interaction.customId.split('_')[3];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || !leaderOwnsRaid(interaction, raid)) return privateReply(interaction, { content: '❌ Yetkiniz yok.' });
        const userId = interaction.values[0];
        return interaction.update({
            content: 'Değiştirilecek alanı seçin.',
            components: [new ActionRowBuilder().addComponents(planCategoryMenu(messageId, userId))]
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_plan_category_')) {
        const parts = interaction.customId.split('_');
        const messageId = parts[3];
        const userId = parts[4];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || !leaderOwnsRaid(interaction, raid)) return privateReply(interaction, { content: '❌ Yetkiniz yok.' });
        const player = findParticipant(raid, userId);
        if (!player) return interaction.update({ content: '❌ Oyuncu bulunamadı.', components: [] });
        const category = interaction.values[0];
        return interaction.update({
            content: `${player.displayName} için yeni değeri seçin.`,
            components: [new ActionRowBuilder().addComponents(planValueMenu(messageId, player, category))]
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_plan_value_')) {
        const parts = interaction.customId.split('_');
        const messageId = parts[3];
        const userId = parts[4];
        const category = parts[5];
        const raid = raidHafizasi.get(String(messageId));
        if (!raid || !leaderOwnsRaid(interaction, raid)) return privateReply(interaction, { content: '❌ Yetkiniz yok.' });
        if (!raid.planOverrides[userId]) raid.planOverrides[userId] = {};
        raid.planOverrides[userId][category] = interaction.values[0] === NONE_VALUE ? null : interaction.values[0];
        raid.planApproved = false;
        raid.planNeedsRefresh = true;
        saveRaid(messageId, raid);
        await interaction.update({ content: '✅ Manuel atama kaydedildi. Güncel taslak ayrı mesaj olarak gönderiliyor.', components: [] });
        await sendDraft(interaction.client, messageId, raid, 'Raid lideri manuel atama yaptı.');
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
        return await handlePlanInteraction(interaction);
    } catch (error) {
        console.error('Raid sisteminde hata oluştu:', error);
        const payload = { content: '❌ İşlem gerçekleştirilirken bir hata oluştu.', components: [] };
        if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => {});
        return privateReply(interaction, payload).catch(() => {});
    }
}

loadRaids();
loadProfiles();

module.exports = {
    raidKomutu,
    raidOyuncuEkleKomutu,
    raidDuzenleKomutu,
    raidSisteminiYonet,
    raidAutocompleteYonet,
    raidManuelOyuncuEkle,
    raidDuzenleKomutuYonet,
    raidZamanlayicisiniBaslat,
    _test: {
        normalizeRaid,
        registerParticipant,
        isRaidClosed,
        contentTypeFromValue,
        capacityForType,
        rosterFingerprint,
        planInputFingerprint,
        generatePlan,
        raidEmbedOlustur,
        raidButtonRow,
        inventoryMenu,
        dateComponents,
        klasSecenekleri,
        profileStepPayload,
        profileReviewPayload
    }
};
