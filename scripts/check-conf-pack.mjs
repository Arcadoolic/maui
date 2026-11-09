#!/usr/bin/env node
/* global process, console, fetch, AbortSignal, URL */
// The configuration pack this version of MAUI expects (conf-pack-expected.json): the CRC32 of the
// hiscore.dat it ships, whose entries the mhiex extractors rely on. Run by build.yml and
// release.yml before anything is built: a release does not go out while the repository serves an
// older pack (the cabinets then install it by themselves at startup, ConfPackUpdate.ts).
//
//   node scripts/check-conf-pack.mjs                 compares with the published pack
//                                                    (MAUI_REPO_URL, MAUI_REPO_KEY, MAUI_REPO_TOKEN: a
//                                                    maui-api service account, as maui-repository's)
//   node scripts/check-conf-pack.mjs --pin <file>    pins <file> (maui-repository's conf-pack/hiscore.dat)
import {appendFileSync, readFileSync, writeFileSync} from 'node:fs';
import {crc32} from 'node:zlib';

const expectedPath = new URL('../conf-pack-expected.json', import.meta.url);
const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));

function summary(text) {
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
    }
}

const pin = process.argv.indexOf('--pin');
if (pin !== -1) {
    const file = process.argv[pin + 1];
    if (!file) {
        console.error('Usage: node scripts/check-conf-pack.mjs --pin <hiscore.dat>');
        process.exit(2);
    }
    expected.hiscoreDatCrc32 = crc32(readFileSync(file));
    writeFileSync(expectedPath, `${JSON.stringify(expected, null, 4)}\n`);
    console.log(`Pinned hiscore.dat CRC32 ${expected.hiscoreDatCrc32} (${file}): update "source" too.`);
    process.exit(0);
}

const {MAUI_REPO_URL: url, MAUI_REPO_KEY: key, MAUI_REPO_TOKEN: token} = process.env;
if (!url || !key || !token) {
    summary('Configuration pack not checked: MAUI_REPO_URL, MAUI_REPO_KEY and MAUI_REPO_TOKEN are needed (repository secrets).');
    process.exit(1);
}
const manifestUrl = `${url.replace(/\/+$/, '')}/mame-conf-pack.manifest.json`;
let companion;
try {
    const response = await fetch(manifestUrl, {
        headers: {'X-Maui-Key': key, Authorization: `Bearer ${token}`},
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    companion = await response.json();
} catch (error) {
    summary(`Configuration pack not checked: ${manifestUrl} did not answer (${error instanceof Error ? error.message : error}).`);
    process.exit(1);
}
const published = Array.isArray(companion?.files) ? companion.files.find(file => file?.name === 'hiscore.dat') : undefined;
if (published?.crc32 === expected.hiscoreDatCrc32) {
    summary(`Configuration pack up to date: hiscore.dat CRC32 ${published.crc32}.`);
    process.exit(0);
}
summary([
    `Configuration pack out of date: the repository's hiscore.dat has CRC32 ${published?.crc32 ?? 'none'},`
        + ` this version of MAUI expects ${expected.hiscoreDatCrc32} (${expected.source}).`,
    'Rebuild mame-conf-pack.zip and publish it (maui-repository docs/STARTER-PACK-REPO.md 3.2 bis), then run this again.',
].join('\n'));
process.exit(1);
