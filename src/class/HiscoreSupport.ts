import {MameHiExtractor} from '@arcadoolic/mhiex';

// exist() is a lookup in mhiex's table of extractors: it reads no directory, so none is needed.
// Deliberately not HiscoreService, which drags in the models and Log and needs a mame path.
const extractors = new MameHiExtractor('');

/**
 * Whether mhiex can extract this rom's hiscores. Same test as the "hi" flag GameService stores
 * (HiscoreService.hasHiscore()): it says the rom is *supported*, not that a .hi file exists yet.
 * Matched on the exact rom name, so a clone without an extractor of its own is not covered.
 */
export function hasHiscoreExtraction(romName: string): boolean {
    return extractors.exist(romName);
}
