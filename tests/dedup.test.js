'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════════
//  Dedup Tests — Alert Fingerprinting
// ═══════════════════════════════════════════════════════════════════════

function makeFingerprint(type, payload) {
  return crypto.createHash('sha1')
    .update(`${type}:${JSON.stringify(payload)}`)
    .digest('hex')
    .slice(0, 16);
}

function shouldSendAlert(state, fingerprint, windowMs = 5 * 60 * 1000) {
  state.sentAlerts = state.sentAlerts || {};
  state.counters = state.counters || { dedupHits: 0 };
  const now = Date.now();

  const cleanupThreshold = windowMs * 4;
  for (const [k, t] of Object.entries(state.sentAlerts)) {
    if (now - t > cleanupThreshold) delete state.sentAlerts[k];
  }

  const last = state.sentAlerts[fingerprint];
  if (last && (now - last) < windowMs) {
    state.counters.dedupHits++;
    return false;
  }

  state.sentAlerts[fingerprint] = now;
  return true;
}

// ─── Fingerprint ────────────────────────────────────────────────────────
test('fingerprint deterministic', () => {
  const fp1 = makeFingerprint('course', { code: 'GEN101' });
  const fp2 = makeFingerprint('course', { code: 'GEN101' });
  assert.strictEqual(fp1, fp2);
});

test('different payloads → different fingerprints', () => {
  const fp1 = makeFingerprint('course', { code: 'GEN101' });
  const fp2 = makeFingerprint('course', { code: 'GEN102' });
  assert.notStrictEqual(fp1, fp2);
});

test('different types → different fingerprints', () => {
  const fp1 = makeFingerprint('course_appeared', { code: 'A' });
  const fp2 = makeFingerprint('new_group', { code: 'A' });
  assert.notStrictEqual(fp1, fp2);
});

test('fingerprint is 16 chars', () => {
  const fp = makeFingerprint('test', { a: 1 });
  assert.strictEqual(fp.length, 16);
});

// ─── Dedup logic ────────────────────────────────────────────────────────
test('first alert passes', () => {
  const state = {};
  const fp = makeFingerprint('test', { a: 1 });
  assert.strictEqual(shouldSendAlert(state, fp, 5000), true);
});

test('duplicate within window suppressed', () => {
  const state = {};
  const fp = makeFingerprint('test', { a: 1 });
  assert.strictEqual(shouldSendAlert(state, fp, 5000), true);
  assert.strictEqual(shouldSendAlert(state, fp, 5000), false);
  assert.strictEqual(state.counters.dedupHits, 1);
});

test('passes again after window', async () => {
  const state = {};
  const fp = makeFingerprint('test', { a: 1 });
  assert.strictEqual(shouldSendAlert(state, fp, 100), true);
  await new Promise(r => setTimeout(r, 150));
  assert.strictEqual(shouldSendAlert(state, fp, 100), true);
});

test('old fingerprints cleaned up', () => {
  const state = {};
  state.sentAlerts = { 'old': Date.now() - 1_000_000 };
  const fp = makeFingerprint('test', { a: 1 });
  shouldSendAlert(state, fp, 1000);
  assert.strictEqual(state.sentAlerts['old'], undefined);
});

// ─── Multiple alerts ────────────────────────────────────────────────────
test('different alerts all pass', () => {
  const state = {};
  const fps = [
    makeFingerprint('course', { code: 'A' }),
    makeFingerprint('course', { code: 'B' }),
    makeFingerprint('course', { code: 'C' }),
  ];
  for (const fp of fps) {
    assert.strictEqual(shouldSendAlert(state, fp, 5000), true);
  }
  assert.strictEqual(Object.keys(state.sentAlerts).length, 3);
});

test('recent fingerprints preserved on cleanup', () => {
  const state = {};
  const fp1 = makeFingerprint('a', { x: 1 });
  shouldSendAlert(state, fp1, 10_000);
  const fp2 = makeFingerprint('b', { x: 2 });
  shouldSendAlert(state, fp2, 10_000);
  assert.strictEqual(Object.keys(state.sentAlerts).length, 2);
});

test('dedup counter increments correctly', () => {
  const state = {};
  const fp = makeFingerprint('test', { a: 1 });
  shouldSendAlert(state, fp, 5000);
  shouldSendAlert(state, fp, 5000);
  shouldSendAlert(state, fp, 5000);
  assert.strictEqual(state.counters.dedupHits, 2);
});

// ─── Real-world scenarios ───────────────────────────────────────────────
test('course appeared: 1 hour window', () => {
  const state = {};
  const fp = makeFingerprint('course_appeared', { code: 'GEN 101' });
  assert.strictEqual(shouldSendAlert(state, fp, 60 * 60 * 1000), true);
  assert.strictEqual(shouldSendAlert(state, fp, 60 * 60 * 1000), false);
});

test('seat increase: 2 min window', () => {
  const state = {};
  const fp = makeFingerprint('seat_increase', { code: 'GEN 101', changes: ['A:5→8'] });
  assert.strictEqual(shouldSendAlert(state, fp, 2 * 60 * 1000), true);
  assert.strictEqual(shouldSendAlert(state, fp, 2 * 60 * 1000), false);
});

test('different groups → different alerts', () => {
  const state = {};
  const fp1 = makeFingerprint('new_group', { code: 'GEN 101', names: ['A'] });
  const fp2 = makeFingerprint('new_group', { code: 'GEN 101', names: ['B'] });
  assert.strictEqual(shouldSendAlert(state, fp1, 5000), true);
  assert.strictEqual(shouldSendAlert(state, fp2, 5000), true);
});
