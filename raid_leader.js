const { randomBytes } = require('crypto');
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { organizerTime } = require('./raid_time');

const INSTRUCTIONS = 'Gerekirse atamaları düzenleyebilir veya tabloyu yeniden oluşturabilirsiniz. Kadroyu kontrol ettikten sonra onaylayın.\nYou can edit assignments or regenerate the plan if needed. Please review the roster before approving.';
const trim = (value, limit) => {
    const text = String(value ?? '');
    return text.length > limit ? `${text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '')}…` : text;
};

function warningFields(tr = [], en = []) {
    if (!tr.length) return [{ name: 'Uyarılar / Warnings', value: 'Uyarı bulunmuyor. / No warnings found.' }];
    const fields = [];
    let value = '';
    let used = 0;
    let shown = 0;
    for (let index = 0; index < tr.length; index++) {
        const pair = `⚠️ ${trim(tr[index], 450)}\n${trim(en[index] || tr[index], 450)}`;
        if (used + pair.length + 2 > 3600) break;
        if (value.length + pair.length + 2 > 1000) {
            fields.push({ name: fields.length ? 'Uyarılar / Warnings (devam / continued)' : 'Uyarılar / Warnings', value });
            value = '';
        }
        value += `${value ? '\n\n' : ''}${pair}`;
        used += pair.length + 2;
        shown++;
    }
    if (value) fields.push({ name: fields.length ? 'Uyarılar / Warnings (devam / continued)' : 'Uyarılar / Warnings', value });
    if (shown < tr.length) fields.push({ name: 'Diğer uyarılar / More warnings', value: `${tr.length - shown} uyarı daha var; liste kısaltıldı.\n${tr.length - shown} more warnings; the list was shortened.` });
    return fields;
}

function buildLeaderEmbed(raid, plans, { confirmation = false, error = false, imageName = 'raid-plan.png', title } = {}) {
    const plan = plans.tr;
    const warningCount = plan.warnings?.length || 0;
    // Error > approved > warnings > pending. Approved plans stay green even with acknowledged warnings.
    const color = error ? '#ED4245' : raid.planApproved ? '#2ECC71' : warningCount ? '#F1A93B' : '#5865F2';
    const embed = new EmbedBuilder().setColor(color)
        .setTitle(trim(String(title || raid.zindan || raid.zindanKodu || 'Raid').replace(/^(.+?)\s+\((.+)\)$/, '$1 — $2'), 256))
        .setDescription(confirmation
            ? '**Uyarılar mevcut / Warnings detected**\nBu raid planında çözülmemiş uyarılar bulunuyor. Yine de onaylamak istiyor musunuz?\nThis raid plan contains unresolved warnings. Do you still want to approve it?'
            : 'Raid tablosu hazırlandı. Lütfen kadroyu kontrol ederek onaylayın.\nThe raid plan is ready. Please review the roster and approve it.')
        .addFields(
            { name: 'Trial / Zindan', value: trim(raid.zindanKodu && raid.zindanKodu !== 'custom' ? raid.zindanKodu : raid.zindan || '—', 200), inline: true },
            { name: 'Oyuncular / Players', value: `${plan.rows?.length || 0} / ${plan.capacity || raid.capacity || 10}`, inline: true },
            { name: '\u200b', value: '\u200b', inline: true },
            { name: 'Durum / Status', value: raid.planApproved ? 'Onaylandı / Approved' : 'Onay Bekliyor / Pending Approval', inline: true },
            { name: 'Uyarılar / Warnings', value: String(warningCount), inline: true },
            { name: '\u200b', value: '\u200b', inline: true },
            ...warningFields(plan.warnings, plans.en?.warnings)
        )
        .setFooter({ text: INSTRUCTIONS });
    const organizer = organizerTime(raid);
    if (organizer) embed.addFields(
        { name: 'Raid Liderinin Saati / Organizer Time', value: organizer },
        { name: 'Yerel Saatiniz / Your Local Time', value: `<t:${Math.floor(raid.unixZamani)}:F> • <t:${Math.floor(raid.unixZamani)}:R>` }
    );
    if (imageName) embed.setImage(`attachment://${imageName}`);
    if (error) embed.addFields({ name: 'Hata / Error', value: 'Kontrol mesajı güncellenemedi. Yenile düğmesiyle tekrar deneyin.\nThe review message could not be updated. Please try Regenerate.' });
    return embed;
}

function planActionRow(id, approved = false, confirmation = null, disabled = false) {
    if (confirmation) return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`raid_plan_confirm_${id}_${confirmation}`).setLabel('Yine de Onayla / Approve Anyway').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`raid_plan_cancel_${id}_${confirmation}`).setLabel('İptal / Cancel').setStyle(ButtonStyle.Secondary)
    );
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`raid_plan_approve_${id}`).setLabel('Onayla / Approve').setStyle(ButtonStyle.Success).setDisabled(approved || disabled),
        new ButtonBuilder().setCustomId(`raid_plan_edit_${id}`).setLabel('Düzenle / Edit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`raid_plan_recalc_${id}`).setLabel('Yenile / Regenerate').setStyle(ButtonStyle.Secondary)
    );
}

// Only UI state lives here. No new database fields or changes to assignment/scheduler rules.
function createLeaderReview(deps) {
    const reviews = new Map();
    const editors = new Map();
    const busy = new Set();
    const notify = (interaction, content) => {
        const payload = { content, flags: [64], allowedMentions: { parse: [] } };
        return interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
    };
    function current(id, raid) {
        return deps.getRaid(id) === raid && !deps.isClosed(raid);
    }
    function prune() {
        for (const id of reviews.keys()) {
            const raid = deps.getRaid(id);
            if (!raid || deps.isClosed(raid)) { reviews.delete(id); editors.delete(id); }
        }
    }
    async function publish(client, id, raid, payload, review) {
        if (review?.message) {
            try { return await review.message.edit({ ...payload, attachments: [] }); }
            catch (error) {
                // Only a definitely deleted message warrants a replacement. Other edit
                // failures must not send a second DM or leak a draft to another channel.
                if (error.code !== 10008) throw error;
            }
        }
        try {
            if (!raid.creatorId) throw new Error('Raid lideri bilinmiyor.');
            const leader = await client.users.fetch(raid.creatorId);
            return await leader.send(payload);
        } catch (error) {
            console.warn(`Raid plan draft DM failed (${id}); falling back to channel:`, error.message);
            const channel = await client.channels.fetch(raid.channelId);
            if (!channel?.send) throw error;
            return channel.send({ ...payload, content: raid.creatorMention || (raid.creatorId ? `<@${raid.creatorId}>` : ''), allowedMentions: { users: raid.creatorId ? [String(raid.creatorId)] : [], parse: [] } });
        }
    }
    async function refresh(client, id, raid) {
        for (let attempt = 0; attempt < 3; attempt++) {
            if (!current(id, raid)) throw new Error('Raid no longer available for review');
            const fingerprint = deps.fingerprint(raid);
            const plans = deps.generatePlans(raid);
            const image = await deps.render(client, raid, plans.tr);
            if (!current(id, raid)) throw new Error('Raid no longer available for review');
            if (fingerprint !== deps.fingerprint(raid)) continue;
            const payload = {
                content: null,
                embeds: [buildLeaderEmbed(raid, plans, { title: deps.title?.(raid) })],
                files: [new AttachmentBuilder(image, { name: 'raid-plan.png' })],
                components: [planActionRow(id, raid.planApproved)],
                allowedMentions: { parse: [] }
            };
            const message = await publish(client, id, raid, payload, reviews.get(id));
            // The stored fingerprint describes the PNG actually sent, even if signup
            // data changed while Discord was accepting the edit. Approval checks it.
            reviews.set(id, { message, fingerprint, plans, imageName: 'raid-plan.png', confirmation: null });
            editors.delete(id);
            if (!current(id, raid)) return false;
            raid.draftSent = true;
            if (fingerprint === deps.fingerprint(raid)) raid.planNeedsRefresh = false;
            deps.save(id, raid);
            return true;
        }
        throw new Error('Raid roster changed during rendering; review again');
    }
    async function sendDraft(client, id, raid) {
        id = String(id);
        prune();
        if (busy.has(id)) return false;
        busy.add(id);
        try { return await refresh(client, id, raid); }
        catch (error) { console.error(`Taslak gönderilemedi (${id}):`, error); return false; }
        finally { busy.delete(id); }
    }
    async function showState(id, raid, review, confirmation = false) {
        await review.message.edit({
            content: null,
            embeds: [buildLeaderEmbed(raid, review.plans, { confirmation, imageName: review.imageName, title: deps.title?.(raid) })],
            components: [planActionRow(id, raid.planApproved, confirmation ? review.confirmation.token : null)],
            allowedMentions: { parse: [] }
        });
    }
    async function handle(interaction) {
        const parts = interaction.customId?.split('_') || [];
        const action = parts[2];
        const id = parts[3];
        const button = interaction.isButton() && ['approve', 'confirm', 'cancel', 'recalc', 'edit'].includes(action);
        const valueSelection = interaction.isStringSelectMenu() && action === 'value';
        if (!interaction.customId?.startsWith('raid_plan_') || (!button && !valueSelection)) return null;
        const raid = deps.getRaid(id);
        if (!raid || !deps.canManage(interaction, raid)) {
            await notify(interaction, 'Bu işlem yalnızca raid liderine açıktır. / Only the raid leader can use this action.');
            return true;
        }
        if (deps.isClosed(raid)) {
            await notify(interaction, 'Raid kapandı; işlem yapılamaz. / This raid is closed.');
            return true;
        }
        if (busy.has(id)) {
            await notify(interaction, 'İşlem sürüyor, lütfen bekleyin. / An update is in progress; please wait.');
            return true;
        }
        busy.add(id);
        let review = reviews.get(id);
        try {
            if (button && review && review.message.id !== interaction.message.id) {
                await notify(interaction, 'Lütfen en son kontrol mesajını kullanın. / Please use the latest review message.');
                return true;
            }
            if (button && !review) {
                // Legacy messages and restart recovery: use the clicked message, but
                // require a fresh preview before accepting approval of an unknown PNG.
                review = { message: interaction.message, fingerprint: null, confirmation: null };
                reviews.set(id, review);
            }
            if (action === 'edit') {
                const fingerprint = deps.fingerprint(raid);
                const message = await deps.openEditor(interaction, id, raid);
                if (message) editors.set(id, { messageId: message.id, userId: interaction.user.id, fingerprint });
                return true;
            }
            await interaction.deferUpdate();
            // Recheck after acknowledging; signup and scheduler work may have run.
            if (!current(id, raid)) throw new Error('Raid no longer available for review');
            if (valueSelection) {
                const editor = editors.get(id);
                if (!review || !editor || editor.messageId !== interaction.message.id || editor.userId !== interaction.user.id || editor.fingerprint !== deps.fingerprint(raid)) {
                    await notify(interaction, 'Düzenleme oturumu güncel değil. Düzenle düğmesini yeniden açın. / This editor is stale. Please open Edit again.');
                    return true;
                }
                deps.setAssignment(raid, parts[4], parts[5], interaction.values[0]);
                raid.planApproved = false;
                raid.planNeedsRefresh = true;
                deps.save(id, raid);
                editors.delete(id);
                await refresh(interaction.client, id, raid);
                await interaction.editReply({ content: 'Atama kaydedildi; kontrol tablosu güncellendi. / Assignment saved; the review plan was updated.', components: [] });
                return true;
            }
            if (action === 'recalc') {
                raid.planOverrides = {};
                raid.planApproved = false;
                raid.planNeedsRefresh = true;
                deps.save(id, raid);
                await refresh(interaction.client, id, raid);
                return true;
            }
            if (raid.planApproved) {
                await notify(interaction, 'Bu raid zaten onaylandı. / This raid is already approved.');
                return true;
            }
            if (review.fingerprint !== deps.fingerprint(raid)) {
                await refresh(interaction.client, id, raid);
                await notify(interaction, 'Tablo güncellendi. Lütfen tekrar kontrol edip onaylayın. / The plan was updated. Please review it again before approving.');
                return true;
            }
            if (action === 'cancel' || action === 'confirm') {
                if (!review.confirmation || review.confirmation.token !== parts[4] || review.confirmation.fingerprint !== deps.fingerprint(raid)) {
                    await notify(interaction, 'Bu onay adımı artık geçerli değil. / This confirmation is no longer valid.');
                    return true;
                }
                review.confirmation = null;
                if (action === 'cancel') { await showState(id, raid, review); return true; }
            } else if (review.plans.tr.warnings?.length) {
                review.confirmation = { token: randomBytes(6).toString('hex'), fingerprint: review.fingerprint };
                await showState(id, raid, review, true);
                return true;
            }
            // No await between the final revision check and commit. The per-raid
            // lock plus persisted planApproved protects concurrent and repeated clicks.
            raid.planApproved = true;
            deps.save(id, raid);
            review.fingerprint = deps.fingerprint(raid);
            review.confirmation = null;
            await showState(id, raid, review);
            return true;
        } catch (error) {
            console.error(`Raid plan review failed (${id}):`, error);
            review = reviews.get(id);
            if (review && current(id, raid)) {
                review.fingerprint = null;
                review.confirmation = null;
                try {
                    if (!review.plans) {
                        review.plans = deps.generatePlans(raid);
                        review.imageName = review.message.attachments?.first()?.name || null;
                    }
                    await review.message.edit({ embeds: [buildLeaderEmbed(raid, review.plans, { error: true, imageName: review.imageName })], components: [planActionRow(id, raid.planApproved, null, true)] });
                } catch (editError) { console.error('Raid review error edit failed:', editError); }
            }
            await notify(interaction, 'İşlem tamamlanamadı. Lütfen kontrol mesajını yenileyin. / The operation could not be completed. Please regenerate the review.')
                .catch(replyError => console.error('Raid review error reply failed:', replyError));
            return true;
        } finally { busy.delete(id); }
    }
    return { sendDraft, handle };
}

module.exports = { buildLeaderEmbed, planActionRow, createLeaderReview };
