'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// ═══════════════════════════════════════════════════════════════════════
//  State Tests — v14 migration + structure
// ═══════════════════════════════════════════════════════════════════════

const CONFIG = { stateVersion: 140 };

function defaultState() {
  return {
    version: CONFIG.stateVersion,
    startedAt: 0,
    registeredCourses: [],
    targets: {},
    pendingCallbacks: {},
    _cbCounter: 0,
    lastTgUpdateId: 0,
    tgChatId: null,
    startupBriefedAt: 0,
    paused: false,
    lastError: null,
    sentAlerts: {},
    sessionStats: {
      logins: 0, reuses: 0, relogins: 0, failures: 0,
      validations: 0, lastLoginAt: 0, lastReuseAt: 0,
    },
    regWindow: { status: null, lastCheck: 0 },
    earlyDetection: { enabled: true, checks: 0, hits: 0, lastCheck: 0 },
    gapStats: {
      lastRunStartedAt: 0, lastRunEndedAt: 0,
      maxGapMs: 0, avgGapMs: 0, gapCount: 0,
    },
    audit: [],
    counters: {
      opens: 0, drops: 0, adds: 0,
      newGroups: 0, seatIncreases: 0, blockChanges: 0,
      relogins: 0, errors: 0, alertsSent: 0, dedupHits: 0,
      loginFailures: 0, scans: 0, sessionDeaths: 0, sessionValidations: 0,
    },
  };
}

function migrateState(s) {
  if (!s || typeof s !== 'object') return defaultState();
  const base = defaultState();
  const merged = {
    ...base, ...s,
    counters:       { ...base.counters,       ...(s.counters       || {}) },
    earlyDetection: { ...base.earlyDetection, ...(s.earlyDetection || {}) },
    regWindow:      { ...base.regWindow,      ...(s.regWindow      || {}) },
    sessionStats:   { ...base.sessionStats,   ...(s.sessionStats   || {}) },
    gapStats:       { ...base.gapStats,       ...(s.gapStats       || {}) },
    sentAlerts:     s.sentAlerts || {},
    targets:        s.targets || {},
  };
  merged.audit = Array.isArray(merged.audit) ? merged.audit.slice(-500) : [];
  if (!merged.pendingCallbacks || typeof merged.pendingCallbacks !== 'object') {
    merged.pendingCallbacks = {};
  }
  if (typeof merged._cbCounter !== 'number') merged._cbCounter = 0;
  merged.version = CONFIG.stateVersion;
  return merged;
}

// ─── Default state ──────────────────────────────────────────────────────
test('default state has version 140', () => {
  const s = defaultState();
  assert.strictEqual(s.version, 140);
});

test('default state has all v14 fields', () => {
  const s = defaultState();
  assert.ok(s.sentAlerts);
  assert.ok(s.sessionStats);
  assert.ok(s.gapStats);
  assert.ok(s.earlyDetection);
  assert.ok(s.regWindow);
  assert.strictEqual(s.counters.blockChanges, 0);
  assert.strictEqual(s.counters.dedupHits, 0);
  assert.strictEqual(s.counters.sessionDeaths, 0);
});

// ─── Migration ──────────────────────────────────────────────────────────
test('migrate null → default', () => {
  const s = migrateState(null);
  assert.strictEqual(s.version, 140);
});

test('migrate empty → default', () => {
  const s = migrateState({});
  assert.strictEqual(s.version, 140);
});

test('migrate v11 state preserves targets', () => {
  const v11 = {
    version: 110,
    targets: { 'GEN 101': { id: '996', groups: {} } },
    counters: { opens: 5, newGroups: 3 },
  };
  const s = migrateState(v11);
  assert.strictEqual(s.version, 140);
  assert.strictEqual(s.targets['GEN 101'].id, '996');
  assert.strictEqual(s.counters.opens, 5);
  assert.strictEqual(s.counters.newGroups, 3);
  assert.strictEqual(s.counters.blockChanges, 0);
});

test('migrate v12 state keeps sessionStats', () => {
  const v12 = { version: 120, sessionStats: { logins: 10, reuses: 5 } };
  const s = migrateState(v12);
  assert.strictEqual(s.sessionStats.logins, 10);
  assert.strictEqual(s.sessionStats.reuses, 5);
  assert.strictEqual(s.sessionStats.validations, 0);
});

test('migrate v13 state keeps gapStats', () => {
  const v13 = { version: 130, gapStats: { gapCount: 5, maxGapMs: 60000 } };
  const s = migrateState(v13);
  assert.strictEqual(s.gapStats.gapCount, 5);
  assert.strictEqual(s.gapStats.maxGapMs, 60000);
});

test('migrate preserves audit (last 500)', () => {
  const v11 = { audit: new Array(1000).fill({ event: 'test' }) };
  const s = migrateState(v11);
  assert.strictEqual(s.audit.length, 500);
});

test('invalid pendingCallbacks normalized', () => {
  const s = migrateState({ pendingCallbacks: 'not-object' });
  assert.deepStrictEqual(s.pendingCallbacks, {});
});

test('_cbCounter non-number normalized', () => {
  const s = migrateState({ _cbCounter: 'invalid' });
  assert.strictEqual(s._cbCounter, 0);
});

test('_cbCounter preserved if valid', () => {
  const s = migrateState({ _cbCounter: 42 });
  assert.strictEqual(s._cbCounter, 42);
});

// ─── Targets ────────────────────────────────────────────────────────────
test('targets preserved through migration', () => {
  const old = {
    targets: {
      'GEN 101': {
        id: '996',
        name: 'English 2',
        status: 5,
        groups: { 'A': { open: true, seats: 5 } },
        knownGroups: { 'A': { firstSeen: 123 } },
        watchGroups: ['A'],
        firstScanDone: true,
      },
    },
  };
  const s = migrateState(old);
  assert.strictEqual(s.targets['GEN 101'].id, '996');
  assert.strictEqual(s.targets['GEN 101'].firstScanDone, true);
  assert.deepStrictEqual(s.targets['GEN 101'].watchGroups, ['A']);
});

// ─── Counters merge ─────────────────────────────────────────────────────
test('counters merged with defaults', () => {
  const old = { counters: { opens: 100, newGroups: 50 } };
  const s = migrateState(old);
  assert.strictEqual(s.counters.opens, 100);
  assert.strictEqual(s.counters.newGroups, 50);
  assert.strictEqual(s.counters.seatIncreases, 0);
  assert.strictEqual(s.counters.blockChanges, 0);
});

test('unknown counter keys ignored', () => {
  const old = { counters: { unknownKey: 999 } };
  const s = migrateState(old);
  assert.strictEqual(s.counters.unknownKey, undefined);
});
