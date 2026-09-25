import {describe, it, expect} from 'vitest';
import {parseGamepadIds} from '@/class/GamepadId';

describe('parseGamepadIds', () => {
    it('reads vendor/product/bus from an SDL GUID', () => {
        expect(parseGamepadIds('030000005e0400008e02000014010000')).toEqual({
            vendorId: '045e',
            productId: '028e',
            vendorName: 'Microsoft',
            bus: 'USB',
        });
    });

    it('ignores the CRC field and a trailing serial number', () => {
        expect(parseGamepadIds('0500b881c82d00000160000000000000-E4:17:D8:00:00:01')).toEqual({
            vendorId: '2dc8',
            productId: '6001',
            vendorName: '8BitDo',
            bus: 'Bluetooth',
        });
    });

    it('omits the vendor name and bus when unknown', () => {
        expect(parseGamepadIds('00000000341200007856000000000000')).toEqual({vendorId: '1234', productId: '5678'});
    });

    it('returns null for an SDL GUID holding the device name instead of IDs', () => {
        expect(parseGamepadIds('050000004e696e74656e646f20537769')).toBeNull();
    });

    it('reads vendor/product from a DirectInput product GUID', () => {
        expect(parseGamepadIds('product_{0006D209-0000-0000-0000-504944564944} instance_{A1B2C3D4-0000-11EE-8001-444553540000}'))
            .toEqual({vendorId: 'd209', productId: '0006', vendorName: 'Ultimarc'});
    });

    it('returns null for XInput ids', () => {
        expect(parseGamepadIds('XInput Player 1')).toBeNull();
    });
});
