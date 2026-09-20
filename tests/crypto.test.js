'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════════
//  Crypto Tests — AES-256-GCM
// ═══════════════════════════════════════════════════════════════════════

const ENC_PREFIX = 'ENC1:';

function encryptString(plain, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const s = String(plain);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function decryptString(data, keyHex) {
  const s = String(data);
  if (!s.startsWith(ENC_PREFIX)) return s;
  const key = Buffer.from(keyHex, 'hex');
  const buf = Buffer.from(s.slice(ENC_PREFIX.length), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

const newKey = () => crypto.randomBytes(32).toString('hex');

// ─── Basic ──────────────────────────────────────────────────────────────
test('roundtrip: encrypt → decrypt', () => {
  const key = newKey();
  const plain = 'Hello DULMS Watcher v14.0';
  const enc = encryptString(plain, key);
  assert.ok(enc.startsWith(ENC_PREFIX));
  assert.strictEqual(decryptString(enc, key), plain);
});

test('different IV for same plaintext', () => {
  const key = newKey();
  const enc1 = encryptString('same', key);
  const enc2 = encryptString('same', key);
  assert.notStrictEqual(enc1, enc2);
});

test('empty string roundtrip', () => {
  const key = newKey();
  const enc = encryptString('', key);
  assert.strictEqual(decryptString(enc, key), '');
});

// ─── Security ───────────────────────────────────────────────────────────
test('decrypt with wrong key throws', () => {
  const key1 = newKey();
  const key2 = newKey();
  const enc = encryptString('secret', key1);
  assert.throws(() => decryptString(enc, key2));
});

test('tampered ciphertext throws', () => {
  const key = newKey();
  const enc = encryptString('secret', key);
  const buf = Buffer.from(enc.slice(ENC_PREFIX.length), 'base64');
  buf[buf.length - 1] ^= 0xff;
  const tampered = ENC_PREFIX + buf.toString('base64');
  assert.throws(() => decryptString(tampered, key));
});

test('tampered IV throws', () => {
  const key = newKey();
  const enc = encryptString('secret', key);
  const buf = Buffer.from(enc.slice(ENC_PREFIX.length), 'base64');
  buf[0] ^= 0xff;
  const tampered = ENC_PREFIX + buf.toString('base64');
  assert.throws(() => decryptString(tampered, key));
});

test('plaintext without prefix passes through', () => {
  const key = newKey();
  assert.strictEqual(decryptString('plain text', key), 'plain text');
});

// ─── Content types ──────────────────────────────────────────────────────
test('unicode + emoji', () => {
  const key = newKey();
  const plain = 'مرحبا 🎉 Тест 中文';
  const enc = encryptString(plain, key);
  assert.strictEqual(decryptString(enc, key), plain);
});

test('multi-line text', () => {
  const key = newKey();
  const plain = 'line1\nline2\nline3';
  const enc = encryptString(plain, key);
  assert.strictEqual(decryptString(enc, key), plain);
});

test('JSON string', () => {
  const key = newKey();
  const obj = { a: 1, b: [2, 3], c: { d: 'e' } };
  const enc = encryptString(JSON.stringify(obj), key);
  assert.deepStrictEqual(JSON.parse(decryptString(enc, key)), obj);
});

// ─── Size ──────────────────────────────────────────────────────────────
test('large payload (100KB)', () => {
  const key = newKey();
  const plain = 'x'.repeat(100_000);
  const enc = encryptString(plain, key);
  assert.strictEqual(decryptString(enc, key), plain);
});

test('large payload (1MB)', () => {
  const key = newKey();
  const plain = crypto.randomBytes(1_000_000).toString('hex');
  const enc = encryptString(plain, key);
  assert.strictEqual(decryptString(enc, key), plain);
});

// ─── Key validation ─────────────────────────────────────────────────────
test('key must be 64 hex chars', () => {
  assert.throws(() => Buffer.from('short', 'hex'));
  // Note: actual validation is in watch.js getEncryptionKey()
});

test('key of 32 random bytes works', () => {
  const key = newKey();
  assert.strictEqual(key.length, 64);
  assert.ok(/^[0-9a-f]{64}$/.test(key));
});
