const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { ASSET_ROOT, findCatalogItem, assetPath } = require('./raid_catalog');

const LOGO_PATH = path.join(ASSET_ROOT, 'anka-logo.png');
const WIDTH = 2560;
const MARGIN = 60;
const TABLE_WIDTH = WIDTH - MARGIN * 2;
const TABLE_Y = 220;
const TABLE_HEADER_HEIGHT = 80;
const ROW_HEIGHT = 104;
const COLUMN_WIDTHS = [320, 150, 200, 510, 480, 480, 300];
const COLUMN_LABELS = ['OYUNCU', 'ROL', 'KLAS', 'ESER', 'BİNEK GÜCÜ', 'YOLDAŞ', 'AURA'];
const imageCache = new Map();

function escapeXml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function imageDataUri(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    if (imageCache.has(filePath)) return imageCache.get(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const mime = extension === '.webp' ? 'image/webp' : 'image/png';
    const uri = `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
    imageCache.set(filePath, uri);
    return uri;
}

function wrapText(value, maxCharacters = 25) {
    const text = String(value || '').trim();
    if (!text) return [];
    if (text.length <= maxCharacters) return [text];

    const words = text.split(/\s+/);
    const lines = [''];
    for (const word of words) {
        const current = lines[lines.length - 1];
        if (!current || `${current} ${word}`.length <= maxCharacters) {
            lines[lines.length - 1] = current ? `${current} ${word}` : word;
        } else if (lines.length === 1) {
            lines.push(word);
        } else {
            lines[1] += ` ${word}`;
        }
    }

    if (lines[1] && lines[1].length > maxCharacters + 6) {
        lines[1] = `${lines[1].slice(0, maxCharacters + 3)}…`;
    }
    return lines.slice(0, 2);
}

function roleStyle(role) {
    if (role === 'tank') return { color: '#62A9D8', label: 'TANK' };
    if (role === 'heal') return { color: '#67BE8B', label: 'HEALER' };
    return { color: '#D98D52', label: 'DPS' };
}

function formatRaidDate(raid) {
    if (!raid.unixZamani) return raid.saat || '';
    return new Intl.DateTimeFormat('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(Number(raid.unixZamani) * 1000)).replace(',', ' ·');
}

function fallbackIcon(x, y, label, color = '#7D8794') {
    const initials = String(label || '?')
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part[0] || '')
        .join('')
        .toUpperCase();
    return `
        <rect x="${x}" y="${y}" width="72" height="72" rx="16" fill="#11161C" stroke="#35404C" stroke-width="2"/>
        <text x="${x + 36}" y="${y + 45}" fill="${color}" font-size="24" font-weight="700" text-anchor="middle">${escapeXml(initials)}</text>`;
}

function auraIcon(x, y, name) {
    const colors = {
        'Pack Tactics': ['#F2A84B', '#D66B32'],
        'Mystic Aura': ['#A879F6', '#664CD8'],
        'Runic Aura': ['#57D4F2', '#1787C5']
    };
    const [outer, inner] = colors[name] || ['#8994A2', '#53606E'];
    return `
        <g transform="translate(${x} ${y})">
            <circle cx="36" cy="36" r="33" fill="#0A0E13" stroke="${outer}" stroke-width="4"/>
            <circle cx="36" cy="36" r="23" fill="none" stroke="${inner}" stroke-width="3" opacity="0.85"/>
            <path d="M36 11 L53 53 L19 53 Z M36 24 L28 46 L44 46 Z" fill="none" stroke="${outer}" stroke-width="3" stroke-linejoin="round"/>
            <circle cx="36" cy="36" r="5" fill="${outer}"/>
        </g>`;
}

function itemCell(x, y, width, value, category) {
    if (!value) return '';
    const catalogCategory = {
        artifact: 'artifacts',
        mount: 'mounts',
        companion: 'companions',
        aura: 'auras'
    }[category];
    const item = findCatalogItem(catalogCategory, value);
    const filePath = assetPath(item);
    const uri = imageDataUri(filePath);
    const iconX = x + 16;
    const iconY = y + 16;
    let icon;

    if (category === 'aura') {
        icon = auraIcon(iconX, iconY, value);
    } else if (uri) {
        icon = `
            <rect x="${iconX - 2}" y="${iconY - 2}" width="76" height="76" rx="17" fill="#090C10" stroke="#35404C" stroke-width="2"/>
            <image href="${uri}" x="${iconX}" y="${iconY}" width="72" height="72" preserveAspectRatio="xMidYMid slice"/>`;
    } else {
        icon = fallbackIcon(iconX, iconY, value);
    }

    const maxCharacters = width >= 480 ? 28 : 20;
    const lines = wrapText(value, maxCharacters);
    const textY = lines.length === 1 ? y + 61 : y + 46;
    const textX = x + 106;
    const spans = lines.map((line, index) =>
        `<tspan x="${textX}" dy="${index === 0 ? 0 : 29}">${escapeXml(line)}</tspan>`
    ).join('');

    return `${icon}<text x="${textX}" y="${textY}" class="cellText">${spans}</text>`;
}

function titleText(raid) {
    const title = String(raid.zindanKodu || raid.zindan || 'RAID').replace(/\s*\([^)]*\)\s*$/, '');
    return title.length > 54 ? `${title.slice(0, 51)}…` : title;
}

async function renderRaidTable(raid, plan, options = {}) {
    const capacity = Number(plan.capacity || raid.capacity) || 10;
    const rows = Array.isArray(plan.rows) ? plan.rows : [];
    const footerHeight = 70;
    const height = TABLE_Y + TABLE_HEADER_HEIGHT + ROW_HEIGHT * capacity + footerHeight + 50;
    const logoUri = imageDataUri(LOGO_PATH);
    const columnX = [MARGIN];
    for (const width of COLUMN_WIDTHS) columnX.push(columnX[columnX.length - 1] + width);
    const status = options.status || (raid.planApproved ? 'LİDER ONAYLI' : 'TASLAK');
    const contentType = raid.contentType === 'dungeon' ? 'ZİNDAN' : 'TRIAL';
    const emptySlots = Math.max(0, capacity - rows.length);
    const warningCount = Array.isArray(plan.warnings) ? plan.warnings.length : 0;

    let svg = `<?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
        <defs>
            <clipPath id="logoClip"><rect x="0" y="0" width="112" height="112" rx="24"/></clipPath>
            <style>
                text { font-family: 'Nimbus Sans', 'DejaVu Sans', Arial, sans-serif; }
                .eyebrow { fill: #8B94A1; font-size: 20px; font-weight: 700; letter-spacing: 2.5px; }
                .title { fill: #F2F4F7; font-size: 44px; font-weight: 700; }
                .meta { fill: #8D96A3; font-size: 23px; font-weight: 500; }
                .th { fill: #8E98A6; font-size: 21px; font-weight: 700; letter-spacing: 1.6px; }
                .cellText { fill: #E3E7EC; font-size: 26px; font-weight: 600; }
                .player { fill: #F1F3F6; font-size: 28px; font-weight: 700; }
                .classText { fill: #B5BDC8; font-size: 25px; font-weight: 500; }
                .roleText { fill: #C8CFD8; font-size: 20px; font-weight: 700; letter-spacing: 1px; }
            </style>
        </defs>
        <rect width="${WIDTH}" height="${height}" fill="#0A0D11"/>
        <rect x="${MARGIN}" y="32" width="${TABLE_WIDTH}" height="150" rx="24" fill="#0F1318" stroke="#222831" stroke-width="2"/>
        ${logoUri ? `<g transform="translate(88 51)" clip-path="url(#logoClip)"><image href="${logoUri}" width="112" height="112" preserveAspectRatio="xMidYMid slice"/></g><rect x="88" y="51" width="112" height="112" rx="24" fill="none" stroke="#353C46" stroke-width="2"/>` : ''}
        <text x="236" y="73" class="eyebrow">ANKA RAID PLANI</text>
        <text x="236" y="122" class="title">${escapeXml(titleText(raid))}</text>
        <text x="236" y="157" class="meta">${contentType}  ·  ${escapeXml(formatRaidDate(raid))}  ·  LİDER ${escapeXml(raid.creatorMention || '')}</text>

        <g transform="translate(1780 83)">
            <rect width="340" height="58" rx="16" fill="#141920" stroke="#29313B" stroke-width="2"/>
            <circle cx="26" cy="29" r="6" fill="#D8864D"/>
            <text x="48" y="37" fill="#C9D0D9" font-size="22" font-weight="600">${escapeXml(status)}</text>
        </g>
        <g transform="translate(2140 83)">
            <rect width="330" height="58" rx="16" fill="#141920" stroke="#29313B" stroke-width="2"/>
            <text x="22" y="24" fill="#7F8996" font-size="16" font-weight="700" letter-spacing="1.4">KATILIM</text>
            <text x="22" y="48" fill="#EDF0F4" font-size="27" font-weight="700">${rows.length} / ${capacity}</text>
            <text x="302" y="37" fill="#B97850" text-anchor="end" font-size="19" font-weight="700">${emptySlots} BOŞ</text>
        </g>

        <rect x="${MARGIN}" y="${TABLE_Y}" width="${TABLE_WIDTH}" height="${TABLE_HEADER_HEIGHT + ROW_HEIGHT * capacity}" rx="20" fill="#0D1116" stroke="#222933" stroke-width="2"/>
        <path d="M${MARGIN + 20} ${TABLE_Y}H${MARGIN + TABLE_WIDTH - 20}Q${MARGIN + TABLE_WIDTH} ${TABLE_Y} ${MARGIN + TABLE_WIDTH} ${TABLE_Y + 20}V${TABLE_Y + TABLE_HEADER_HEIGHT}H${MARGIN}V${TABLE_Y + 20}Q${MARGIN} ${TABLE_Y} ${MARGIN + 20} ${TABLE_Y}Z" fill="#171C24"/>
        <rect x="${MARGIN}" y="${TABLE_Y + TABLE_HEADER_HEIGHT - 2}" width="${TABLE_WIDTH}" height="2" fill="#B86C43"/>
    `;

    for (let index = 0; index < COLUMN_LABELS.length; index += 1) {
        svg += `<text x="${columnX[index] + COLUMN_WIDTHS[index] / 2}" y="${TABLE_Y + 51}" class="th" text-anchor="middle">${COLUMN_LABELS[index]}</text>`;
    }

    for (let index = 0; index < capacity; index += 1) {
        const row = rows[index] || null;
        const y = TABLE_Y + TABLE_HEADER_HEIGHT + index * ROW_HEIGHT;
        const fill = row ? (index % 2 === 0 ? '#11161C' : '#0F1419') : '#0D1116';
        const style = roleStyle(row ? row.role : null);

        svg += `
            <rect x="${MARGIN}" y="${y}" width="${TABLE_WIDTH}" height="${ROW_HEIGHT}" fill="${fill}"/>
            <rect x="${MARGIN}" y="${y}" width="3" height="${ROW_HEIGHT}" fill="${row ? style.color : '#303741'}"/>
            <line x1="${MARGIN}" y1="${y + ROW_HEIGHT}" x2="${MARGIN + TABLE_WIDTH}" y2="${y + ROW_HEIGHT}" stroke="#20262E" stroke-width="1"/>`;

        for (let columnIndex = 1; columnIndex < columnX.length - 1; columnIndex += 1) {
            svg += `<line x1="${columnX[columnIndex]}" y1="${y}" x2="${columnX[columnIndex]}" y2="${y + ROW_HEIGHT}" stroke="#1D232B" stroke-width="1"/>`;
        }

        if (!row) continue;

        const playerLines = wrapText(row.displayName, 21);
        const playerY = playerLines.length === 1 ? y + 62 : y + 48;
        svg += `<text x="${columnX[0] + 22}" y="${playerY}" class="player">${playerLines.map((line, lineIndex) => `<tspan x="${columnX[0] + 22}" dy="${lineIndex === 0 ? 0 : 31}">${escapeXml(line)}</tspan>`).join('')}</text>`;
        svg += `<circle cx="${columnX[1] + 32}" cy="${y + 52}" r="7" fill="${style.color}"/>`;
        svg += `<text x="${columnX[1] + 52}" y="${y + 59}" class="roleText">${style.label}</text>`;
        svg += `<text x="${columnX[2] + 22}" y="${y + 62}" class="classText">${escapeXml(row.klass)}</text>`;
        svg += itemCell(columnX[3], y, COLUMN_WIDTHS[3], row.artifact, 'artifact');
        svg += itemCell(columnX[4], y, COLUMN_WIDTHS[4], row.mount, 'mount');
        svg += itemCell(columnX[5], y, COLUMN_WIDTHS[5], row.companion, 'companion');
        svg += itemCell(columnX[6], y, COLUMN_WIDTHS[6], row.aura, 'aura');
    }

    const footerY = TABLE_Y + TABLE_HEADER_HEIGHT + ROW_HEIGHT * capacity + 24;
    const footerText = warningCount > 0
        ? `${warningCount} uyarı var. Atanamayan alanlar boş bırakıldı; ayrıntılar raid liderine gönderildi.`
        : 'Tüm atamalar uygun oyuncu profillerine göre tamamlandı.';
    svg += `
        <rect x="${MARGIN}" y="${footerY}" width="${TABLE_WIDTH}" height="54" rx="15" fill="#0F1419" stroke="#222933"/>
        <circle cx="${MARGIN + 28}" cy="${footerY + 27}" r="5" fill="${warningCount > 0 ? '#D8864D' : '#67BE8B'}"/>
        <text x="${MARGIN + 48}" y="${footerY + 35}" fill="#AEB7C2" font-size="20" font-weight="500">${escapeXml(footerText)}</text>
        <text x="${MARGIN + TABLE_WIDTH - 22}" y="${footerY + 35}" fill="#596371" font-size="18" text-anchor="end">ANKA</text>
    </svg>`;

    return sharp(Buffer.from(svg))
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
}

module.exports = { renderRaidTable, WIDTH };
