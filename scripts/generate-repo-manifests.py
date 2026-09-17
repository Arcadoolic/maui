#!/usr/bin/env python3
"""Generate companion <pack>.manifest.json files and index.json for repo.maui.afronob.com.

For each *.zip in --zip-dir: extracts the internal manifest.json (formatVersion 1,
produced by scripts/build-starting-pack.ts) verbatim as a companion file, or writes a
fallback manifest when the zip has none (e.g. a hand-built "gros volumes" bulk zip).
Then rebuilds index.json next to the packs so the BO can fetch one small file to
populate its picker instead of downloading every zip.
"""
import argparse
import json
import sys
import zipfile
from pathlib import Path

INTERNAL_MANIFEST_NAME = 'manifest.json'
SUPPORTED_FORMAT_VERSION = 1


def manifest_path_for(zip_path: Path) -> Path:
    return zip_path.with_name(zip_path.stem + '.manifest.json')


def fallback_manifest(note: str, entries: list) -> bytes:
    return json.dumps(
        {'formatVersion': None, 'note': note, 'entries': entries},
        indent=2,
    ).encode('utf8')


def read_manifest_bytes(zip_path: Path) -> bytes:
    """Returns the bytes to write as the companion manifest for this zip."""
    try:
        with zipfile.ZipFile(zip_path) as zf:
            try:
                raw = zf.read(INTERNAL_MANIFEST_NAME)
            except KeyError:
                return fallback_manifest('no internal manifest.json found', zf.namelist())

            try:
                manifest = json.loads(raw)
            except json.JSONDecodeError as exc:
                return fallback_manifest(f'internal manifest.json is not valid JSON: {exc}', zf.namelist())

            if manifest.get('formatVersion') != SUPPORTED_FORMAT_VERSION:
                return fallback_manifest(
                    f"unrecognized formatVersion {manifest.get('formatVersion')!r}",
                    zf.namelist(),
                )

            return raw
    except zipfile.BadZipFile as exc:
        return fallback_manifest(f'not a valid zip file: {exc}', [])


def process_zip(zip_path: Path) -> None:
    manifest_path = manifest_path_for(zip_path)
    if manifest_path.exists():
        print(f'[generate-repo-manifests] skip {zip_path.name} (manifest already exists)')
        return

    manifest_path.write_bytes(read_manifest_bytes(zip_path))
    print(f'[generate-repo-manifests] wrote {manifest_path.name}')


def build_index(zip_dir: Path) -> None:
    packs = []
    for zip_path in sorted(zip_dir.glob('*.zip')):
        stat = zip_path.stat()
        entry = {
            'filename': zip_path.name,
            'size': stat.st_size,
            'mtime': int(stat.st_mtime),
        }

        manifest_path = manifest_path_for(zip_path)
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding='utf8'))
            except json.JSONDecodeError:
                manifest = {}
            if manifest.get('generatedAt') is not None:
                entry['generatedAt'] = manifest['generatedAt']
            if isinstance(manifest.get('games'), list):
                entry['gameCount'] = len(manifest['games'])

        packs.append(entry)

    index_path = zip_dir / 'index.json'
    index_path.write_text(json.dumps({'packs': packs}, indent=2), encoding='utf8')
    print(f'[generate-repo-manifests] wrote {index_path.name} ({len(packs)} pack(s))')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--zip-dir',
        type=Path,
        default=Path('/data/production/repo-maui/zip'),
        help='Directory containing the pack zips (default: %(default)s)',
    )
    args = parser.parse_args()

    zip_dir: Path = args.zip_dir
    if not zip_dir.is_dir():
        print(f'error: {zip_dir} is not a directory', file=sys.stderr)
        return 1

    for zip_path in sorted(zip_dir.glob('*.zip')):
        process_zip(zip_path)

    build_index(zip_dir)
    return 0


if __name__ == '__main__':
    sys.exit(main())
