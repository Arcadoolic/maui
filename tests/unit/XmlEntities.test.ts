import {describe, it, expect} from 'vitest';
import {decodeXmlEntities} from '@/class/XmlEntities';

describe('decodeXmlEntities', () => {
    it('decodes the entities mame leaves in its -lx texts', () => {
        expect(decodeXmlEntities('Track &amp; Field')).toBe('Track & Field');
        expect(decodeXmlEntities('&lt;unknown&gt; &quot;Bally&quot; &apos;Sente&apos;')).toBe('<unknown> "Bally" \'Sente\'');
    });

    it('leaves plain text untouched', () => {
        expect(decodeXmlEntities('Konami (Centuri license)')).toBe('Konami (Centuri license)');
        expect(decodeXmlEntities('')).toBe('');
    });

    it('decodes once only: an escaped entity stays an entity', () => {
        expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;');
    });
});
