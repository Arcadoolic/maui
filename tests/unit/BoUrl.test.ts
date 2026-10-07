import {describe, it, expect} from 'vitest';
import {describeBoUrl} from '@/class/BoUrl';

describe('describeBoUrl', () => {
    it('is localhost and the BO port on a desktop, whatever its address', () => {
        expect(describeBoUrl({cabinet: false, lanAddress: '192.168.1.20', onCabinetPort: false, port: 3131}))
            .toBe('http://localhost:3131');
    });

    it('is the bare address of a cabinet that could open port 80', () => {
        expect(describeBoUrl({cabinet: true, lanAddress: '192.168.1.48', onCabinetPort: true, port: 3131}))
            .toBe('http://192.168.1.48');
    });

    it('keeps the BO port on a cabinet that could not', () => {
        expect(describeBoUrl({cabinet: true, lanAddress: '192.168.1.48', onCabinetPort: false, port: 3131}))
            .toBe('http://192.168.1.48:3131');
    });

    it('falls back on localhost while a cabinet has no network', () => {
        expect(describeBoUrl({cabinet: true, lanAddress: null, onCabinetPort: true, port: 3131}))
            .toBe('http://localhost:3131');
    });
});
