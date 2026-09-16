const fs = require('fs');
const path = require('path');
const { JsonStore } = require('./storage');

const SUPPORTED_LANGUAGES = new Set(['tr', 'en']);
const DEFAULT_LANGUAGE = 'en';
const localeDirectory = path.join(__dirname, 'locales');
const preferenceStore = new JsonStore(
    path.join(__dirname, 'user_language_preferences.json'),
    { version: 1, users: {} }
);
const channelLanguageStore = new JsonStore(
    path.join(__dirname, 'channel_languages.json'),
    { version: 1, channels: {} }
);
const bundleCache = new Map();
let runtimeConfig = {};

function normalizeLanguage(language, fallback = DEFAULT_LANGUAGE) {
    const normalized = String(language || '').toLowerCase();
    return SUPPORTED_LANGUAGES.has(normalized) ? normalized : fallback;
}

function isTurkishLocale(locale) {
    const normalized = String(locale || '').toLowerCase();
    return normalized === 'tr' || normalized.startsWith('tr-');
}

function languageFromLocale(locale) {
    if (!locale) return null;
    return isTurkishLocale(locale) ? 'tr' : 'en';
}

function configureLocalization(config = {}) {
    runtimeConfig = config || {};
}

function getGuildLanguage(guildId = null) {
    const guildLanguages = runtimeConfig.guildLanguages || {};
    const configured = guildId ? guildLanguages[String(guildId)] : null;
    return normalizeLanguage(configured || runtimeConfig.defaultLanguage || process.env.ANKABOT_DEFAULT_LANGUAGE || DEFAULT_LANGUAGE, DEFAULT_LANGUAGE);
}

function getSharedLanguage(guildId = null, channelId = null) {
    const configured = channelLanguageStore.data.channels?.[String(channelId)]?.language
        || runtimeConfig.channelLanguages?.[String(channelId)]
        || runtimeConfig.guildLanguages?.[String(guildId)]
        || runtimeConfig.defaultLanguage || process.env.ANKABOT_DEFAULT_LANGUAGE || 'en';
    return ['tr', 'en', 'both'].includes(configured) ? configured : 'en';
}

function setChannelLanguage(guildId, channelId, language) {
    if (!guildId || !channelId || !['tr', 'en', 'both'].includes(language)) throw new Error('Invalid channel language.');
    channelLanguageStore.data.channels[String(channelId)] = { guildId: String(guildId), language };
    channelLanguageStore.save();
}

function loadLocaleBundle(language) {
    const code = normalizeLanguage(language);
    if (bundleCache.has(code)) return bundleCache.get(code);
    const filePath = path.join(localeDirectory, `${code}.json`);
    try {
        const bundle = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        bundleCache.set(code, bundle);
        return bundle;
    } catch (error) {
        console.error(`Locale bundle '${code}' could not be loaded:`, error.message);
        const bundle = code === DEFAULT_LANGUAGE ? {} : loadLocaleBundle(DEFAULT_LANGUAGE);
        bundleCache.set(code, bundle);
        return bundle;
    }
}

function lookup(bundle, key) {
    if (Object.prototype.hasOwnProperty.call(bundle, key)) return bundle[key];
    return String(key).split('.').reduce((value, part) => value && value[part], bundle);
}

function interpolate(template, variables = {}) {
    if (typeof template !== 'string') return '';
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
        const value = variables[key];
        return value === undefined || value === null ? match : String(value);
    });
}

function t(language, key, variables = {}) {
    if (language === 'both') {
        const tr = t('tr', key, variables);
        const en = t('en', key, variables);
        return tr === en ? tr : `${tr} / ${en}`;
    }
    const selected = normalizeLanguage(language);
    let value = lookup(loadLocaleBundle(selected), key);
    if (typeof value !== 'string' && selected !== DEFAULT_LANGUAGE) value = lookup(loadLocaleBundle(DEFAULT_LANGUAGE), key);
    if (typeof value !== 'string') {
        console.warn(`Missing localization key: ${key}`);
        return key;
    }
    return interpolate(value, variables);
}

function getUserPreference(userId) {
    if (!userId) return null;
    return preferenceStore.data.users?.[String(userId)] || null;
}

function setUserLanguage(userId, language, locale = null) {
    const normalized = String(language || '').toLowerCase();
    if (!['tr', 'en', 'auto'].includes(normalized)) throw new Error(`Unsupported language preference: ${language}`);
    if (!preferenceStore.data.users) preferenceStore.data.users = {};
    const current = preferenceStore.data.users[String(userId)] || {};
    preferenceStore.data.users[String(userId)] = {
        ...current,
        language: normalized,
        locale: locale || current.locale || null,
        updatedAt: new Date().toISOString()
    };
    preferenceStore.save();
    return preferenceStore.data.users[String(userId)];
}

function rememberInteractionLocale(userId, locale) {
    if (!userId || !locale) return;
    if (!preferenceStore.data.users) preferenceStore.data.users = {};
    const current = preferenceStore.data.users[String(userId)] || { language: 'auto' };
    if (current.locale === locale) return;
    preferenceStore.data.users[String(userId)] = {
        ...current,
        locale,
        updatedAt: current.updatedAt || new Date().toISOString(),
        localeUpdatedAt: new Date().toISOString()
    };
    preferenceStore.save();
}

function resolveUserLanguage(context = {}, fallback = DEFAULT_LANGUAGE) {
    if (SUPPORTED_LANGUAGES.has(context.language)) return context.language;
    const localeLanguage = languageFromLocale(context.locale);
    if (localeLanguage) return localeLanguage;
    return DEFAULT_LANGUAGE;
}

function languageForUser(userId, options = {}) {
    const preference = getUserPreference(userId) || {};
    return resolveUserLanguage({
        language: preference.language,
        locale: options.locale || preference.locale,
        guildLanguage: options.guildLanguage || getGuildLanguage(options.guildId)
    }, options.fallback || DEFAULT_LANGUAGE);
}

function languageForInteraction(interaction) {
    if (!interaction) return DEFAULT_LANGUAGE;
    rememberInteractionLocale(interaction.user?.id, interaction.locale);
    return languageForUser(interaction.user?.id, {
        locale: interaction.locale,
        guildId: interaction.guildId,
        guildLanguage: getGuildLanguage(interaction.guildId)
    });
}

function formatDiscordTimestamp(dateOrTimestamp, style = 'F') {
    const allowedStyles = new Set(['t', 'T', 'd', 'D', 'f', 'F', 'R']);
    if (!allowedStyles.has(style)) throw new Error(`Unsupported Discord timestamp style: ${style}`);
    let milliseconds;
    if (dateOrTimestamp instanceof Date) milliseconds = dateOrTimestamp.getTime();
    else {
        const value = Number(dateOrTimestamp);
        if (!Number.isFinite(value)) throw new Error('Invalid Discord timestamp value.');
        milliseconds = Math.abs(value) >= 1e12 ? value : value * 1000;
    }
    return `<t:${Math.floor(milliseconds / 1000)}:${style}>`;
}

function raidTemplateVariables(raid = {}, raidId = '') {
    const timestamp = Number(raid.unixZamani || raid.timestamp);
    return {
        raid_name: raid.zindan || raid.zindanKodu || '',
        raid_time: Number.isFinite(timestamp) ? formatDiscordTimestamp(timestamp, 't') : '',
        raid_date: Number.isFinite(timestamp) ? formatDiscordTimestamp(timestamp, 'F') : '',
        raid_relative: Number.isFinite(timestamp) ? formatDiscordTimestamp(timestamp, 'R') : '',
        raid_id: raidId || raid.id || ''
    };
}

function resolveRaidTemplateText(text, raid = {}, raidId = '') {
    // Backward-compatible overload used by early localization prototypes:
    // resolveRaidTemplateText(language, text, variables)
    if ((text === 'tr' || text === 'en') && typeof raid === 'string' && raidId && typeof raidId === 'object') {
        return interpolate(raid, {
            ...raidId,
            raid_name: raidId.raid_name || raidId.raidName || '',
            raid_time: raidId.raid_time || raidId.raidTime || '',
            raid_date: raidId.raid_date || raidId.raidDate || '',
            raid_relative: raidId.raid_relative || raidId.raidRelative || ''
        });
    }
    return interpolate(String(text || ''), raidTemplateVariables(raid, raidId));
}

module.exports = {
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    normalizeLanguage,
    isTurkishLocale,
    languageFromLocale,
    configureLocalization,
    getGuildLanguage,
    getSharedLanguage,
    setChannelLanguage,
    loadLocaleBundle,
    interpolate,
    t,
    getUserPreference,
    setUserLanguage,
    rememberInteractionLocale,
    resolveUserLanguage,
    languageForUser,
    languageForInteraction,
    formatDiscordTimestamp,
    raidTemplateVariables,
    resolveRaidTemplateText,
    _preferenceStore: preferenceStore,
    _channelLanguageStore: channelLanguageStore
};
