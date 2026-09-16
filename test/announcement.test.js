const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JsonStore } = require('../storage');
const { LocalOllamaTranslationProvider } = require('../translation_service');
const { announcementCommand, languageMenu, buildPublishedMessagePayload, _test } = require('../announcement');
const { _test: raidTest } = require('../raid');

test('announcement command is management-only and has Turkish localization', () => {
    const command = announcementCommand.toJSON();
    assert.equal(command.name, 'announcement');
    assert.equal(command.name_localizations.tr, 'duyuru');
    assert.ok(command.default_member_permissions);
    assert.equal(command.options[0].autocomplete, true);
});

test('announcement and raid language selectors expose automatic, Turkish, and English', () => {
    const announcementMenu = languageMenu('announcement_language_test', 'tr').toJSON();
    const raidMenu = raidTest.raidLanguageRow('tr').toJSON().components[0];
    assert.deepEqual(announcementMenu.options.map(option => option.value), ['auto', 'tr', 'en']);
    assert.deepEqual(raidMenu.options.map(option => option.value), ['auto', 'tr', 'en']);
    assert.equal(announcementMenu.placeholder, '🌐 Language');
    assert.equal(raidMenu.placeholder, '🌐 Language');
    assert.equal(announcementMenu.options[0].label, '🌐 Automatic (Discord language)');
    assert.equal(raidMenu.options[0].label, '🌐 Automatic (Discord language)');
});

test('preview mass mentions are escaped and cannot ping', () => {
    assert.equal(_test.safePingLabel('here'), '@\u200bhere');
    assert.equal(_test.safePingLabel('everyone'), '@\u200beveryone');
    assert.equal(_test.safePingLabel('none'), '—');
});

test('published announcement resolves raid timestamps and explicitly allows only the chosen mass mention', () => {
    const record = {
        id: 'announcement', raidId: 'raid', ping: 'here', createdAt: new Date().toISOString(),
        turkishText: '{{raid_name}} {{raid_date}}', englishText: '{{raid_name}} {{raid_date}}'
    };
    const raid = { zindan: 'Master Test', unixZamani: 2000000000 };
    const payload = buildPublishedMessagePayload(record, 'en', raid);
    assert.equal(
        payload.content,
        '@here\n\nMaster Test <t:2000000000:F>\n\n-# To view the other language privately, use the language selector below.'
    );
    assert.deepEqual(payload.allowedMentions, { parse: ['everyone'] });
    assert.equal(payload.embeds, undefined);
});

test('published Turkish and English selectors render the stored matching version', () => {
    const record = {
        id: 'announcement', raidId: 'raid', ping: 'none', createdAt: new Date().toISOString(),
        turkishText: 'Türkçe metin', englishText: 'English text'
    };
    const raid = { zindan: 'Raid', unixZamani: 2000000000 };
    assert.equal(_test.publishedText(record, 'tr', raid), 'Türkçe metin');
    assert.equal(_test.publishedText(record, 'en', raid), 'English text');
});

test('announcement body cannot create an extra mass mention', () => {
    const record = {
        id: 'announcement', raidId: null, ping: 'here', createdAt: new Date().toISOString(),
        turkishText: '@everyone test', englishText: '@everyone test'
    };
    const payload = buildPublishedMessagePayload(record, 'en');
    assert.equal(
        payload.content,
        '@here\n\n@\u200beveryone test\n\n-# To view the other language privately, use the language selector below.'
    );
});

test('translation provider only accepts explicitly configured loopback URLs', () => {
    assert.equal(new LocalOllamaTranslationProvider({ baseUrl: 'https://api.example.com', model: 'model' }).available, false);
    assert.equal(new LocalOllamaTranslationProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'model' }).available, true);
});

test('JSON preferences survive a store reload', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankabot-store-'));
    const filePath = path.join(directory, 'preferences.json');
    try {
        const first = new JsonStore(filePath, { users: {} });
        first.data.users['42'] = { language: 'tr' };
        first.save();
        const restarted = new JsonStore(filePath, { users: {} });
        assert.equal(restarted.data.users['42'].language, 'tr');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
