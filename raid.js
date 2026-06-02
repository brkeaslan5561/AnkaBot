const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

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
                { name: 'DPS', value: 'dps' }
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

const gunListesi = Array.from({ length: 25 }, (_, i) => ({ label: `${i + 1}`, value: `${i + 1}` }));

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
        { label: 'Warlock (Heal)', value: 'Warlock', emoji: '<:klaswarlock:1506316156796014662>' }
    ],
    dps: [
        { label: 'Barbarian', value: 'Barbarian', emoji: '<:klasbarbar:1506315488073093142>' },
        { label: 'Cleric', value: 'Cleric', emoji: '<:klascleric:1506315663860568164>' },
        { label: 'Fighter', value: 'Fighter', emoji: '<:klasfighter:1506316057407655956>' },
        { label: 'Warlock', value: 'Warlock', emoji: '<:klaswarlock:1506316156796014662>' },
        { label: 'Rogue', value: 'Rogue', emoji: '<:klasrogue:1506316128090329099>' },
        { label: 'Wizard', value: 'Wizard', emoji: '<:klaswizard:1506316021664055408>' },
        { label: 'Ranger', value: 'Ranger', emoji: '<:klasranger:1506315982912753694>' },
        { label: 'Bard', value: 'Bard', emoji: '<:klasbard:1506315579521372210>' }
    ]
};

const raidHafizasi = new Map();
const secimHafizasi = new Map();

// --- YENİ AUTOCOMPLETE MANTIĞI (GÖRSELDEKİ LİSTELEME) ---
async function raidAutocompleteYonet(interaction) {
    if (!interaction.isAutocomplete()) return;

    const focusedValue = interaction.options.getFocused().toLowerCase();
    const secenekler = [];

    for (const [mesajId, veri] of raidHafizasi.entries()) {
        const temizTarih = veri.tarih.replace(/<[^>]*>/g, '').trim() || "Bilinmeyen Tarih";
        const labelText = `${mesajId} | ${temizTarih} | ${veri.zindan.toUpperCase()}`;

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
    
    const katilimciMetni = `${kullaniciObj.toString()} (${emoji} ${secilenKlasValue})`;

    const temizle = (liste) => liste.filter(item => !item.includes(kullaniciObj.toString()));
    veri.tanklar = temizle(veri.tanklar);
    veri.healerlar = temizle(veri.healerlar);
    veri.dpsler = temizle(veri.dpsler);

    if (rol === 'tank') veri.tanklar.push(katilimciMetni);
    if (rol === 'heal') veri.healerlar.push(katilimciMetni);
    if (rol === 'dps') veri.dpsler.push(katilimciMetni);

    raidHafizasi.set(mesajId, veri);

    const tankMetin = veri.tanklar.length > 0 ? veri.tanklar.join('\n') : '⚠️ Kadro Boş';
    const healMetin = veri.healerlar.length > 0 ? veri.healerlar.join('\n') : '⚠️ Kadro Boş';
    const dpsMetin = veri.dpsler.length > 0 ? veri.dpsler.join('\n') : '⚠️ Kadro Boş';

    const maviTiklanabilirBaslik = `[${veri.zindan.toUpperCase()} RUNU](https://discord.com)`;

    const guncelEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('ASHES OF ANKA RAID OLUŞTURUCU')
        .setDescription(`## ${maviTiklanabilirBaslik}\n\n<:iconclock:1506322705941794967> **TARİH:**\n ${veri.tarih}\n\n<:icondesc:1506323019323150436> **AÇIKLAMA:**\n ${veri.aciklama}`)
        .addFields(
            { name: `<:klastanks:1508412246081015970> TANK (${veri.tanklar.length})`, value: tankMetin, inline: true },
            { name: `<:klasheals:1508412311537455205> HEALER (${veri.healerlar.length})`, value: healMetin, inline: true },
            { name: `<:klasdpss:1508412362099527751> DPS (${veri.dpsler.length})`, value: dpsMetin, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Ashes of Anka Raid Sistemi' });

    try {
        const anaMesaj = await interaction.channel.messages.fetch(mesajId);
        await anaMesaj.edit({ embeds: [guncelEmbed] });

        // DM Bildirimi Gönderme
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('📅 RAID ETKİNLİK KAYDI')
                .setDescription(`Merhaba, **Ashes of Anka** yönetimi tarafından bir raide manuel olarak kaydedildiniz.`)
                .addFields(
                    { name: '🟥 ZİNDAN', value: veri.zindan.toUpperCase(), inline: true },
                    { name: '<:icondesc:1506323019323150436> ROL / KLAS', value: `${rol.toUpperCase()} (${secilenKlasValue})`, inline: true },
                    { name: '<:iconclock:1506322705941794967> TARİH', value: veri.tarih, inline: false }
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

            const gunMenu = new StringSelectMenuBuilder().setCustomId('raid_tarih_gun').setPlaceholder('Günü Seçin (1-25)...').addOptions(gunListesi);
            const ayMenu = new StringSelectMenuBuilder().setCustomId('raid_tarih_ay').setPlaceholder('Ayı Seçin...').addOptions(ayListesi);

            const row1 = new ActionRowBuilder().addComponents(gunMenu);
            const row2 = new ActionRowBuilder().addComponents(ayMenu);

            return await interaction.update({ content: '<:iconflight:1508409696791564441> **Raid Tarihi Belirleme:** Lütfen listeden **Gün** ve **Ay** seçimi yapın:', components: [row1, row2] });
        }

        if (interaction.isStringSelectMenu() && (interaction.customId === 'raid_tarih_gun' || interaction.customId === 'raid_tarih_ay')) {
            const data = secimHafizasi.get(interaction.user.id);
            if (!data) return await interaction.reply({ content: '❌ İşlem zaman aşımına uğradı, lütfen komutu tekrar çalıştırın.', flags: [64] });

            if (interaction.customId === 'raid_tarih_gun') data.gun = interaction.values[0];
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
                const gunMenu = new StringSelectMenuBuilder()
                    .setCustomId('raid_tarih_gun')
                    .setPlaceholder(data.gun ? `Seçilen Gün: ${data.gun}` : 'Günü Seçin (1-25)...')
                    .addOptions(gunListesi);

                const ayMenu = new StringSelectMenuBuilder()
                    .setCustomId('raid_tarih_ay')
                    .setPlaceholder(data.ay ? `Seçilen Ay: ${ayListesi.find(a=>a.value === data.ay).label}` : 'Ayı Seçin...')
                    .addOptions(ayListesi);

                const row1 = new ActionRowBuilder().addComponents(gunMenu);
                const row2 = new ActionRowBuilder().addComponents(ayMenu);

                return await interaction.update({ 
                    content: '🟥 **Raid Tarihi Belirleme:** Lütfen hem **Gün** hem de **Ay** seçtiğinizden emin olun:', 
                    components: [row1, row2] 
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

            const [saat, dakika] = data.saat.split(':').map(Number);
            const hedefTarih = new Date(2026, Number(data.ay), Number(data.gun), saat, dakika);
            const unixZamani = Math.floor(hedefTarih.getTime() / 1000);
            const gosterilecekTarih = `<t:${unixZamani}:F> (<t:${unixZamani}:R>)`;

            const maviTiklanabilirBaslik = `[${zindanAdi.toUpperCase()} RUNU](https://discord.com)`;

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('ASHES OF ANKA RAID OLUŞTURUCU')
                .setDescription(`## ${maviTiklanabilirBaslik}\n\n<:iconclock:1506322705941794967> **TARİH:**\n ${gosterilecekTarih}\n\n<:icondesc:1506323019323150436> **AÇIKLAMA:**\n ${aciklama}`)
                .addFields(
                    { name: '<:klastanks:1508412246081015970> TANK (0)', value: '⚠️ Kadro Boş', inline: true },
                    { name: '<:klasheals:1508412311537455205> HEAL (0)', value: '⚠️ Kadro Boş', inline: true },
                    { name: '<:klasdpss:1508412362099527751> DPS (0)', value: '⚠️ Kadro Boş', inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Ashes of Anka Raid Sistemi' });

            const tankButon = new ButtonBuilder().setCustomId('raid_bas_tank').setLabel('TANK').setEmoji('<:klastanks:1508412246081015970>').setStyle(ButtonStyle.Primary);
            const healerButon = new ButtonBuilder().setCustomId('raid_bas_heal').setLabel('HEALER').setEmoji('<:klasheals:1508412311537455205>').setStyle(ButtonStyle.Success);
            const dpsButon = new ButtonBuilder().setCustomId('raid_bas_dps').setLabel('DPS').setEmoji('<:klasdpss:1508412362099527751>').setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(tankButon, healerButon, dpsButon);

            const raidMesaji = await interaction.channel.send({ embeds: [embed], components: [row] });

            raidHafizasi.set(raidMesaji.id, {
                zindan: zindanAdi, tarih: gosterilecekTarih, aciklama: aciklama,
                tanklar: [], healerlar: [], dpsler: []
            });

            try {
                await interaction.editReply({ content: '✅ Etkinlik kartı başarıyla oluşturuldu!', components: [] });
                setTimeout(async () => {
                    await interaction.deleteReply().catch(() => {});
                }, 2000);
            } catch (e) {}

            secimHafizasi.delete(interaction.user.id);
            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('raid_bas_')) {
            const rol = interaction.customId.split('_')[2];
            const mesajId = interaction.message.id;

            const klasMenu = new StringSelectMenuBuilder()
                .setCustomId(`raid_klas_secim_${rol}_${mesajId}`)
                .setPlaceholder(`Hangi Klas ile Katılıyorsunuz?`)
                .addOptions(klasSecenekleri[rol]);

            const row = new ActionRowBuilder().addComponents(klasMenu);
            return await interaction.reply({ content: `🎭 **Sınıf Seçimi:** Lütfen katıldığınız **${rol.toUpperCase()}** klasını seçin:`, components: [row], flags: [64] });
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
            const katilimciMetni = `${kullaniciObj.toString()} (${emoji} ${secilenKlasValue})`;

            const temizle = (liste) => liste.filter(item => !item.includes(kullaniciObj.toString()));
            veri.tanklar = temizle(veri.tanklar);
            veri.healerlar = temizle(veri.healerlar);
            veri.dpsler = temizle(veri.dpsler);

            if (rol === 'tank') veri.tanklar.push(katilimciMetni);
            if (rol === 'heal') veri.healerlar.push(katilimciMetni);
            if (rol === 'dps') veri.dpsler.push(katilimciMetni);

            raidHafizasi.set(mesajId, veri);

            const tankMetin = veri.tanklar.length > 0 ? veri.tanklar.join('\n') : '⚠️ Kadro Boş';
            const healMetin = veri.healerlar.length > 0 ? veri.healerlar.join('\n') : '⚠️ Kadro Boş';
            const dpsMetin = veri.dpsler.length > 0 ? veri.dpsler.join('\n') : '⚠️ Kadro Boş';

            const maviTiklanabilirBaslik = `[${veri.zindan.toUpperCase()} RUNU](https://discord.com)`;

            const guncelEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('ASHES OF ANKA RAID OLUŞTURUCU')
                .setDescription(`## ${maviTiklanabilirBaslik}\n\n<:iconclock:1506322705941794967> **TARİH:**\n ${veri.tarih}\n\n<:icondesc:1506323019323150436> **AÇIKLAMA:**\n ${veri.aciklama}`)
                .addFields(
                    { name: `<:klastanks:1508412246081015970> TANK (${veri.tanklar.length})`, value: tankMetin, inline: true },
                    { name: `<:klasheals:1508412311537455205> HEALER (${veri.healerlar.length})`, value: healMetin, inline: true },
                    { name: `<:klasdpss:1508412362099527751> DPS (${veri.dpsler.length})`, value: dpsMetin, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Ashes of Anka Raid Sistemi' });

            const anaKanal = interaction.channel;
            const anaMesaj = await anaKanal.messages.fetch(mesajId);
            await anaMesaj.edit({ embeds: [guncelEmbed] });

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
    raidAutocompleteYonet, 
    raidManuelOyuncuEkle 
};