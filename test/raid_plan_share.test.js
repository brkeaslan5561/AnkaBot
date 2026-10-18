const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { AttachmentBuilder } = require('discord.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'raid.js'), 'utf8');
const body = source.slice(source.indexOf('async function sendFinalPlan('), source.indexOf('function planPublicationAction('));

function harness() {
    const sent = [], saved = [];
    const state = { current: true, closed: false, fetched: null, renders: 0 };
    const plan = { rows: [{ userId: '123' }] };
    const image = Buffer.from('reviewed PNG');
    const raid = { channelId: '456', zindanKodu: 'MSH', published: true, planNeedsRefresh: true };
    const deps = {
        raidLanguage: () => 'en', generatePlan: () => plan,
        t: (_language, key) => key,
        renderRaidTable: async () => { state.renders++; return image; },
        AttachmentBuilder, createHash,
        isRaidClosed: () => state.closed,
        saveRaid: (id, value) => saved.push({ id, value }),
        planInputFingerprint: () => 'current-version'
    };
    const send = new Function(...Object.keys(deps), `${body}\nreturn sendFinalPlan;`)(...Object.values(deps));
    const client = { user: {}, channels: { fetch: async id => {
        assert.equal(id, raid.channelId);
        if (state.fetched) await state.fetched();
        return { send: async payload => { sent.push(payload); return { id: '789' }; } };
    } } };
    return { state, sent, saved, raid, image, send: (phase = 'manual', fingerprint = 'reviewed-version') =>
        send(client, '101', raid, phase, phase === 'manual' ? { plan, image, fingerprint, isCurrent: () => state.current } : null) };
}

test('manual sharing sends the reviewed PNG with a stable nonce without consuming automatic checkpoints', async () => {
    const h = harness(), before = structuredClone(h.raid);
    assert.equal((await h.send()).id, '789');
    assert.equal(h.sent[0].files[0].attachment, h.image);
    assert.equal(h.sent[0].files[0].name, 'anka-msh-updated-plan.png');
    assert.match(h.sent[0].content, /raid\.plan\.manual_share/);
    assert.deepEqual(h.sent[0].allowedMentions, { parse: [] });
    assert.equal(h.sent[0].enforceNonce, true);
    assert.equal(h.state.renders, 0);
    assert.deepEqual(h.raid, before);
    assert.equal(h.saved.length, 0);
    await h.send();
    assert.equal(h.sent[0].nonce, h.sent[1].nonce);
    await h.send('manual', 'changed-version');
    assert.notEqual(h.sent[0].nonce, h.sent[2].nonce);
});

test('manual sharing rechecks edits, closure and publication after asynchronous channel lookup', async () => {
    for (const change of [h => { h.state.current = false; }, h => { h.state.closed = true; }, h => { h.raid.published = false; }]) {
        const h = harness();
        h.state.fetched = () => change(h);
        await assert.rejects(h.send(), /changed before sharing/);
        assert.equal(h.sent.length, 0);
        assert.equal(h.saved.length, 0);
    }
});

test('automatic table publication still persists each existing checkpoint and mentions participants', async () => {
    for (const phase of ['initial', 'checkpoint', 'kickoff']) {
        const h = harness();
        await h.send(phase);
        assert.equal(h.state.renders, 1);
        assert.equal(h.saved.length, 1);
        assert.equal(h.raid.finalSent, true);
        assert.equal(h.raid.finalMessageId, '789');
        assert.equal(h.raid.finalPlanFingerprint, 'current-version');
        assert.equal(h.raid.planNeedsRefresh, false);
        assert.equal(h.raid.fiveMinuteCheckpointSent, phase === 'checkpoint' ? true : undefined);
        assert.equal(h.raid.kickoffFinalSent, phase === 'kickoff' ? true : undefined);
        assert.deepEqual(h.sent[0].allowedMentions, { users: ['123'] });
        assert.equal(h.sent[0].nonce, undefined);
    }
});
