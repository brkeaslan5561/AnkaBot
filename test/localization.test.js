const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTurkishLocale,
  resolveUserLanguage,
  formatDiscordTimestamp,
  resolveRaidTemplateText,
  DEFAULT_LANGUAGE
} = require('../localization');
const { TranslationService, TranslationError } = require('../translation_service');

test('Turkish locale detection works', () => {
  assert.equal(isTurkishLocale('tr'), true);
  assert.equal(isTurkishLocale('tr-TR'), true);
  assert.equal(isTurkishLocale('en-US'), false);
});

test('current Discord locale overrides a stale manual language value', () => {
  const result = resolveUserLanguage({ userId: '1', locale: 'en-US', manual: 'tr' }, 'en');
  assert.equal(result, 'en');
  assert.equal(resolveUserLanguage({ userId: '1', locale: 'tr-TR', manual: 'en' }, 'en'), 'tr');
});

test('automatic language follows Turkish Discord locale and otherwise uses English', () => {
  assert.equal(resolveUserLanguage({ userId: '2', locale: 'en-US' }, 'tr'), 'en');
  assert.equal(resolveUserLanguage({ userId: '3', locale: 'fr-FR' }, 'tr'), 'en');
  assert.equal(resolveUserLanguage({ userId: '4', locale: 'tr-TR' }, 'en'), 'tr');
});

test('Discord timestamps format correctly', () => {
  const stamp = formatDiscordTimestamp(1700000000, 'F');
  assert.match(stamp, /^<t:\d+:F>$/);
});

test('translation service keeps Discord mentions and URLs intact', async () => {
  const value = '**Merhaba** 👋 <@123> ve https://example.com.\n@here {{raid_date}}';
  const service = new TranslationService({
    available: true,
    async translate(masked) { return masked.replace('Merhaba', 'Hello').replace(' ve ', ' and '); }
  });
  const translated = await service.translateTurkishToEnglish(value);
  assert.match(translated, /https:\/\/example.com/);
  assert.match(translated, /@here/);
  assert.match(translated, /<@123>/);
  assert.match(translated, /\*\*Hello\*\*/);
  assert.match(translated, /👋/);
  assert.match(translated, /\n@here \{\{raid_date\}\}/);
});

test('unconfigured local translation fails without making a paid request', async () => {
  const service = new TranslationService({ available: false, async translate() { throw new TranslationError('Translation provider is not configured.'); } });
  await assert.rejects(() => service.translateTurkishToEnglish('Merhaba'), TranslationError);
});

test('raid tokens resolve for preview text', () => {
  const resolved = resolveRaidTemplateText('tr', 'Merhaba {{raid_name}} {{raid_time}}', {
    raidName: 'Master Soul Harvester',
    raidTime: formatDiscordTimestamp(1700000000, 'F')
  });
  assert.match(resolved, /Master Soul Harvester/);
  assert.match(resolved, /<t:\d+:F>/);
});

test('default language constant is exposed', () => {
  assert.ok(DEFAULT_LANGUAGE);
});
