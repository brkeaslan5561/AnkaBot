const { Client, GatewayIntentBits } = require('discord.js');
const { configureLocalization } = require('../localization');
const { getAllRaids, buildRaidMessagePayload, _test } = require('../raid');

async function migrateLocalization(client, options = {}) {
    const dryRun = Boolean(options.dryRun);
    const entries = options.entries || getAllRaids();
    const logger = options.logger || console;
    const summary = { eligible: 0, updated: 0, skipped: 0, failed: 0 };

    for (const { id, raid } of entries) {
        if (_test.isRaidClosed(raid)) {
            summary.skipped += 1;
            logger.log(`[skip] ${id}: raid is closed`);
            continue;
        }
        if (!raid.channelId) {
            summary.skipped += 1;
            logger.log(`[skip] ${id}: channel ID is missing`);
            continue;
        }
        try {
            const channel = await client.channels.fetch(String(raid.channelId));
            if (!channel?.messages) throw new Error('Channel does not support messages.');
            const message = await channel.messages.fetch(String(id));
            if (String(message.author?.id) !== String(client.user.id)) {
                summary.skipped += 1;
                logger.log(`[skip] ${id}: message was not authored by this bot`);
                continue;
            }
            summary.eligible += 1;
            if (dryRun) {
                logger.log(`[dry-run] ${id}: would add localized raid card and language selector`);
                continue;
            }
            await message.edit(buildRaidMessagePayload(raid));
            summary.updated += 1;
            logger.log(`[updated] ${id}`);
        } catch (error) {
            const missing = [10003, 10008].includes(Number(error?.code)) || Number(error?.status) === 404;
            if (missing) {
                summary.skipped += 1;
                logger.log(`[skip] ${id}: Discord message or channel no longer exists`);
            } else {
                summary.failed += 1;
                logger.error(`[failed] ${id}:`, error.message);
            }
        }
    }
    return { dryRun, ...summary };
}

async function main() {
    const config = require('../config.json');
    configureLocalization(config);
    const dryRun = process.argv.includes('--dry-run');
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
    client.once('clientReady', async () => {
        try {
            const summary = await migrateLocalization(client, { dryRun });
            console.log(JSON.stringify(summary, null, 2));
            process.exitCode = 0;
        } catch (error) {
            console.error('Localization migration failed:', error);
            process.exitCode = 1;
        } finally {
            client.destroy();
        }
    });
    await client.login(config.token);
}

if (require.main === module) {
    main().catch(error => {
        console.error('Discord login failed:', error);
        process.exitCode = 1;
    });
}

module.exports = { migrateLocalization };
