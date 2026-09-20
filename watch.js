/* ═══════════════════════════════════════════════════════════════════════════
 *                                                                           ═
 *   ██████╗ ██╗   ██╗██╗     ███╗   ███╗███████╗                            ═
 *   ██╔══██╗██║   ██║██║     ████╗ ████║██╔════╝                            ═
 *   ██║  ██║██║   ██║██║     ██╔████╔██║███████╗                            ═
 *   ██║  ██║██║   ██║██║     ██║╚██╔╝██║╚════██║                            ═
 *   ██████╔╝╚██████╔╝███████╗██║ ╚═╝ ██║███████║                            ═
 *   ╚═════╝  ╚═════╝ ╚══════╝╚═╝     ╚═╝╚══════╝                            ═
 *                                                                           ═
 *   WATCHER — v14.0 "Monolith"                                              ═
 *                                                                           ═
 *   🎯 الهدف: مراقبة GEN 101 على DULMS + تنبيهات فورية على المقاعد        ═
 *                                                                           ═
 *   📦 المحتويات:                                                           ═
 *   ─────────────────────────────────────────────────────────────           ═
 *     § 1  — CONFIG              : كل الإعدادات                             ═
 *     § 2  — CONSTANTS           : ثوابت                                     ═
 *     § 3  — ERRORS              : Custom error classes                    ═
 *     § 4  — CRYPTO              : AES-256-GCM                              ═
 *     § 5  — REDACTION           : إخفاء secrets                            ═
 *     § 6  — LOGGER              : Logging مع timestamp                     ═
 *     § 7  — TIME UTILS          : utilities الوقت                          ═
 *     § 8  — FILE UTILS          : atomic writes, rotate                    ═
 *     § 9  — STRING UTILS        : normalize, escape, hash                   ═
 *     § 10 — ASYNC UTILS         : retry, timeout, sleep                    ═
 *     § 11 — STATE               : load/save/migrate                        ═
 *     § 12 — AUDIT               : audit trail                              ═
 *     § 13 — DEDUP               : منع تكرار التنبيهات                     ═
 *     § 14 — TELEGRAM QUEUE      : queue + rate limit                      ═
 *     § 15 — TELEGRAM SENDER     : sendMessage                              ═
 *     § 16 — TELEGRAM KEYBOARDS  : أزرار + commands                        ═
 *     § 17 — TELEGRAM POLLING    : getUpdates                               ═
 *     § 18 — TELEGRAM CALLBACKS  : inline buttons                          ═
 *     § 19 — TELEGRAM COMMANDS   : كل الأوامر                              ═
 *     § 20 — SESSION             : save/load/validate/refresh              ═
 *     § 21 — BROWSER             : launch + context                        ═
 *     § 22 — LOGIN               : login with retries                       ═
 *     § 23 — INTERCEPTION        : AJAX interception                        ═
 *     § 24 — API CLIENT          : HTTP calls                               ═
 *     § 25 — DETECTION: EARLY    : ظهور المادة                              ═
 *     § 26 — DETECTION: GROUP    : مجموعة جديدة + فتحت                      ═
 *     § 27 — DETECTION: SEAT     : زيادة مقاعد                              ═
 *     § 28 — DETECTION: BLOCK    : تغير الحجب                              ═
 *     § 29 — DETECTION: SECURITY : مواد مسجلة                              ═
 *     § 30 — MAIN LOOP           : scheduler + timers                       ═
 *     § 31 — HEARTBEAT           : memory + health                          ═
 *     § 32 — SHUTDOWN            : graceful shutdown                        ═
 *     § 33 — RECOVERY            : error recovery                           ═
 *     § 34 — ENTRYPOINT          : main                                     ═
 *                                                                           ═
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 0 — IMPORTS
// ═══════════════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const util   = require('util');

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 1 — USER CONFIG
//  ═══════════════════════════════════════════════════════════════════════════
//  كل الإعدادات اللي المستخدم بيعدّلها هنا فقط
// ═══════════════════════════════════════════════════════════════════════════
const USER_CONFIG = {

  // ─── 1.1 المواد المستهدفة ────────────────────────────────────────────
  targets: [
    { code: 'GEN 101', label: 'English 2' },
    // ضيف مواد تانية هنا لو عايز
    // { code: 'MEC 151', label: 'Mechanics' },
  ],

  // ─── 1.2 المواد المتوقعة (للتحقق من المواد المسجلة) ──────────────────
  expectedCourses: ['MEC151', 'BAS111', 'CIV111', 'CIV121', 'CIV131'],

  // ─── 1.3 فترات الفحص ─────────────────────────────────────────────────
  timing: {
    fastIntervalMs:      10 * 1000,       // 10s — فحص عادي
    slowIntervalMs:      30 * 1000,       // 30s — فحص هادئ
    securityIntervalMs:  10 * 60 * 1000,  // 10m — فحص المواد المسجلة
    telegramPollMs:      3 * 1000,        // 3s — polling تيليجرام
    heartbeatMs:         500,             // 0.5s — نبضة الـ loop
    sessionRenewEveryMs: 3 * 60 * 1000,   // 3m — تجديد الـ session
    stateFlushEveryMs:   30 * 1000,       // 30s — حفظ state
    memoryCheckMs:       60 * 1000,       // 60s — فحص الذاكرة
    pageHealthMs:        30 * 1000,       // 30s — فحص الصفحة
  },

  // ─── 1.4 التنبيهات ───────────────────────────────────────────────────
  notifications: {
    notifyWithSound:   true,              // صوت للتنبيهات المهمة
    maxTelegramPerMin: 20,                // rate limit
    startupBriefHours: 12,                // إعادة brief كل 12 ساعة
  },

  // ─── 1.5 منع التكرار ─────────────────────────────────────────────────
  dedup: {
    courseAppeared: 60 * 60 * 1000,       // ساعة
    newGroup:       10 * 60 * 1000,       // 10 دقايق
    groupOpen:      5  * 60 * 1000,       // 5 دقايق
    seatIncrease:   2  * 60 * 1000,       // دقيقتين
    blockChange:    10 * 60 * 1000,       // 10 دقايق
    courseDrop:     30 * 60 * 1000,       // 30 دقيقة
  },

  // ─── 1.6 Session ─────────────────────────────────────────────────────
  session: {
    maxAgeMs:  25 * 60 * 1000,            // 25 دقيقة → login جديد
    warnAgeMs: 15 * 60 * 1000,            // 15 دقيقة → validate
    validateBeforeUse: true,              // تحقق قبل الاستخدام
  },

  // ─── 1.7 Login ───────────────────────────────────────────────────────
  login: {
    maxAttempts: 4,
    baseDelayMs: 2_000,
    jitterMs:    1_500,
  },

  // ─── 1.8 السلوك ──────────────────────────────────────────────────────
  behavior: {
    alertOnNewGroups:    true,            // 🆕 مجموعة جديدة
    alertOnSeatIncrease: true,            // 📈 مقاعد زادت
    alertOnGroupOpen:    true,            // 🎉 مجموعة فتحت
    alertOnBlockChange:  true,            // 🚫 حالة الحجب
    alertOnCourseDrop:   true,            // 🚨 مادة اتشالت
    alertOnRegOpen:      false,           // 🚪 باب التسجيل (معطل)
    adaptivePolling:     true,            // تخفيف عند الهدوء
    autoResumeOnStart:   true,            // auto-resume لو paused
    sendStartupBrief:    true,            // brief عند البدء
    firstScanSilent:     true,            // أول scan صامت
  },

  // ─── 1.9 API ─────────────────────────────────────────────────────────
  api: {
    retryAttempts: 3,
    retryBaseMs:   800,
    timeoutMs:     15_000,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 2 — CONSTANTS
//  ═══════════════════════════════════════════════════════════════════════════

// ─── 2.1 Runtime CONFIG ──────────────────────────────────────────────
const CONFIG = {
  // URLs
  baseUrl:        'https://dulms.deltauniv.edu.eg',
  loginUrl:       'https://dulms.deltauniv.edu.eg/Login.aspx',
  coursesPageUrl: 'https://dulms.deltauniv.edu.eg/Registered/CoursesRegisteration',

  // API endpoints
  API: {
    coursesList:    '/Registered/GetStudentResiterationCourses',
    courseSchedule: '/Registered/GetCourseSchedual',
    regInfo:        '/Registered/GetStudentResiterationInfo',
  },

  // Credentials من env
  username:    process.env.DULMS_USERNAME || '',
  password:    process.env.DULMS_PASSWORD || '',
  tgToken:     process.env.TG_TOKEN       || '',
  tgChatId:    String(process.env.TG_CHAT_ID || ''),

  // Duration
  durationMin: parseFloat(process.env.DURATION_MIN || '50'),

  // Limits
  netTimeoutMs:      15_000,
  pageTimeoutMs:     60_000,
  memWarnMb:         700,
  memRestartMb:      900,
  auditMaxBytes:     1 * 1024 * 1024,
  tgMessageMaxChars: 3800,

  // Files
  stateFile:       path.join(process.cwd(), '.dulms-state.json'),
  sessionFile:     path.join(process.cwd(), '.dulms-session.json'),
  sessionMetaFile: path.join(process.cwd(), '.dulms-session-meta.json'),
  auditFile:       path.join(process.cwd(), '.dulms-audit.log'),

  // Metadata
  timezone:     'Africa/Cairo',
  stateVersion: 140,
  versionLabel: 'v14.0-monolith',
  userAgent:    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

// ─── 2.2 Result constants ────────────────────────────────────────────
const RESULT = Object.freeze({
  COMPLETED: 'completed',
  REBUILD:   'rebuild',
  FATAL:     'fatal',
  SHUTDOWN:  'shutdown',
});

// ─── 2.3 Session strategies ──────────────────────────────────────────
const SESSION_STRATEGY = Object.freeze({
  FRESH_LOGIN:  'fresh_login',
  VALIDATE:     'validate',
  USE_DIRECT:   'use_direct',
});

// ─── 2.4 Validation results ──────────────────────────────────────────
const VALIDATION = Object.freeze({
  VALID:   'valid',
  EXPIRED: 'expired',
  UNKNOWN: 'unknown',
});

// ─── 2.5 Encryption prefix ───────────────────────────────────────────
const ENC_PREFIX = 'ENC1:';

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 3 — CUSTOM ERRORS
//  ═══════════════════════════════════════════════════════════════════════════

/** خطأ تسجيل الدخول مع تفاصيل السبب */
class LoginError extends Error {
  constructor(message, cause, url, title, body) {
    super(message);
    this.name = 'LoginError';
    this.loginCause = cause;
    this.loginUrl   = url;
    this.loginTitle = title;
    this.loginBody  = body;
  }
}

/** خطأ انتهاء الجلسة */
class SessionDeadError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'SessionDeadError';
  }
}

/** خطأ من DULMS API */
class ApiError extends Error {
  constructor(kind, message) {
    super(message || `API error: ${kind}`);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 4 — CRYPTO (AES-256-GCM)
//  ═══════════════════════════════════════════════════════════════════════════

let _encKeyWarned = false;

/**
 * يجيب مفتاح التشفير من environment
 * @returns {Buffer|null}
 */
function getEncryptionKey() {
  const k = process.env.STATE_ENCRYPTION_KEY || '';

  if (!k) {
    if (!_encKeyWarned) {
      console.warn('[WARN] STATE_ENCRYPTION_KEY missing — files stored in PLAINTEXT');
      _encKeyWarned = true;
    }
    return null;
  }

  if (!/^[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error('STATE_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  }

  return Buffer.from(k, 'hex');
}

/**
 * يشفر string بـ AES-256-GCM
 * Format: ENC1:<iv(12)><tag(16)><ciphertext>base64
 * @param {string} plain
 * @returns {string}
 */
function encryptString(plain) {
  const key = getEncryptionKey();
  const s = String(plain);
  if (!key) return s;

  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(s, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return ENC_PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * يفك تشفير string
 * @param {string} data
 * @returns {string}
 */
function decryptString(data) {
  const s = String(data);
  if (!s.startsWith(ENC_PREFIX)) return s;

  const key = getEncryptionKey();
  if (!key) throw new Error('Encrypted file but STATE_ENCRYPTION_KEY missing');

  const buf = Buffer.from(s.slice(ENC_PREFIX.length), 'base64');

  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 5 — REDACTION
//  ═══════════════════════════════════════════════════════════════════════════

const REDACT_PATTERNS = [
  /(ASP\.NET_SessionId)\s*[=:]\s*["']?([^;"'\s]+)/gi,
  /(\.AUTH)\s*[=:]\s*["']?([^;"'\s]+)/gi,
  /(sessionid)\s*[=:]\s*["']?([^;"'\s]+)/gi,
  /(auth_token)\s*[=:]\s*["']?([^;"'\s]+)/gi,
  /(Bearer)\s+([A-Za-z0-9._\-+/=]+)/gi,
];

/**
 * يشيل أي secrets من string
 * @param {string} s
 * @returns {string}
 */
function redact(s) {
  let out = String(s ?? '');

  // Personal secrets
  const secrets = [
    CONFIG.password,
    CONFIG.username,
    CONFIG.tgToken,
    process.env.STATE_ENCRYPTION_KEY,
  ];

  for (const secret of secrets) {
    if (secret && String(secret).length >= 4) {
      out = out.split(String(secret)).join('«redacted»');
    }
  }

  // Pattern-based
  for (const pattern of REDACT_PATTERNS) {
    out = out.replace(pattern, '$1=«redacted»');
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 6 — LOGGER
//  ═══════════════════════════════════════════════════════════════════════════

/**
 * يرجع الوقت الحالي بصيغة HH:MM:SS
 */
function timestamp() {
  return new Date().toISOString().slice(11, 19);
}

/**
 * ينشئ logger function
 */
function makeLogFn(consoleMethod, level, { newline = false } = {}) {
  return (...args) => {
    const redacted = args.map(x => typeof x === 'string' ? redact(x) : x);
    const prefix = `${newline ? '\n' : ''}[${timestamp()}] ${level}`;
    consoleMethod(prefix, ...redacted);
  };
}

const log = {
  info: makeLogFn(console.log.bind(console),   '[INFO]'),
  ok:   makeLogFn(console.log.bind(console),   '[ OK ]'),
  warn: makeLogFn(console.warn.bind(console),  '[WARN]'),
  err:  makeLogFn(console.error.bind(console), '[FAIL]'),
  step: makeLogFn(console.log.bind(console),   '━━━', { newline: true }),
  sess: makeLogFn(console.log.bind(console),   '[SESS]'),
  tg:   makeLogFn(console.log.bind(console),   '[ TG ]'),
  det:  makeLogFn(console.log.bind(console),   '[DET ]'),
};

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 7 — TIME UTILITIES
//  ═══════════════════════════════════════════════════════════════════════════

/** Sleep لعدد ملي ثانية */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * يحول milliseconds لصيغة بشرية
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

/**
 * كم من الوقت عدى على timestamp
 * @param {number} t
 * @returns {string}
 */
function timeSince(t) {
  if (!t) return 'never';
  const d = Date.now() - t;
  if (d < 0) return 'in future';
  return `${formatDuration(d)} ago`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 8 — FILE UTILITIES
//  ═══════════════════════════════════════════════════════════════════════════

/**
 * كتابة ذرية — write to .tmp ثم rename
 * @param {string} file
 * @param {string|object} data
 */
function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

/**
 * كتابة ذرية مع تشفير
 */
function atomicWriteEncrypted(file, data) {
  const plain = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  atomicWrite(file, encryptString(plain));
}

/**
 * قراءة ملف مع فك تشفير
 */
function readFileDecrypted(file) {
  return decryptString(fs.readFileSync(file, 'utf8'));
}

/**
 * يلف الـ audit log لو كبر
 */
function rotateAuditIfNeeded() {
  try {
    if (!fs.existsSync(CONFIG.auditFile)) return;

    const stats = fs.statSync(CONFIG.auditFile);
    if (stats.size <= CONFIG.auditMaxBytes) return;

    const backup = CONFIG.auditFile + '.old';
    if (fs.existsSync(backup)) {
      try { fs.unlinkSync(backup); } catch {}
    }
    fs.renameSync(CONFIG.auditFile, backup);
  } catch (e) {
    log.warn('audit rotate failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 9 — STRING UTILITIES
//  ═══════════════════════════════════════════════════════════════════════════

/**
 * يهرب HTML entities
 */
function escapeHtml(s) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(s).replace(/[&<>"']/g, c => map[c]);
}

/**
 * يوحّد صيغة كود المادة
 * "gen 101" → "GEN101"
 */
function normalizeCode(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '');
}

/**
 * يقصّر string لتيليجرام
 */
function truncateForTelegram(s, max = CONFIG.tgMessageMaxChars) {
  const str = String(s ?? '');
  return str.length <= max ? str : str.slice(0, max - 20) + '\n… (truncated)';
}

/**
 * يوصف status course
 */
function statusLabel(s) {
  const map = {
    0: '❌ Failed',
    1: '✅ Passed',
    2: '↩️ Withdrawn',
    3: '⏳ Pending',
    4: '📝 Registered',
    5: '🆕 Never',
  };
  return s == null ? '❓' : (map[Number(s)] || `❓ (${s})`);
}

/**
 * هل الـ status قابل للتسجيل
 */
const isRegisterable = (s) => [0, 2, 5].includes(Number(s));

/**
 * ينشئ fingerprint فريد
 */
function makeFingerprint(type, payload) {
  return crypto.createHash('sha1')
    .update(`${type}:${JSON.stringify(payload)}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * snapshot hash لمجموعة
 */
function snapshotHash(groups) {
  const sig = groups
    .map(g => `${g.name}:${g.seats}/${g.total}:${g.blocked ? 'B' : 'F'}`)
    .sort()
    .join('|');
  return crypto.createHash('sha1').update(sig).digest('hex').slice(0, 12);
}

/**
 * يقارن مادتين
 */
function sameCourse(a, b) {
  if (a.id && b.id) return String(a.id) === String(b.id);
  return a.code && b.code && normalizeCode(a.code) === normalizeCode(b.code);
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 10 — ASYNC UTILITIES
//  ═══════════════════════════════════════════════════════════════════════════

/**
 * يلف promise بـ timeout
 */
async function withTimeout(promise, ms, label = 'op') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * يعيد المحاولة مع backoff
 */
async function retry(fn, { attempts = 3, baseMs = 800, label = 'op' } = {}) {
  let lastErr;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const retryable = /timeout|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|Target closed|net::|aborted/i.test(msg);

      if (!retryable || i === attempts - 1) throw e;

      const delay = baseMs * Math.pow(2, i) + Math.floor(Math.random() * 250);
      log.warn(`[retry ${label}] ${i + 1}/${attempts}: ${msg} — retry ${delay}ms`);
      await sleep(delay);
    }
  }

  throw lastErr;
}

/**
 * يقيس الذاكرة الحالية (MB)
 */
function rssMb() {
  try {
    return Math.round(process.memoryUsage().rss / 1024 / 1024);
  } catch {
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 11 — STATE MANAGEMENT
//  ═══════════════════════════════════════════════════════════════════════════

/**
 * State الافتراضي
 */
function defaultState() {
  return {
    version:            CONFIG.stateVersion,
    startedAt:          0,
    registeredCourses:  [],
    targets:            {},
    pendingCallbacks:   {},
    _cbCounter:         0,
    lastTgUpdateId:     0,
    tgChatId:           null,
    startupBriefedAt:   0,
    paused:             false,
    lastError:          null,
    sentAlerts:         {},

    sessionStats: {
      logins:      0,
      reuses:      0,
      relogins:    0,
      failures:    0,
      validations: 0,
      lastLoginAt: 0,
      lastReuseAt: 0,
    },

    regWindow: {
      status:    null,
      lastCheck: 0,
    },

    earlyDetection: {
      enabled:   true,
      checks:    0,
      hits:      0,
      lastCheck: 0,
    },

    gapStats: {
      lastRunStartedAt: 0,
      lastRunEndedAt:   0,
      maxGapMs:         0,
      avgGapMs:         0,
      gapCount:         0,
    },

    audit: [],

    counters: {
      opens:            0,
      drops:            0,
      adds:             0,
      newGroups:        0,
      seatIncreases:    0,
      blockChanges:     0,
      relogins:         0,
      errors:           0,
      alertsSent:       0,
      dedupHits:        0,
      loginFailures:    0,
      scans:            0,
      sessionDeaths:    0,
      sessionValidations: 0,
    },
  };
}

/**
 * يحوّل state قديم لـ v14
 */
function migrateState(s) {
  if (!s || typeof s !== 'object') return defaultState();

  const base   = defaultState();
  const merged = {
    ...base,
    ...s,
    counters:       { ...base.counters,       ...(s.counters       || {}) },
    earlyDetection: { ...base.earlyDetection, ...(s.earlyDetection || {}) },
    regWindow:      { ...base.regWindow,      ...(s.regWindow      || {}) },
    sessionStats:   { ...base.sessionStats,   ...(s.sessionStats   || {}) },
    gapStats:       { ...base.gapStats,       ...(s.gapStats       || {}) },
    sentAlerts:     s.sentAlerts || {},
    targets:        s.targets || {},
  };

  // تنقية
  merged.audit = Array.isArray(merged.audit) ? merged.audit.slice(-500) : [];
  if (!merged.pendingCallbacks || typeof merged.pendingCallbacks !== 'object') {
    merged.pendingCallbacks = {};
  }
  if (typeof merged._cbCounter !== 'number') merged._cbCounter = 0;

  merged.version = CONFIG.stateVersion;
  return merged;
}

/**
 * يحمّل الـ state من القرص
 */
function loadState() {
  try {
    if (fs.existsSync(CONFIG.stateFile)) {
      return migrateState(JSON.parse(readFileDecrypted(CONFIG.stateFile)));
    }
  } catch (e) {
    log.warn('State load failed:', e.message);
  }
  return defaultState();
}

/**
 * يحفظ الـ state على القرص
 */
function saveState(state) {
  try {
    atomicWriteEncrypted(CONFIG.stateFile, state);
  } catch (e) {
    log.warn('State save failed:', e.message);
  }
}

let _currentState = null;

/** setter للـ state الحالي (للـ shutdown) */
function setCurrentState(s) { _currentState = s; }

/** getter للـ state الحالي */
function getCurrentState() { return _currentState; }

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 12 — AUDIT TRAIL
//  ═══════════════════════════════════════════════════════════════════════════

/**
 * يسجل حدث في الـ audit trail
 */
function audit(state, event, details = {}) {
  const entry = { t: Date.now(), event };

  for (const [k, v] of Object.entries(details)) {
    entry[k] = typeof v === 'string' ? redact(v) : v;
  }

  state.audit.push(entry);
  if (state.audit.length > 500) {
    state.audit = state.audit.slice(-500);
  }

  try {
    rotateAuditIfNeeded();
    fs.appendFileSync(CONFIG.auditFile, JSON.stringify(entry) + '\n');
  } catch (e) {
    log.warn('audit append failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 13 — ALERT DEDUPLICATION
//  ═══════════════════════════════════════════════════════════════════════════

/**
 * يقرر لو لازم نبعت التنبيه أو مكرر
 * @returns {boolean} true لو نبعت، false لو مكرر
 */
function shouldSendAlert(state, fingerprint, windowMs = 5 * 60 * 1000) {
  state.sentAlerts = state.sentAlerts || {};
  const now = Date.now();

  // تنظيف القديم
  const cleanupThreshold = windowMs * 4;
  for (const [k, t] of Object.entries(state.sentAlerts)) {
    if (now - t > cleanupThreshold) {
      delete state.sentAlerts[k];
    }
  }

  // فحص
  const last = state.sentAlerts[fingerprint];
  if (last && (now - last) < windowMs) {
    state.counters.dedupHits = (state.counters.dedupHits || 0) + 1;
    log.warn(`[dedup] suppressed ${fingerprint} (${Math.round((now - last) / 1000)}s ago)`);
    return false;
  }

  state.sentAlerts[fingerprint] = now;
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 14 — TELEGRAM QUEUE
//  ═══════════════════════════════════════════════════════════════════════════

const tgQueue       = [];
const tgTimestamps  = [];
let   tgSending     = false;

/**
 * يقص الرسائل القديمة من الـ rate limit
 */
function pruneRateLimit(now) {
  while (tgTimestamps.length && now - tgTimestamps[0] > 60_000) {
    tgTimestamps.shift();
  }
}

/**
 * ينتظر لو وصلنا للـ rate limit
 */
async function waitForRateLimit() {
  const now = Date.now();
  pruneRateLimit(now);

  if (tgTimestamps.length >= USER_CONFIG.notifications.maxTelegramPerMin) {
    const waitMs = 60_000 - (now - tgTimestamps[0]) + 100;
    log.tg(`Rate limit hit — waiting ${formatDuration(waitMs)}`);
    await sleep(waitMs);
    pruneRateLimit(Date.now());
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 15 — TELEGRAM SENDER
//  ═══════════════════════════════════════════════════════════════════════════

/**
 * ينشئ payload الرسالة
 */
function buildTelegramPayload(msg, silent, replyMarkup) {
  const payload = {
    chat_id: CONFIG.tgChatId,
    text: msg,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    disable_notification: silent,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return payload;
}

/**
 * يبعت رسالة فورية (بدون queue)
 */
async function sendTelegramNow(payload) {
  const url = `https://api.telegram.org/bot${CONFIG.tgToken}/sendMessage`;

  const res = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    CONFIG.netTimeoutMs,
    'tg-send'
  );

  return await res.json().catch(() => ({}));
}

/**
 * يعالج أخطاء الإرسال
 * @returns {'ok'|'retry'|'failed'}
 */
function handleSendResult(body) {
  if (body.ok) return 'ok';
  if (body.error_code === 429) return 'retry';
  log.warn(`TG rejected (${body.error_code || '?'}): ${body.description || 'unknown'}`);
  return 'failed';
}

/**
 * يبعت رسالة (مع queue + rate limit + retries)
 */
async function tgSend(html, { silent = false, replyMarkup = null } = {}) {
  if (!CONFIG.tgToken || !CONFIG.tgChatId || !html) return;

  tgQueue.push({
    html: truncateForTelegram(html),
    silent,
    replyMarkup,
  });

  if (tgSending) return;
  tgSending = true;

  try {
    while (tgQueue.length > 0) {
      await waitForRateLimit();
      tgTimestamps.push(Date.now());

      const { html: msg, silent: sil, replyMarkup: rm } = tgQueue.shift();
      const payload = buildTelegramPayload(msg, sil, rm);

      try {
        const body = await sendTelegramNow(payload);
        const result = handleSendResult(body);

        if (result === 'retry') {
          const retryAfter = (body.parameters && body.parameters.retry_after) || 5;
          tgQueue.unshift({ html: msg, silent: sil, replyMarkup: rm });
          log.tg(`Rate limited — waiting ${retryAfter}s`);
          await sleep(retryAfter * 1000);
        }
      } catch (e) {
        log.warn('TG send failed:', e.message);
      }

      await sleep(1_100); // Throttle
    }
  } finally {
    tgSending = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 16 — TELEGRAM KEYBOARDS + COMMANDS
//  ═══════════════════════════════════════════════════════════════════════════

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '📊 Status' }, { text: '🎯 Groups' }],
    [{ text: '🔥 Open' },   { text: '🔍 Find' }],
    [{ text: '🎯 Targets' }, { text: '📋 Baseline' }],
    [{ text: '⏸️ Pause' },  { text: '▶️ Resume' }],
    [{ text: '🔄 Reset' },  { text: '❓ Help' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const BUTTON_MAP = {
  '📊 Status':    '/status',
  '🎯 Groups':    '/groups',
  '🔥 Open':      '/open',
  '🔍 Find':      '/find',
  '🎯 Targets':   '/targets',
  '📋 Baseline':  '/baseline',
  '⏸️ Pause':     '/pause',
  '▶️ Resume':    '/resume',
  '🔄 Reset':     '/reset',
  '❓ Help':      '/help',
};

const BOT_COMMANDS = [
  { command: 'start',    description: '🟢 Bot alive' },
  { command: 'status',   description: '📊 Status report' },
  { command: 'groups',   description: '🎯 All groups' },
  { command: 'open',     description: '🔥 Open groups' },
  { command: 'targets',  description: '🎯 Targets list' },
  { command: 'target',   description: '🎯 Add target' },
  { command: 'find',     description: '🔍 Search course' },
  { command: 'diag',     description: '🩺 Diagnostic' },
  { command: 'baseline', description: '🛡️ Registered courses' },
  { command: 'info',     description: 'ℹ️ Registration info' },
  { command: 'watch',    description: '👁️ Watch group' },
  { command: 'audit',    description: '📜 Last 10 events' },
  { command: 'pause',    description: '⏸️ Pause' },
  { command: 'resume',   description: '▶️ Resume' },
  { command: 'reset',    description: '🔄 Reset' },
  { command: 'help',     description: '❓ Commands' },
];

/**
 * يسجل الأوامر مع Telegram
 */
async function registerBotCommands() {
  if (!CONFIG.tgToken || !CONFIG.tgChatId) return;

  try {
    const chatIdNum = Number(CONFIG.tgChatId);
    const scope = Number.isFinite(chatIdNum)
      ? { type: 'chat', chat_id: chatIdNum }
      : { type: 'default' };

    await fetch(`https://api.telegram.org/bot${CONFIG.tgToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: BOT_COMMANDS, scope }),
    });

    log.ok(`Registered ${BOT_COMMANDS.length} commands`);
  } catch (e) {
    log.warn('Command registration failed:', e.message);
  }
}

/**
 * يسجل مجموعة pending للـ inline buttons
 */
function registerPendingGroup(state, name) {
  state._cbCounter = (state._cbCounter || 0) + 1;
  const id = 'g' + state._cbCounter;

  state.pendingCallbacks = state.pendingCallbacks || {};
  state.pendingCallbacks[id] = name;

  // تنظيف
  const keys = Object.keys(state.pendingCallbacks);
  if (keys.length > 200) {
    for (const k of keys.slice(0, keys.length - 150)) {
      delete state.pendingCallbacks[k];
    }
  }

  return id;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 17 — TELEGRAM POLLING
//  ═══════════════════════════════════════════════════════════════════════════

/**
 * يجيب تحديثات تيليجرام ويعالجها
 */
async function handleTelegramCommands(state, api) {
  if (!CONFIG.tgToken) return;

  try {
    const offset = state.lastTgUpdateId ? state.lastTgUpdateId + 1 : -1;
    const url = `https://api.telegram.org/bot${CONFIG.tgToken}/getUpdates?offset=${offset}&timeout=0`;

    const res = await withTimeout(fetch(url), CONFIG.netTimeoutMs, 'tg-poll');
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.result)) return;

    for (const upd of data.result) {
      state.lastTgUpdateId = Math.max(state.lastTgUpdateId || 0, upd.update_id);

      // ─── Callback query ─────────────────────────────────────────
      if (upd.callback_query) {
        const cb = upd.callback_query;
        if (String(cb.message?.chat?.id || cb.from?.id) !== CONFIG.tgChatId) continue;
        await handleCallback(cb, state);
        continue;
      }

      // ─── Message ────────────────────────────────────────────────
      const msg = upd.message;
      if (!msg?.text) continue;
      if (String(msg.chat.id) !== CONFIG.tgChatId) continue;

      const text = msg.text.trim();
      let cmd, args;

      if (BUTTON_MAP[text]) {
        cmd = BUTTON_MAP[text];
        args = [];
      } else {
        const parts = text.split(/\s+/);
        cmd = parts[0].toLowerCase().replace(/@\w+$/, '');
        args = parts.slice(1);
      }

      await dispatchCommand(cmd, args, state, api);
    }

    saveState(state);
  } catch (e) {
    log.warn('TG poll failed:', e.message);
  }
}

/**
 * يرد على callback query
 */
async function answerCallback(id, text = '') {
  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.tgToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: id, text }),
    });
  } catch (e) {
    log.warn('answerCallback failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 18 — TELEGRAM CALLBACKS
//  ═══════════════════════════════════════════════════════════════════════════

async function handleCallback(cb, state) {
  const [action, ...rest] = (cb.data || '').split(':');
  const shortId = rest.join(':').trim();

  await answerCallback(cb.id);

  if (!shortId) return;

  const groupName = state.pendingCallbacks?.[shortId];
  if (!groupName) {
    await tgSend('⚠️ انتهت صلاحية الزر.');
    return;
  }

  const activeCode = state._activeTarget || USER_CONFIG.targets[0].code;
  const tgt = state.targets[activeCode];
  if (!tgt) return;

  tgt.watchGroups = tgt.watchGroups || [];

  if (action === 'watch') {
    if (!tgt.watchGroups.includes(groupName)) {
      tgt.watchGroups.push(groupName);
      audit(state, 'watch_add', { group: groupName, target: activeCode });
      saveState(state);
    }
    await tgSend(`👁️ Added: <b>${escapeHtml(groupName)}</b>`);
  } else if (action === 'unwatch') {
    tgt.watchGroups = tgt.watchGroups.filter(g => g !== groupName);
    audit(state, 'watch_remove', { group: groupName, target: activeCode });
    saveState(state);
    await tgSend(`🚫 Removed: <b>${escapeHtml(groupName)}</b>`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 19 — TELEGRAM COMMANDS
//  ═══════════════════════════════════════════════════════════════════════════

async function dispatchCommand(cmd, args, state, api) {
  const uptimeMin = Math.floor((Date.now() - (state.startedAt || Date.now())) / 60_000);
  const activeCode = state._activeTarget || USER_CONFIG.targets[0].code;
  const activeTgt = state.targets[activeCode] || {};

  switch (cmd) {

    // ─── /start ──────────────────────────────────────────────────
    case '/start':
      await tgSend(`🎛️ <b>لوحة التحكم ${CONFIG.versionLabel}</b>`, { replyMarkup: MAIN_KEYBOARD });
      await dispatchCommand('/status', [], state, api);
      break;

    // ─── /status ─────────────────────────────────────────────────
    case '/status': {
      const regs = state.registeredCourses
        .map(c => `• <code>${escapeHtml(c.code)}</code>`)
        .join(' ') || '—';

      const openCount = Object.values(activeTgt.groups || {}).filter(g => g.open).length;
      const knownCount = Object.keys(activeTgt.knownGroups || {}).length;

      const errLine = state.lastError
        ? `\n⚠️ <code>${escapeHtml(String(state.lastError.message || '').slice(0, 100))}</code>`
        : '';

      const sessAge = state.sessionStats.lastLoginAt
        ? formatDuration(Date.now() - state.sessionStats.lastLoginAt)
        : '—';

      await tgSend(
        `🟢 <b>Watcher ${CONFIG.versionLabel}</b>\n` +
        `⏱ <b>${uptimeMin}m</b> | 💾 <b>${rssMb()}MB</b> | ${state.paused ? '⏸' : '▶️'}\n` +
        `🔐 Session: <b>${sessAge}</b> | reused <b>${state.sessionStats.reuses}×</b>\n\n` +
        `🎯 <b>${escapeHtml(activeCode)}</b> (${activeTgt.id ? `<code>${escapeHtml(activeTgt.id)}</code>` : '⏳'})\n` +
        `📋 Status: ${activeTgt.status != null ? statusLabel(activeTgt.status) : '—'}\n` +
        `👥 Groups: <b>${knownCount}</b> known | 🔥 <b>${openCount}</b> open\n` +
        `👁️ Watched: <b>${(activeTgt.watchGroups || []).length}</b>${errLine}\n\n` +
        `🛡️ Baseline (${state.registeredCourses.length}): ${regs}\n\n` +
        `📊 opens=${state.counters.opens} new=${state.counters.newGroups} ` +
        `seat+=${state.counters.seatIncreases} block=${state.counters.blockChanges} ` +
        `drops=${state.counters.drops} alerts=${state.counters.alertsSent} ` +
        `dedup=${state.counters.dedupHits} relog=${state.counters.relogins} err=${state.counters.errors}`
      );
      break;
    }

    // ─── /targets ────────────────────────────────────────────────
    case '/targets': {
      let msg = `🎯 <b>Targets (${Object.keys(state.targets).length})</b>\n\n`;

      for (const [code, t] of Object.entries(state.targets)) {
        const open = Object.values(t.groups || {}).filter(g => g.open).length;
        const known = Object.keys(t.knownGroups || {}).length;

        msg += `<b>${escapeHtml(code)}</b> — ${t.id ? `<code>${escapeHtml(t.id)}</code>` : '⏳'}\n`;
        msg += `  ${t.status != null ? statusLabel(t.status) : '—'} | 👥 ${known} | 🔥 ${open}\n\n`;
      }

      await tgSend(msg);
      break;
    }

    // ─── /baseline ───────────────────────────────────────────────
    case '/baseline': {
      const regs = state.registeredCourses
        .map(c => `• <code>${escapeHtml(c.code)}</code> — ${escapeHtml(c.name)}`)
        .join('\n') || '—';

      const missing = USER_CONFIG.expectedCourses.filter(exp =>
        !state.registeredCourses.some(c => normalizeCode(c.code).includes(normalizeCode(exp)))
      );

      await tgSend(
        `🛡️ <b>Baseline</b>\n${regs}` +
        (missing.length
          ? `\n\n⚠️ Missing: ${missing.map(escapeHtml).join(', ')}`
          : `\n\n✅ Complete`)
      );
      break;
    }

    // ─── /find ───────────────────────────────────────────────────
    case '/find': {
      const q = args.join(' ').trim();
      if (!q) {
        await tgSend(`Usage: /find &lt;code&gt;`);
        break;
      }

      const r = await api.getCourses({ forceRefresh: true });
      if (r.kind !== 'ok') {
        await tgSend(`❌ API: ${r.kind}`);
        break;
      }

      const qUp = q.toUpperCase();
      const qNorm = qUp.replace(/\s+/g, '');

      const matches = r.courses.filter(c =>
        String(c.code).toUpperCase().includes(qUp) ||
        String(c.name).toUpperCase().includes(qUp) ||
        String(c.code).toUpperCase().replace(/\s+/g, '').includes(qNorm)
      );

      if (!matches.length) {
        await tgSend(`🔍 No matches. Total: ${r.courses.length}`);
        break;
      }

      let msg = `🔍 <b>${matches.length} matches:</b>\n\n`;
      matches.slice(0, 20).forEach((c, i) => {
        msg += `${i + 1}. <code>${escapeHtml(c.code)}</code> — ${escapeHtml(c.name)}\n`;
        msg += `   ${statusLabel(c.status)} | ID: <code>${escapeHtml(c.id)}</code>\n\n`;
      });

      await tgSend(msg);
      break;
    }

    // ─── /diag ───────────────────────────────────────────────────
    case '/diag': {
      const r = await api.getCourses({ forceRefresh: true });
      if (r.kind !== 'ok') {
        await tgSend(`❌ API: ${r.kind}`);
        break;
      }

      const by = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] };
      for (const c of r.courses) {
        const s = Number(c.status);
        if (by[s]) by[s].push(c.code);
      }

      let msg = `🩺 <b>Diagnostic</b>\n\n📊 Total: <b>${r.courses.length}</b>\n\n`;

      for (const [s, codes] of Object.entries(by)) {
        if (!codes.length) continue;
        msg += `${statusLabel(Number(s))} (${codes.length}):\n`;
        msg += `<code>${codes.slice(0, 15).map(escapeHtml).join(', ')}</code>\n\n`;
      }

      await tgSend(msg);
      break;
    }

    // ─── /groups ─────────────────────────────────────────────────
    case '/groups': {
      if (!activeTgt.id) {
        await tgSend(`⏳ Target "<b>${escapeHtml(activeCode)}</b>" مش ظاهرة لسه.`);
        break;
      }

      const r = await api.getCourseSchedule(activeTgt.id);
      if (r.kind !== 'ok' || !r.groups?.length) {
        await tgSend(`❌ No groups.`);
        break;
      }

      const sorted = [...r.groups].sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      let msg = `🎯 <b>${escapeHtml(activeCode)} — ${r.groups.length} groups</b>\n\n`;

      sorted.slice(0, 25).forEach(g => {
        const w = (activeTgt.watchGroups || []).some(x =>
          g.name.toUpperCase().includes(x.toUpperCase())
        );
        const blockIcon = g.blocked ? '🚫' : '';

        msg += `${w ? '👁️ ' : ''}${g.available ? '🔥' : '❄️'}${blockIcon} `;
        msg += `<b>${escapeHtml(g.name)}</b> — 💺 ${g.seats}/${g.total}\n`;

        if (g.slots[0]) {
          msg += `   📅 ${escapeHtml(g.slots[0].day)} | ⏰ ${escapeHtml(g.slots[0].time)}\n`;
        }
      });

      const avail = sorted.filter(g => g.available).slice(0, 8);
      const rows = avail.map(g => {
        const id = registerPendingGroup(state, g.name);
        return [{ text: `👁️ Watch ${g.name} (${g.seats})`, callback_data: `watch:${id}` }];
      });

      saveState(state);
      await tgSend(msg, {
        replyMarkup: rows.length ? { inline_keyboard: rows } : undefined,
      });
      break;
    }

    // ─── /open ───────────────────────────────────────────────────
    case '/open': {
      const openGroups = Object.entries(activeTgt.groups || {})
        .filter(([_, v]) => v.open)
        .map(([n, v]) => ({ name: n, ...v }));

      if (!openGroups.length) {
        await tgSend(`❄️ مفيش مجموعات مفتوحة.`);
        break;
      }

      let msg = `🔥 <b>Open (${openGroups.length}):</b>\n\n`;
      openGroups.forEach((g, i) => {
        msg += `${i + 1}. <b>${escapeHtml(g.name)}</b> — 💺 ${g.seats}/${g.total}\n`;
      });

      await tgSend(msg);
      break;
    }

    // ─── /info ───────────────────────────────────────────────────
    case '/info': {
      const r = await api.getRegInfo();
      if (r.kind !== 'ok' || !r.data?.[0]) {
        await tgSend(`❌ API: ${r.kind}`);
        break;
      }

      const info = r.data[0];
      const status = info.RegAvailabilty === 1
        ? '✅ OPEN'
        : (info.RegAvailabilty === -1 ? '⏳ NOT STARTED' : '🚫 BLOCKED');

      await tgSend(
        `ℹ️ <b>Registration</b>\n\nStatus: <b>${status}</b>\n` +
        (info.RegAvailabiltyReason
          ? `<i>${escapeHtml(info.RegAvailabiltyReason)}</i>\n`
          : '') +
        `\n📅 Ends: <b>${escapeHtml(String(info.RegEndDate || '—'))}</b>\n` +
        `💰 Balance: <b>${escapeHtml(String(info.StudentCredit || '—'))} ${escapeHtml(String(info.Currency || ''))}</b>\n` +
        `⏱ Permitted: <b>${escapeHtml(String(info.AcademicAllowedHours || '—'))}</b> hrs\n` +
        `📚 Registered: <b>${escapeHtml(String(info.RegisteredHours || '—'))}</b> hrs`
      );
      break;
    }

    // ─── /target ─────────────────────────────────────────────────
    case '/target': {
      const code = args.join(' ').trim();
      if (!code) {
        await tgSend(`Usage: /target &lt;code&gt;`);
        break;
      }

      const resolved = await api.resolveTargetId(code, { onlyRegisterable: false });

      if (resolved) {
        state.targets[code] = {
          id: resolved.id,
          name: resolved.name,
          status: resolved.status,
          apiCode: resolved.code,
          groups: {},
          knownGroups: {},
          watchGroups: [],
          lastHash: null,
          firstScanDone: false,
        };
        state._activeTarget = code;
        audit(state, 'target_set', { code, id: resolved.id });
        saveState(state);

        await tgSend(
          `🎯 Added <code>${escapeHtml(code)}</code> (${escapeHtml(resolved.name)})\n` +
          `ID: <code>${escapeHtml(resolved.id)}</code>`
        );
      } else {
        await tgSend(`❌ Not found.`);
      }
      break;
    }

    // ─── /watch ──────────────────────────────────────────────────
    case '/watch': {
      const grp = args.join(' ').trim();
      activeTgt.watchGroups = activeTgt.watchGroups || [];

      if (!grp) {
        await tgSend(
          activeTgt.watchGroups.length
            ? `👁️ Watching: ${activeTgt.watchGroups.map(g => `<code>${escapeHtml(g)}</code>`).join(', ')}`
            : `👁️ فاضي — هينبهك على أي مجموعة.`
        );
        break;
      }

      if (!activeTgt.watchGroups.includes(grp)) {
        activeTgt.watchGroups.push(grp);
        saveState(state);
      }

      await tgSend(`👁️ Watching: <b>${escapeHtml(grp)}</b>`);
      break;
    }

    // ─── /reset ──────────────────────────────────────────────────
    case '/reset': {
      for (const code of Object.keys(state.targets)) {
        state.targets[code].groups = {};
        state.targets[code].knownGroups = {};
        state.targets[code].lastHash = null;
        state.targets[code].firstScanDone = false;
      }

      state.registeredCourses = [];
      state.sentAlerts = {};

      audit(state, 'reset');
      saveState(state);
      await tgSend(`🔄 Reset done.`);
      break;
    }

    // ─── /audit ──────────────────────────────────────────────────
    case '/audit': {
      const last = state.audit
        .slice(-10)
        .map(e => `• <code>${new Date(e.t).toISOString().slice(11, 19)}</code> ${escapeHtml(e.event)}`)
        .join('\n');

      await tgSend(`📜 <b>Last 10</b>\n${last || '—'}`);
      break;
    }

    // ─── /pause ──────────────────────────────────────────────────
    case '/pause':
      state.paused = true;
      saveState(state);
      await tgSend('⏸️ Paused');
      break;

    // ─── /resume ─────────────────────────────────────────────────
    case '/resume':
      state.paused = false;
      saveState(state);
      await tgSend('▶️ Resumed');
      break;

    // ─── /help ───────────────────────────────────────────────────
    case '/help':
      await tgSend(
        `🤖 <b>Commands</b>\n\n` +
        BOT_COMMANDS.map(c => `/<b>${c.command}</b> — ${c.description}`).join('\n'),
        { replyMarkup: MAIN_KEYBOARD }
      );
      break;

    default:
      // أمر مش معروف
      break;
  }

  saveState(state);
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 20 — SESSION MANAGEMENT
//  ═══════════════════════════════════════════════════════════════════════════

/**
 * كم دقيقة عمر الـ session
 */
function sessionAgeMinutes() {
  try {
    if (fs.existsSync(CONFIG.sessionMetaFile)) {
      const m = JSON.parse(readFileDecrypted(CONFIG.sessionMetaFile));
      return m.savedAt ? (Date.now() - m.savedAt) / 60000 : Infinity;
    }
  } catch (e) {
    log.warn('session meta read failed:', e.message);
  }
  return Infinity;
}

/**
 * كم ms عمر الـ session
 */
function sessionAgeMs() {
  const m = sessionAgeMinutes();
  return m === Infinity ? Infinity : m * 60_000;
}

/**
 * يمسح ملف الـ session
 */
function cleanupSession() {
  try {
    if (fs.existsSync(CONFIG.sessionFile)) {
      fs.unlinkSync(CONFIG.sessionFile);
    }
  } catch (e) {
    log.warn('session cleanup failed:', e.message);
  }
}

/**
 * يحفظ الـ session من context
 */
async function saveSession(ctx) {
  try {
    const tmp = CONFIG.sessionFile + '.plain';
    await ctx.storageState({ path: tmp });

    const plain = fs.readFileSync(tmp, 'utf8');
    fs.unlinkSync(tmp);

    atomicWrite(CONFIG.sessionFile, encryptString(plain));
    atomicWrite(
      CONFIG.sessionMetaFile,
      encryptString(JSON.stringify({ savedAt: Date.now() }))
    );
  } catch (e) {
    log.warn('Session save failed:', e.message);
  }
}

/**
 * يقرر استراتيجية الـ session
 */
function decideSessionStrategy() {
  const age = sessionAgeMs();
  const ageMin = age === Infinity ? '∞' : Math.round(age / 60_000);

  if (!fs.existsSync(CONFIG.sessionFile)) {
    log.sess(`Strategy: FRESH_LOGIN (no session file)`);
    return SESSION_STRATEGY.FRESH_LOGIN;
  }

  if (age === Infinity) {
    log.sess(`Strategy: FRESH_LOGIN (no meta)`);
    return SESSION_STRATEGY.FRESH_LOGIN;
  }

  if (age > USER_CONFIG.session.maxAgeMs) {
    log.sess(`Strategy: FRESH_LOGIN (age=${ageMin}min > max=${USER_CONFIG.session.maxAgeMs / 60000}min)`);
    return SESSION_STRATEGY.FRESH_LOGIN;
  }

  if (age > USER_CONFIG.session.warnAgeMs) {
    log.sess(`Strategy: VALIDATE (age=${ageMin}min)`);
    return SESSION_STRATEGY.VALIDATE;
  }

  log.sess(`Strategy: USE_DIRECT (age=${ageMin}min)`);
  return SESSION_STRATEGY.USE_DIRECT;
}

/**
 * يتحقق من الـ session بـ request خفيف
 */
async function validateSession(page, state) {
  if (!page || page.isClosed()) return VALIDATION.UNKNOWN;

  state.counters.sessionValidations = (state.counters.sessionValidations || 0) + 1;

  try {
    const result = await page.evaluate(async (endpoint) => {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });

        if (res.status === 302 || res.status === 401) return 'expired';

        const text = await res.text();
        const trimmed = text.trim();

        if (trimmed === '' || trimmed === '-1' || trimmed === 'null') return 'expired';

        if (trimmed.startsWith('<')) {
          if (/login|signin/i.test(trimmed)) return 'expired';
          return 'unknown';
        }

        if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'valid';

        return 'unknown';
      } catch (e) {
        return 'unknown';
      }
    }, CONFIG.API.regInfo);

    log.sess(`Validation: ${result}`);
    return result;
  } catch (e) {
    log.warn(`Validation failed: ${e.message}`);
    return VALIDATION.UNKNOWN;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 21 — BROWSER MANAGEMENT
//  ═══════════════════════════════════════════════════════════════════════════

async function createBrowser() {
  return chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--no-zygote',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--js-flags=--max-old-space-size=512',
    ],
  });
}

async function createAuthContext(browser, useCookies = true) {
  const opts = {
    baseURL: CONFIG.baseUrl,
    timezoneId: CONFIG.timezone,
    userAgent: CONFIG.userAgent,
  };

  if (useCookies && fs.existsSync(CONFIG.sessionFile)) {
    try {
      opts.storageState = JSON.parse(readFileDecrypted(CONFIG.sessionFile));
    } catch (e) {
      log.warn('Session decrypt failed:', e.message);
      cleanupSession();
    }
  }

  return browser.newContext(opts);
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 22 — LOGIN
//  ═══════════════════════════════════════════════════════════════════════════

const LOGIN_SELECTORS = {
  user: [
    'input[name="txtUserName"]',
    'input[name="txtUsername"]',
    'input[name="username"]',
    'input[id*="UserName"]',
    'input[id*="Username"]',
    'input[type="text"]',
  ],
  pass: [
    'input[name="txtPassword"]',
    'input[name="password"]',
    'input[id*="Password"]',
    'input[type="password"]',
  ],
  submit: [
    'input[name="btnLogin"]',
    'input[name="btnSignIn"]',
    'input[type="submit"]',
    'button[type="submit"]',
  ],
};

/**
 * يجيب أول locator موجود
 */
async function firstMatch(page, selectors) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0) return loc;
    } catch {}
  }
  return null;
}

/**
 * يصنف فشل تسجيل الدخول
 */
function classifyLoginFailure({ url = '', title = '', body = '' }) {
  const all = (url + ' ' + title + ' ' + body).toLowerCase();

  if (/captcha|recaptcha|robot|are you human|verify you are/i.test(all)) return 'captcha_required';
  if (/locked|disabled|blocked|suspended/i.test(all)) return 'account_locked';
  if (/invalid|incorrect|wrong password|bad credentials|كلمة المرور|خطأ/i.test(all)) return 'invalid_credentials';
  if (/maintenance|temporarily unavailable|under construction/i.test(all)) return 'site_maintenance';
  if (/login\.aspx/i.test(url) && body.trim().length === 0) return 'blank_login_page';

  return 'unknown';
}

/**
 * يسجل الدخول ويحفظ الـ cookies
 */
async function loginAndCaptureCookies(browser, state) {
  log.sess('Starting fresh login…');

  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    timezoneId: CONFIG.timezone,
    userAgent: CONFIG.userAgent,
  });

  const page = await ctx.newPage();

  // Block resource-heavy content
  await page.route('**/*', (r) => {
    const t = r.request().resourceType();
    if (t === 'image' || t === 'font' || t === 'media' || t === 'stylesheet') {
      return r.abort();
    }
    return r.continue();
  });

  // Hide webdriver
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  let lastErr = null;
  const MAX = USER_CONFIG.login.maxAttempts;

  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      log.info(`Login attempt ${attempt}/${MAX}…`);

      await page.goto(CONFIG.loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.pageTimeoutMs,
      });

      const userEl   = await firstMatch(page, LOGIN_SELECTORS.user);
      const passEl   = await firstMatch(page, LOGIN_SELECTORS.pass);
      const submitEl = await firstMatch(page, LOGIN_SELECTORS.submit);

      if (!userEl || !passEl || !submitEl) {
        throw new Error('Login form not found');
      }

      await userEl.fill(CONFIG.username);
      await passEl.fill(CONFIG.password);

      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {}),
        submitEl.click(),
      ]);

      await sleep(800);

      const finalUrl = page.url();
      const stillOnLogin = finalUrl.includes('/Login.aspx') || /\/login(\?|$)/i.test(finalUrl);

      if (stillOnLogin) {
        const title = await page.title().catch(() => '');
        const body  = await page.locator('body').innerText().catch(() => '');
        const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 400);

        const cause = classifyLoginFailure({ url: finalUrl, title, body });
        const detail = `cause=${cause} url="${finalUrl}" title="${title}" body="${snippet}"`;

        log.warn(`Login failed: ${redact(detail)}`);
        throw new LoginError(`Login failed [${cause}]: ${detail}`, cause, finalUrl, title, snippet);
      }

      await saveSession(ctx);
      await ctx.close();

      state.sessionStats.logins = (state.sessionStats.logins || 0) + 1;
      state.sessionStats.lastLoginAt = Date.now();

      log.ok(`✅ Logged in (attempt ${attempt})`);
      return;
    } catch (e) {
      lastErr = e;
      log.warn(`Attempt ${attempt}/${MAX} failed: ${String(e.message || e).slice(0, 200)}`);

      if (attempt >= MAX) break;

      const wait = USER_CONFIG.login.baseDelayMs * attempt +
                   Math.floor(Math.random() * USER_CONFIG.login.jitterMs);

      log.info(`Waiting ${wait}ms…`);
      await sleep(wait);

      try {
        await page.goto(CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      } catch {}
    }
  }

  try { await ctx.close(); } catch {}

  throw lastErr || new Error('Login failed after all attempts');
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 23 — AJAX INTERCEPTION
//  ═══════════════════════════════════════════════════════════════════════════

/**
 * يفتح صفحة الكورسات ويلتقط الـ AJAX response
 */
async function setupAJAXInterception(ctx, pageRef) {
  if (pageRef.page && !pageRef.page.isClosed()) {
    try { await pageRef.page.close(); } catch {}
  }

  pageRef.page = await ctx.newPage();
  pageRef.lastAJAX = null;
  pageRef.ajaxTime = 0;

  pageRef.page.on('response', async (response) => {
    const url = response.url();

    if (url.includes('/Registered/GetStudentResiterationCourses')) {
      try {
        const json = await response.json();
        if (Array.isArray(json) && json.length > 0) {
          pageRef.lastAJAX = json;
          pageRef.ajaxTime = Date.now();
        }
      } catch {}
    }
  });

  await pageRef.page.goto(CONFIG.coursesPageUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  }).catch(e => log.warn('Page nav failed:', e.message));

  // انتظر الـ AJAX
  for (let i = 0; i < 20 && !pageRef.lastAJAX; i++) {
    await sleep(500);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 24 — API CLIENT
//  ═══════════════════════════════════════════════════════════════════════════

function makeApi(ctx, pageRef) {
  let courseCache = { ts: 0, data: null };
  const CACHE_TTL = 8 * 1000;

  /**
   * ينفذ request من داخل الصفحة
   */
  async function fetchInPage(path, options = {}) {
    const result = await pageRef.page.evaluate(async ({ path, options }) => {
      try {
        const res = await fetch(path, {
          method: options.method || 'GET',
          credentials: 'include',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/plain, */*',
          },
        });

        if (!res.ok) return { ok: false, status: res.status, text: '' };

        const text = await res.text();
        return { ok: true, status: res.status, text };
      } catch (e) {
        return { ok: false, status: 0, text: '', error: e.message };
      }
    }, { path, options });

    if (!result.ok) {
      if (result.status === 302 || result.status === 401) return { kind: 'session_dead' };
      if (result.status >= 500) return { kind: 'soft_server' };
      return { kind: 'net', error: result.error };
    }

    const s = String(result.text || '').trim();

    if (s === '' || s === 'null' || s === '-1') return { kind: 'session_dead' };

    if (s[0] === '<') {
      if (/login|signin|Login\.aspx/i.test(s)) return { kind: 'session_dead' };
      return { kind: 'soft_server' };
    }

    let data;
    try { data = JSON.parse(s); }
    catch { return { kind: 'structural' }; }

    return { kind: 'ok', data };
  }

  /**
   * يعمل HTTP call
   */
  async function call(method, url, params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetchInPage(url + qs, { method });
  }

  /**
   * يعيد تحميل الصفحة
   */
  async function triggerAjax() {
    try {
      if (!pageRef.page || pageRef.page.isClosed()) {
        await setupAJAXInterception(ctx, pageRef);
        return;
      }

      pageRef.lastAJAX = null;
      await pageRef.page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});

      for (let i = 0; i < 20 && !pageRef.lastAJAX; i++) {
        await sleep(500);
      }
    } catch (e) {
      log.warn('triggerAjax failed:', e.message);
    }
  }

  /**
   * يحول صيغة الكورسات
   */
  function mapCourses(arr) {
    return arr.map(c => ({
      id: String(c.CourseId),
      code: c.Code || '',
      name: c.Name || '',
      status: c.GradeStatusId,
      group: c.GrpName,
    }));
  }

  // ─── API METHODS ──────────────────────────────────────────────
  return {

    /**
     * يجيب مجموعات مادة معينة
     */
    async getCourseSchedule(courseId) {
      const r = await retry(
        () => call('GET', CONFIG.API.courseSchedule, { CourseId: courseId }),
        { label: 'schedule', attempts: 2 }
      );

      if (r.kind !== 'ok') return r;
      if (!Array.isArray(r.data)) return { kind: 'structural' };

      const groups = {};

      for (const item of r.data) {
        if (!item || item.Type !== 'Group') continue;

        const gid = item.GroupId;
        if (gid == null) continue;

        if (!groups[gid]) {
          const rawName   = String(item.GroupName || '').trim();
          const shortName = String(item.ShortName || '').trim();
          const isUni     = !!item.IsUniversity;

          let displayName;
          if (isUni && shortName && rawName) displayName = `${shortName}-${rawName}`;
          else if (rawName) displayName = rawName;
          else if (shortName) displayName = `${shortName}-${gid}`;
          else displayName = `Group-${gid}`;

          groups[gid] = {
            id: gid,
            name: displayName,
            rawName,
            shortName,
            isUniversity: isUni,
            blocked: !!item.IsBlocked,
            total: parseInt(item.StudentsCount) || 0,
            registered: parseInt(item.RegisteredCount) || 0,
            slots: [],
          };
        }

        groups[gid].slots.push({
          day: item.DayWeekName,
          time: item.Time,
          hall: item.ClassRoomName,
          staff: item.Staff,
        });
      }

      const list = Object.values(groups).map(g => ({
        ...g,
        seats: g.total - g.registered,
        available: !g.blocked && (g.total - g.registered) > 0,
      }));

      return { kind: 'ok', groups: list };
    },

    /**
     * يجيب كل الكورسات
     */
    async getCourses({ forceRefresh = false } = {}) {
      if (!forceRefresh && courseCache.data && Date.now() - courseCache.ts < CACHE_TTL) {
        return { kind: 'ok', courses: courseCache.data };
      }

      if (pageRef.lastAJAX?.length > 0 && Date.now() - pageRef.ajaxTime < 60_000) {
        const list = mapCourses(pageRef.lastAJAX);
        courseCache = { ts: Date.now(), data: list };
        return { kind: 'ok', courses: list };
      }

      await triggerAjax();

      if (pageRef.lastAJAX?.length > 0) {
        const list = mapCourses(pageRef.lastAJAX);
        courseCache = { ts: Date.now(), data: list };
        return { kind: 'ok', courses: list };
      }

      log.warn('getCourses: AJAX failed → direct fetch');

      const r = await fetchInPage(
        CONFIG.API.coursesList +
        '?GradeStatusIds=0,1,2,3,4,5&GroupsIds=-1&IsVirtualRegisteration=false'
      );

      if (r.kind !== 'ok') return r;

      const data = Array.isArray(r.data) ? r.data : [];
      const list = mapCourses(data);
      courseCache = { ts: Date.now(), data: list };

      return { kind: 'ok', courses: list };
    },

    /**
     * يجيب معلومات التسجيل
     */
    async getRegInfo() {
      return retry(
        () => call('POST', CONFIG.API.regInfo),
        { label: 'regInfo', attempts: 2 }
      );
    },

    /**
     * يحل مادة من كودها
     */
    async resolveTargetId(query, { onlyRegisterable = true } = {}) {
      const r = await this.getCourses({ forceRefresh: true });
      if (r.kind !== 'ok') return null;

      const pool = onlyRegisterable
        ? r.courses.filter(c => isRegisterable(c.status))
        : r.courses;

      const qNorm = normalizeCode(query);
      const qRaw  = String(query).toUpperCase().trim();
      const qNoSp = qRaw.replace(/\s+/g, '');

      return (
        pool.find(c => normalizeCode(c.code) === qNorm) ||
        pool.find(c => String(c.code).toUpperCase().trim() === qRaw) ||
        pool.find(c => normalizeCode(c.code).includes(qNorm)) ||
        pool.find(c => String(c.name).toUpperCase().includes(qRaw)) ||
        pool.find(c => String(c.name).toUpperCase().replace(/\s+/g, '').includes(qNoSp)) ||
        null
      );
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 25 — DETECTION: EARLY COURSE APPEARANCE
//  ═══════════════════════════════════════════════════════════════════════════

async function runEarlyDetection(api, state) {
  if (!state.earlyDetection?.enabled) return;

  state.earlyDetection.checks++;
  state.earlyDetection.lastCheck = Date.now();

  const r = await api.getCourses({ forceRefresh: true });
  if (r.kind !== 'ok') {
    log.warn(`Early: ${r.kind}`);
    return;
  }

  for (const t of USER_CONFIG.targets) {
    // Skip لو الـ target موجود بالفعل
    if (state.targets[t.code]?.id) continue;

    const qNorm = normalizeCode(t.code);
    const qRaw  = String(t.code).toUpperCase().trim();
    const qNoSp = qRaw.replace(/\s+/g, '');

    const found = r.courses.find(c =>
      normalizeCode(c.code) === qNorm ||
      String(c.code).toUpperCase().trim() === qRaw ||
      normalizeCode(c.code).includes(qNorm) ||
      String(c.name).toUpperCase().includes(qRaw) ||
      String(c.name).toUpperCase().replace(/\s+/g, '').includes(qNoSp)
    );

    if (!found) continue;

    // نسجل الـ hit دايماً
    state.earlyDetection.hits++;

    state.targets[t.code] = {
      id: found.id,
      name: found.name,
      status: found.status,
      apiCode: found.code,
      groups: {},
      knownGroups: {},
      watchGroups: [],
      lastHash: null,
      detectedAt: Date.now(),
      firstScanDone: false,  // ⭐ أول scan صامت
    };

    state._activeTarget = t.code;
    audit(state, 'early_hit', { code: found.code, id: found.id });

    // Dedup
    const fp = makeFingerprint('course_appeared', { code: t.code, id: found.id });
    if (!shouldSendAlert(state, fp, USER_CONFIG.dedup.courseAppeared)) {
      log.info(`[dedup] course_appeared suppressed for ${t.code}`);
      continue;
    }

    log.ok(`🎉 EARLY: ${found.code} id=${found.id}`);
    state.counters.alertsSent++;

    await tgSend(
      `🎉🎉 <b>${escapeHtml(t.code)} ظهرت!</b>\n\n` +
      `📋 <code>${escapeHtml(found.code)}</code>\n` +
      `📚 ${escapeHtml(found.name)}\n` +
      `🆔 <code>${escapeHtml(found.id)}</code>\n` +
      `📊 ${statusLabel(found.status)}\n\n` +
      `⚡ بدأ مراقبة المجموعات…\n📋 /groups`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 26 — DETECTION: GROUP WATCH (NEW + OPENED)
//  ═══════════════════════════════════════════════════════════════════════════

/**
 * يفلتر المجموعات اللي بتتراقب
 */
function filterByWatch(groups, watchList) {
  if (!watchList?.length) return groups;
  const w = watchList.map(x => x.toUpperCase());
  return groups.filter(g =>
    w.some(p => String(g.name || '').toUpperCase().includes(p))
  );
}

/**
 * يستقبل إشارة: مجموعة جديدة
 */
async function signalNewGroup(state, code, newGroups) {
  if (!USER_CONFIG.behavior.alertOnNewGroups) return;
  if (newGroups.length === 0) return;

  const fp = makeFingerprint('new_group', {
    code,
    names: newGroups.map(g => g.name).sort(),
  });

  if (!shouldSendAlert(state, fp, USER_CONFIG.dedup.newGroup)) return;

  state.counters.newGroups += newGroups.length;
  state.counters.alertsSent++;
  audit(state, 'new_group', { code, groups: newGroups.map(g => g.name) });

  let msg = `🆕 <b>${escapeHtml(code)} — ${newGroups.length} مجموعة جديدة!</b>\n\n`;

  newGroups.forEach((g, i) => {
    msg += `<b>${i + 1}. ${escapeHtml(g.name)}</b> — 💺 ${g.seats}/${g.total}\n`;
    if (g.slots[0]) {
      msg += `   📅 ${escapeHtml(g.slots[0].day)} | ⏰ ${escapeHtml(g.slots[0].time)}\n`;
    }
    if (g.available) {
      msg += `   🔥 <b>فيها مقاعد!</b>\n`;
    }
    msg += `\n`;
  });

  msg += `🔗 افتح DULMS`;
  await tgSend(msg, { silent: false });
}

/**
 * يستقبل إشارة: مجموعة فتحت
 */
async function signalGroupOpen(state, code, newlyOpened) {
  if (!USER_CONFIG.behavior.alertOnGroupOpen) return;
  if (newlyOpened.length === 0) return;

  const fp = makeFingerprint('group_open', {
    code,
    names: newlyOpened.map(g => g.name).sort(),
  });

  if (!shouldSendAlert(state, fp, USER_CONFIG.dedup.groupOpen)) return;

  state.counters.opens += newlyOpened.length;
  state.counters.alertsSent++;
  audit(state, 'target_open', { code, groups: newlyOpened.map(g => g.name) });

  let msg = `🎉 <b>${escapeHtml(code)} — ${newlyOpened.length} فتحت!</b>\n\n`;

  newlyOpened.slice(0, 8).forEach((g, i) => {
    msg += `<b>${i + 1}. ${escapeHtml(g.name)}</b> — 💺 ${g.seats}/${g.total}\n`;
    if (g.slots[0]) {
      msg += `   📅 ${escapeHtml(g.slots[0].day)} | ⏰ ${escapeHtml(g.slots[0].time)}\n`;
    }
    if (g.slots[0]?.hall) {
      msg += `   🏛 ${escapeHtml(g.slots[0].hall)}\n`;
    }
    msg += `\n`;
  });

  msg += `🔗 <b>افتح DULMS حالاً!</b>`;
  await tgSend(msg, { silent: !USER_CONFIG.notifications.notifyWithSound });
}

/**
 * الفحص الرئيسي للمجموعات
 */
async function runGroupWatch(api, state) {
  for (const [code, tgt] of Object.entries(state.targets)) {
    if (!tgt.id) continue;

    const r = await api.getCourseSchedule(tgt.id);

    // Session ميتة؟
    if (r.kind === 'session_dead') {
      return { kind: 'session_dead', target: code };
    }

    if (r.kind !== 'ok') {
      log.warn(`GroupWatch(${code}): ${r.kind}`);
      continue;
    }

    const allGroups = (r.groups || []).filter(g => g?.name);
    const watched = filterByWatch(allGroups, tgt.watchGroups);

    tgt.groups = tgt.groups || {};
    tgt.knownGroups = tgt.knownGroups || {};

    const isFirstScan = !tgt.firstScanDone;

    if (isFirstScan && USER_CONFIG.behavior.firstScanSilent) {
      log.info(`[first-scan] ${code}: ${allGroups.length} groups (silent)`);
      tgt.firstScanDone = true;
    } else {
      // ═══ إشارة 1: مجموعة جديدة ═══
      const newGroups = watched.filter(g => !tgt.knownGroups[g.name]);
      await signalNewGroup(state, code, newGroups);

      // ═══ إشارة 2: مجموعة فتحت ═══
      const newlyOpened = watched.filter(g =>
        g.available && !tgt.groups[g.name]?.open
      );
      await signalGroupOpen(state, code, newlyOpened);

      // ═══ إشارة 3: مقاعد زادت ═══
      await signalSeatIncrease(state, code, tgt, watched, newlyOpened);

      // ═══ إشارة 4: حجب اتغير ═══
      await signalBlockChange(state, code, tgt, watched);
    }

    // تحديث الـ snapshot
    for (const g of allGroups) {
      tgt.groups[g.name] = {
        open: g.available,
        blocked: g.blocked,
        seats: g.seats,
        total: g.total,
        lastSeen: Date.now(),
      };

      tgt.knownGroups[g.name] = tgt.knownGroups[g.name] || {
        firstSeen: Date.now(),
      };
    }

    tgt.lastHash = snapshotHash(allGroups);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 27 — DETECTION: SEAT INCREASE
//  ═══════════════════════════════════════════════════════════════════════════

async function signalSeatIncrease(state, code, tgt, watched, newlyOpened) {
  if (!USER_CONFIG.behavior.alertOnSeatIncrease) return;

  const increases = watched.filter(g => {
    const prev = tgt.groups[g.name]?.seats;
    return g.available && prev != null && g.seats > prev && !newlyOpened.includes(g);
  });

  if (increases.length === 0) return;

  const fp = makeFingerprint('seat_increase', {
    code,
    changes: increases.map(g => `${g.name}:${tgt.groups[g.name]?.seats}→${g.seats}`).sort(),
  });

  if (!shouldSendAlert(state, fp, USER_CONFIG.dedup.seatIncrease)) return;

  state.counters.seatIncreases += increases.length;
  state.counters.alertsSent++;
  audit(state, 'seat_increase', {
    code,
    changes: increases.map(g => `${g.name}:${tgt.groups[g.name]?.seats}→${g.seats}`),
  });

  let msg = `📈 <b>${escapeHtml(code)} — مقاعد زادت!</b>\n\n`;

  increases.forEach((g, i) => {
    const prev = tgt.groups[g.name]?.seats || 0;
    msg += `<b>${i + 1}. ${escapeHtml(g.name)}</b> — 💺 ${prev} → <b>${g.seats}</b>/${g.total}\n\n`;
  });

  msg += `🔗 <b>افتح DULMS حالاً!</b>`;
  await tgSend(msg, { silent: false });
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 28 — DETECTION: BLOCK CHANGE
//  ═══════════════════════════════════════════════════════════════════════════

async function signalBlockChange(state, code, tgt, watched) {
  if (!USER_CONFIG.behavior.alertOnBlockChange) return;

  const blockChanges = watched.filter(g => {
    const prev = tgt.groups[g.name]?.blocked;
    return prev != null && prev !== g.blocked;
  });

  if (blockChanges.length === 0) return;

  const fp = makeFingerprint('block_change', {
    code,
    changes: blockChanges.map(g => `${g.name}:${tgt.groups[g.name]?.blocked}→${g.blocked}`).sort(),
  });

  if (!shouldSendAlert(state, fp, USER_CONFIG.dedup.blockChange)) return;

  state.counters.blockChanges += blockChanges.length;
  state.counters.alertsSent++;
  audit(state, 'block_change', {
    code,
    changes: blockChanges.map(g => `${g.name}:${g.blocked}`),
  });

  let msg = `🚫 <b>${escapeHtml(code)} — حالة الحجب اتغيرت!</b>\n\n`;

  blockChanges.forEach((g, i) => {
    const icon = g.blocked ? '🔒 محجوبة' : '🔓 مفتوحة';
    msg += `<b>${i + 1}. ${escapeHtml(g.name)}</b> — ${icon}\n\n`;
  });

  await tgSend(msg, { silent: false });
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 29 — DETECTION: SECURITY GUARD (COURSE DROPS)
//  ═══════════════════════════════════════════════════════════════════════════

async function runSecurityGuard(api, state) {
  const r = await api.getCourses();
  if (r.kind !== 'ok') return { kind: r.kind };

  const currentReg = r.courses
    .filter(c => Number(c.status) === 3 || Number(c.status) === 4)
    .map(c => ({ id: c.id, code: c.code, name: c.name }));

  // أول مرة → baseline
  if (!state.registeredCourses.length) {
    state.registeredCourses = currentReg;
    log.ok(`Baseline: ${currentReg.length} courses`);
    audit(state, 'baseline_set', { codes: currentReg.map(c => c.code) });
    return { kind: 'ok' };
  }

  // ─── كشف المواد اللي اتشالت ───
  for (const saved of state.registeredCourses) {
    if (!currentReg.some(c => sameCourse(c, saved))) {
      const fp = makeFingerprint('course_drop', { code: saved.code, id: saved.id });

      if (shouldSendAlert(state, fp, USER_CONFIG.dedup.courseDrop)) {
        state.counters.drops++;
        audit(state, 'course_dropped', { code: saved.code });

        if (USER_CONFIG.behavior.alertOnCourseDrop) {
          state.counters.alertsSent++;
          await tgSend(
            `🚨 <b>مادة اتشالت!</b>\n❌ ${escapeHtml(saved.code)} — ${escapeHtml(saved.name)}`,
            { silent: false }
          );
        }
      }
    }
  }

  // ─── كشف المواد الجديدة ───
  for (const curr of currentReg) {
    if (!state.registeredCourses.some(s => sameCourse(s, curr))) {
      state.counters.adds++;
      audit(state, 'course_added', { code: curr.code });
      await tgSend(`✅ <b>مادة جديدة!</b>\n➕ ${escapeHtml(curr.code)}`);
    }
  }

  state.registeredCourses = currentReg;
  return { kind: 'ok' };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 30 — MAIN LOOP
//  ═══════════════════════════════════════════════════════════════════════════

async function runScan(browser, deadline) {
  const state = loadState();
  state.startedAt = Date.now();
  state.counters.scans = (state.counters.scans || 0) + 1;

  // Gap stats
  const lastEnd = state.gapStats.lastRunEndedAt;
  if (lastEnd > 0) {
    const gap = Date.now() - lastEnd;
    state.gapStats.gapCount = (state.gapStats.gapCount || 0) + 1;
    if (gap > (state.gapStats.maxGapMs || 0)) state.gapStats.maxGapMs = gap;
    const n = state.gapStats.gapCount;
    state.gapStats.avgGapMs = Math.round(
      ((state.gapStats.avgGapMs || 0) * (n - 1) + gap) / n
    );
    log.info(`Gap since last run: ${formatDuration(gap)}`);
  }
  state.gapStats.lastRunStartedAt = Date.now();

  // Auto-resume
  if (state.paused && USER_CONFIG.behavior.autoResumeOnStart) {
    log.warn('Auto-resume');
    state.paused = false;
    audit(state, 'auto_resume');
  }

  setCurrentState(state);
  saveState(state);

  // ─── Session Decision ─────────────────────────────────────────
  const strategy = decideSessionStrategy(state);
  let needLogin = strategy === SESSION_STRATEGY.FRESH_LOGIN;
  let reusedSession = false;

  if (needLogin) {
    cleanupSession();

    try {
      await loginAndCaptureCookies(browser, state);
      state.lastError = null;
      saveState(state);
    } catch (e) {
      state.counters.loginFailures++;
      state.counters.errors++;
      state.sessionStats.failures = (state.sessionStats.failures || 0) + 1;
      state.lastError = {
        t: Date.now(),
        phase: 'login',
        cause: e.loginCause || 'unknown',
        message: String(e.message || e).slice(0, 500),
      };
      audit(state, 'login_failed', { cause: e.loginCause || 'unknown' });
      saveState(state);
      throw e;
    }
  }

  // ─── Setup ────────────────────────────────────────────────────
  let ctx = await createAuthContext(browser, true);
  const pageRef = { page: null, lastAJAX: null, ajaxTime: 0 };

  await setupAJAXInterception(ctx, pageRef);
  let api = makeApi(ctx, pageRef);

  // ─── Validate session لو محتاجة ───────────────────────────────
  if (!needLogin && strategy === SESSION_STRATEGY.VALIDATE &&
      USER_CONFIG.session.validateBeforeUse) {
    const validation = await validateSession(pageRef.page, state);

    if (validation === VALIDATION.EXPIRED) {
      log.warn('❌ Session expired — relogin');
      state.counters.relogins++;
      state.sessionStats.relogins = (state.sessionStats.relogins || 0) + 1;
      state.sessionStats.failures = (state.sessionStats.failures || 0) + 1;

      try { await ctx.close(); } catch {}
      cleanupSession();

      await loginAndCaptureCookies(browser, state);
      ctx = await createAuthContext(browser, true);
      await setupAJAXInterception(ctx, pageRef);
      api = makeApi(ctx, pageRef);
    } else if (validation === VALIDATION.VALID) {
      log.ok('✅ Session valid — reusing');
      reusedSession = true;
      state.sessionStats.reuses = (state.sessionStats.reuses || 0) + 1;
      state.sessionStats.lastReuseAt = Date.now();
      await saveSession(ctx);
    } else {
      log.warn('⚠️ Session validation unknown — proceed');
      reusedSession = true;
      state.sessionStats.reuses = (state.sessionStats.reuses || 0) + 1;
    }
  } else if (!needLogin) {
    log.ok('✅ Session fresh — reusing directly');
    reusedSession = true;
    state.sessionStats.reuses = (state.sessionStats.reuses || 0) + 1;
  }

  saveState(state);

  // ─── Chat migration ───────────────────────────────────────────
  if (!state.tgChatId) {
    state.tgChatId = CONFIG.tgChatId;
  } else if (state.tgChatId !== CONFIG.tgChatId) {
    state.tgChatId = CONFIG.tgChatId;
    await tgSend(`🔄 <b>Chat migrated</b>`, { replyMarkup: MAIN_KEYBOARD });
  }
  saveState(state);

  // ─── Startup brief ────────────────────────────────────────────
  const startupGapMs = USER_CONFIG.notifications.startupBriefHours * 60 * 60_000;
  if (USER_CONFIG.behavior.sendStartupBrief &&
      Date.now() - state.startupBriefedAt > startupGapMs) {
    state.startupBriefedAt = Date.now();
    const targetList = USER_CONFIG.targets.map(t => t.code).join(', ');

    await tgSend(
      `🚀 <b>Watcher ${CONFIG.versionLabel}</b>\n\n` +
      `🎯 Targets: <b>${escapeHtml(targetList)}</b>\n` +
      `👥 Group watch: <b>ON (10s)</b>\n` +
      `💺 Seat watch: <b>ON</b>\n` +
      `🚫 Block watch: <b>ON</b>\n` +
      `🛡️ Guarding <b>${state.registeredCourses.length}</b> courses\n` +
      `🔐 Session: <b>${reusedSession ? 'reused' : 'fresh login'}</b>`,
      { replyMarkup: MAIN_KEYBOARD }
    );
    saveState(state);
  }

  log.step(`${CONFIG.versionLabel} STARTED (session=${reusedSession ? 'REUSED' : 'FRESH'})`);

  // ─── Timers ───────────────────────────────────────────────────
  let fastMode = true;
  let consecutiveNoChanges = 0;

  const T = USER_CONFIG.timing;

  const timers = {
    groupWatch:     Date.now() + 500,
    security:       Date.now() + 1_500,
    earlyDetection: Date.now() + 3_000,
    telegram:       Date.now() + 1_000,
    memory:         Date.now() + T.memoryCheckMs,
    pageHealth:     Date.now() + T.pageHealthMs,
    sessionRenew:   Date.now() + T.sessionRenewEveryMs,
    stateFlush:     Date.now() + T.stateFlushEveryMs,
  };

  // ─── Main Loop ────────────────────────────────────────────────
  while (Date.now() < deadline) {
    const now = Date.now();

    // ─── Telegram polling ────────────────────────────────────
    if (now >= timers.telegram) {
      await handleTelegramCommands(state, api);
      timers.telegram = Date.now() + T.telegramPollMs;
    }

    if (state.paused) {
      await sleep(1000);
      continue;
    }

    // ─── State flush ─────────────────────────────────────────
    if (now >= timers.stateFlush) {
      saveState(state);
      timers.stateFlush = Date.now() + T.stateFlushEveryMs;
    }

    // ─── Memory check ────────────────────────────────────────
    if (now >= timers.memory) {
      const mb = rssMb();

      if (mb >= CONFIG.memRestartMb) {
        log.err(`Memory critical (${mb} MB) — rebuild`);
        saveState(state);
        try { await ctx.close(); } catch {}
        state.gapStats.lastRunEndedAt = Date.now();
        saveState(state);
        return RESULT.REBUILD;
      } else if (mb >= CONFIG.memWarnMb) {
        log.warn(`Memory high: ${mb} MB`);
      }

      timers.memory = Date.now() + T.memoryCheckMs;
    }

    // ─── Page health ─────────────────────────────────────────
    if (now >= timers.pageHealth) {
      try {
        if (!pageRef.page || pageRef.page.isClosed()) {
          log.warn('Page closed — reopening…');
          await setupAJAXInterception(ctx, pageRef);
          api = makeApi(ctx, pageRef);
        }
      } catch (e) {
        log.warn('Page health failed:', e.message);
      }
      timers.pageHealth = Date.now() + T.pageHealthMs;
    }

    // ─── Session renew ───────────────────────────────────────
    if (now >= timers.sessionRenew) {
      try {
        await saveSession(ctx);
        timers.sessionRenew = Date.now() + T.sessionRenewEveryMs;
      } catch (e) {
        log.warn('Session renew failed:', e.message);
        timers.sessionRenew = Date.now() + 60_000;
      }
    }

    // ─── Early detection ─────────────────────────────────────
    if (now >= timers.earlyDetection) {
      try {
        await runEarlyDetection(api, state);
      } catch (e) {
        log.warn('Early error:', e.message);
      }

      const interval = fastMode ? T.fastIntervalMs : T.slowIntervalMs;
      timers.earlyDetection = Date.now() + interval;
      saveState(state);
    }

    // ─── Group watch (MAIN) ──────────────────────────────────
    if (now >= timers.groupWatch && Object.keys(state.targets).length > 0) {
      try {
        const before = JSON.stringify(state.targets);
        const gr = await runGroupWatch(api, state);
        const after = JSON.stringify(state.targets);

        if (before === after) {
          consecutiveNoChanges++;
        } else {
          consecutiveNoChanges = 0;
          fastMode = true;
        }
        if (consecutiveNoChanges > 30) fastMode = false;

        if (gr?.kind === 'session_dead') {
          log.warn('GroupWatch: session dead — relogin');
          state.counters.relogins++;
          state.counters.sessionDeaths = (state.counters.sessionDeaths || 0) + 1;
          state.sessionStats.relogins = (state.sessionStats.relogins || 0) + 1;
          state.sessionStats.failures = (state.sessionStats.failures || 0) + 1;

          try { await ctx.close(); } catch {}
          cleanupSession();

          await loginAndCaptureCookies(browser, state);
          ctx = await createAuthContext(browser, true);
          await setupAJAXInterception(ctx, pageRef);
          api = makeApi(ctx, pageRef);

          timers.groupWatch = Date.now() + 3_000;
        } else {
          const interval = (USER_CONFIG.behavior.adaptivePolling && !fastMode)
            ? T.slowIntervalMs
            : T.fastIntervalMs;
          timers.groupWatch = Date.now() + interval;
        }
      } catch (e) {
        log.warn('GroupWatch error:', e.message);
      }
      saveState(state);
    }

    // ─── Security guard ──────────────────────────────────────
    if (now >= timers.security) {
      try {
        const sr = await runSecurityGuard(api, state);

        if (sr.kind === 'session_dead') {
          log.warn('Security: session dead — relogin');
          state.counters.relogins++;
          state.counters.sessionDeaths = (state.counters.sessionDeaths || 0) + 1;
          state.sessionStats.relogins = (state.sessionStats.relogins || 0) + 1;
          state.sessionStats.failures = (state.sessionStats.failures || 0) + 1;

          try { await ctx.close(); } catch {}
          cleanupSession();

          await loginAndCaptureCookies(browser, state);
          ctx = await createAuthContext(browser, true);
          await setupAJAXInterception(ctx, pageRef);
          api = makeApi(ctx, pageRef);

          timers.security = Date.now() + 5_000;
        } else {
          timers.security = Date.now() + T.securityIntervalMs;
        }

        saveState(state);
      } catch (e) {
        log.warn('Security error:', e.message);
        timers.security = Date.now() + 60_000;
      }
    }

    await sleep(T.heartbeatMs);
  }

  try { await ctx.close(); } catch {}

  state.gapStats.lastRunEndedAt = Date.now();
  saveState(state);

  return RESULT.COMPLETED;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 31 — HEARTBEAT (placeholder for future)
//  ═══════════════════════════════════════════════════════════════════════════
//  Note: heartbeat is currently integrated in main loop with sleep()

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 32 — SHUTDOWN
//  ═══════════════════════════════════════════════════════════════════════════

let shuttingDown = false;

function setupShutdownHandlers() {
  const handler = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.warn(`${sig} — saving state before exit`);

    try {
      const s = getCurrentState();
      if (s) {
        s.gapStats = s.gapStats || {};
        s.gapStats.lastRunEndedAt = Date.now();
        saveState(s);
      }
    } catch (e) {
      log.warn('Shutdown save failed:', e.message);
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT',  () => handler('SIGINT'));
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 33 — ERROR RECOVERY
//  ═══════════════════════════════════════════════════════════════════════════

async function handleFatalError(e, iter, maxIter) {
  log.err('Fatal:', e.message);
  if (e.stack) console.error(redact(e.stack));

  try {
    const state = getCurrentState() || loadState();
    state.counters.errors++;
    state.lastError = {
      t: Date.now(),
      phase: 'fatal',
      message: String(e.message || e).slice(0, 500),
    };
    audit(state, 'fatal', { message: String(e.message || e).slice(0, 200) });
    saveState(state);

    const errSummary = redact(String(e.message || e)).slice(0, 400);

    await tgSend(
      `💥 <b>Watcher crashed</b>\n\n<code>${escapeHtml(errSummary)}</code>\n\n` +
      `🕐 ${new Date().toISOString().slice(11, 19)} UTC\n` +
      `🔁 Iter ${iter}/${maxIter}`,
      { silent: false }
    );
  } catch (ne) {
    log.warn('Crash notify failed:', ne.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 34 — ENTRYPOINT
//  ═══════════════════════════════════════════════════════════════════════════

(async function main() {

  // ─── Validation ──────────────────────────────────────────────
  if (!CONFIG.username || !CONFIG.password) {
    log.err('Missing DULMS_USERNAME / DULMS_PASSWORD env vars');
    process.exit(1);
  }

  setupShutdownHandlers();

  const startTs = Date.now();
  const deadline = startTs + CONFIG.durationMin * 60_000;

  log.info(`${CONFIG.versionLabel} — PID ${process.pid}, RSS ${rssMb()} MB`);
  log.info(`Mode: GitHub Actions | Duration: ${CONFIG.durationMin}min`);

  await registerBotCommands();

  let iter = 0;
  const maxIter = 10;

  while (Date.now() < deadline && iter < maxIter) {
    iter++;

    // ─── Launch browser ─────────────────────────────────────
    let browser;
    try {
      browser = await createBrowser();
    } catch (e) {
      log.err('Browser launch failed:', e.message);
      await sleep(3_000);
      continue;
    }

    // ─── Run scan ────────────────────────────────────────────
    let result;
    try {
      result = await runScan(browser, deadline);
    } catch (e) {
      await handleFatalError(e, iter, maxIter);
      result = RESULT.FATAL;
    } finally {
      try { await browser.close(); } catch {}
    }

    // ─── Handle result ──────────────────────────────────────
    if (result === RESULT.COMPLETED) {
      log.ok('Completed');
      break;
    }

    if (result === RESULT.REBUILD) {
      log.info('Rebuilding…');
      await sleep(2_000);
      continue;
    }

    if (result === RESULT.FATAL) {
      log.err('Fatal — retry in 30s');
      await sleep(30_000);
      continue;
    }
  }

  // ─── Final save ──────────────────────────────────────────────
  try {
    const s = getCurrentState();
    if (s) saveState(s);
    else saveState(loadState());
  } catch {}

  log.info(`Exiting — RSS ${rssMb()} MB`);
})();
