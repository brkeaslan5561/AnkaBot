const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { REST } = require('@discordjs/rest');
const config = require('./config.json');
const fs = require('fs');
const { raidKomutu, raidSisteminiYonet, raidOyuncuEkleKomutu, raidDuzenleKomutu, raidDuzenleKomutuYonet, raidAutocompleteYonet, raidManuelOyuncuEkle, raidKapanisTakibiniBaslat } = require('./raid.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// Zindan listesini okuyan fonksiyon (Eski sistem için)
function zindanListesiniGetir() {
    try {
        if (fs.existsSync('./zindan_listesi.json')) {
            return JSON.parse(fs.readFileSync('./zindan_listesi.json', 'utf8'));
        }
    } catch (err) {
        console.error("Zindan listesi okunurken hata oluştu:", err);
    }
    return [];
}

// Komut Tanımlamaları
const commands = [
    new SlashCommandBuilder()
        .setName('rapor')
        .setDescription('Günlük lonca görevi ve kaynak raporu girer.')
        .addAttachmentOption(option =>
            option.setName('gorsel')
                .setDescription('Raporunuza eklemek istediğiniz ekran görüntüsü (Opsiyonel)')
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('zindan-ihtiyacı')
        .setDescription('Oyuncuların zindan ve ekipman ihtiyaçlarını listeler.'),

    raidKomutu,
    raidOyuncuEkleKomutu,
    raidDuzenleKomutu
].map(command => command.toJSON());

const userSessions = new Map();
const zindanSecimHafizasi = new Map(); 
let zindanVerisi = {};

try {
    if (fs.existsSync('./zindanlar.json')) {
        zindanVerisi = JSON.parse(fs.readFileSync('./zindanlar.json', 'utf8'));
    }
} catch (err) {
    console.error("Veri dosyası okunurken hata oluştu:", err);
}

function gosterIlerleme(toplam, tamamlanan) {
    if (toplam === 0) return '`░░░░░░░░░░` %0';
    const oran = tamamlanan / toplam;
    const barSayisi = Math.round(oran * 10);
    const yuzde = Math.round(oran * 100);
    const bar = '█'.repeat(barSayisi) + '░'.repeat(10 - barSayisi);
    return `\`${bar}\` %${yuzde}`;
}

// DeprecationWarning uyarısını engellemek için clientReady olarak güncellendi
client.once('clientReady', async () => {
    console.log(`🚀 ${client.user.tag} olarak giriş yapıldı!`);
    const rest = new REST({ version: '10' }).setToken(config.token);
    try {
        await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
        console.log('✅ Eğik çizgi (Slash) komutları başarıyla yüklendi!');
    } catch (error) {
        console.error(error);
    }

    await raidKapanisTakibiniBaslat(client);
});

// ANA ETKİLEŞİM DİNLEYİCİSİ
client.on('interactionCreate', async interaction => {

   // --- YENİ AUTOCOMPLETE DİNLEYİCİSİ ---
    if (interaction.isAutocomplete() && (interaction.commandName === 'raid-oyuncu-ekle' || interaction.commandName === 'düzenle')) {
        return await raidAutocompleteYonet(interaction);
    }

    // --- YENİ MANUEL EKLEME SLASH KOMUTU YÖNLENDİRMESİ ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'raid-oyuncu-ekle') {
        return await raidManuelOyuncuEkle(interaction);
    }

    // --- RAID DÜZENLEME SLASH KOMUTU YÖNLENDİRMESİ ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'düzenle') {
        return await raidDuzenleKomutuYonet(interaction);
    }
    //----------------------------------------------------
    // RAID SİSTEMİ YÖNLENDİRMESİ (TÜM ETKİLEŞİMLERİ KAPSAYACAK ŞEKİLDE DÜZELTİLDİ)
    //----------------------------------------------------
    const isRaidInteraction = 
        (interaction.isChatInputCommand() && interaction.commandName === 'raid-oluştur') || 
        (interaction.isModalSubmit() && interaction.customId.startsWith('raid_')) ||
        (interaction.isButton() && interaction.customId.startsWith('raid_')) ||
        (interaction.isStringSelectMenu() && interaction.customId.startsWith('raid_'));

    if (isRaidInteraction) {
        // HATA BURADAYDI: Başına 'await' eklendi, böylece Discord işlem bitene kadar bekleyecek.
        return await raidSisteminiYonet(interaction);
    }

    //----------------------------------------------------
    // ESKİ SİSTEM: SLASH KOMUTLARI (Rapor & Zindan İhtiyacı)
    //----------------------------------------------------
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'rapor') {
            const gorsel = interaction.options.getAttachment('gorsel');
            userSessions.set(interaction.user.id, gorsel ? gorsel.url : null);
            const modal = new ModalBuilder().setCustomId('gorev_modal').setTitle('Anka Lonca Görev Raporu');
            const karakterInput = new TextInputBuilder().setCustomId('karakter_sayisi').setLabel('Karakter Sayısı').setStyle(TextInputStyle.Short).setRequired(true);
            const notInput = new TextInputBuilder().setCustomId('gorev_notu').setLabel('Kaynak Durumu ve Notlar').setStyle(TextInputStyle.Paragraph).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(karakterInput), new ActionRowBuilder().addComponents(notInput));
            return await interaction.showModal(modal);
        }

        if (interaction.commandName === 'zindan-ihtiyacı') {
            const modal = new ModalBuilder().setCustomId('zindan_isim_modal').setTitle('Oyuncu Girişi');
            const isimInput = new TextInputBuilder().setCustomId('oyuncu_ismi').setLabel('Oyuncu Adı / Nickname').setStyle(TextInputStyle.Short).setPlaceholder('Örn: Berke').setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(isimInput));
            return await interaction.showModal(modal);
        }
    }

    //----------------------------------------------------
    // ESKİ SİSTEM: MODAL SUBMITLER
    //----------------------------------------------------
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'gorev_modal') {
            await interaction.deferReply({ flags: [64] });
            const karakter = interaction.fields.getTextInputValue('karakter_sayisi');
            const notlar = interaction.fields.getTextInputValue('gorev_notu');
            const gorselUrl = userSessions.get(interaction.user.id);
            userSessions.delete(interaction.user.id);

            const embed = new EmbedBuilder().setColor('#ff4500').setTitle('📝 YENİ LONCA GÖREV RAPORU').addFields({ name: 'RAPORLAYAN YÖNETİCİ', value: `${interaction.user}`, inline: false } , { name: 'KARAKTER SAYISI', value: `**${karakter}**`, inline: false }, { name: 'NOTLAR', value: notlar }).setTimestamp().setFooter({ text: 'Ashes of Anka Yönetim Sistemi' });
            if (gorselUrl) embed.setImage(gorselUrl);
            const logChannel = await interaction.guild.channels.fetch(config.logChannelId);
            if (logChannel) { 
                await logChannel.send({ embeds: [embed] }); 
                await interaction.editReply({ content: '✅ Raporunuz başarıyla kanala iletildi!' }); 
            }
            return;
        }

        if (interaction.customId === 'zindan_isim_modal') {
            const oyuncu = interaction.fields.getTextInputValue('oyuncu_ismi');
            const rolMenu = new StringSelectMenuBuilder()
                .setCustomId(`rol_secim_${oyuncu}`)
                .setPlaceholder('Oyuncunun sınıf rolünü seçin...')
                .addOptions([
                    { label: 'TANK', value: 'tank', description: 'Tank ekipmanlarının düştüğü zindanları listeler.' },
                    { label: 'HEALER', value: 'heal', description: 'Healer ekipmanlarının düştüğü zindanları listeler.' },
                    { label: 'DPS', value: 'dps', description: 'DPS ekipmanlarının düştüğü zindanları listeler.' }
                ]);
            const row = new ActionRowBuilder().addComponents(rolMenu);
            return await interaction.reply({ content: `👤 **${oyuncu}** hangi rolde oynuyor?`, components: [row], flags: [64] });
        }

        if (interaction.customId === 'zindan_not_modal') {
            await interaction.deferReply({ flags: [64] });
            const hafiza = zindanSecimHafizasi.get(interaction.user.id);
            if (!hafiza) return interaction.editReply({ content: '❌ Seçim hafızası zaman aşımına uğradı veya bulunamadı.' });
            zindanSecimHafizasi.delete(interaction.user.id);

            const { oyuncu, rol, secilenZindanlar } = hafiza;
            let yoneticiNotu = interaction.fields.getTextInputValue('yonetici_notu') || 'Yok';

            const guncelZindanListesi = zindanListesiniGetir();
            const zindanListesi = {};
            secilenZindanlar.forEach(z => {
                const bul = guncelZindanListesi.find(x => x.value === z);
                zindanListesi[z] = { label: bul ? bul.label : z, tamamlandi: false };
            });

            let aciklama = `**OYUNCU:**\n **${oyuncu.toUpperCase()} (${rol.toUpperCase()})**\n\n`;
            aciklama += `**YÖNETİCİ NOTU:**\n ${yoneticiNotu}\n\n`;
            secilenZindanlar.forEach(z => { aciklama += `🔴 **${zindanListesi[z].label}**\n`; });
            aciklama += `\n📊 **İlerleme Durumu:**\n${gosterIlerleme(secilenZindanlar.length, 0)}`;

            const embed = new EmbedBuilder().setColor('#e74c3c').setTitle('▶ ZİNDAN İHTIYAÇ KAYDI').setDescription(aciklama).setTimestamp().setFooter({ text: 'Ashes of Anka Yönetimi' });
            const guncelleButon = new ButtonBuilder().setCustomId(`zindan_guncelle_buton`).setLabel('⚙️ İhtiyaçları Güncelle (Tik Kaldır)').setStyle(ButtonStyle.Primary);
            const hepsiniBitirButon = new ButtonBuilder().setCustomId(`zindan_hepsini_bitir`).setLabel('✨ Hepsini Tamamla').setStyle(ButtonStyle.Success);
            const row = new ActionRowBuilder().addComponents(guncelleButon, hepsiniBitirButon);

            const mesaj = await interaction.channel.send({ embeds: [embed], components: [row] });
            zindanVerisi[mesaj.id] = { oyuncu, rol, not: yoneticiNotu, zindanlar: zindanListesi };
            fs.writeFileSync('./zindanlar.json', JSON.stringify(zindanVerisi, null, 2));

            return await interaction.editReply({ content: '✅ Zindan ihtiyaç kartı başarıyla oluşturuldu!', components: [] });
        }
    }

    //----------------------------------------------------
    // ESKİ SİSTEM: SELECTION MENUS
    //----------------------------------------------------
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('rol_secim_')) {
            await interaction.deferUpdate();
            const oyuncu = interaction.customId.split('_')[2];
            const secilenRol = interaction.values[0];
            const tumZindanlar = zindanListesiniGetir();
            const filtrelenmişZindanlar = tumZindanlar.filter(z => z.roller && z.roller.includes(secilenRol));

            if (filtrelenmişZindanlar.length === 0) {
                return interaction.editReply({ content: `❌ **${secilenRol.toUpperCase()}** için zindan bulunamadı!`, components: [] });
            }

            const zindanMenu = new StringSelectMenuBuilder()
                .setCustomId(`zindan_secim_${oyuncu}_${secilenRol}`)
                .setPlaceholder(`${secilenRol.toUpperCase()} zindanlarından seçin...`)
                .setMinValues(1)
                .setMaxValues(filtrelenmişZindanlar.length)
                .addOptions(filtrelenmişZindanlar);

            const row = new ActionRowBuilder().addComponents(zindanMenu);
            return await interaction.editReply({ content: `🎯 **${oyuncu}** için zindanları seçin:`, components: [row] });
        }

        if (interaction.customId.startsWith('zindan_secim_')) {
            const parse = interaction.customId.split('_');
            const oyuncu = parse[2]; const rol = parse[3];
            zindanSecimHafizasi.set(interaction.user.id, { oyuncu, rol, secilenZindanlar: interaction.values });

            const modal = new ModalBuilder().setCustomId('zindan_not_modal').setTitle('Yönetici Notu Ekle');
            const notInput = new TextInputBuilder().setCustomId('yonetici_notu').setLabel('Not (Opsiyonel)').setStyle(TextInputStyle.Paragraph).setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(notInput));
            return await interaction.showModal(modal);
        }

        if (interaction.customId.startsWith('zindan_tamamla_islem_')) {
            await interaction.deferUpdate();
            const mesajId = interaction.customId.split('_')[3];
            const kayit = zindanVerisi[mesajId]; if (!kayit) return;

            interaction.values.forEach(z => { if (kayit.zindanlar[z]) kayit.zindanlar[z].tamamlandi = true; });
            zindanVerisi[mesajId] = kayit; fs.writeFileSync('./zindanlar.json', JSON.stringify(zindanVerisi, null, 2));

            let toplam = Object.keys(kayit.zindanlar).length; let tamamlananSayisi = 0;
            let yeniAciklama = `**OYUNCU:**\n ${kayit.oyuncu.toUpperCase()} (${kayit.rol.toUpperCase()})\n\n**YÖNETİCİ NOTU:**\n ${kayit.not || 'Yok'}\n\n`;

            Object.keys(kayit.zindanlar).forEach(k => {
                if (kayit.zindanlar[k].tamamlandi) { yeniAciklama += `🟢 ~~**${kayit.zindanlar[k].label}** - Tamamlandı!~~\n`; tamamlananSayisi++; }
                else { yeniAciklama += `🔴 **${kayit.zindanlar[k].label}**\n`; }
            });
            yeniAciklama += `\n📊 **İlerleme Durumu:**\n${gosterIlerleme(toplam, tamamlananSayisi)}`;

            const guncelEmbed = new EmbedBuilder().setColor('#2ecc71').setTitle(toplam === tamamlananSayisi ? '▶️ 🟢 Tüm İhtiyaçlar Tamamlandı!' : '▶ ZİNDAN İHTIYAÇ KAYDI').setDescription(yeniAciklama).setTimestamp();
            
            let finalComponents = [];
            if (toplam === tamamlananSayisi) {
                const bittiButon = new ButtonBuilder().setCustomId('bitti_gosterge').setLabel('✨ Görev Tamamlandı').setStyle(ButtonStyle.Secondary).setDisabled(true);
                finalComponents = [new ActionRowBuilder().addComponents(bittiButon)];
            } else {
                finalComponents = interaction.message.components.map(row => ActionRowBuilder.from(row));
            }

            const anaMesaj = await interaction.channel.messages.fetch(mesajId);
            return await anaMesaj.edit({ embeds: [guncelEmbed], components: finalComponents });
        }
    }

    //----------------------------------------------------
    // ESKİ SİSTEM: BUTONLAR
    //----------------------------------------------------
    if (interaction.isButton()) {
        if (interaction.customId === 'zindan_guncelle_buton') {
            const kayit = zindanVerisi[interaction.message.id];
            if (!kayit) return interaction.reply({ content: '❌ Kayıt bulunamadı.', flags: [64] });
            const aktifZindanlar = [];
            Object.keys(kayit.zindanlar).forEach(k => { if (!kayit.zindanlar[k].tamamlandi) aktifZindanlar.push({ label: kayit.zindanlar[k].label, value: k }); });
            if (aktifZindanlar.length === 0) return interaction.reply({ content: '✨ Tüm ihtiyaçlar zaten bitmiş!', flags: [64] });

            const guncelMenu = new StringSelectMenuBuilder().setCustomId(`zindan_tamamla_islem_${interaction.message.id}`).setPlaceholder('Tamamlananları seçin...').setMinValues(1).setMaxValues(aktifZindanlar.length).addOptions(aktifZindanlar);
            return await interaction.reply({ components: [new ActionRowBuilder().addComponents(guncelMenu)], flags: [64] });
        }

        if (interaction.customId === 'zindan_hepsini_bitir') {
            await interaction.deferUpdate();
            const kayit = zindanVerisi[interaction.message.id]; if (!kayit) return;
            Object.keys(kayit.zindanlar).forEach(k => { kayit.zindanlar[k].tamamlandi = true; });
            zindanVerisi[interaction.message.id] = kayit; fs.writeFileSync('./zindanlar.json', JSON.stringify(zindanVerisi, null, 2));

            let yeniAciklama = `**OYUNCU:**\n ~~${kayit.oyuncu}~~\n\n**YÖNETİCİ NOTU:**\n ~~${kayit.not || 'Yok'}~~\n\n`;
            Object.keys(kayit.zindanlar).forEach(k => { yeniAciklama += `🟢 ~~**${kayit.zindanlar[k].label}** - Tamamlandı!~~\n`; });
            yeniAciklama += `\n📊 **İlerleme Durumu:**\n${gosterIlerleme(1, 1)}`;

            const guncelEmbed = new EmbedBuilder().setColor('#2ecc71').setTitle('▶️ 🟢 Tüm İhtiyaçlar Tamamlandı!').setDescription(yeniAciklama).setTimestamp();
            const bittiButon = new ButtonBuilder().setCustomId('bitti_gosterge').setLabel('✨ Görev Tamamlandı').setStyle(ButtonStyle.Secondary).setDisabled(true);
            return await interaction.message.edit({ embeds: [guncelEmbed], components: [new ActionRowBuilder().addComponents(bittiButon)] });
        }
    }
});

client.login(config.token);
