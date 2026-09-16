const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const localization = require('../localization');
const { languageCommand, channelLanguageCommand, handleLanguageCommand } = require('../language_settings');
const { _test: raid } = require('../raid');
const { handleAnnouncementInteraction, buildPublishedMessagePayload, _test: announcement } = require('../announcement');

// Use temporary stores so integration tests never touch the bot's live preferences or drafts.
function isolateStores(context) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anka-languages-'));
    const stores = [localization._preferenceStore, localization._channelLanguageStore, announcement.announcementStore];
    const snapshots = stores.map(store => ({ filePath: store.filePath, data: store.data }));
    stores.forEach((store, index) => {
        store.filePath = path.join(directory, `${index}.json`);
        store.data = JSON.parse(JSON.stringify(store.fallback));
    });
    context.after(() => {
        stores.forEach((store, index) => Object.assign(store, snapshots[index]));
        localization.configureLocalization({});
        fs.rmSync(directory, { recursive: true, force: true });
    });
}

test('language commands have valid choices and channel settings require management permission', async context => {
    isolateStores(context);
    assert.equal(languageCommand.toJSON().name_localizations.tr, 'dil');
    assert.ok(channelLanguageCommand.toJSON().default_member_permissions);
    const interaction = {
        commandName: 'channel-language', guildId: 'guild', channelId: 'channel', user: { id: 'user' }, locale: 'tr',
        options: { getString: () => 'both' }, memberPermissions: { has: () => false },
        reply: async payload => payload
    };
    const denied = await handleLanguageCommand(interaction);
    assert.match(denied.content, /yetkiniz/);
    assert.deepEqual(localization._channelLanguageStore.data.channels, {});
    interaction.memberPermissions.has = () => true;
    await handleLanguageCommand(interaction);
    localization._channelLanguageStore.reload();
    assert.equal(localization.getSharedLanguage('guild', 'channel'), 'both');
    assert.equal(localization.getSharedLanguage('guild', 'other'), 'en');
});

test('manual language survives reload and Discord changes; automatic resumes Discord detection', async context => {
    isolateStores(context);
    let selected = 'tr';
    const interaction = {
        commandName: 'language', user: { id: 'user' }, locale: 'en-US',
        options: { getString: () => selected }, reply: async payload => payload
    };
    const reply = await handleLanguageCommand(interaction);
    assert.deepEqual(reply.flags, [64]);
    localization._preferenceStore.reload();
    assert.equal(localization.languageForInteraction(interaction), 'tr');
    interaction.locale = 'de';
    assert.equal(localization.languageForInteraction(interaction), 'tr');
    selected = 'auto';
    await handleLanguageCommand(interaction);
    assert.equal(localization.languageForInteraction(interaction), 'en');
    interaction.locale = 'tr';
    assert.equal(localization.languageForInteraction(interaction), 'tr');
    assert.equal(localization.languageForUser('user'), 'tr');
});

test('channel language overrides the creator and bilingual views share the same roster', context => {
    isolateStores(context);
    localization.configureLocalization({ defaultLanguage: 'en', guildLanguages: { guild: 'tr' }, channelLanguages: { channel: 'both' } });
    const record = raid.normalizeRaid({
        guildId: 'guild', channelId: 'channel', displayLanguage: 'tr', zindan: 'Test',
        unixZamani: Math.floor(Date.now() / 1000) + 3600, tarih: '<t:2000000000:F>',
        descriptions: { tr: 'Erken gelin.', en: 'Arrive early.' }
    });
    assert.equal(raid.raidLanguage(record), 'both');
    for (const [id, name] of [['1', 'Türk oyuncu'], ['2', 'English player']]) {
        raid.registerParticipant(record, { id }, name, 'dps', 'Wizard', {});
    }
    const shared = raid.raidEmbedOlustur(record).toJSON();
    const tr = raid.raidEmbedOlustur(record, 'tr').toJSON();
    const en = raid.raidEmbedOlustur(record, 'en').toJSON();
    assert.match(shared.description, /TÜR \/ TYPE/);
    assert.match(shared.description, /Erken gelin/);
    assert.match(shared.description, /Arrive early/);
    assert.match(tr.description, /Erken gelin/);
    assert.doesNotMatch(tr.description, /Arrive early/);
    assert.match(en.description, /Arrive early/);
    assert.equal(record.dpsler.length, 2);
    assert.equal(tr.fields[2].value, en.fields[2].value);
    assert.match(raid.raidButtonRow(false, 'both').toJSON().components[4].label, /LEAVE/);
    localization.setChannelLanguage('guild', 'channel', 'en');
    assert.equal(raid.raidLanguage(record), 'en');
    assert.equal(localization.getSharedLanguage('guild', 'other'), 'tr');
    assert.equal(raid.raidDescription({ aciklama: 'Legacy text' }, 'en'), 'Legacy text');
    assert.match(raid.raidDescription({ descriptions: { tr: 'Özel açıklama' } }, 'en'), /No description/);
});

test('ready-made announcements contain both languages without calling a translation provider', async context => {
    isolateStores(context);
    context.mock.method(announcement.translationService, 'translateTurkishToEnglish', () => { throw new Error('Unexpected translation request'); });
    const reply = await handleAnnouncementInteraction({
        isAutocomplete: () => false, isChatInputCommand: () => true, commandName: 'announcement',
        user: { id: 'user' }, locale: 'en-US', guildId: 'guild', channelId: 'channel',
        memberPermissions: { has: () => true },
        options: { getString: () => null, getBoolean: () => true },
        reply: async payload => payload
    });
    assert.deepEqual(reply.flags, [64]);
    const [draft] = Object.values(announcement.announcementStore.data.announcements);
    assert.match(draft.turkishText, /kayıtlar açık/);
    assert.match(draft.englishText, /Registration is open/);
    assert.equal(announcement.translationService.translateTurkishToEnglish.mock.callCount(), 0);
});

test('announcement language selector persists a personal preference and never edits the shared message', async context => {
    isolateStores(context);
    announcement.announcementStore.data.announcements.example_with_underscores = {
        id: 'example_with_underscores', status: 'published', turkishText: 'Türkçe metin', englishText: 'English text'
    };
    const reply = await handleAnnouncementInteraction({
        isAutocomplete: () => false, isChatInputCommand: () => false, isModalSubmit: () => false,
        isButton: () => false, isStringSelectMenu: () => true,
        customId: 'announcement_language_example_with_underscores', values: ['tr'], locale: 'en-US', user: { id: 'user' },
        reply: async payload => payload,
        update: () => { throw new Error('Must not edit the shared message'); }
    });
    assert.match(reply.content, /Türkçe metin/);
    assert.deepEqual(reply.flags, [64]);
    localization._preferenceStore.reload();
    assert.equal(localization.languageForUser('user', { locale: 'en-US' }), 'tr');
});

test('long bilingual announcements remain one message with both complete versions and one ping', context => {
    isolateStores(context);
    const record = { id: 'example', ping: 'here', turkishText: 'T'.repeat(1500), englishText: 'E'.repeat(1500) };
    const payload = buildPublishedMessagePayload(record, 'both');
    assert.ok(payload.content.length <= 2000);
    assert.equal(payload.embeds.length, 2);
    assert.equal(payload.embeds[0].toJSON().description, record.turkishText);
    assert.equal(payload.embeds[1].toJSON().description, record.englishText);
    assert.deepEqual(payload.allowedMentions, { parse: ['everyone'] });
    assert.equal(payload.content.match(/@here/g).length, 1);
});
