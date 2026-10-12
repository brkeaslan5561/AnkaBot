const fs = require('fs');
const path = require('path');

// Keep the bundled font available on Ubuntu hosts without system fonts.
const BUNDLED_FONT_CONFIG = path.join(__dirname, 'assets', 'raid', 'fonts', 'fonts.conf');
if (process.platform === 'linux' && fs.existsSync(BUNDLED_FONT_CONFIG)) {
    process.env.FONTCONFIG_FILE = BUNDLED_FONT_CONFIG;
}

const sharp = require('sharp');
const { ASSET_ROOT, findCatalogItem } = require('./raid_catalog');

// Dark Phoenix — Black & Crimson. Geometry and game assets are independent of this palette.
const THEME = Object.freeze({
    background: '#0B0C10',
    row: '#151922',
    rowAlternate: '#10141C',
    columnBackground: '#1D2029',
    accent: '#E23B35',
    heading: '#E65A4A',
    text: '#E9EAF0',
    secondaryText: '#A0A6B2',
    columnSubtitle: '#8F96A3',
    equipmentText: '#B8BEC9',
    rowNumber: '#8993A3',
    divider: '#292D38',
    groupBackground: '#28191B',
    groupText: '#F28736',
    groupDivider: '#44302C',
    tank: '#66B8DC',
    healer: '#77D4A0',
    dps: '#F3A85A',
    fallbackBackground: '#1D2836',
    fallbackText: '#7F8C9D'
});

// PNG-only overrides: replacing these files does not alter Discord menu/emoji logic.
const PNG_ICON_PATHS = {
    mystic_aura: 'auras/mystic-aura.png',
    runic_aura: 'auras/runic-aura.png',
    pack_tactics: 'auras/pack-tactics.png',
    demonic_gravehound: 'mounts/demonic-gravehound.png',
    blue_fire_eye: 'companions/blue-fire-eye.png'
};
// Remove transparent source padding so these icons fill the same visible area as their peers.
const TRIMMED_ICONS = new Set(['blue_fire_eye', 'elena', 'demonic_gravehound']);
const WIDTH = 2560;
const MARGIN = 48;
const TABLE_WIDTH = WIDTH - MARGIN * 2;
const HEADER_HEIGHT = 72;
const GROUP_HEIGHT = 42;
const ICON_SIZE = 56;
const CELL_PADDING = 16;
const COLUMN_WIDTHS = [64, 330, 144, 196, 474, 438, 430, 388];
const COLUMN_LABELS = [
    ['#'], ['OYUNCU', 'PLAYER'], ['ROL', 'ROLE'], ['KLAS', 'CLASS'],
    ['ESER', 'ARTIFACT'], ['BİNEK GÜCÜ', 'MOUNT POWER'], ['YOLDAŞ', 'COMPANION'], ['AURA']
];
const GROUP_ROLES = ['tank', 'heal', 'dps', 'dps', 'dps'];
let avatarCache = null;

function escapeXml(value) {
    return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function roleStyle(role) {
    if (role === 'tank') return { color: THEME.tank, label: 'TANK' };
    if (role === 'heal') return { color: THEME.healer, label: 'HEALER' };
    if (role === 'dps') return { color: THEME.dps, label: 'DPS' };
    return { color: THEME.secondaryText, label: '—' };
}

function prepareDisplayRows(raid = {}, plan = {}) {
    const contentType = plan.contentType || raid.contentType;
    const requestedCapacity = Number(plan.capacity || raid.capacity);
    const capacity = Number.isSafeInteger(requestedCapacity) && requestedCapacity > 0
        ? requestedCapacity : contentType === 'dungeon' ? 5 : 10;
    // assignRaid already orders these rows by signup order. Never sort/mutate plan.rows.
    const rows = Array.isArray(plan.rows) ? plan.rows.filter(row => row && typeof row === 'object') : [];
    const grouped = capacity === 10 && contentType !== 'dungeon';
    const standardDungeon = capacity === 5 && contentType === 'dungeon';
    if (!grouped && !standardDungeon) {
        return { capacity, grouped: false, slots: Array.from({ length: Math.max(capacity, rows.length) }, (_, index) => ({ row: rows[index] || null })) };
    }

    const queues = new Map(['tank', 'heal', 'dps'].map(role => [role, rows.filter(row => row.role === role)]));
    const roles = grouped ? [...GROUP_ROLES, ...GROUP_ROLES] : GROUP_ROLES;
    const placed = new Set();
    const slots = roles.map((role, index) => {
        const row = queues.get(role).shift() || null;
        if (row) placed.add(row);
        return { role, row, group: grouped ? Math.floor(index / 5) + 1 : null };
    });
    // Registration permits nonstandard rosters (e.g. ten DPS). Keep vacant role slots
    // vacant, but show extra players below them rather than silently dropping anyone.
    for (const row of rows) if (!placed.has(row)) slots.push({ role: row.role, row });
    return { capacity, grouped, slots };
}

function resolveAssetPath(relativePath, root = ASSET_ROOT) {
    if (!relativePath) return null;
    try {
        let current = root;
        for (const part of relativePath.split(/[\\/]/)) {
            if (!part || part === '.' || part === '..') return null;
            const entries = fs.readdirSync(current);
            const name = entries.find(entry => entry === part)
                || entries.find(entry => entry.toLowerCase() === part.toLowerCase());
            if (!name) return null;
            current = path.join(current, name);
        }
        return current;
    } catch {
        return null;
    }
}

async function imageDataUri(input, size = ICON_SIZE, trimTransparent = false) {
    if (!input) return null;
    try {
        let image = sharp(input, { limitInputPixels: 16_000_000 });
        if (trimTransparent) image = image.trim({ background: '#00000000', threshold: 0 });
        const png = await image.resize(size, size, { fit: 'contain', background: '#00000000' }).png().toBuffer();
        return `data:image/png;base64,${png.toString('base64')}`;
    } catch {
        // Missing, unreadable or corrupt images must not abort a raid plan.
        return null;
    }
}

async function logoDataUri(botUser) {
    // The supplied theme logo takes priority over the bot's potentially older avatar.
    const localLogo = await imageDataUri(resolveAssetPath('anka-logo.png'), 112);
    if (localLogo) return localLogo;
    try {
        if (botUser?.avatar && typeof botUser.displayAvatarURL === 'function') {
            const url = botUser.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true });
            const parsed = new URL(url);
            if (parsed.protocol === 'https:' && parsed.hostname === 'cdn.discordapp.com') {
                if (avatarCache?.url === url) return avatarCache.uri;
                const response = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: 'error' });
                if (!response.ok) throw new Error('Avatar unavailable');
                const uri = await imageDataUri(Buffer.from(await response.arrayBuffer()), 112);
                if (uri) {
                    avatarCache = { url, uri };
                    return uri;
                }
            }
        }
    } catch { /* Missing logo and failed CDN requests must not prevent rendering. */ }
    return null;
}

function titleText(raid) {
    const code = raid.zindanKodu && raid.zindanKodu !== 'custom' ? raid.zindanKodu : null;
    return String(raid.zindan || code || 'RAID');
}

// Pango wraps using actual font metrics, including unbroken names; no ellipsis,
// clipping or guessed character widths. Sharp remains the only image dependency.
async function textImage(text, width, size = 24, color = THEME.equipmentText, bold = false, secondary = '') {
    const value = String(text ?? '').trim() || '—';
    const { data, info } = await sharp({ text: {
        text: `<span foreground="${color}">${escapeXml(value)}</span>${secondary ? `\n<span foreground="${THEME.columnSubtitle}" size="smaller">${escapeXml(secondary)}</span>` : ''}`,
        font: `DejaVu Sans${bold ? ' Bold' : ''} ${size}`,
        fontfile: path.join(ASSET_ROOT, 'fonts', bold ? 'DejaVuSans-Bold.ttf' : 'DejaVuSans.ttf'),
        width, dpi: 72, rgba: true, wrap: 'word-char', spacing: 4
    } }).png().toBuffer({ resolveWithObject: true });
    return { text: secondary ? `${value}\n${secondary}` : value, width: info.width, height: info.height, uri: `data:image/png;base64,${data.toString('base64')}` };
}

function svgImage(image, x, y, width = image.width, height = image.height) {
    return `<image href="${image.uri}" x="${x}" y="${y}" width="${width}" height="${height}"/>`;
}

async function buildRaidTableSvg(raid = {}, plan = {}, options = {}) {
    const display = prepareDisplayRows(raid, plan);
    // Cache only within a render so replacing any local PNG takes effect next time.
    const icons = new Map();
    const texts = new Map();
    function label(value, width, size, color, bold, secondary) {
        const key = JSON.stringify([value, width, size, color, bold, secondary]);
        if (!texts.has(key)) texts.set(key, textImage(value, width, size, color, bold, secondary));
        return texts.get(key);
    }
    async function equipment(value, category, column) {
        const item = findCatalogItem(category, value);
        const name = item?.name || value || '—';
        let icon = null;
        if (value) {
            const relativePath = PNG_ICON_PATHS[item?.id] || item?.icon;
            if (!icons.has(relativePath)) icons.set(relativePath, imageDataUri(resolveAssetPath(relativePath), ICON_SIZE, TRIMMED_ICONS.has(item?.id)));
            icon = await icons.get(relativePath);
        }
        const inset = value ? ICON_SIZE + 14 : 0;
        return { image: await label(name, COLUMN_WIDTHS[column] - CELL_PADDING * 2 - inset, 24), icon, inset };
    }
    const slots = await Promise.all(display.slots.map(async slot => {
        const row = slot.row;
        const style = roleStyle(row?.role || slot.role);
        const cells = [
            { image: await label(row ? row.displayName || row.mention || '—' : 'BOŞ SLOT', COLUMN_WIDTHS[1] - CELL_PADDING * 2, row ? 26 : 21, row ? THEME.text : THEME.secondaryText, Boolean(row), row ? '' : 'EMPTY SLOT') },
            { image: await label(style.label, COLUMN_WIDTHS[2] - CELL_PADDING * 2, 22, style.color, true) },
            { image: await label(row?.klass || row?.klas || row?.class || '—', COLUMN_WIDTHS[3] - CELL_PADDING * 2, 24, THEME.equipmentText) },
            await equipment(row?.artifact, 'artifacts', 4),
            await equipment(row?.mount, 'mounts', 5),
            await equipment(row?.companion, 'companions', 6),
            await equipment(row?.aura, 'auras', 7)
        ];
        return { ...slot, cells };
    }));
    const rowHeight = Math.max(96, ...slots.flatMap(slot => slot.cells.map(cell => cell.image.height + 28)));
    const title = await label(titleText(raid), 1150, 40, THEME.text, true);
    const tableY = Math.max(184, title.height + 116);
    const height = tableY + HEADER_HEIGHT + rowHeight * slots.length + (display.grouped ? GROUP_HEIGHT * 2 : 0) + 32;
    const logoUri = await logoDataUri(options.botUser);
    const columnX = [MARGIN];
    for (const width of COLUMN_WIDTHS) columnX.push(columnX[columnX.length - 1] + width);

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}">
        <style>text { font-family: 'DejaVu Sans', sans-serif; }</style>
        <rect width="${WIDTH}" height="${height}" fill="${THEME.background}"/>
        ${logoUri ? svgImage({ uri: logoUri, width: 112, height: 112 }, MARGIN, 34) : ''}
        <text x="188" y="68" fill="${THEME.heading}" font-size="27" font-weight="700">ANKA RAID PLANI</text>
        ${svgImage(title, 188, 88)}
        <text x="${WIDTH - MARGIN}" y="82" fill="${THEME.secondaryText}" font-size="22" text-anchor="end">Bu tablo Anka Botu tarafından otomatik hazırlanmıştır.</text>
        <text x="${WIDTH - MARGIN}" y="116" fill="${THEME.secondaryText}" font-size="21" text-anchor="end">This table was automatically prepared by Anka Bot.</text>
        <rect x="${MARGIN}" y="${tableY}" width="${TABLE_WIDTH}" height="${HEADER_HEIGHT}" fill="${THEME.columnBackground}"/>
        <line x1="${MARGIN}" y1="${tableY + HEADER_HEIGHT}" x2="${WIDTH - MARGIN}" y2="${tableY + HEADER_HEIGHT}" stroke="${THEME.accent}"/>`;

    COLUMN_LABELS.forEach(([tr, en], index) => {
        const x = columnX[index] + CELL_PADDING;
        svg += `<text x="${x}" y="${tableY + (en ? 30 : 43)}" fill="${THEME.heading}" font-size="23" font-weight="700">${tr}</text>`;
        if (en) svg += `<text x="${x}" y="${tableY + 55}" fill="${THEME.columnSubtitle}" font-size="17">${en}</text>`;
    });

    let y = tableY + HEADER_HEIGHT;
    slots.forEach((slot, index) => {
        if (display.grouped && (index === 0 || index === 5)) {
            svg += `<rect x="${MARGIN}" y="${y}" width="${TABLE_WIDTH}" height="${GROUP_HEIGHT}" fill="${THEME.groupBackground}"/>
                <text x="${MARGIN + CELL_PADDING}" y="${y + 28}" fill="${THEME.groupText}" font-size="21" font-weight="700">GRUP ${slot.group}</text>
                <line x1="${MARGIN}" y1="${y + GROUP_HEIGHT}" x2="${WIDTH - MARGIN}" y2="${y + GROUP_HEIGHT}" stroke="${THEME.groupDivider}"/>`;
            y += GROUP_HEIGHT;
        }
        svg += `<rect x="${MARGIN}" y="${y}" width="${TABLE_WIDTH}" height="${rowHeight}" fill="${index % 2 ? THEME.rowAlternate : THEME.row}"/>
            <text x="${columnX[0] + 20}" y="${y + rowHeight / 2 + 8}" fill="${THEME.rowNumber}" font-size="23">${index + 1}</text>
            <line x1="${MARGIN}" y1="${y + rowHeight}" x2="${WIDTH - MARGIN}" y2="${y + rowHeight}" stroke="${THEME.divider}"/>`;
        slot.cells.forEach((cell, cellIndex) => {
            const x = columnX[cellIndex + 1] + CELL_PADDING;
            if (cell.inset) {
                const iconY = y + (rowHeight - ICON_SIZE) / 2;
                svg += cell.icon
                    ? svgImage({ uri: cell.icon, width: ICON_SIZE, height: ICON_SIZE }, x, iconY)
                    : `<rect x="${x}" y="${iconY}" width="${ICON_SIZE}" height="${ICON_SIZE}" fill="${THEME.fallbackBackground}"/>
                       <text x="${x + ICON_SIZE / 2}" y="${iconY + 35}" fill="${THEME.fallbackText}" font-size="22" text-anchor="middle">—</text>`;
            }
            svg += svgImage(cell.image, x + (cell.inset || 0), y + (rowHeight - cell.image.height) / 2);
        });
        y += rowHeight;
    });
    svg += '</svg>';
    return { svg, width: WIDTH, height, rowHeight, slots };
}

async function renderRaidTable(raid, plan, options = {}) {
    const { svg } = await buildRaidTableSvg(raid, plan, options);
    return sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

module.exports = { renderRaidTable, WIDTH, _test: { prepareDisplayRows, buildRaidTableSvg, resolveAssetPath, imageDataUri, COLUMN_WIDTHS, PNG_ICON_PATHS } };
