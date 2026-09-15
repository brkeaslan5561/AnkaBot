const crypto = require('crypto');
const path = require('path');
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { JsonStore } = require('./storage');
const {
    t,
    languageForInteraction,
    resolveRaidTemplateText,
    formatDiscordTimestamp
} = require('./localization');
const { TranslationService } = require('./translation_service');
const { getRaid, getRecentRaids } = require('./raid');

const announcementStore = new JsonStore(
    path.join(__dirname, 'announcements.json'),
    { version: 1, announcements: {} }
);
const translationService = new TranslationService();

const announcementCommand = new SlashCommandBuilder()
    .setName('announcement')
    .setNameLocalizations({ tr: 'duyuru' })
    .setDescription('Create a bilingual raid announcement.')
    .setDescriptionLocalizations({ tr: 'İki dilli raid duyurusu oluşturur.' })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option => option
        .setName('raid')
        .setDescription('Raid to link (optional)')
        .setDescriptionLocalizations({ tr: 'Bağlanacak raid (isteğe bağlı)' })
        .setAutocomplete(true)
        .setRequired(false));

function newId() {
    return crypto.randomBytes(9).toString('base64url');
}

function saveAnnouncement(record) {
    announcementStore.data.announcements[record.id] = record;
    announcementStore.save();
    return record;
}

function getAnnouncement(id) {
    return announcementStore.data.announcements?.[String(id)] || null;
}

function updateAnnouncement(id, changes) {
    const current = getAnnouncement(id);
    if (!current) return null;
    return saveAnnouncement({ ...current, ...changes, updatedAt: new Date().toISOString() });
}

function privatePayload(payload) {
    return { ...payload, flags: [64] };
}

function officerCanManage(interaction) {
    return Boolean(interaction.guildId && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function ownsDraft(interaction, draft) {
    return Boolean(draft && draft.status === 'draft' && String(draft.createdBy) === String(interaction.user.id));
}

function safePingLabel(ping) {
    if (ping === 'everyone') return '@\u200beveryone';
    if (ping === 'here') return '@\u200bhere';
    return '—';
}

function textModal(draft, language, uiLanguage, initial = false) {
    const isTurkish = language === 'tr';
    const modal = new ModalBuilder()
        .setCustomId(`announcement_modal_${language}_${draft.id}`)
        .setTitle(t(uiLanguage, initial ? 'announcement.modal_title' : isTurkish ? 'announcement.edit_tr_title' : 'announcement.edit_en_title'));
    const input = new TextInputBuilder()
        .setCustomId('announcement_text')
        .setLabel(t(uiLanguage, isTurkish ? 'announcement.turkish_label' : 'announcement.english_label'))
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(1)
        .setMaxLength(1600)
        .setRequired(true);
    const current = isTurkish ? draft.turkishText : draft.englishText;
    if (current) input.setValue(String(current).slice(0, 1600));
    else if (isTurkish) input.setPlaceholder(t(uiLanguage, 'announcement.turkish_placeholder').slice(0, 100));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
}

function raidForDraft(draft) {
    return draft.raidId ? getRaid(draft.raidId) : null;
}

function resolvedVersions(draft) {
    const raid = raidForDraft(draft) || {};
    return {
        tr: resolveRaidTemplateText(draft.turkishText || '', raid, draft.raidId),
        en: resolveRaidTemplateText(draft.englishText || '', raid, draft.raidId)
    };
}

function draftEmbeds(draft, uiLanguage) {
    const raid = raidForDraft(draft);
    const versions = resolvedVersions(draft);
    const raidValue = raid
        ? `**${raid.zindan || raid.zindanKodu}**\n${formatDiscordTimestamp(raid.unixZamani, 'F')} · ${formatDiscordTimestamp(raid.unixZamani, 'R')}`
        : t(uiLanguage, 'announcement.no_raid');
    const summary = new EmbedBuilder()
        .setColor(draft.translationError ? '#E09F3E' : '#1D8BD1')
        .setTitle(t(uiLanguage, 'announcement.preview_title'))
        .addFields(
            { name: t(uiLanguage, 'announcement.raid'), value: raidValue },
            { name: t(uiLanguage, 'announcement.ping'), value: safePingLabel(draft.ping) }
        );
    if (draft.translationError) summary.setFooter({ text: t(uiLanguage, 'announcement.translation_failed', { reason: draft.translationError }).slice(0, 2048) });
    const turkish = new EmbedBuilder().setColor('#E30A17').setTitle(t(uiLanguage, 'announcement.turkish')).setDescription(versions.tr || '—');
    const english = new EmbedBuilder().setColor('#1D4ED8').setTitle(t(uiLanguage, 'announcement.english')).setDescription(versions.en || t(uiLanguage, 'announcement.english_missing'));
    return [summary, turkish, english];
}

function pingMenu(draft, uiLanguage) {
    return new StringSelectMenuBuilder()
        .setCustomId(`announcement_ping_${draft.id}`)
        .setPlaceholder(t(uiLanguage, 'announcement.ping_placeholder'))
        .addOptions(
            { label: t(uiLanguage, 'announcement.ping_here'), value: 'here', description: t(uiLanguage, 'announcement.ping_here_description'), default: draft.ping === 'here' },
            { label: t(uiLanguage, 'announcement.ping_everyone'), value: 'everyone', description: t(uiLanguage, 'announcement.ping_everyone_description'), default: draft.ping === 'everyone' },
            { label: t(uiLanguage, 'announcement.ping_none'), value: 'none', description: t(uiLanguage, 'announcement.ping_none_description'), default: draft.ping === 'none' }
        );
}

function draftComponents(draft, uiLanguage) {
    const first = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`announcement_edittr_${draft.id}`).setLabel(t(uiLanguage, 'announcement.edit_turkish')).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`announcement_editen_${draft.id}`).setLabel(t(uiLanguage, 'announcement.edit_english')).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`announcement_raid_${draft.id}`).setLabel(t(uiLanguage, 'announcement.select_raid')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`announcement_suggest_${draft.id}`).setLabel(t(uiLanguage, 'announcement.suggestions')).setStyle(ButtonStyle.Secondary)
    );
    const second = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`announcement_preview_${draft.id}`).setLabel(t(uiLanguage, 'announcement.preview')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`announcement_publish_${draft.id}`).setLabel(t(uiLanguage, 'announcement.publish')).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`announcement_cancel_${draft.id}`).setLabel(t(uiLanguage, 'common.cancel')).setStyle(ButtonStyle.Danger)
    );
    if (draft.translationError) {
        second.components.unshift(new ButtonBuilder().setCustomId(`announcement_retry_${draft.id}`).setLabel(t(uiLanguage, 'announcement.translation_retry')).setStyle(ButtonStyle.Primary));
    }
    return [first, new ActionRowBuilder().addComponents(pingMenu(draft, uiLanguage)), second];
}

function draftPayload(draft, uiLanguage, notice = null) {
    return { content: notice || null, embeds: draftEmbeds(draft, uiLanguage), components: draftComponents(draft, uiLanguage) };
}

function languageMenu(customId, uiLanguage) {
    return new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(t('en', 'language.placeholder'))
        .addOptions(
            { label: t('en', 'language.automatic'), value: 'auto', emoji: '🌐' },
            { label: 'Türkçe', value: 'tr', emoji: '🇹🇷' },
            { label: 'English', value: 'en', emoji: '🇬🇧' }
        );
}

function escapeMassMentions(text) {
    return String(text || '').replace(/@(here|everyone)/gi, '@\u200b$1');
}

function publishedText(record, language, raidOverride = null) {
    const raid = raidOverride || (record.raidId ? getRaid(record.raidId) : null);
    const source = language === 'tr' ? record.turkishText : record.englishText;
    return escapeMassMentions(resolveRaidTemplateText(source, raid || {}, record.raidId) || '—');
}

function buildPublishedMessagePayload(record, language, raidOverride = null) {
    const pingText = record.ping === 'here' ? '@here' : record.ping === 'everyone' ? '@everyone' : '';
    const body = publishedText(record, language, raidOverride);
    const languageHint = `-# ${t('en', 'announcement.version_footer')}`;
    return {
        content: [pingText, body, languageHint].filter(Boolean).join('\n\n'),
        components: [new ActionRowBuilder().addComponents(languageMenu(`announcement_language_${record.id}`, language))],
        allowedMentions: pingText ? { parse: ['everyone'] } : { parse: [] }
    };
}

function recentRaidOptions(guildId, uiLanguage) {
    return getRecentRaids({ guildId, limit: 10 }).map(({ id, raid }) => ({
        label: String(raid.zindan || raid.zindanKodu || 'Raid').slice(0, 100),
        value: String(id),
        description: `${formatDiscordTimestamp(raid.unixZamani, 'f')} · ${formatDiscordTimestamp(raid.unixZamani, 'R')}`.slice(0, 100)
    }));
}

function suggestionMenu(draft, uiLanguage) {
    return new StringSelectMenuBuilder()
        .setCustomId(`announcement_suggestions_${draft.id}`)
        .setPlaceholder(t(uiLanguage, 'announcement.suggestion_placeholder'))
        .setMinValues(1)
        .setMaxValues(3)
        .addOptions(
            { label: t(uiLanguage, 'announcement.suggestion.early'), value: 'early' },
            { label: t(uiLanguage, 'announcement.suggestion.mechanics'), value: 'mechanics' },
            { label: t(uiLanguage, 'announcement.suggestion.requirements'), value: 'requirements' }
        );
}

async function translateDraft(draft) {
    try {
        const englishText = await translationService.translateTurkishToEnglish(draft.turkishText);
        return updateAnnouncement(draft.id, { englishText, translationError: null });
    } catch (error) {
        console.error(`Announcement translation failed (${draft.id}):`, error);
        return updateAnnouncement(draft.id, { translationError: error.message || 'Unknown translation error' });
    }
}

async function handleAnnouncementAutocomplete(interaction) {
    const focused = String(interaction.options.getFocused() || '').toLowerCase();
    const choices = getRecentRaids({ guildId: interaction.guildId, limit: 25 })
        .map(({ id, raid }) => ({
            name: `${raid.zindan || raid.zindanKodu} | ${formatDiscordTimestamp(raid.unixZamani, 'f')}`.slice(0, 100),
            value: String(id)
        }))
        .filter(choice => !focused || choice.name.toLowerCase().includes(focused));
    return interaction.respond(choices).catch(error => console.error('Announcement autocomplete failed:', error.message));
}

async function beginAnnouncement(interaction) {
    const uiLanguage = languageForInteraction(interaction);
    if (!officerCanManage(interaction)) return interaction.reply(privatePayload({ content: t(uiLanguage, 'common.no_permission') }));
    const requestedRaidId = interaction.options.getString('raid');
    const raid = requestedRaidId ? getRaid(requestedRaidId) : null;
    const id = newId();
    const now = new Date().toISOString();
    const draft = saveAnnouncement({
        id,
        status: 'draft',
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        messageId: null,
        raidId: raid ? String(requestedRaidId) : null,
        createdBy: interaction.user.id,
        turkishText: '',
        englishText: '',
        ping: 'here',
        translationError: null,
        createdAt: now,
        updatedAt: now
    });
    return interaction.showModal(textModal(draft, 'tr', uiLanguage, true));
}

async function handleTextModal(interaction) {
    const [, , language, id] = interaction.customId.split('_');
    const uiLanguage = languageForInteraction(interaction);
    let draft = getAnnouncement(id);
    if (!ownsDraft(interaction, draft)) return interaction.reply(privatePayload({ content: t(uiLanguage, draft ? 'announcement.owner_only' : 'announcement.not_found') }));
    if (!officerCanManage(interaction)) return interaction.reply(privatePayload({ content: t(uiLanguage, 'common.no_permission') }));
    const text = interaction.fields.getTextInputValue('announcement_text').trim();
    if (language === 'en') {
        await interaction.deferUpdate();
        draft = updateAnnouncement(id, { englishText: text, translationError: null });
        return interaction.editReply(draftPayload(draft, uiLanguage));
    }
    const isInitial = !draft.turkishText;
    draft = updateAnnouncement(id, { turkishText: text, translationError: null });
    if (isInitial) await interaction.deferReply(privatePayload({ content: t(uiLanguage, 'announcement.translating') }));
    else await interaction.deferUpdate();
    draft = await translateDraft(draft);
    const notice = draft.translationError
        ? t(uiLanguage, 'announcement.translation_failed', { reason: draft.translationError })
        : null;
    return interaction.editReply(draftPayload(draft, uiLanguage, notice));
}

async function publishDraft(interaction, draft, uiLanguage) {
    if (!draft.raidId || !raidForDraft(draft)) return interaction.update(draftPayload(draft, uiLanguage, t(uiLanguage, 'announcement.raid_required')));
    if (!draft.englishText) return interaction.update(draftPayload(draft, uiLanguage, t(uiLanguage, 'announcement.english_required')));
    await interaction.deferUpdate();
    try {
        const channel = await interaction.client.channels.fetch(draft.channelId);
        if (!channel?.send) throw new Error('Announcement channel is unavailable.');
        const sharedLanguage = uiLanguage;
        const pingText = draft.ping === 'here' ? '@here' : draft.ping === 'everyone' ? '@everyone' : '';
        if (pingText) {
            const officerCanMention = interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone);
            const botCanMention = channel.permissionsFor?.(interaction.client.user)?.has(PermissionFlagsBits.MentionEveryone);
            if (!officerCanMention || !botCanMention) {
                return interaction.editReply(draftPayload(draft, uiLanguage, t(uiLanguage, 'announcement.mass_mention_forbidden')));
            }
        }
        const publishedPayload = buildPublishedMessagePayload(draft, sharedLanguage, raidForDraft(draft));
        if (publishedPayload.content.length > 2000) {
            return interaction.editReply(draftPayload(draft, uiLanguage, t(uiLanguage, 'announcement.too_long')));
        }
        const message = await channel.send(publishedPayload);
        draft = updateAnnouncement(draft.id, {
            status: 'published',
            messageId: message.id,
            publishedAt: new Date().toISOString()
        });
        return interaction.editReply({
            content: t(uiLanguage, 'announcement.published', { url: message.url }),
            embeds: [],
            components: []
        });
    } catch (error) {
        console.error(`Announcement publish failed (${draft.id}):`, error);
        return interaction.editReply(draftPayload(draft, uiLanguage, `${t(uiLanguage, 'common.error')} ${error.message}`));
    }
}

async function handleAnnouncementComponent(interaction) {
    const parts = interaction.customId.split('_');
    const action = parts[1];
    const id = parts[2];
    let uiLanguage = languageForInteraction(interaction);

    if (action === 'language') {
        const record = getAnnouncement(id);
        if (!record || record.status !== 'published') return interaction.reply(privatePayload({ content: t(uiLanguage, 'announcement.not_found') }));
        const selected = interaction.values[0];
        uiLanguage = selected === 'tr' || selected === 'en'
            ? selected
            : languageForInteraction(interaction);
        const label = selected === 'auto' ? t(uiLanguage, 'language.auto_name') : selected === 'tr' ? 'Türkçe' : 'English';
        const version = publishedText(record, uiLanguage);
        const saved = t(uiLanguage, 'language.saved', { language: label });
        const content = `${saved}\n\n${version}`;
        return interaction.reply(privatePayload({
            content: content.length <= 2000
                ? content
                : version.length <= 2000
                    ? version
                    : t(uiLanguage, 'announcement.too_long')
        }));
    }

    let draft = getAnnouncement(id);
    if (!ownsDraft(interaction, draft)) return interaction.reply(privatePayload({ content: t(uiLanguage, draft ? 'announcement.owner_only' : 'announcement.not_found') }));
    if (!officerCanManage(interaction)) return interaction.reply(privatePayload({ content: t(uiLanguage, 'common.no_permission') }));

    if (action === 'edittr') return interaction.showModal(textModal(draft, 'tr', uiLanguage));
    if (action === 'editen') return interaction.showModal(textModal(draft, 'en', uiLanguage));
    if (action === 'cancel') {
        updateAnnouncement(id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
        return interaction.update({ content: t(uiLanguage, 'announcement.cancelled'), embeds: [], components: [] });
    }
    if (action === 'retry') {
        await interaction.deferUpdate();
        draft = await translateDraft(draft);
        const notice = draft.translationError ? t(uiLanguage, 'announcement.translation_failed', { reason: draft.translationError }) : null;
        return interaction.editReply(draftPayload(draft, uiLanguage, notice));
    }
    if (action === 'raid') {
        const options = recentRaidOptions(draft.guildId, uiLanguage);
        if (!options.length) return interaction.update(draftPayload(draft, uiLanguage, t(uiLanguage, 'announcement.raid_required')));
        const menu = new StringSelectMenuBuilder().setCustomId(`announcement_raidselect_${id}`).setPlaceholder(t(uiLanguage, 'announcement.raid_placeholder')).addOptions(options);
        return interaction.update({ content: null, embeds: draftEmbeds(draft, uiLanguage), components: [new ActionRowBuilder().addComponents(menu)] });
    }
    if (action === 'raidselect') {
        const raid = getRaid(interaction.values[0]);
        if (!raid) return interaction.update(draftPayload(draft, uiLanguage, t(uiLanguage, 'raid.manual.not_found')));
        draft = updateAnnouncement(id, { raidId: String(interaction.values[0]) });
        return interaction.update(draftPayload(draft, uiLanguage, t(uiLanguage, 'announcement.raid_selected', { raidName: raid.zindan || raid.zindanKodu })));
    }
    if (action === 'suggest') {
        return interaction.update({ content: null, embeds: draftEmbeds(draft, uiLanguage), components: [new ActionRowBuilder().addComponents(suggestionMenu(draft, uiLanguage))] });
    }
    if (action === 'suggestions') {
        const trLines = interaction.values.map(value => t('tr', `announcement.suggestion.${value}`));
        const enLines = interaction.values.map(value => t('en', `announcement.suggestion.${value}`));
        draft = updateAnnouncement(id, {
            turkishText: [draft.turkishText, ...trLines].filter(Boolean).join('\n\n'),
            englishText: [draft.englishText, ...enLines].filter(Boolean).join('\n\n')
        });
        return interaction.update(draftPayload(draft, uiLanguage, t(uiLanguage, 'announcement.suggestion_added', { count: interaction.values.length })));
    }
    if (action === 'ping') {
        const ping = interaction.values[0];
        if (ping !== 'none' && !interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone)) {
            return interaction.update(draftPayload(draft, uiLanguage, t(uiLanguage, 'announcement.mass_mention_forbidden')));
        }
        draft = updateAnnouncement(id, { ping });
        return interaction.update(draftPayload(draft, uiLanguage));
    }
    if (action === 'publish') {
        if (!draft.raidId || !raidForDraft(draft)) return interaction.update(draftPayload(draft, uiLanguage, t(uiLanguage, 'announcement.raid_required')));
        if (!draft.englishText) return interaction.update(draftPayload(draft, uiLanguage, t(uiLanguage, 'announcement.english_required')));
        const channelMention = `<#${draft.channelId}>`;
        const prompt = t(uiLanguage, 'announcement.confirm_prompt', { channel: channelMention, ping: safePingLabel(draft.ping) });
        return interaction.update({
            content: prompt,
            embeds: draftEmbeds(draft, uiLanguage),
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`announcement_confirm_${id}`).setLabel(t(uiLanguage, 'announcement.confirm_publish')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`announcement_preview_${id}`).setLabel(t(uiLanguage, 'common.back')).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`announcement_cancel_${id}`).setLabel(t(uiLanguage, 'common.cancel')).setStyle(ButtonStyle.Secondary)
            )]
        });
    }
    if (action === 'confirm') return publishDraft(interaction, draft, uiLanguage);
    return interaction.update(draftPayload(draft, uiLanguage));
}

async function handleAnnouncementInteraction(interaction) {
    try {
        if (interaction.isAutocomplete() && interaction.commandName === 'announcement') return handleAnnouncementAutocomplete(interaction);
        if (interaction.isChatInputCommand() && interaction.commandName === 'announcement') return beginAnnouncement(interaction);
        if (interaction.isModalSubmit() && interaction.customId.startsWith('announcement_modal_')) return handleTextModal(interaction);
        if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('announcement_')) {
            return handleAnnouncementComponent(interaction);
        }
        return null;
    } catch (error) {
        console.error('Announcement interaction failed:', error);
        const uiLanguage = languageForInteraction(interaction);
        const payload = { content: t(uiLanguage, 'common.error'), embeds: [], components: [] };
        if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(replyError => console.error('Announcement error reply failed:', replyError));
        return interaction.reply(privatePayload(payload)).catch(replyError => console.error('Announcement error reply failed:', replyError));
    }
}

module.exports = {
    announcementCommand,
    handleAnnouncementInteraction,
    handleAnnouncementAutocomplete,
    languageMenu,
    publishedText,
    buildPublishedMessagePayload,
    getAnnouncement,
    _test: {
        safePingLabel,
        resolvedVersions,
        draftEmbeds,
        escapeMassMentions,
        publishedText,
        buildPublishedMessagePayload,
        announcementStore,
        translationService
    }
};
