import {describe, it, expect} from 'vitest';
import {isSameOriginRequest} from '@/class/SameOrigin';

const host = '192.168.1.20:3000';

describe('isSameOriginRequest', () => {
    it('accepts an Origin matching the Host header', () => {
        expect(isSameOriginRequest({origin: 'http://192.168.1.20:3000', host})).toBe(true);
    });

    it('rejects an Origin from another site', () => {
        expect(isSameOriginRequest({origin: 'https://evil.example', host})).toBe(false);
    });

    it('rejects another port on the same machine', () => {
        expect(isSameOriginRequest({origin: 'http://192.168.1.20:8080', host})).toBe(false);
    });

    it('rejects the opaque null Origin', () => {
        expect(isSameOriginRequest({origin: 'null', host})).toBe(false);
    });

    it('rejects a malformed Origin', () => {
        expect(isSameOriginRequest({origin: 'not a url', host})).toBe(false);
    });

    it('decides on Origin alone when both headers are present', () => {
        expect(isSameOriginRequest({
            origin: 'https://evil.example',
            referer: 'http://192.168.1.20:3000/maui',
            host,
        })).toBe(false);
    });

    it('falls back to a same-host Referer when Origin is missing', () => {
        expect(isSameOriginRequest({referer: 'http://192.168.1.20:3000/maui#online', host})).toBe(true);
        expect(isSameOriginRequest({referer: 'https://evil.example/maui', host})).toBe(false);
    });

    it('rejects a request carrying neither header', () => {
        expect(isSameOriginRequest({host})).toBe(false);
    });

    it('rejects a request without a Host header', () => {
        expect(isSameOriginRequest({origin: 'http://192.168.1.20:3000'})).toBe(false);
    });

    it('compares hosts case-insensitively', () => {
        expect(isSameOriginRequest({origin: 'http://Cabinet.local:3000', host: 'cabinet.local:3000'})).toBe(true);
    });
});
