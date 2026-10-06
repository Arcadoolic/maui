import {describe, it, expect} from 'vitest';
import {
    SECRET_PREFIX, WRAPPED_KEY_PREFIX, decryptSecret, encryptSecret, generateDataKey, isEncryptedSecret,
    unwrapDataKey, wrapDataKey,
} from '@/class/SecretBox';

describe('data key wrapping', () => {
    it('unwraps with the password it was wrapped with', () => {
        const dataKey = generateDataKey();
        const wrapped = wrapDataKey('correct horse', dataKey);

        expect(wrapped.startsWith(WRAPPED_KEY_PREFIX)).toBe(true);
        expect(unwrapDataKey('correct horse', wrapped)?.equals(dataKey)).toBe(true);
    });

    it('returns null with another password', () => {
        const wrapped = wrapDataKey('correct horse', generateDataKey());

        expect(unwrapDataKey('battery staple', wrapped)).toBeNull();
    });

    it('returns null for a value in no known format', () => {
        expect(unwrapDataKey('x', '')).toBeNull();
        expect(unwrapDataKey('x', 'MAUIKEY2.a.b.c.d')).toBeNull();
        expect(unwrapDataKey('x', `${WRAPPED_KEY_PREFIX}a.b`)).toBeNull();
    });

    it('salts each wrapping', () => {
        const dataKey = generateDataKey();

        expect(wrapDataKey('same', dataKey)).not.toBe(wrapDataKey('same', dataKey));
    });
});

describe('secret encryption', () => {
    it('round-trips a value, prefixed', () => {
        const dataKey = generateDataKey();
        const encrypted = encryptSecret(dataKey, 'p@ss wörd');

        expect(encrypted.startsWith(SECRET_PREFIX)).toBe(true);
        expect(isEncryptedSecret(encrypted)).toBe(true);
        expect(encrypted).not.toContain('p@ss');
        expect(decryptSecret(dataKey, encrypted)).toBe('p@ss wörd');
    });

    it('returns null with another key or a tampered value', () => {
        const dataKey = generateDataKey();
        const encrypted = encryptSecret(dataKey, 'secret');
        const tampered = encrypted.slice(0, -2) + (encrypted.endsWith('AA') ? 'BB' : 'AA');

        expect(decryptSecret(generateDataKey(), encrypted)).toBeNull();
        expect(decryptSecret(dataKey, tampered)).toBeNull();
    });

    it('does not take a plaintext value for an encrypted one', () => {
        expect(isEncryptedSecret('hunter2')).toBe(false);
        expect(decryptSecret(generateDataKey(), 'hunter2')).toBeNull();
    });
});
