import {describe, it, expect} from 'vitest';
import {
    ConfigurationStringError,
    parseConfigurationString,
    toApiBaseUrl,
} from '@/class/ConfigurationString';

function encode(payload: unknown): string {
    return 'MAUI1.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
}

const valid = {url: 'https://api.example.org', key: 'mk_7F3aQ9dLx2PzK8wR4mT6vYb1', token: '12|secret+/token'};

function reasonOf(input: string): string | null {
    try {
        parseConfigurationString(input);
        return null;
    } catch (error) {
        return error instanceof ConfigurationStringError ? error.reason : 'other';
    }
}

describe('parseConfigurationString', () => {
    it('decodes url, key and token', () => {
        expect(parseConfigurationString(encode(valid))).toEqual(valid);
    });

    it('decodes the string produced by the MAUI-API reference implementation', () => {
        // Output of maui-api's ConfigurationString::encode('https://api.example.org', 'mk_abc', '1|t').
        const fromApi = 'MAUI1.eyJ1cmwiOiJodHRwczovL2FwaS5leGFtcGxlLm9yZyIsImtleSI6Im1rX2FiYyIsInRva2VuIjoiMXx0In0';
        expect(parseConfigurationString(fromApi)).toEqual({url: 'https://api.example.org', key: 'mk_abc', token: '1|t'});
    });

    it('accepts padded base64url and surrounding whitespace from a paste', () => {
        const payload = {url: 'https://a.org', key: 'mk_a', token: '1|ttt'};
        const padded = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
        expect(padded).toMatch(/=$/);
        expect(parseConfigurationString(`  MAUI1.${padded}\n`)).toEqual(payload);
    });

    it('ignores unknown fields', () => {
        expect(parseConfigurationString(encode({...valid, future: 'x'}))).toEqual(valid);
    });

    it('rejects another format version as unsupported', () => {
        expect(reasonOf('MAUI2.eyJ1cmwiOiJ4In0')).toBe('unsupported_version');
        expect(reasonOf('MAUI12.eyJ1cmwiOiJ4In0')).toBe('unsupported_version');
    });

    it('rejects anything that is not a MAUI configuration string', () => {
        expect(reasonOf('')).toBe('malformed');
        expect(reasonOf('hello')).toBe('malformed');
        expect(reasonOf('maui1.' + encode(valid).slice(6))).toBe('malformed');
    });

    it('rejects a payload that is not base64url JSON', () => {
        expect(reasonOf('MAUI1.')).toBe('malformed');
        expect(reasonOf('MAUI1.not*base64')).toBe('malformed');
        expect(reasonOf('MAUI1.' + Buffer.from('{oops').toString('base64url'))).toBe('malformed');
        expect(reasonOf(encode(['https://api.example.org']))).toBe('malformed');
        expect(reasonOf(encode(null))).toBe('malformed');
    });

    it('rejects a payload missing a field or with a non-string field', () => {
        expect(reasonOf(encode({url: valid.url, key: valid.key}))).toBe('incomplete');
        expect(reasonOf(encode({...valid, token: 12}))).toBe('incomplete');
        expect(reasonOf(encode({...valid, key: ''}))).toBe('incomplete');
    });

    it('rejects a url that is not http or https', () => {
        expect(reasonOf(encode({...valid, url: 'not a url'}))).toBe('invalid_url');
        expect(reasonOf(encode({...valid, url: 'file:///etc/passwd'}))).toBe('invalid_url');
        expect(reasonOf(encode({...valid, url: 'javascript:alert(1)'}))).toBe('invalid_url');
    });

    it('gives a message telling the owner to update MAUI for a newer version', () => {
        expect(() => parseConfigurationString('MAUI2.abc')).toThrow(/update MAUI/);
    });
});

describe('toApiBaseUrl', () => {
    it('appends /api/v1', () => {
        expect(toApiBaseUrl('https://api.example.org')).toBe('https://api.example.org/api/v1');
    });

    it('does not double the slash', () => {
        expect(toApiBaseUrl('http://localhost:8080/')).toBe('http://localhost:8080/api/v1');
    });

    it('keeps a path prefix', () => {
        expect(toApiBaseUrl('https://example.org/maui')).toBe('https://example.org/maui/api/v1');
    });
});
