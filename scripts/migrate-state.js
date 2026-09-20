#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  DULMS Watcher — State Migration (v11/v12/v13 → v14)
 *  ═══════════════════════════════════════════════════════════════════════════
 *
 *  🎯 الوظيفة:
 *    يحوّل ملف الـ state من نسخة قديمة لنسخة v14 الحديثة
 *    مع الحفاظ على كل البيانات المهمة
 *
 *  📋 الاستخدام:
 *
 *    # أساسي — يحوّل .dulms-state.json في place
 *    STATE_ENCRYPTION_KEY=<key> node scripts/migrate-state.js
 *
 *    # ملف معين
 *    STATE_ENCRYPTION_KEY=<key> node scripts/migrate-state.js --input old-state.json
 *
 *    # ملف جديد
 *    STATE_ENCRYPTION_KEY=<key> node scripts/migrate-state.js --output new-state.json
 *
 *    # بدون تشفير (لو عايز تفتح الملف بعدين)
 *    node scripts/migrate-state.js --no-encrypt
 *
 *  ⚙️ Options:
 *    --input  <path>   الملف المصدر (default: .dulms-state.json)
 *    --output <path>   الملف الهدف (default: نفس المصدر)
 *    --verbose         تفاصيل إضافية
 *    --dry-run         يعرض التغييرات بدون كتابة
 *    --no-encrypt      يكتب plaintext (مش مفضل)
 *    --no-backup       ما يعملش backup
 *
 *  ⚠️  ملاحظات:
 *    - الملف الأصلي بيتحفظ كـ .v-old.bak
 *    - لو الملف مُشفر، لازم STATE_ENCRYPTION_KEY
 *    - آمن تماماً — لو فشل، ما بيعدلش الملف الأصلي
 *
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════════════
//  ARGS PARSING
// ═══════════════════════════════════════════════════════════════════════════
const args = process.argv.slice(2);

const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const hasFlag = (name) => args.includes(name);

// Paths
const INPUT_PATH  = getArg('--input',  path.join(process.cwd(), '.dulms-state.json'));
const OUTPUT_PATH = getArg('--output', INPUT_PATH);
const BACKUP_PATH = INPUT_PATH + '.v-old.bak';

// Flags
const VERBOSE     = hasFlag('--verbose');
const DRY_RUN     = hasFlag('--dry-run');
const NO_ENCRYPT  = hasFlag('--no-encrypt');
const NO_BACKUP   = hasFlag('--no-backup');

// ═══════════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════════
const ENC_PREFIX   = 'ENC1:';
const TARGET_VER   = 140;
const TARGET_NAME  = 'v14.0-monolith';

// ═══════════════════════════════════════════════════════════════════════════
//  CRYPTO
// ═══════════════════════════════════════════════════════════════════════════
function getEncryptionKey() {
  const k = process.env.STATE_ENCRYPTION_KEY || '';

  if (!k) return null;

  if (!/^[0-9a-fA-F]{64}$/.test(k)) {
    console.error('');
    console.error('❌ STATE_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
    console.error(`   Got: ${k.length} chars`);
    console.error('');
    console.error('💡 Generate one with:');
    console.error('   openssl rand -hex 32');
    console.error('   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    console.error('');
    process.exit(1);
  }

  return Buffer.from(k, 'hex');
}

function encryptString(plain) {
  const key = getEncryptionKey();
  if (!key) return String(plain);

  const iv  = crypto.randomBytes(12);
  const c   = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);

  return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function decryptString(data) {
  const s = String(data);
  if (!s.startsWith(ENC_PREFIX)) return s;

  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      'File is encrypted but STATE_ENCRYPTION_KEY is not set.\n' +
      '   Set it: export STATE_ENCRYPTION_KEY=<your-key>'
    );
  }

  const buf = Buffer.from(s.slice(ENC_PREFIX.length), 'base64');

  if (buf.length < 28) {
    throw new Error('Encrypted data too short — file may be corrupted');
  }

  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);

  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);

  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ═══════════════════════════════════════════════════════════════════════════
//  DEFAULT v14 STATE
// ═══════════════════════════════════════════════════════════════════════════
function defaultStateV14() {
  return {
    // ─── Metadata ────────────────────────────────────────────────
    version:            TARGET_VER,
    startedAt:          0,

    // ─── Core data ───────────────────────────────────────────────
    registeredCourses:  [],
    targets:            {},

    // ─── Telegram ────────────────────────────────────────────────
    pendingCallbacks:   {},
    _cbCounter:         0,
    lastTgUpdateId:     0,
    tgChatId:           null,

    // ─── Runtime state ───────────────────────────────────────────
    startupBriefedAt:   0,
    paused:             false,
    lastError:          null,

    // ─── Dedup ───────────────────────────────────────────────────
    sentAlerts:         {},

    // ─── Session stats ───────────────────────────────────────────
    sessionStats: {
      logins:      0,
      reuses:      0,
      relogins:    0,
      failures:    0,
      validations: 0,
      lastLoginAt: 0,
      lastReuseAt: 0,
    },

    // ─── Reg window ──────────────────────────────────────────────
    regWindow: {
      status:    null,
      lastCheck: 0,
    },

    // ─── Early detection ─────────────────────────────────────────
    earlyDetection: {
      enabled:   true,
      checks:    0,
      hits:      0,
      lastCheck: 0,
    },

    // ─── Gap stats ───────────────────────────────────────────────
    gapStats: {
      lastRunStartedAt: 0,
      lastRunEndedAt:   0,
      maxGapMs:         0,
      avgGapMs:         0,
      gapCount:         0,
    },

    // ─── Audit trail ─────────────────────────────────────────────
    audit: [],

    // ─── Counters ────────────────────────────────────────────────
    counters: {
      opens:              0,
      drops:              0,
      adds:               0,
      newGroups:          0,
      seatIncreases:      0,
      blockChanges:       0,
      relogins:           0,
      errors:             0,
      alertsSent:         0,
      dedupHits:          0,
      loginFailures:      0,
      scans:              0,
      sessionDeaths:      0,
      sessionValidations: 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  MIGRATION LOGIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * يحوّل state من أي نسخة قديمة لـ v14
 *
 * @param {object} old - الـ state القديم
 * @returns {object} - الـ state الجديد
 */
function migrateState(old) {
  if (!old || typeof old !== 'object') {
    return defaultStateV14();
  }

  const base = defaultStateV14();

  // ─── Merge layer-by-layer ────────────────────────────────────────
  const merged = {
    ...base,
    ...old,

    // ─── Object merges (لازم نضمن إن كل الحقول موجودة) ─────────
    counters: {
      ...base.counters,
      ...(old.counters || {}),
    },

    earlyDetection: {
      ...base.earlyDetection,
      ...(old.earlyDetection || {}),
    },

    regWindow: {
      ...base.regWindow,
      ...(old.regWindow || {}),
    },

    sessionStats: {
      ...base.sessionStats,
      ...(old.sessionStats || {}),
    },

    gapStats: {
      ...base.gapStats,
      ...(old.gapStats || {}),
    },

    // ─── Reset maps (عشان نضمن إنهم objects) ────────────────────
    sentAlerts: old.sentAlerts || {},
    targets:    old.targets || {},
  };

  // ─── Audit trail — آخر 500 بس ────────────────────────────────────
  merged.audit = Array.isArray(merged.audit)
    ? merged.audit.slice(-500)
    : [];

  // ─── Normalize types ─────────────────────────────────────────────
  if (!merged.pendingCallbacks || typeof merged.pendingCallbacks !== 'object') {
    merged.pendingCallbacks = {};
  }

  if (typeof merged._cbCounter !== 'number') {
    merged._cbCounter = 0;
  }

  if (typeof merged.lastTgUpdateId !== 'number') {
    merged.lastTgUpdateId = 0;
  }

  // ─── Counters numeric validation ─────────────────────────────────
  for (const key of Object.keys(merged.counters)) {
    if (typeof merged.counters[key] !== 'number' || isNaN(merged.counters[key])) {
      merged.counters[key] = 0;
    }
  }

  // ─── Add migration audit entry ───────────────────────────────────
  merged.audit.push({
    t: Date.now(),
    event: 'migrated',
    from: old.version || 'unknown',
    to: TARGET_VER,
    tool: 'migrate-state.js',
  });

  // ─── Set version ─────────────────────────────────────────────────
  merged.version = TARGET_VER;

  return merged;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function printBanner() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🛡️  DULMS Watcher — State Migration');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log(`  Target: ${TARGET_NAME} (stateVersion=${TARGET_VER})`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
}

function printConfig() {
  console.log('⚙️  Configuration:');
  console.log('');

  console.log('  📁 Paths:');
  console.log(`     Input:   ${INPUT_PATH}`);
  console.log(`     Output:  ${OUTPUT_PATH}`);
  console.log(`     Backup:  ${NO_BACKUP ? '(disabled)' : BACKUP_PATH}`);
  console.log('');

  console.log('  🔐 Encryption:');
  const keySet = !!process.env.STATE_ENCRYPTION_KEY;
  console.log(`     STATE_ENCRYPTION_KEY: ${keySet ? '✓ set' : '✗ not set'}`);
  console.log(`     Output mode:          ${NO_ENCRYPT ? 'PLAINTEXT (⚠️)' : 'AES-256-GCM'}`);
  console.log('');

  console.log('  🎛️  Flags:');
  console.log(`     Verbose:     ${VERBOSE ? '✓' : '✗'}`);
  console.log(`     Dry-run:     ${DRY_RUN ? '✓ (no write)' : '✗'}`);
  console.log('');

  console.log('');
}

function printStateSummary(label, s) {
  console.log(`  ${label}`);
  console.log('');

  console.log(`     version:          ${s.version || 'unknown'}`);
  console.log(`     targets:          ${Object.keys(s.targets || {}).length}`);
  console.log(`     courses:          ${(s.registeredCourses || []).length}`);
  console.log(`     audit:            ${(s.audit || []).length} entries`);
  console.log(`     sentAlerts:       ${Object.keys(s.sentAlerts || {}).length} fingerprints`);
  console.log(`     paused:           ${s.paused ? 'YES' : 'no'}`);
  console.log('');

  if (s.counters) {
    console.log(`     counters.opens:          ${s.counters.opens || 0}`);
    console.log(`     counters.newGroups:      ${s.counters.newGroups || 0}`);
    console.log(`     counters.seatIncreases:  ${s.counters.seatIncreases || 0}`);
    console.log(`     counters.blockChanges:   ${s.counters.blockChanges || 0}`);
    console.log(`     counters.alertsSent:     ${s.counters.alertsSent || 0}`);
  }
  console.log('');
}

function printDiff(old, nw) {
  if (!VERBOSE) return;

  console.log('  📊 Diff:');
  console.log('');

  const oldVer = old.version || 'unknown';
  console.log(`     version:              ${oldVer} → ${nw.version}`);

  // Counters
  const oldC = old.counters || {};
  const newC = nw.counters  || {};

  const counterKeys = [
    'opens', 'newGroups', 'seatIncreases', 'blockChanges',
    'drops', 'alertsSent', 'dedupHits', 'relogins', 'errors', 'scans',
  ];

  console.log('');
  console.log('     Counters:');
  for (const k of counterKeys) {
    const o = oldC[k] || 0;
    const n = newC[k] || 0;
    const mark = o === n ? ' ' : '✨';
    console.log(`       ${mark} ${k.padEnd(18)} ${o} → ${n}`);
  }

  // Session stats
  console.log('');
  console.log('     Session stats:');
  const oldS = old.sessionStats || {};
  const newS = nw.sessionStats  || {};
  for (const k of ['logins', 'reuses', 'relogins', 'failures', 'validations']) {
    const o = oldS[k] || 0;
    const n = newS[k] || 0;
    const mark = o === n ? ' ' : '✨';
    console.log(`       ${mark} ${k.padEnd(18)} ${o} → ${n}`);
  }

  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════
(function main() {

  printBanner();
  printConfig();

  // ═══════════════════════════════════════════════════════════════
  //  1. Check input file
  // ═══════════════════════════════════════════════════════════════
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`❌ Input file not found: ${INPUT_PATH}`);
    console.error('');
    console.error('   Nothing to migrate.');
    console.error('   A fresh v14 state will be created at first run.');
    console.error('');
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════
  //  2. Read input file
  // ═══════════════════════════════════════════════════════════════
  console.log('📖 Reading input file…');
  console.log('');

  let oldState;
  let wasEncrypted = false;

  try {
    const raw = fs.readFileSync(INPUT_PATH, 'utf8');
    wasEncrypted = raw.startsWith(ENC_PREFIX);

    const plain = decryptString(raw);

    oldState = JSON.parse(plain);

    console.log(`   ✓ Read OK (${raw.length} chars)`);
    console.log(`   ✓ Encrypted: ${wasEncrypted ? 'YES' : 'no'}`);
    console.log(`   ✓ Parsed OK`);
    console.log('');

  } catch (e) {
    console.error(`❌ Failed to read input: ${e.message}`);
    console.error('');
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════
  //  3. Show current state
  // ═══════════════════════════════════════════════════════════════
  printStateSummary('📊 Current state:', oldState);

  // ═══════════════════════════════════════════════════════════════
  //  4. Check if already v14
  // ═══════════════════════════════════════════════════════════════
  if (oldState.version === TARGET_VER) {
    console.log(`ℹ️  State is already ${TARGET_NAME}`);
    console.log('');

    if (!VERBOSE) {
      console.log('   Nothing to do. Use --verbose to refresh structure anyway.');
      console.log('');
      process.exit(0);
    }

    console.log('   (--verbose: refreshing structure)');
    console.log('');
  }

  // ═══════════════════════════════════════════════════════════════
  //  5. Create backup
  // ═══════════════════════════════════════════════════════════════
  if (!NO_BACKUP) {
    if (fs.existsSync(BACKUP_PATH)) {
      console.log(`ℹ️  Backup already exists: ${BACKUP_PATH}`);
      console.log(`   (skipping — delete manually to re-create)`);
      console.log('');
    } else {
      console.log(`💾 Creating backup…`);
      try {
        fs.copyFileSync(INPUT_PATH, BACKUP_PATH);
        console.log(`   ✓ Saved: ${BACKUP_PATH}`);
        console.log('');
      } catch (e) {
        console.error(`❌ Backup failed: ${e.message}`);
        console.error('');
        process.exit(1);
      }
    }
  } else {
    console.log(`⚠️  Backup disabled (--no-backup)`);
    console.log('');
  }

  // ═══════════════════════════════════════════════════════════════
  //  6. Perform migration
  // ═══════════════════════════════════════════════════════════════
  console.log('🔄 Migrating…');
  console.log('');

  let newState;
  try {
    newState = migrateState(oldState);
    console.log(`   ✓ Migration complete`);
    console.log('');
  } catch (e) {
    console.error(`❌ Migration failed: ${e.message}`);
    console.error('');
    process.exit(1);
  }

  printStateSummary('📊 New state:', newState);
  printDiff(oldState, newState);

  // ═══════════════════════════════════════════════════════════════
  //  7. Dry-run check
  // ═══════════════════════════════════════════════════════════════
  if (DRY_RUN) {
    console.log('🧪 DRY-RUN — no files were written');
    console.log('');
    console.log('   Re-run without --dry-run to apply changes.');
    console.log('');
    process.exit(0);
  }

  // ═══════════════════════════════════════════════════════════════
  //  8. Prepare output
  // ═══════════════════════════════════════════════════════════════
  console.log(`✍️  Writing output…`);
  console.log(`   Target: ${OUTPUT_PATH}`);
  console.log('');

  const jsonContent = JSON.stringify(newState, null, 2);
  const shouldEncrypt = !NO_ENCRYPT && !!process.env.STATE_ENCRYPTION_KEY;

  let outputContent;
  if (shouldEncrypt) {
    outputContent = encryptString(jsonContent);
    console.log(`   ✓ Encrypted (AES-256-GCM)`);
  } else if (NO_ENCRYPT) {
    outputContent = jsonContent;
    console.log(`   ⚠️  PLAINTEXT (--no-encrypt)`);
  } else {
    outputContent = jsonContent;
    console.log(`   ⚠️  PLAINTEXT (no STATE_ENCRYPTION_KEY)`);
  }

  // ═══════════════════════════════════════════════════════════════
  //  9. Atomic write
  // ═══════════════════════════════════════════════════════════════
  const tmpPath = OUTPUT_PATH + '.tmp';

  try {
    fs.writeFileSync(tmpPath, outputContent);
    fs.renameSync(tmpPath, OUTPUT_PATH);
    console.log(`   ✓ Written (${outputContent.length} chars)`);
    console.log('');
  } catch (e) {
    console.error(`❌ Write failed: ${e.message}`);
    console.error('');
    // Cleanup tmp
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════
  //  10. Verify
  // ═══════════════════════════════════════════════════════════════
  console.log('🔍 Verifying…');
  console.log('');

  try {
    const verifyRaw = fs.readFileSync(OUTPUT_PATH, 'utf8');
    const verifyPlain = decryptString(verifyRaw);
    const verifyState = JSON.parse(verifyPlain);

    if (verifyState.version !== TARGET_VER) {
      throw new Error(`Version mismatch: expected ${TARGET_VER}, got ${verifyState.version}`);
    }

    console.log(`   ✓ Re-read OK`);
    console.log(`   ✓ Version: ${verifyState.version}`);
    console.log(`   ✓ Targets: ${Object.keys(verifyState.targets).length}`);
    console.log(`   ✓ Courses: ${verifyState.registeredCourses.length}`);
    console.log(`   ✓ Audit:   ${verifyState.audit.length} entries`);
    console.log('');

  } catch (e) {
    console.error(`❌ Verification failed: ${e.message}`);
    console.error('');

    // Restore from backup
    if (!NO_BACKUP && fs.existsSync(BACKUP_PATH)) {
      console.error('⚠️  Restoring from backup…');
      try {
        fs.copyFileSync(BACKUP_PATH, INPUT_PATH);
        console.error('   ✓ Backup restored');
      } catch (re) {
        console.error(`   ✗ Restore failed: ${re.message}`);
      }
    }

    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════
  //  DONE
  // ═══════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ✅ Migration complete');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  📋 Summary:');
  console.log(`     From:   v${oldState.version || 'unknown'}`);
  console.log(`     To:     ${TARGET_NAME}`);
  console.log(`     File:   ${OUTPUT_PATH}`);
  if (!NO_BACKUP) {
    console.log(`     Backup: ${BACKUP_PATH}`);
  }
  console.log('');

  console.log('  🚀 Next steps:');
  console.log('');
  console.log('     1. Verify:');
  if (shouldEncrypt) {
    console.log(`        STATE_ENCRYPTION_KEY=<key> node scripts/decrypt-state.js`);
  } else {
    console.log(`        head -c 200 ${OUTPUT_PATH}`);
  }
  console.log('');
  console.log('     2. Run watcher:');
  console.log(`        node watch.js`);
  console.log('');
  console.log('     3. Test in Telegram:');
  console.log(`        /status`);
  console.log('');

  if (!NO_BACKUP) {
    console.log('  🔙 Rollback (if needed):');
    console.log(`     cp ${BACKUP_PATH} ${INPUT_PATH}`);
    console.log('');
  }

})();
