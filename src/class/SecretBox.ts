import {createCipheriv, createDecipheriv, randomBytes, scryptSync} from 'crypto';

// Encryption at rest of the credentials held in mame-awesome-ui-config.json (ScreenScraper and
// repository passwords). A random data key encrypts the values; that data key is itself wrapped
// with a key derived from the BO account's password, and stored wrapped in bo_user.secretsKey.
// Only the BO ever needs those credentials, always behind a sign-in: the data key is unwrapped at
// login, kept in the (in-memory) session, and never written to disk in the clear. Changing the
// password only re-wraps the 32-byte data key, the config file is left untouched.
//
// Both formats carry a version prefix, so a plaintext value left by an older MAUI (no prefix) is
// told apart from an encrypted one, and a future format can live alongside this one.

export const SECRET_PREFIX = 'MAUIENC1.';
export const WRAPPED_KEY_PREFIX = 'MAUIKEY1.';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
// scrypt cost: ~40 ms on a desktop CPU (slower on a Raspberry Pi), paid once per sign-in or
// password change - it is what makes brute-forcing a stolen wrapped key expensive.
const SCRYPT_OPTIONS = {N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024};

function encode(parts: Buffer[]): string {
    return parts.map(part => part.toString('base64url')).join('.');
}

function decode(value: string, prefix: string, count: number): Buffer[] | null {
    if (!value.startsWith(prefix)) {
        return null;
    }
    const parts = value.slice(prefix.length).split('.');
    if (parts.length !== count || parts.some(part => !/^[A-Za-z0-9_-]*$/.test(part))) {
        return null;
    }
    return parts.map(part => Buffer.from(part, 'base64url'));
}

function seal(key: Buffer, plaintext: Buffer): Buffer[] {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext];
}

function open(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer): Buffer | null {
    try {
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
        // Wrong key (another cabinet's config, a different password) or tampered value.
        return null;
    }
}

export function generateDataKey(): Buffer {
    return randomBytes(KEY_LENGTH);
}

export function wrapDataKey(password: string, dataKey: Buffer): string {
    const salt = randomBytes(SALT_LENGTH);
    const passwordKey = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
    return WRAPPED_KEY_PREFIX + encode([salt, ...seal(passwordKey, dataKey)]);
}

/**
 * The data key, or null when `password` is not the one it was wrapped with (or the value is not
 * a wrapped key this version understands).
 */
export function unwrapDataKey(password: string, wrapped: string): Buffer | null {
    const parts = decode(wrapped, WRAPPED_KEY_PREFIX, 4);
    if (!parts) {
        return null;
    }
    const [salt, iv, tag, ciphertext] = parts;
    const passwordKey = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
    const dataKey = open(passwordKey, iv, tag, ciphertext);
    return dataKey && dataKey.length === KEY_LENGTH ? dataKey : null;
}

export function isEncryptedSecret(value: string): boolean {
    return value.startsWith(SECRET_PREFIX);
}

export function encryptSecret(dataKey: Buffer, plaintext: string): string {
    return SECRET_PREFIX + encode(seal(dataKey, Buffer.from(plaintext, 'utf8')));
}

/**
 * The plaintext, or null when the value was not encrypted with `dataKey` or is malformed.
 */
export function decryptSecret(dataKey: Buffer, value: string): string | null {
    const parts = decode(value, SECRET_PREFIX, 3);
    if (!parts) {
        return null;
    }
    const [iv, tag, ciphertext] = parts;
    const plaintext = open(dataKey, iv, tag, ciphertext);
    return plaintext ? plaintext.toString('utf8') : null;
}
