const ENTITIES: {[entity: string]: string} = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': '\'',
};

/**
 * mame's `-lx` texts are read back with innerHTML (MameService.getGameInformation()), so they are
 * stored still XML-escaped ("Track &amp; Field"). Text bound with {{ }} is escaped again by Vue,
 * which would show the entity literally: decode the five predefined XML entities for display.
 * A single pass, so "&amp;lt;" gives "&lt;" and not "<".
 */
export function decodeXmlEntities(text: string): string {
    return text.replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ENTITIES[entity]);
}
