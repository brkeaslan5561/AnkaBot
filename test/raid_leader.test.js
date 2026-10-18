const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLeaderEmbed, planActionRow, createLeaderReview } = require('../raid_leader');
const { assignRaid } = require('../raid_assignment');
const { previewScenarios } = require('../scripts/generate_raid_preview');

function fixture() {
    const full = previewScenarios()['trial-full-tr'];
    const raid = { ...full.raid, creatorId: 'leader', channelId: 'channel', planApproved: false, planOverrides: {} };
    const players = full.plan.rows.map((row, i) => ({
        userId: row.userId, displayName: row.displayName, role: row.role, klas: row.klass, sira: i + 1,
        inventory: { artifacts: [row.artifact].filter(Boolean), mounts: [row.mount].filter(Boolean), companions: [row.companion].filter(Boolean), auras: [row.aura].filter(Boolean) }
    }));
    return { raid, players };
}
function plansFor(raid, players) {
    return { tr: assignRaid(raid, players, raid.planOverrides, 'tr'), en: assignRaid(raid, players, raid.planOverrides, 'en') };
}
function validate(payload) {
    for (const embed of payload.embeds || []) {
        const json = embed.toJSON();
        assert.ok(embed.length <= 6000);
        assert.ok(json.title.length <= 256);
        assert.ok(json.description.length <= 4096);
        assert.ok(json.fields.length <= 25);
        assert.ok(json.fields.every(f => f.name.length <= 256 && f.value.length <= 1024));
    }
    for (const row of payload.components || []) {
        for (const button of row.toJSON().components) {
            assert.ok(button.label.length <= 80);
            assert.ok(button.custom_id.length <= 100);
        }
    }
}
function harness() {
    const data = fixture();
    const raids = new Map([['101', data.raid]]);
    const events = [];
    let serial = 0;
    let renders = 0;
    const message = (id = `message-${++serial}`) => ({
        id, payload: {}, files: [],
        async edit(payload) {
            validate(payload);
            if (this.fail) throw this.fail;
            events.push({ kind: 'edit', id, payload });
            this.payload = { ...this.payload, ...payload };
            if (payload.attachments) this.files = [];
            if (payload.files) this.files.push(...payload.files);
            return this;
        }
    });
    const send = async (kind, payload) => {
        validate(payload);
        const sent = message();
        sent.payload = payload;
        sent.files = payload.files || [];
        events.push({ kind, payload, message: sent });
        return sent;
    };
    const client = {
        users: { fetch: async () => ({ send: payload => send('dm', payload) }) },
        channels: { fetch: async () => ({ send: payload => send('channel', payload) }) }
    };
    const deps = {
        getRaid: id => raids.get(id),
        canManage: interaction => interaction.user.id === 'leader',
        isClosed: raid => Boolean(raid.kapandi),
        fingerprint: raid => JSON.stringify([data.players, raid.planOverrides, raid.planApproved]),
        generatePlans: raid => { const plans = plansFor(raid, data.players); raid.plan = plans.tr; return plans; },
        render: async () => { renders++; events.push({ kind: 'render' }); return Buffer.from(`png-${renders}`); },
        save: (_id, raid) => events.push({ kind: 'save', approved: raid.planApproved }),
        share: async (_client, _id, _raid, prepared) => {
            assert.ok(prepared.isCurrent());
            events.push({ kind: 'share', prepared });
            return { id: 'public-plan' };
        },
        openEditor: async interaction => { await interaction.reply({ content: 'editor' }); return message('editor'); },
        setAssignment: (raid, userId, category, value) => {
            raid.planOverrides[userId] ||= {};
            raid.planOverrides[userId][category] = value === '__none__' ? null : value;
        }
    };
    const controller = createLeaderReview(deps);
    function interaction(action, origin, suffix = '', userId = 'leader') {
        return {
            customId: `raid_plan_${action}_101${suffix}`, user: { id: userId }, message: origin, client,
            isButton: () => action !== 'value', isStringSelectMenu: () => action === 'value', values: ['__none__'],
            async reply(payload) { assert.ok(!this.replied && !this.deferred); this.replied = true; events.push({ kind: 'reply', payload }); },
            async followUp(payload) { assert.ok(this.replied || this.deferred); events.push({ kind: 'followup', payload }); },
            async deferUpdate() { assert.ok(!this.replied && !this.deferred); this.deferred = true; events.push({ kind: 'defer' }); },
            async editReply(payload) { assert.ok(this.deferred || this.replied); return origin.edit(payload); }
        };
    }
    return { ...data, data, raids, events, deps, controller, client, message, interaction,
        draft: () => controller.sendDraft(client, '101', data.raid),
        main: () => events.find(event => event.kind === 'dm' || event.kind === 'channel')?.message };
}

test('10/10 uyarısız embed, iki sütun, PNG ve iki dilli butonlar geçerli', () => {
    const { raid, players } = fixture();
    const plans = plansFor(raid, players);
    assert.equal(plans.tr.warnings.length, 0);
    const embed = buildLeaderEmbed(raid, plans);
    validate({ embeds: [embed], components: [planActionRow('101')] });
    const json = embed.toJSON();
    assert.equal(json.title, 'MSH — Master Soul Harvester');
    assert.equal(json.color, 0x5865f2);
    assert.equal(json.fields[1].value, '10 / 10');
    assert.equal(json.fields[4].name, 'Tarih / Date');
    assert.equal(json.image.url, 'attachment://raid-plan.png');
    assert.match(json.footer.text, /Gerekirse.*\nYou can/);
    assert.ok(!json.fields.some(field => /Warnings|uyarı/i.test(field.name)));
    assert.deepEqual(planActionRow('101').toJSON().components.map(b => [b.custom_id, b.style, b.label]), [
        ['raid_plan_approve_101', 3, 'Onayla / Approve'], ['raid_plan_edit_101', 1, 'Düzenle / Edit'], ['raid_plan_recalc_101', 2, 'Yenile / Regenerate'], ['raid_plan_share_101', 1, 'Paylaş / Share Now']
    ]);
});

for (const scenario of ['empty', 'auras', 'both']) {
    test(`${scenario}: uyarılar hesaplanır fakat mesajda listelenmez, renk korunur`, () => {
        const { raid, players } = fixture();
        if (scenario !== 'auras') players.pop();
        if (scenario !== 'empty') players.filter(p => p.role === 'tank').forEach(p => { p.inventory.auras = []; });
        const plans = plansFor(raid, players);
        const embed = buildLeaderEmbed(raid, plans);
        const json = embed.toJSON();
        assert.equal(json.color, 0xf1a93b);
        assert.ok(plans.tr.warnings.length > 0);
        assert.ok(!json.fields.some(field => /Warnings|uyarı/i.test(field.name)));
        const details = JSON.stringify(json);
        for (const warning of [...plans.tr.warnings, ...plans.en.warnings]) assert.ok(!details.includes(warning));
        validate({ embeds: [embed] });
        raid.planApproved = true;
        assert.equal(buildLeaderEmbed(raid, plans).toJSON().color, 0x2ecc71);
        assert.equal(buildLeaderEmbed(raid, plans, { error: true }).toJSON().color, 0xed4245);
    });
}

test('çok sayıda uzun gerçek uyarı embed alanlarına eklenmez; ek onay korunur', () => {
    const { raid, players } = fixture();
    raid.zindan = 'Raid '.repeat(200);
    players.forEach((player, index) => {
        player.displayName = `${index}: ${'Uzunİsim'.repeat(500)}`;
        player.inventory = {};
    });
    const plans = plansFor(raid, players);
    const embed = buildLeaderEmbed(raid, plans, { confirmation: true, error: true });
    validate({ embeds: [embed] });
    assert.ok(plans.tr.warnings.length > 0);
    assert.ok(!embed.toJSON().fields.some(f => /warnings|uyarı/i.test(f.name)));
    assert.match(embed.toJSON().description, /Warnings detected/);
});

test('lider mesajındaki eksik veya geçersiz tarih güvenli gösterilir', () => {
    const { raid, players } = fixture();
    const plans = plansFor(raid, players);
    for (const unixZamani of [undefined, null, 'invalid', Infinity, 1e20]) {
        const embed = buildLeaderEmbed({ ...raid, unixZamani }, plans);
        validate({ embeds: [embed] });
        assert.equal(embed.toJSON().fields.find(f => f.name === 'Tarih / Date').value, '—');
    }
});

test('ilk DM tek mesajdır; yenilemede aynı mesaj ve tek yeni attachment kullanılır', async () => {
    const h = harness();
    await h.draft();
    const main = h.main();
    const firstPng = main.files[0].attachment;
    const click = h.interaction('recalc', main);
    h.events.length = 0;
    await h.controller.handle(click);
    assert.equal(h.events[0].kind, 'defer');
    assert.equal(h.events.filter(e => e.kind === 'dm').length, 0);
    assert.equal(main.files.length, 1);
    assert.notDeepEqual(main.files[0].attachment, firstPng);
    assert.deepEqual(main.payload.attachments, []);
    assert.equal(main.payload.embeds.length, 1);
});

test('uyarısız onay tek kayıt yapar; aynı butonun tekrarları işlem üretmez', async () => {
    const h = harness();
    await h.draft();
    const main = h.main();
    h.events.length = 0;
    await Promise.all([h.controller.handle(h.interaction('approve', main)), h.controller.handle(h.interaction('approve', main))]);
    await h.controller.handle(h.interaction('approve', main));
    assert.equal(h.raid.planApproved, true);
    assert.equal(h.events.filter(e => e.kind === 'save').length, 1);
    assert.equal(main.payload.embeds[0].toJSON().color, 0x2ecc71);
    assert.equal(main.payload.embeds[0].toJSON().fields[3].value, 'Onaylandı / Approved');
    assert.equal(main.payload.components[0].toJSON().components[0].disabled, true);
    assert.equal(main.files.length, 1);
});

test('uyarılı onay ikinci adımı gerektirir; iptal onaylamaz, eski token çalışmaz', async () => {
    const h = harness();
    h.players.pop();
    await h.draft();
    const main = h.main();
    await h.controller.handle(h.interaction('approve', main));
    assert.equal(h.raid.planApproved, false);
    const token = main.payload.components[0].toJSON().components[0].custom_id.split('_')[4];
    await h.controller.handle(h.interaction('cancel', main, `_${token}`));
    assert.equal(h.raid.planApproved, false);
    await h.controller.handle(h.interaction('confirm', main, `_${token}`));
    assert.equal(h.raid.planApproved, false);
    await h.controller.handle(h.interaction('approve', main));
    const nextToken = main.payload.components[0].toJSON().components[0].custom_id.split('_')[4];
    assert.notEqual(nextToken, token);
    await Promise.all([h.controller.handle(h.interaction('confirm', main, `_${nextToken}`)), h.controller.handle(h.interaction('confirm', main, `_${nextToken}`))]);
    assert.equal(h.raid.planApproved, true);
    assert.equal(main.payload.embeds[0].toJSON().color, 0x2ecc71);
    assert.equal(h.events.filter(e => e.kind === 'save' && e.approved).length, 1);
});

test('uyarı onayı sırasında değişen kadro eski onayla kabul edilmez', async () => {
    const h = harness();
    h.players.pop();
    await h.draft();
    const main = h.main();
    await h.controller.handle(h.interaction('approve', main));
    const token = main.payload.components[0].toJSON().components[0].custom_id.split('_')[4];
    h.players.pop();
    await h.controller.handle(h.interaction('confirm', main, `_${token}`));
    assert.equal(h.raid.planApproved, false);
    assert.equal(main.payload.embeds[0].toJSON().fields[1].value, '8 / 10');
    assert.equal(main.files.length, 1);
});

test('manuel düzenleme mevcut menüyü açar; kayıt sonrası ana embed ve PNG güncellenir', async () => {
    const h = harness();
    await h.draft();
    const main = h.main();
    await h.controller.handle(h.interaction('edit', main));
    const selection = h.interaction('value', h.message('editor'), '_1_artifact');
    await h.controller.handle(selection);
    assert.equal(h.raid.planOverrides['1'].artifact, null);
    assert.equal(h.raid.planApproved, false);
    assert.equal(h.raid.plan.warnings.length, 1);
    assert.equal(main.payload.embeds[0].toJSON().color, 0xf1a93b);
    assert.ok(!main.payload.embeds[0].toJSON().fields.some(f => /warnings|uyarı/i.test(f.name)));
    assert.equal(h.events.filter(e => e.kind === 'dm').length, 1);
    assert.equal(main.files.length, 1);
    assert.ok(selection.deferred);
});

test('leader can share the reviewed PNG after editing; repeated/concurrent clicks send one version', async () => {
    const h = harness(); await h.draft();
    const main = h.main();
    await h.controller.handle(h.interaction('edit', main));
    await h.controller.handle(h.interaction('value', h.message('editor'), '_1_artifact'));
    const image = main.files[0].attachment;
    const before = [h.raid.finalSent, h.raid.fiveMinuteCheckpointSent, h.raid.kickoffFinalSent];
    await Promise.all([h.controller.handle(h.interaction('share', main)), h.controller.handle(h.interaction('share', main))]);
    await h.controller.handle(h.interaction('share', main));
    const shares = h.events.filter(e => e.kind === 'share');
    assert.equal(shares.length, 1);
    assert.equal(shares[0].prepared.image, image);
    assert.equal(h.raid.manualPlanMessageId, 'public-plan');
    assert.deepEqual([h.raid.finalSent, h.raid.fiveMinuteCheckpointSent, h.raid.kickoffFinalSent], before);
    await h.controller.handle(h.interaction('recalc', main));
    await h.controller.handle(h.interaction('share', main));
    assert.equal(h.events.filter(e => e.kind === 'share').length, 2);
});

test('sharing works for approved plans but rejects strangers and refreshes stale or recovered previews first', async () => {
    const h = harness(); await h.draft(); const main = h.main();
    await h.controller.handle(h.interaction('share', main, '', 'stranger'));
    assert.equal(h.events.filter(e => e.kind === 'share').length, 0);
    h.players.pop();
    await h.controller.handle(h.interaction('share', main));
    assert.equal(h.events.filter(e => e.kind === 'share').length, 0);
    await h.controller.handle(h.interaction('share', main));
    assert.equal(h.events.filter(e => e.kind === 'share').length, 1);
    const approved = harness(); await approved.draft();
    await approved.controller.handle(approved.interaction('approve', approved.main()));
    await approved.controller.handle(approved.interaction('share', approved.main()));
    assert.equal(approved.events.filter(e => e.kind === 'share').length, 1);
    const recovered = harness(); const old = recovered.message('legacy');
    await recovered.controller.handle(recovered.interaction('share', old));
    assert.equal(recovered.events.filter(e => e.kind === 'share').length, 0);
    await recovered.controller.handle(recovered.interaction('share', old));
    assert.equal(recovered.events.filter(e => e.kind === 'share').length, 1);
});

test('failed manual sharing does not record success and permits retry after refreshing', async t => {
    t.mock.method(console, 'error', () => {});
    const h = harness(); await h.draft(); const main = h.main();
    const send = h.deps.share;
    h.deps.share = async () => { throw new Error('Missing permission'); };
    await h.controller.handle(h.interaction('share', main));
    assert.equal(h.raid.manualPlanMessageId, undefined);
    h.deps.share = send;
    await h.controller.handle(h.interaction('share', main));
    await h.controller.handle(h.interaction('share', main));
    assert.equal(h.events.filter(e => e.kind === 'share').length, 1);
});

test('kadrosu değişmiş eski düzenleme menüsü yeni plana yazamaz', async () => {
    const h = harness();
    await h.draft();
    await h.controller.handle(h.interaction('edit', h.main()));
    h.players.pop();
    await h.controller.handle(h.interaction('value', h.message('editor'), '_1_artifact'));
    assert.deepEqual(h.raid.planOverrides, {});
});

test('eski mesaj/restart: aynı mesaja güncel önizleme gelir, ilk tıklama onaylamaz', async () => {
    const h = harness();
    const legacy = h.message('legacy');
    await h.controller.handle(h.interaction('approve', legacy));
    assert.equal(h.raid.planApproved, false);
    assert.equal(legacy.payload.embeds.length, 1);
    assert.equal(h.events.filter(e => e.kind === 'dm').length, 0);
    await h.controller.handle(h.interaction('approve', legacy));
    assert.equal(h.raid.planApproved, true);
});

test('PNG hazırlanırken kadro değişirse yeniden çizilir; eski PNG onaylanamaz', async () => {
    const h = harness();
    const render = h.deps.render;
    let calls = 0;
    h.deps.render = async (...args) => { if (calls++ === 0) h.players.pop(); return render(...args); };
    await h.draft();
    assert.equal(calls, 2);
    assert.equal(h.main().payload.embeds[0].toJSON().fields[1].value, '9 / 10');
});

test('DM kapalıysa mevcut kanal fallback çalışır; yeni mesaj çoğalmaz', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = harness();
    h.client.users.fetch = async () => { throw new Error('DM closed'); };
    assert.equal(await h.draft(), true);
    assert.equal(h.events.filter(e => e.kind === 'channel').length, 1);
    await h.draft();
    assert.equal(h.events.filter(e => e.kind === 'channel').length, 1);
});

test('geçici edit hatası ikinci DM üretmez; render hatasında kırmızı hata embed görünür', async t => {
    t.mock.method(console, 'error', () => {});
    const h = harness();
    await h.draft();
    const main = h.main();
    main.fail = new Error('Discord unavailable');
    assert.equal(await h.draft(), false);
    assert.equal(h.events.filter(e => e.kind === 'dm').length, 1);
    main.fail = null;
    h.deps.render = async () => { throw new Error('Renderer failed'); };
    await h.controller.handle(h.interaction('recalc', main));
    assert.equal(main.payload.embeds[0].toJSON().color, 0xed4245);
    assert.equal(h.raid.planApproved, false);
    assert.equal(main.payload.components[0].toJSON().components[0].disabled, true);
});

test('silinmiş kontrol mesajı bir kez değiştirilir; eski mesajdaki buton reddedilir', async () => {
    const h = harness();
    await h.draft();
    const old = h.main();
    old.fail = Object.assign(new Error('Unknown Message'), { code: 10008 });
    await h.draft();
    assert.equal(h.events.filter(e => e.kind === 'dm').length, 2);
    await h.controller.handle(h.interaction('approve', old));
    assert.equal(h.raid.planApproved, false);
});

test('başka kullanıcı, kapanmış ve silinmiş raid onaylanamaz', async () => {
    const h = harness();
    await h.draft();
    const main = h.main();
    await h.controller.handle(h.interaction('approve', main, '', 'stranger'));
    assert.equal(h.raid.planApproved, false);
    h.raid.kapandi = true;
    await h.controller.handle(h.interaction('approve', main));
    assert.equal(h.raid.planApproved, false);
    h.raids.clear();
    await h.controller.handle(h.interaction('approve', main));
    assert.equal(h.raid.planApproved, false);
});
