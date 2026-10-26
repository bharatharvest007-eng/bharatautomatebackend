/**
 * Password hashing, tokens, HMAC and at-rest encryption for third-party secrets.
 *
 * - Passwords: scrypt, stored as 'scrypt$<saltB64>$<hashB64>'. Legacy rows that
 *   still hold plaintext are verified with a constant-time compare so the login
 *   route can rehash them on first successful sign-in.
 * - Secrets (Meta access tokens, webhook signing secrets): AES-256-GCM, stored as
 *   'enc:v1:<ivB64>:<tagB64>:<ctB64>'. `decryptSecret` passes legacy plaintext
 *   through unchanged, so existing rows keep working until they are re-saved.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
const SCRYPT_PREFIX = 'scrypt$';
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;
const ENC_PREFIX = 'enc:v1:';
const ENC_IV_BYTES = 12;
function scryptAsync(password, salt, keylen) {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, keylen, (error, derivedKey) => {
            if (error)
                reject(error);
            else
                resolve(derivedKey);
        });
    });
}
export async function hashPassword(plain) {
    const salt = randomBytes(SCRYPT_SALT_BYTES);
    const hash = await scryptAsync(plain, salt, SCRYPT_KEYLEN);
    return `${SCRYPT_PREFIX}${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function isLegacyPasswordHash(stored) {
    return !stored.startsWith(SCRYPT_PREFIX);
}
export async function verifyPassword(plain, stored) {
    if (!stored || typeof plain !== 'string')
        return false;
    if (isLegacyPasswordHash(stored)) {
        // Hash both sides first so the comparison does not leak the stored length.
        return timingSafeEqual(createHash('sha256').update(plain).digest(), createHash('sha256').update(stored).digest());
    }
    const [, saltB64, hashB64] = stored.split('$');
    if (!saltB64 || !hashB64)
        return false;
    const expected = Buffer.from(hashB64, 'base64');
    if (expected.length === 0)
        return false;
    const actual = await scryptAsync(plain, Buffer.from(saltB64, 'base64'), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function randomToken(bytes = 32) {
    return randomBytes(bytes).toString('base64url');
}
export function sha256(input) {
    return createHash('sha256').update(input).digest('hex');
}
export function hmacSha256Hex(secret, payload) {
    return createHmac('sha256', secret).update(payload).digest('hex');
}
export function safeEqual(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length)
        return false;
    return timingSafeEqual(bufA, bufB);
}
// --- At-rest encryption -------------------------------------------------------
const keyCache = new Map();
let warnedInsecureKey = false;
function encryptionKey() {
    const material = env.ENCRYPTION_KEY || env.SESSION_SECRET;
    if (!material && env.isProd && !warnedInsecureKey) {
        warnedInsecureKey = true;
        console.error('[Crypto] ENCRYPTION_KEY and SESSION_SECRET are unset — secrets are encrypted with an insecure development key.');
    }
    const source = material || 'dev-insecure-key';
    let key = keyCache.get(source);
    if (!key) {
        key = createHash('sha256').update(source).digest();
        keyCache.set(source, key);
    }
    return key;
}
export function isEncryptedSecret(value) {
    return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}
/** Encrypts a secret for storage. Empty input → ''. Already-encrypted input is returned unchanged. */
export function encryptSecret(plain) {
    if (!plain)
        return '';
    if (isEncryptedSecret(plain))
        return plain;
    const iv = randomBytes(ENC_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}
/**
 * Decrypts a stored secret. Values without the 'enc:v1:' prefix (legacy
 * plaintext) are returned as-is. A value that fails to decrypt (key rotated,
 * data corrupted) yields '' so callers surface "reconnect" errors instead of crashing.
 */
export function decryptSecret(value) {
    if (!value)
        return '';
    if (!isEncryptedSecret(value))
        return value;
    const parts = value.slice(ENC_PREFIX.length).split(':');
    if (parts.length !== 3) {
        console.error('[Crypto] Malformed encrypted secret');
        return '';
    }
    try {
        const [ivB64, tagB64, ctB64] = parts;
        const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
    }
    catch {
        console.error('[Crypto] Failed to decrypt secret (ENCRYPTION_KEY changed or data corrupted)');
        return '';
    }
}
/** The decrypted access token of a connected account (doc or lean object). */
export function accountToken(account) {
    return decryptSecret(account.accessToken);
}
/** 'sk_live_abcd…' → '••••••••wxyz' for display. Short values are fully masked. */
export function maskSecret(value, visible = 4) {
    if (!value)
        return '';
    if (value.length <= visible * 2)
        return '•'.repeat(Math.max(value.length, 4));
    return `${'•'.repeat(Math.min(value.length - visible, 12))}${value.slice(-visible)}`;
}
