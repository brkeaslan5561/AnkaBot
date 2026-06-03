const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

const ISTANBUL_UTC_OFFSET_HOURS = 3;

function istanbulTimestampOlustur(gun, ay, saat) {
    const [saatSayisi, dakikaSayisi] = saat.split(':').map(Number);
    return Math.floor(Date.UTC(2026, Number(ay), Number(gun), saatSayisi - ISTANBUL_UTC_OFFSET_HOURS, dakikaSayisi) / 1000);
}

function istanbulParcalariAl(unixZamani) {
    const tarih = new Date((Number(unixZamani) + ISTANBUL_UTC_OFFSET_HOURS * 60 * 60) * 1000);
    const saat = String(tarih.getUTCHours()).padStart(2, '0');
    const dakika = String(tarih.getUTCMinutes()).padStart(2, '0');

    return {
        gun: tarih.getUTCDate(),
        ay: tarih.getUTCMonth(),
        saat: `${saat}:${dakika}`
    };
}

function discordTarihMetniOlustur(unixZamani) {
    return `<t:${unixZamani}:F> (<t:${unixZamani}:R>)`;
}

function tumKlasSecenekleriniAl() {
    return Object.values(klasSecenekleri).flat();
}

function klasEmojisiBul(klas) {
    if (!klas) return '🔹';

    const klasLower = String(klas).toLowerCase();
    const bulunan = tumKlasSecenekleriniAl().find(k =>
        k.value.toLowerCase() === klasLower ||
        k.label.toLowerCase().includes(klasLower)
    );

    return bulunan ? bulunan.emoji : '🔹';
}

function eskiKatilimciMetniniKaydaCevir(kayit, sira) {
    const metin = String(kayit || '').trim();
    const idEslesme = metin.match(/<@!?(\d+)>/);
    const mentionEslesme = metin.match(/<@!?\d+>/);
    const parantezEslesme = metin.match(/\((.*?)\)/);
    const parantezIci = parantezEslesme ? parantezEslesme[1] : '';
    const emojiEslesme = parantezIci.match(/<a?:[^>]+>/);
    const emoji = emojiEslesme ? emojiEslesme[0] : '🔹';
    const klas = parantezIci.replace(/<a?:[^>]+>/g, '').trim();

    return {
        userId: idEslesme ? idEslesme[1] : null,
        mention: mentionEslesme ? mentionEslesme[0] : metin.replace(/\s*\([^)]*\)/g, ''),
        klas: klas || null,
        klasEmoji: emoji,
        sira
    };
}

function katilimciKaydiniNormalizeEt(kayit, varsayilanSira) {
    if (kayit && typeof kayit === 'object' && !Array.isArray(kayit)) {
        const sira = Number(kayit.sira || kayit.kayitSirasi || kayit.order || varsayilanSira);
        const klas = kayit.klas || kayit.class || null;
        const klasEmoji = kayit.klasEmoji || kayit.emoji || klasEmojisiBul(klas);
        const userId = kayit.userId ? String(kayit.userId) : null;

        return {
            userId,
            mention: kayit.mention || (userId ? `<@${userId}>` : 'Bilinmeyen oyuncu'),
            klas,
            klasEmoji,
            sira
        };
    }

    return eskiKatilimciMetniniKaydaCevir(kayit, varsayilanSira);
}

function raidVerisiniNormalizeEt(veri) {
    const rolListeleri = ['tanklar', 'healerlar', 'dpsler', 'yedekler'];
    let siradakiVarsayilan = 1;
    let enYuksekSira = 0;

    for (const listeAdi of rolListeleri) {
        const liste = Array.isArray(veri[listeAdi]) ? veri[listeAdi] : [];

        veri[listeAdi] = liste.map(kayit => {
            const normalizeKayit = katilimciKaydiniNormalizeEt(kayit, siradakiVarsayilan);
            const sira = Number(normalizeKayit.sira) || siradakiVarsayilan;

            normalizeKayit.sira = sira;
            enYuksekSira = Math.max(enYuksekSira, sira);
            siradakiVarsayilan = Math.max(siradakiVarsayilan + 1, enYuksekSira + 1);

            return normalizeKayit;
        });
    }

    veri.siradakiSira = Math.max(Number(veri.siradakiSira) || 1, enYuksekSira + 1);
    return veri;
}

function katilimciKullaniciIdAl(kayit) {
    if (kayit && typeof kayit === 'object' && kayit.userId) return String(kayit.userId);

    const idEslesme = String(kayit || '').match(/<@!?(\d+)>/);
    return idEslesme ? idEslesme[1] : null;
}

function katilimciKullaniciMi(kayit, kullaniciObj) {
    const userId = katilimciKullaniciIdAl(kayit);
    if (userId) return userId === kullaniciObj.id;

    return String(kayit || '').includes(kullaniciObj.toString());
}

function katilimciKaydiOlustur(veri, kullaniciObj, secilenKlasValue, emoji, mevcutKayit = null) {
    const sira = mevcutKayit && mevcutKayit.sira
        ? Number(mevcutKayit.sira)
        : Number(veri.siradakiSira || 1);

    if (!mevcutKayit || !mevcutKayit.sira) {
        veri.siradakiSira = sira + 1;
    }

    return {
        userId: kullaniciObj.id,
        mention: kullaniciObj.toString(),
        klas: secilenKlasValue,
        klasEmoji: emoji || klasEmojisiBul(secilenKlasValue),
        sira
    };
}

function katilimciSatiriniOlustur(kayit) {
    const normalizeKayit = katilimciKaydiniNormalizeEt(kayit, '?');
    const emoji = normalizeKayit.klasEmoji || klasEmojisiBul(normalizeKayit.klas);
    const sira = normalizeKayit.sira || '?';
    const mention = normalizeKayit.mention || (normalizeKayit.userId ? `<@${normalizeKayit.userId}>` : 'Bilinmeyen oyuncu');

    return `${emoji} **${sira}** ${mention}`;
}

function katilimciListesiMetniOlustur(liste) {
    if (!Array.isArray(liste) || liste.length === 0) return 'Boş';

    return [...liste]
        .sort((a, b) => (Number(a.sira) || 9999) - (Number(b.sira) || 9999))
        .map(katilimciSatiriniOlustur)
        .join('\n');
}

function raidKatilimMetinleriniAl(veri) {
    raidVerisiniNormalizeEt(veri);

    return {
        tankMetin: katilimciListesiMetniOlustur(veri.tanklar),
        healMetin: katilimciListesiMetniOlustur(veri.healerlar),
        dpsMetin: katilimciListesiMetniOlustur(veri.dpsler),
        yedekMetin: katilimciListesiMetniOlustur(veri.yedekler)
    };
}

function kullaniciyiTumRollerdenCikar(veri, kullaniciObj) {
    const rolListeleri = ['tanklar', 'healerlar', 'dpsler', 'yedekler'];
    let bulunanKayit = null;

    for (const listeAdi of rolListeleri) {
        const eskiListe = Array.isArray(veri[listeAdi]) ? veri[listeAdi] : [];
        const yeniListe = [];

        for (const kayit of eskiListe) {
            if (katilimciKullaniciMi(kayit, kullaniciObj)) {
                bulunanKayit = katilimciKaydiniNormalizeEt(kayit, Number(veri.siradakiSira || 1));
            } else {
                yeniListe.push(kayit);
            }
        }

        veri[listeAdi] = yeniListe;
    }

    return bulunanKayit;
}

function raidEmbedOlustur(veri) {
    const { tankMetin, healMetin, dpsMetin, yedekMetin } = raidKatilimMetinleriniAl(veri);
    const maviTiklanabilirBaslik = `[${veri.zindan.toUpperCase()} RUNU](https://discord.com)`;

    return new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('ASHES OF ANKA RAID OLUŞTURUCU')
        .setDescription(`## ${maviTiklanabilirBaslik}\n\n<:iconsaat:1511342684986408970> **TARİH:**\n ${veri.tarih}\n\n<:iconinfo:1511342488261230613> **AÇIKLAMA:**\n ${veri.aciklama}`)
        .addFields(
            { name: `<:icontank:1511342553457492038> TANK (${veri.tanklar.length})`, value: tankMetin, inline: true },
            { name: `<:iconheal:1511342753915732150> HEALER (${veri.healerlar.length})`, value: healMetin, inline: true },
            { name: `<:icondps:1511342631043727613> DPS (${veri.dpsler.length})`, value: dpsMetin, inline: true },
            { name: `<:iconyedek:1511353056392904734> YEDEK (${veri.yedekler.length})`, value: yedekMetin, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Ashes of Anka Raid Sistemi' });
}

function raidButonSatiriOlustur() {
    const tankButon = new ButtonBuilder().setCustomId('raid_bas_tank').setLabel('TANK').setEmoji('<:icontank:1511342553457492038>').setStyle(ButtonStyle.Primary);
    const healerButon = new ButtonBuilder().setCustomId('raid_bas_heal').setLabel('HEALER').setEmoji('<:iconheal:1511342753915732150>').setStyle(ButtonStyle.Success);
    const dpsButon = new ButtonBuilder().setCustomId('raid_bas_dps').setLabel('DPS').setEmoji('<:icondps:1511342631043727613>').setStyle(ButtonStyle.Danger);
    const yedekButon = new ButtonBuilder().setCustomId('raid_bas_yedek').setLabel('YEDEK').setEmoji('<:iconyedek:1511353056392904734>').setStyle(ButtonStyle.Secondary);
    const cikisButon = new ButtonBuilder().setCustomId('raid_cikis').setLabel('ÇIKIŞ').setEmoji('<:iconexit:1511665613725106286>').setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder().addComponents(tankButon, healerButon, dpsButon, yedekButon, cikisButon);
}

function saatFormatiniKontrolEt(saat) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(saat);
}

const raidKomutu = new SlashCommandBuilder()
    .setName('raid-oluştur')
    .setDescription('Yeni bir trial veya zindan etkinlik kartı hazırlar.');

// --- YENİ MANUEL OYUNCU EKLEME KOMUT ŞEMASI ---
const raidOyuncuEkleKomutu = new SlashCommandBuilder()
    .setName('raid-oyuncu-ekle')
    .setDescription('Oluşturulan bir raide yönetici tarafından manuel olarak oyuncu ekler.')
    .addStringOption(option =>
        option.setName('id')
            .setDescription('Oyuncunun ekleneceği Raid ID bilgisini seçin.')
            .setRequired(true)
            .setAutocomplete(true) // Görseldeki otomatik tamamlama listesini açar
    )
    .addStringOption(option =>
        option.setName('role')
            .setDescription('Oyuncunun rolu')
            .setRequired(true)
            .addChoices(
                { name: 'TANK', value: 'tank' },
                { name: 'HEALER', value: 'heal' },
                { name: 'DPS', value: 'dps' },
                { name: 'YEDEK', value: 'yedek' }
            )
    )
    .addUserOption(option =>
        option.setName('member')
            .setDescription('Eklenecek oyuncuyu seçin (Sunucu ismiyle aratabilirsiniz).')
            .setRequired(true)
    )
    .addStringOption(option =>
        option.setName('klas')
            .setDescription('Oyuncunun sınıfını yazın veya seçin (Örn: Paladin, Wizard, Cleric).')
            .setRequired(true)
    );

const raidDuzenleKomutu = new SlashCommandBuilder()
    .setName('düzenle')
    .setDescription('Oluşturulan bir raid kartının gün, ay, saat veya açıklamasını düzenler.')
    .addStringOption(option =>
        option.setName('id')
            .setDescription('Düzenlenecek Raid ID bilgisini seçin.')
            .setRequired(true)
            .setAutocomplete(true)
    )
    .addIntegerOption(option =>
        option.setName('gun')
            .setDescription('Yeni gün. Örn: 4')
            .setMinValue(1)
            .setMaxValue(31)
            .setRequired(false)
    )
    .addIntegerOption(option =>
        option.setName('ay')
            .setDescription('Yeni ay. Örn: Haziran için 6')
            .setMinValue(1)
            .setMaxValue(12)
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName('saat')
            .setDescription('Yeni saat. Örn: 21:30')
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName('aciklama')
            .setDescription('Yeni açıklama / yönetici notu')
            .setRequired(false)
    );

const zindanListesi = [
    { label: 'MJS (Master Jotunskar)', value: 'MSJ', description: 'Jotunskar - Master' },
    { label: 'AJS (Advanced Jotunskar)', value: 'ASJ', description: 'Jotunskar - Advanced' },
    { label: 'MSH (Master Soul Harvester)', value: 'MSH', description: 'Soul Harvest Trial - Master' },
    { label: 'MSOD (Master Shackles of Divinity)', value: 'MSOD', description: 'Shackles of Divinity - Master' },
    { label: 'MTIC (Master Imperial Citadel)', value: 'MTIC', description: 'Imperial Citadel - Master' },
    { label: 'MLOMD (Master Lair of the Mad Mage)', value: 'MLOMD', description: 'Lair of the Mad Mage - Master' },
    { label: 'MGZM (Master Gzemnid)', value: 'MGZM', description: 'Gzemnid - Master' },
    { label: 'MZC (Master Zariel)', value: 'MZC', description: 'Zariel - Master' },
    { label: 'TOMM (Tower of The Mad Mage)', value: 'TOMM', description: 'Tower of The Mad Mage - Master' },
    { label: 'ASH (Advanced Soul Harvester)', value: 'ASH', description: 'Soul Harvester - Advanced' }
];

// Discord select menülerinde tek menüde en fazla 25 seçenek olabilir.
// Bu yüzden 31 günü iki ayrı gün menüsüne bölüyoruz.
const gunListesi = Array.from({ length: 31 }, (_, i) => ({ label: `${i + 1}`, value: `${i + 1}` }));

function gunMenuleriniOlustur(data = {}) {
    const secilenGunPlaceholder = data.gun ? `Seçilen Gün: ${data.gun}` : null;

    const gunMenu1 = new StringSelectMenuBuilder()
        .setCustomId('raid_tarih_gun_1')
        .setPlaceholder(secilenGunPlaceholder || 'Günü Seçin (1-16)...')
        .addOptions(gunListesi.slice(0, 16));

    const gunMenu2 = new StringSelectMenuBuilder()
        .setCustomId('raid_tarih_gun_2')
        .setPlaceholder(secilenGunPlaceholder || 'Günü Seçin (17-31)...')
        .addOptions(gunListesi.slice(16));

    return [gunMenu1, gunMenu2];
}

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
    ],
    yedek: [
        { label: 'Paladin', value: 'Paladin', emoji: '<:klaspaladin:1506316091322929163>' },
        { label: 'Fighter', value: 'Fighter', emoji: '<:klasfighter:1506316057407655956>' },
        { label: 'Barbarian', value: 'Barbarian', emoji: '<:klasbarbar:1506315488073093142>' },
        { label: 'Cleric', value: 'Cleric', emoji: '<:klascleric:1506315663860568164>' },
        { label: 'Bard', value: 'Bard', emoji: '<:klasbard:1506315579521372210>' },
        { label: 'Warlock', value: 'Warlock', emoji: '<:klaswarlock:1511349605466378240>' },
        { label: 'Rogue', value: 'Rogue', emoji: '<:klasrogue:1506316128090329099>' },
        { label: 'Wizard', value: 'Wizard', emoji: '<:klaswizard:1506316021664055408>' },
        { label: 'Ranger', value: 'Ranger', emoji: '<:klasranger:1506315982912753694>' }
    ]
};

const RAID_DATA_DOSYASI = path.join(__dirname, 'raid_data.json');
const raidHafizasi = new Map();
const secimHafizasi = new Map();

function bosRaidVerisiniOlustur() {
    return {
        raids: {}
    };
}

function raidVerileriniDisktenYukle() {
    try {
        if (!fs.existsSync(RAID_DATA_DOSYASI)) {
            fs.writeFileSync(RAID_DATA_DOSYASI, JSON.stringify(bosRaidVerisiniOlustur(), null, 2), 'utf8');
            return;
        }

        const hamVeri = fs.readFileSync(RAID_DATA_DOSYASI, 'utf8').trim();
        if (!hamVeri) return;

        const json = JSON.parse(hamVeri);
        const raids = Array.isArray(json) ? Object.fromEntries(json) : (json.raids || json);

        for (const [mesajId, veri] of Object.entries(raids)) {
            if (!mesajId || !veri || typeof veri !== 'object') continue;

            raidHafizasi.set(mesajId, raidVerisiniNormalizeEt({
                ...veri,
                tanklar: Array.isArray(veri.tanklar) ? veri.tanklar : [],
                healerlar: Array.isArray(veri.healerlar) ? veri.healerlar : [],
                dpsler: Array.isArray(veri.dpsler) ? veri.dpsler : [],
                yedekler: Array.isArray(veri.yedekler) ? veri.yedekler : []
            }));
        }

        console.log(`✅ ${raidHafizasi.size} raid kaydı diskten yüklendi.`);
    } catch (error) {
        console.error('Raid verileri diskten yüklenirken hata oluştu:', error);
    }
}

function raidVerileriniDiskeKaydet() {
    try {
        const raids = Object.fromEntries(raidHafizasi.entries());
        const geciciDosya = `${RAID_DATA_DOSYASI}.tmp`;

        fs.writeFileSync(geciciDosya, JSON.stringify({ raids }, null, 2), 'utf8');
        fs.renameSync(geciciDosya, RAID_DATA_DOSYASI);
    } catch (error) {
        console.error('Raid verileri diske kaydedilirken hata oluştu:', error);
    }
}

function raidVerisiniKaydet(mesajId, veri) {
    raidHafizasi.set(mesajId, raidVerisiniNormalizeEt(veri));
    raidVerileriniDiskeKaydet();
}

async function raidMesajiniGetir(interaction, mesajId, veri = {}) {
    const kanallar = [];

    if (veri.channelId) kanallar.push(veri.channelId);
    if (interaction.channelId && !kanallar.includes(interaction.channelId)) kanallar.push(interaction.channelId);

    for (const kanalId of kanallar) {
        try {
            const kanal = await interaction.client.channels.fetch(kanalId);
            if (!kanal || !kanal.messages) continue;
            return await kanal.messages.fetch(mesajId);
        } catch (error) {
            // Bir sonraki kanal ihtimalini dene.
        }
    }

    throw new Error('Raid mesajı bulunamadı.');
}

raidVerileriniDisktenYukle();

// --- YENİ AUTOCOMPLETE MANTIĞI (GÖRSELDEKİ LİSTELEME) ---
async function raidAutocompleteYonet(interaction) {
    if (!interaction.isAutocomplete()) return;

    const focusedValue = interaction.options.getFocused().toLowerCase();
    const secenekler = [];

    for (const [mesajId, veri] of raidHafizasi.entries()) {
        const tarihEtiketi = veri.gun && veri.ay !== undefined && veri.saat
            ? `${veri.gun}/${Number(veri.ay) + 1} ${veri.saat}`
            : 'Bilinmeyen Tarih';
        const labelText = `${mesajId} | ${tarihEtiketi} | ${veri.zindan.toUpperCase()}`;

        if (!focusedValue || labelText.toLowerCase().includes(focusedValue)) {
            secenekler.push({
                name: labelText.substring(0, 100),
                value: mesajId
            });
        }
    }

    await interaction.respond(secenekler.slice(0, 25)).catch(() => {});
}

// --- YENİ MANUEL OYUNCU EKLEME ÇALIŞMA MANTIĞI ---
async function raidManuelOyuncuEkle(interaction) {
    await interaction.deferReply({ flags: [64] });

    const mesajId = interaction.options.getString('id');
    const rol = interaction.options.getString('role');
    const kullaniciObj = interaction.options.getUser('member');
    const secilenKlasValue = interaction.options.getString('klas');

    const veri = raidHafizasi.get(mesajId);
    if (!veri) {
        return await interaction.editReply({ content: '❌ Bu raid kartının verisi bulunamadı veya hafızadan silinmiş.' });
    }

    // Klas emojilerini dinamik olarak tarıyoruz
    const klasBul = klasSecenekleri[rol].find(k => k.value.toLowerCase() === secilenKlasValue.toLowerCase() || k.label.toLowerCase().includes(secilenKlasValue.toLowerCase()));
    const emoji = klasBul ? klasBul.emoji : '🔹';
    
    raidVerisiniNormalizeEt(veri);
    const mevcutKayit = kullaniciyiTumRollerdenCikar(veri, kullaniciObj);
    const katilimciKaydi = katilimciKaydiOlustur(veri, kullaniciObj, secilenKlasValue, emoji, mevcutKayit);

    if (rol === 'tank') veri.tanklar.push(katilimciKaydi);
    if (rol === 'heal') veri.healerlar.push(katilimciKaydi);
    if (rol === 'dps') veri.dpsler.push(katilimciKaydi);
    if (rol === 'yedek') veri.yedekler.push(katilimciKaydi);

    raidVerisiniKaydet(mesajId, veri);

    const guncelEmbed = raidEmbedOlustur(veri);

    try {
        const anaMesaj = await raidMesajiniGetir(interaction, mesajId, veri);
        await anaMesaj.edit({ embeds: [guncelEmbed], components: [raidButonSatiriOlustur()] });

        // DM Bildirimi Gönderme
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('📅 RAID ETKİNLİK KAYDI')
                .setDescription(`Merhaba, **Ashes of Anka** yönetimi tarafından bir raide manuel olarak kaydedildiniz.`)
                .addFields(
                    { name: '🟥 ZİNDAN', value: veri.zindan.toUpperCase(), inline: true },
                    { name: '<:iconinfo:1511342488261230613> ROL / KLAS', value: `${rol.toUpperCase()} (${secilenKlasValue})`, inline: true },
                    { name: '<:iconsaat:1511342684986408970> TARİH', value: veri.tarih, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'Ashes of Anka Raid Yönetimi' });

            await kullaniciObj.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            console.log(`${kullaniciObj.tag} kullanıcısının DM kutusu kapalı olduğu için mesaj atılamadı.`);
        }

        return await interaction.editReply({ content: `✅ ${kullaniciObj.toString()} kullanıcısı **${veri.zindan.toUpperCase()}** raidine **${rol.toUpperCase()}** olarak başarıyla eklendi ve DM bilgilendirmesi yapıldı!` });

    } catch (error) {
        console.error(error);
        return await interaction.editReply({ content: '❌ Oyuncu eklenirken bir hata oluştu. Lütfen doğru kanalda olduğunuzdan emin olun.' });
    }
}

// --- RAID DÜZENLEME KOMUTU ---
async function raidDuzenleKomutuYonet(interaction) {
    await interaction.deferReply({ flags: [64] });

    const mesajId = interaction.options.getString('id');
    const veri = raidHafizasi.get(mesajId);

    if (!veri) {
        return await interaction.editReply({ content: '❌ Bu raid kartının verisi bulunamadı veya bot yeniden başlatıldığı için hafızadan silinmiş olabilir.' });
    }

    const yeniGun = interaction.options.getInteger('gun');
    const yeniAy = interaction.options.getInteger('ay');
    const yeniSaat = interaction.options.getString('saat');
    const yeniAciklama = interaction.options.getString('aciklama');

    const tarihDegisecek = yeniGun !== null || yeniAy !== null || yeniSaat !== null;
    const aciklamaDegisecek = yeniAciklama !== null;

    if (!tarihDegisecek && !aciklamaDegisecek) {
        return await interaction.editReply({ content: '❌ Düzenlemek için en az bir alan girmelisiniz: gün, ay, saat veya açıklama.' });
    }

    if (yeniSaat !== null && !saatFormatiniKontrolEt(yeniSaat)) {
        return await interaction.editReply({ content: '❌ Saat formatı hatalı. Lütfen `21:30` gibi HH:MM formatında yazın.' });
    }

    if (tarihDegisecek) {
        if ((veri.gun === undefined || veri.ay === undefined || veri.saat === undefined) && (yeniGun === null || yeniAy === null || yeniSaat === null)) {
            return await interaction.editReply({ content: '❌ Bu raid eski formatta oluşturulmuş. Tarihi düzenlemek için gün, ay ve saat alanlarının üçünü de girmeniz gerekiyor.' });
        }

        const gun = yeniGun !== null ? yeniGun : Number(veri.gun);
        const ay = yeniAy !== null ? yeniAy - 1 : Number(veri.ay);
        const saat = yeniSaat !== null ? yeniSaat : veri.saat;

        const unixZamani = istanbulTimestampOlustur(gun, ay, saat);
        const kontrol = istanbulParcalariAl(unixZamani);

        if (kontrol.gun !== Number(gun) || kontrol.ay !== Number(ay) || kontrol.saat !== saat) {
            return await interaction.editReply({ content: '❌ Geçersiz tarih girdiniz. Örneğin 31 Şubat gibi bir tarih kullanılamaz.' });
        }

        veri.gun = String(gun);
        veri.ay = String(ay);
        veri.saat = saat;
        veri.unixZamani = unixZamani;
        veri.tarih = discordTarihMetniOlustur(unixZamani);
    }

    if (aciklamaDegisecek) {
        veri.aciklama = yeniAciklama.trim() || 'Herhangi bir açıklama girilmedi.';
    }

    raidVerisiniKaydet(mesajId, veri);

    try {
        const anaMesaj = await raidMesajiniGetir(interaction, mesajId, veri);
        await anaMesaj.edit({ embeds: [raidEmbedOlustur(veri)], components: [raidButonSatiriOlustur()] });
        return await interaction.editReply({ content: `✅ **${veri.zindan.toUpperCase()}** raid kartı başarıyla güncellendi.` });
    } catch (error) {
        console.error(error);
        return await interaction.editReply({ content: '❌ Raid kartı güncellenemedi. Komutu raid mesajının bulunduğu kanalda kullandığınızdan emin olun.' });
    }
}

// --- ESKİ SİSTEMİN ANA FONKSİYONU (DOKUNULMADI) ---
async function raidSisteminiYonet(interaction) {
    try {
        if (interaction.isChatInputCommand() && interaction.commandName === 'raid-oluştur') {
            const menu = new StringSelectMenuBuilder()
                .setCustomId('raid_zindan_secim')
                .setPlaceholder('Planlanacak Zindan veya Trialı Seçin...')
                .addOptions(zindanListesi);

            const row = new ActionRowBuilder().addComponents(menu);
            return await interaction.reply({ content: '<:iconflight:1508409696791564441> **Ashes of Anka:** Lütfen kurmak istediğiniz zindan/trial seçiminizi yapınız', components: [row] });
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'raid_zindan_secim') {
            const secilenZindan = interaction.values[0];
            
            secimHafizasi.set(interaction.user.id, { 
                zindan: secilenZindan, 
                gun: null, 
                ay: null, 
                saat: null
            });

            const [gunMenu1, gunMenu2] = gunMenuleriniOlustur();
            const ayMenu = new StringSelectMenuBuilder().setCustomId('raid_tarih_ay').setPlaceholder('Ayı Seçin...').addOptions(ayListesi);

            const row1 = new ActionRowBuilder().addComponents(gunMenu1);
            const row2 = new ActionRowBuilder().addComponents(gunMenu2);
            const row3 = new ActionRowBuilder().addComponents(ayMenu);

            return await interaction.update({ content: '<:iconflight:1508409696791564441> **Raid Tarihi Belirleme:** Lütfen listeden **Gün** ve **Ay** seçimi yapın:', components: [row1, row2, row3] });
        }

        if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('raid_tarih_gun_') || interaction.customId === 'raid_tarih_ay')) {
            const data = secimHafizasi.get(interaction.user.id);
            if (!data) return await interaction.reply({ content: '❌ İşlem zaman aşımına uğradı, lütfen komutu tekrar çalıştırın.', flags: [64] });

            if (interaction.customId.startsWith('raid_tarih_gun_')) data.gun = interaction.values[0];
            if (interaction.customId === 'raid_tarih_ay') data.ay = interaction.values[0];
            secimHafizasi.set(interaction.user.id, data);

            if (data.gun && data.ay) {
                const saatMenu = new StringSelectMenuBuilder().setCustomId('raid_tarih_saat').setPlaceholder('Saati Seçin...').addOptions(saatListesi);
                const row = new ActionRowBuilder().addComponents(saatMenu);
                
                const ayAdi = ayListesi.find(a => a.value === data.ay).label;
                return await interaction.update({ 
                    content: `<:iconflight:1508409696791564441> Gün: **${data.gun}**, Ay: **${ayAdi}** seçildi. Şimdi kuracağınız turun **Saatini** belirleyin:`, 
                    components: [row] 
                });
            } else {
                const [gunMenu1, gunMenu2] = gunMenuleriniOlustur(data);

                const ayMenu = new StringSelectMenuBuilder()
                    .setCustomId('raid_tarih_ay')
                    .setPlaceholder(data.ay ? `Seçilen Ay: ${ayListesi.find(a=>a.value === data.ay).label}` : 'Ayı Seçin...')
                    .addOptions(ayListesi);

                const row1 = new ActionRowBuilder().addComponents(gunMenu1);
                const row2 = new ActionRowBuilder().addComponents(gunMenu2);
                const row3 = new ActionRowBuilder().addComponents(ayMenu);

                return await interaction.update({ 
                    content: '🟥 **Raid Tarihi Belirleme:** Lütfen hem **Gün** hem de **Ay** seçtiğinizden emin olun:', 
                    components: [row1, row2, row3] 
                });
            }
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'raid_tarih_saat') {
            const data = secimHafizasi.get(interaction.user.id);
            if (!data) return await interaction.reply({ content: '❌ Veri bulunamadı.', flags: [64] });

            data.saat = interaction.values[0];
            secimHafizasi.set(interaction.user.id, data);

            const modal = new ModalBuilder().setCustomId('raid_aciklama_modal').setTitle('Raid Açıklaması');
            const aciklamaInput = new TextInputBuilder()
                .setCustomId('raid_aciklama')
                .setLabel('Açıklama / Yönetici Notu')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Örn: Sınıf rolleri eksiksiz olsun, potları unutmayın.')
                .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(aciklamaInput));
            return await interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && interaction.customId === 'raid_aciklama_modal') {
            await interaction.deferUpdate();

            const data = secimHafizasi.get(interaction.user.id);
            if (!data) return;

            const aciklama = interaction.fields.getTextInputValue('raid_aciklama') || 'Herhangi bir açıklama girilmedi.';
            const zindanBul = zindanListesi.find(z => z.value === data.zindan);
            const zindanAdi = zindanBul ? zindanBul.label : data.zindan;

            const unixZamani = istanbulTimestampOlustur(data.gun, data.ay, data.saat);
            const gosterilecekTarih = discordTarihMetniOlustur(unixZamani);

            const raidVerisi = {
                zindan: zindanAdi,
                tarih: gosterilecekTarih,
                aciklama: aciklama,
                gun: String(data.gun),
                ay: String(data.ay),
                saat: data.saat,
                unixZamani: unixZamani,
                channelId: interaction.channelId,
                guildId: interaction.guildId,
                tanklar: [],
                healerlar: [],
                dpsler: [],
                yedekler: [],
                siradakiSira: 1
            };

            const embed = raidEmbedOlustur(raidVerisi);
            const row = raidButonSatiriOlustur();

            const raidMesaji = await interaction.channel.send({ embeds: [embed], components: [row] });

            raidVerisiniKaydet(raidMesaji.id, raidVerisi);

            try {
                await interaction.editReply({ content: '✅ Etkinlik kartı başarıyla oluşturuldu!', components: [] });
                setTimeout(async () => {
                    await interaction.deleteReply().catch(() => {});
                }, 2000);
            } catch (e) {}

            secimHafizasi.delete(interaction.user.id);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'raid_cikis') {
            await interaction.deferReply({ flags: [64] });

            const mesajId = interaction.message.id;
            const veri = raidHafizasi.get(mesajId);
            if (!veri) return await interaction.editReply({ content: '❌ Bu raid kartının verisi güncelliğini yitirmiş.' });

            raidVerisiniNormalizeEt(veri);
            const silinenKayit = kullaniciyiTumRollerdenCikar(veri, interaction.user);

            if (!silinenKayit) {
                return await interaction.editReply({ content: '❌ Bu raidde zaten kayıtlı görünmüyorsunuz.' });
            }

            raidVerisiniKaydet(mesajId, veri);

            const guncelEmbed = raidEmbedOlustur(veri);
            const anaMesaj = await raidMesajiniGetir(interaction, mesajId, veri);
            await anaMesaj.edit({ embeds: [guncelEmbed], components: [raidButonSatiriOlustur()] });

            return await interaction.editReply({ content: '✅ Raid kaydınız başarıyla silindi.' });
        }

        if (interaction.isButton() && interaction.customId.startsWith('raid_bas_')) {
            const rol = interaction.customId.split('_')[2];
            const mesajId = interaction.message.id;

            const klasMenu = new StringSelectMenuBuilder()
                .setCustomId(`raid_klas_secim_${rol}_${mesajId}`)
                .setPlaceholder(`Hangi Klas ile Katılıyorsunuz?`)
                .addOptions(klasSecenekleri[rol]);

            const row = new ActionRowBuilder().addComponents(klasMenu);
            return await interaction.reply({ content: `**KLAS SEÇİMİ:** Lütfen katıldığınız **${rol.toUpperCase()}** klasını seçin:`, components: [row], flags: [64] });
        }

        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_klas_secim_')) {
            await interaction.deferUpdate();

            const parse = interaction.customId.split('_');
            const rol = parse[3];       
            const mesajId = parse[4];   

            const secilenKlasValue = interaction.values[0]; 
            const kullaniciObj = interaction.user;
            
            const veri = raidHafizasi.get(mesajId);
            if (!veri) return await interaction.followUp({ content: '❌ Bu raid kartının verisi güncelliğini yitirmiş.', flags: [64] });

            const klasBul = klasSecenekleri[rol].find(k => k.value === secilenKlasValue);
            const emoji = klasBul ? klasBul.emoji : '🔹';
            raidVerisiniNormalizeEt(veri);
            const mevcutKayit = kullaniciyiTumRollerdenCikar(veri, kullaniciObj);
            const katilimciKaydi = katilimciKaydiOlustur(veri, kullaniciObj, secilenKlasValue, emoji, mevcutKayit);

            if (rol === 'tank') veri.tanklar.push(katilimciKaydi);
            if (rol === 'heal') veri.healerlar.push(katilimciKaydi);
            if (rol === 'dps') veri.dpsler.push(katilimciKaydi);
            if (rol === 'yedek') veri.yedekler.push(katilimciKaydi);

            raidVerisiniKaydet(mesajId, veri);

            const guncelEmbed = raidEmbedOlustur(veri);

            const anaMesaj = await raidMesajiniGetir(interaction, mesajId, veri);
            await anaMesaj.edit({ embeds: [guncelEmbed], components: [raidButonSatiriOlustur()] });

            return await interaction.followUp({ content: `✅ **${secilenKlasValue}** olarak başarıyla kaydoldunuz!`, flags: [64] });
        }
    } catch (error) {
        console.error("Raid sisteminde hata oluştu:", error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ İşlem gerçekleştirilirken bir hata oluştu.', flags: [64] }).catch(() => {});
        }
    }
}

// --- TÜM MODÜLLERİ HATA ALMADAN DISKARI AKTARMA ALANI ---
module.exports = { 
    raidKomutu, 
    raidSisteminiYonet, 
    raidOyuncuEkleKomutu,
    raidDuzenleKomutu,
    raidDuzenleKomutuYonet,
    raidAutocompleteYonet, 
    raidManuelOyuncuEkle 
};