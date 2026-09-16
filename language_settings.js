const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { t, setUserLanguage, languageForInteraction, setChannelLanguage } = require('./localization');

const languageCommand = new SlashCommandBuilder()
    .setName('language').setNameLocalizations({ tr: 'dil' })
    .setDescription('Save your language preference.').setDescriptionLocalizations({ tr: 'Kişisel dil tercihinizi kaydeder.' })
    .addStringOption(option => option.setName('language').setNameLocalizations({ tr: 'dil' })
        .setDescription('Your preferred language').setDescriptionLocalizations({ tr: 'Tercih ettiğiniz dil' })
        .setRequired(true).addChoices(
            { name: 'Automatic / Otomatik', value: 'auto' },
            { name: 'Türkçe', value: 'tr' }, { name: 'English', value: 'en' }));

const channelLanguageCommand = new SlashCommandBuilder()
    .setName('channel-language').setNameLocalizations({ tr: 'kanal-dili' })
    .setDescription('Set the language of shared raid cards and announcements in this channel.')
    .setDescriptionLocalizations({ tr: 'Bu kanaldaki ortak raid kartlarının ve duyuruların dilini ayarlar.' })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false)
    .addStringOption(option => option.setName('language').setNameLocalizations({ tr: 'dil' })
        .setDescription('Shared message language').setDescriptionLocalizations({ tr: 'Ortak mesaj dili' })
        .setRequired(true).addChoices(
            { name: 'Türkçe / English', value: 'both' },
            { name: 'Türkçe', value: 'tr' }, { name: 'English', value: 'en' }));

async function handleLanguageCommand(interaction) {
    const selected = interaction.options.getString('language');
    if (interaction.commandName === 'language') {
        setUserLanguage(interaction.user.id, selected, interaction.locale);
        const language = languageForInteraction(interaction);
        const label = selected === 'auto' ? t(language, 'language.auto_name') : selected === 'tr' ? 'Türkçe' : 'English';
        return interaction.reply({ content: t(language, 'language.saved', { language: label }), flags: [64] });
    }
    const language = languageForInteraction(interaction);
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: t(language, 'common.no_permission'), flags: [64] });
    }
    setChannelLanguage(interaction.guildId, interaction.channelId, selected);
    return interaction.reply({
        content: t(language, 'language.channel_saved', { language: selected === 'both' ? 'Türkçe / English' : selected === 'tr' ? 'Türkçe' : 'English' }),
        flags: [64]
    });
}

module.exports = { languageCommand, channelLanguageCommand, handleLanguageCommand };
