const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bundles = Object.fromEntries(['en', 'tr'].map(language => [
    language,
    JSON.parse(fs.readFileSync(path.join(root, 'locales', `${language}.json`), 'utf8'))
]));
const files = ['raid.js', 'announcement.js', 'raid_assignment.js', 'raid_table.js'];
const referenced = new Set();
const keyPattern = /\bt\(\s*[^,]+,\s*['"]([^'"]+)['"]/g;

for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(keyPattern)) referenced.add(match[1]);
}

const errors = [];
for (const [language, bundle] of Object.entries(bundles)) {
    for (const key of referenced) {
        if (!Object.prototype.hasOwnProperty.call(bundle, key)) errors.push(`${language}: missing referenced key '${key}'`);
    }
}
for (const key of Object.keys(bundles.en)) {
    if (!Object.prototype.hasOwnProperty.call(bundles.tr, key)) errors.push(`tr: missing English bundle key '${key}'`);
}
for (const key of Object.keys(bundles.tr)) {
    if (!Object.prototype.hasOwnProperty.call(bundles.en, key)) errors.push(`en: missing Turkish bundle key '${key}'`);
}

if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
} else {
    console.log(`Locale bundles match (${Object.keys(bundles.en).length} keys; ${referenced.size} static references checked).`);
}
