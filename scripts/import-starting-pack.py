#!/usr/bin/env python3
"""Import a MAUI starting pack ZIP (built by scripts/build-starting-pack.ts) directly on disk,
bypassing the BO's HTTP upload entirely.

Why this exists: src/boServer.ts's `/import` route uses `multer({storage: memoryStorage(),
limits: {fileSize: 500 * 1024 * 1024}})` - it buffers the *whole* upload in RAM before handing
it to AdmZip (which itself indexes the whole buffer again), and rejects anything over 500 MiB
outright. A multi-hundred-MB (or larger) starting pack can't go through that path at all, and
even a pack just under the cap would double-buffer its full size in memory on a Raspberry Pi
that's also running the Electron kiosk app. This script mirrors boServer.ts's
importStartingPack()/importMameDirectories() but reads the ZIP as a stream: `zipfile` only
loads the central directory (a few KB) into memory, and every rom/marquee/flyer/logo/config
file is copied one entry at a time via shutil.copyfileobj - memory use stays flat regardless of
the pack's total size. `zipfile` also handles ZIP64 archives (>4 GiB / >65535 entries) natively,
unlike the pinned 0.5.x AdmZip release boServer.ts is stuck on for an unrelated webpack-parsing
reason (see its import comment).

Stdlib only, no `pip install` needed - deliberately, to match this repo's Debian Lite-friendly
deployment story (see docs/RASPBERRY-PI-DEPLOY.md).

Usage (on the machine hosting the MAME home, e.g. the Pi, after scp'ing the pack over):
    python3 import-starting-pack.py /home/puckman/mega-starting-pack-20260916.zip
    python3 import-starting-pack.py --yes /home/puckman/mega-starting-pack-20260916.zip
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import zipfile
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Paths / ini parsing - duplicated from src/boServer.ts's own electron-free helpers rather than
# imported (this script never touches Node/Electron code at all), same convention this repo
# already uses for every electron-free entry point (see the comments at the top of boServer.ts).
# ---------------------------------------------------------------------------

def mame_home_path():
    """Same fixed ~/.mame directory MameService.class.ts/boServer.ts pin mame's ini/home to -
    separate from ~/.mame-awesome-ui (this app's own config/database)."""
    path = os.path.join(os.path.expanduser('~'), '.mame')
    os.makedirs(path, exist_ok=True)
    return path


def app_data_path():
    path = os.path.join(os.path.expanduser('~'), '.mame-awesome-ui')
    os.makedirs(path, exist_ok=True)
    return path


def config_path():
    return os.path.join(app_data_path(), 'mame-awesome-ui-config.json')


def database_path():
    return os.path.join(app_data_path(), 'mame-awesome-ui.sqlite')


def load_config():
    path = config_path()
    if not os.path.exists(path):
        return {}
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


INI_LINE_RE = re.compile(r'^([a-z_]+)\s+(.+)$')


def parse_mame_ini_file(text):
    """Same ini-line parsing as boServer.ts's parseMameIniFile()."""
    target = {}
    for raw_line in text.split('\n'):
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue
        match = INI_LINE_RE.match(line)
        if not match:
            continue
        key, value = match.group(1), match.group(2)
        if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
            value = value[1:-1]
        target[key] = value.split(';')
    return target


def resolve_directory_path(path, parent_path):
    """Same relative-path resolution as boServer.ts's resolveDirectoryPath(): expands $HOME/~
    (path only), then joins onto parent_path when not absolute, dropping a duplicated leading
    segment when parent_path's own last segment already names it."""
    home = os.path.expanduser('~')
    path = re.sub(r'\$HOME|~', home, path, count=1)
    if path.startswith('/'):
        return path
    parent_path = parent_path.replace('$HOME', home)
    parent_parts = parent_path.split(os.sep)
    path_parts = path.split(os.sep)
    if parent_parts and path_parts and parent_parts[-1] == path_parts[0]:
        path_parts = path_parts[1:]
        path = os.sep.join(path_parts)
    return os.path.join(parent_path, path)


def get_first_existing_directory(paths, parent_path, file=None):
    if not paths:
        return None
    for raw_path in paths:
        path = resolve_directory_path(raw_path, parent_path)
        if file:
            path = os.path.join(path, file)
        if os.path.exists(path):
            return path
    return None


def ensure_first_directory(paths, parent_path):
    """Same as boServer.ts's ensureFirstDirectory(): returns the first declared path that
    exists, or creates the first candidate when none do."""
    if not paths:
        return None
    existing = get_first_existing_directory(paths, parent_path)
    if existing:
        return existing
    target = resolve_directory_path(paths[0], parent_path)
    os.makedirs(target, exist_ok=True)
    return target


def get_mame_locations(ini_path):
    ui_ini_path = os.path.join(ini_path, 'ui.ini')
    ui_ini = parse_mame_ini_file(read_text(ui_ini_path)) if os.path.exists(ui_ini_path) else {}
    return {
        'ui_ini': ui_ini,
        'marquee_path': ensure_first_directory(ui_ini.get('marquees_directory'), ini_path),
        'flyer_path': ensure_first_directory(ui_ini.get('flyers_directory'), ini_path),
        'logo_path': ensure_first_directory(ui_ini.get('logos_directory'), ini_path),
        'category_dir': ensure_first_directory(ui_ini.get('categorypath'), ini_path),
    }


def ensure_favorites_path(ini_path):
    """Same as boServer.ts's ensureFavoritesPath(): resolves (creating if needed) where
    favorites.ini should be written, even on a brand new install with none yet."""
    ui_ini_path = os.path.join(ini_path, 'ui.ini')
    ui_ini = parse_mame_ini_file(read_text(ui_ini_path)) if os.path.exists(ui_ini_path) else {}
    ui_path = ui_ini.get('ui_path')
    existing = get_first_existing_directory(ui_path, ini_path, 'favorites.ini') if ui_path else None
    if existing:
        return existing
    directory = ensure_first_directory(ui_path, ini_path)
    if not directory:
        raise RuntimeError('ui_path introuvable dans ui.ini.')
    return os.path.join(directory, 'favorites.ini')


def get_show_config(mame_binary, ini_path):
    """Same as boServer.ts's `-showconfig` call in getMameInfo() - returns None when the binary
    is unconfigured/missing/fails, same "degrade gracefully" behavior as the BO."""
    if not mame_binary or not os.path.exists(mame_binary):
        return None
    try:
        result = subprocess.run(
            [mame_binary, '-showconfig', '-inipath', ini_path, '-homepath', ini_path],
            cwd=ini_path, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            check=True,
        )
        return parse_mame_ini_file(result.stdout.decode('utf-8', errors='replace'))
    except (OSError, subprocess.CalledProcessError):
        return None


def read_text(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def write_text(path, text):
    # newline='' - no universal-newline translation, matches Node's writeFileSync(path, text,
    # 'utf8') writing the decoded text back out byte-for-byte.
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


# ---------------------------------------------------------------------------
# ZIP handling - streamed, never loads a whole entry's sibling entries or the archive itself
# into memory beyond what `zipfile`'s central-directory index already needs.
# ---------------------------------------------------------------------------

# Same fixed table as boServer.ts's IMPORTABLE_MAME_DIRECTORIES: each zip top-level folder maps
# to the mame.ini/ui.ini key that currently resolves its real destination on this mame home.
IMPORTABLE_MAME_DIRECTORIES = [
    ('cfg', 'cfg_directory'),
    ('nvram', 'nvram_directory'),
    ('diff', 'diff_directory'),
    ('comments', 'comment_directory'),
    ('inp', 'input_directory'),
    ('sta', 'state_directory'),
    ('snap', 'snapshot_directory'),
    ('folders', 'categorypath'),
]


def zip_has_folder(zf, folder):
    prefix = folder + '/'
    return any(not name.endswith('/') and name.startswith(prefix) for name in zf.namelist())


def read_zip_text(zf, name):
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    with zf.open(info) as f:
        return f.read().decode('utf-8')


def extract_entry_to(zf, entry_name, dest_dir):
    """Streams one zip entry into dest_dir, flattening its path to just the basename and
    overwriting anything already there - same as AdmZip's extractEntryTo(entry, dir, false,
    true) in boServer.ts. Only ever holds one copy buffer (64 KiB, shutil's default) in memory,
    regardless of the entry's own size."""
    try:
        info = zf.getinfo(entry_name)
    except KeyError:
        return False
    dest_path = os.path.join(dest_dir, os.path.basename(entry_name))
    with zf.open(info) as src, open(dest_path, 'wb') as dst:
        shutil.copyfileobj(src, dst)
    return True


def extract_zip_folder(zf, folder, target_dir):
    """Copies every file entry under `{folder}/` into target_dir, preserving whatever
    subdirectories sit under it (e.g. snapshot_directory's per-game subfolders) - same as
    boServer.ts's extractZipFolder(), including its zip-slip guard: an entry whose relative path
    would resolve outside target_dir (via a `../` segment) is skipped rather than written."""
    prefix = folder + '/'
    resolved_target = os.path.realpath(target_dir)
    files_written = 0
    for info in zf.infolist():
        name = info.filename
        if name.endswith('/') or not name.startswith(prefix):
            continue
        relative = name[len(prefix):]
        destination = os.path.realpath(os.path.join(target_dir, relative))
        if destination != resolved_target and not destination.startswith(resolved_target + os.sep):
            continue
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        with zf.open(info) as src, open(destination, 'wb') as dst:
            shutil.copyfileobj(src, dst)
        files_written += 1
    return files_written


def resolve_directory_targets(zf, resolved_ini, ini_path, summary):
    """Resolves (and creates, via ensure_first_directory) the real destination for every
    IMPORTABLE_MAME_DIRECTORIES folder actually present in the ZIP - done once, up front, so
    both the disk-space preflight check and the later extraction pass share the same
    resolution/warnings instead of duplicating boServer.ts's importMameDirectories() logic
    twice."""
    targets = {}
    for zip_folder, ini_key in IMPORTABLE_MAME_DIRECTORIES:
        if not zip_has_folder(zf, zip_folder):
            continue
        target_dir = ensure_first_directory(resolved_ini.get(ini_key), ini_path) if resolved_ini else None
        if not target_dir:
            summary['warnings'].append(f'{zip_folder}/ : "{ini_key}" introuvable dans la configuration mame, ignoré.')
            continue
        targets[zip_folder] = target_dir
    return targets


def import_mame_directories(zf, directory_targets, summary, log):
    for zip_folder, target_dir in directory_targets.items():
        files_written = extract_zip_folder(zf, zip_folder, target_dir)
        summary['directoriesImported'].append({'zipFolder': zip_folder, 'filesWritten': files_written})
        log(f'{zip_folder}/ : {files_written} fichier(s) copié(s) vers {target_dir}.')


# ---------------------------------------------------------------------------
# Disk-space preflight - a pack this size silently filling up a Pi's SD card halfway through
# extraction (partially-imported roms, a truncated favorites.ini) is worse than refusing up
# front, so total each destination's requirement before writing anything.
# ---------------------------------------------------------------------------

def compute_required_space(zf):
    totals = {}
    for info in zf.infolist():
        if info.filename.endswith('/'):
            continue
        prefix = info.filename.split('/', 1)[0]
        totals[prefix] = totals.get(prefix, 0) + info.file_size
    return totals


def check_disk_space(zf, targets):
    """targets: {zip top-level prefix -> resolved destination directory}. Aborts with a clear
    error listing every undersized destination, before any file is written."""
    required = compute_required_space(zf)
    by_dir = {}
    for prefix, size in required.items():
        target_dir = targets.get(prefix)
        if not target_dir:
            continue
        by_dir[target_dir] = by_dir.get(target_dir, 0) + size

    problems = []
    for target_dir, needed in by_dir.items():
        try:
            free = shutil.disk_usage(target_dir).free
        except OSError:
            continue
        # +5% margin: many small files (individual roms/marquees/flyers) cost more in filesystem
        # block overhead than their raw uncompressed byte total suggests.
        if needed * 1.05 > free:
            problems.append(f'{target_dir} : besoin d\'environ {human_size(needed)}, '
                             f'{human_size(free)} disponible(s).')
    if problems:
        fail('Espace disque insuffisant :\n  ' + '\n  '.join(problems))


# ---------------------------------------------------------------------------
# Database - plain sqlite3, no ORM: this script never imports sequelize-typescript (Node-only),
# so it writes to the exact same table schema Sequelize creates (verified against a live
# ~/.mame-awesome-ui/mame-awesome-ui.sqlite: `sqlite3 <db> ".schema game" ".schema category"`).
# CREATE TABLE IF NOT EXISTS mirrors Sequelize's sync() - never touches existing tables, only
# creates them on a genuinely fresh install (see importStartingPack()'s own comment in
# boServer.ts for why that matters: a starting pack can be the very first thing imported).
# ---------------------------------------------------------------------------

CATEGORY_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS `category` (
    `id_category` INTEGER PRIMARY KEY AUTOINCREMENT,
    `name` TEXT NOT NULL,
    `creationDate` DATETIME NOT NULL,
    `updatedOn` DATETIME NOT NULL,
    `deletionDate` DATETIME
)
"""

GAME_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS `game` (
    `id_game` INTEGER PRIMARY KEY AUTOINCREMENT,
    `id_category` INTEGER REFERENCES `category` (`id_category`) ON DELETE CASCADE ON UPDATE CASCADE,
    `romName` TEXT UNIQUE,
    `fullname` TEXT,
    `shortname` TEXT,
    `subname` TEXT,
    `manufacturer` TEXT,
    `year` TINYINT,
    `hi` TINYINT(1),
    `player_alt` TINYINT DEFAULT 0,
    `player_sim` TINYINT DEFAULT 0,
    `createdAt` DATETIME NOT NULL,
    `updatedAt` DATETIME NOT NULL,
    `deletedAt` DATETIME
)
"""


def now_timestamp():
    """Same DATETIME text format Sequelize writes for this sqlite dialect (verified against
    live rows: "2026-09-11 08:13:37.881 +00:00")."""
    now = datetime.now(timezone.utc)
    return now.strftime('%Y-%m-%d %H:%M:%S.') + f'{now.microsecond // 1000:03d} +00:00'


def find_or_create_category(conn, name, now):
    """Same lookup as boServer.ts's Category.findOrCreate({where: {name}}): only matches a
    non-soft-deleted row: a name that was previously soft-deleted gets a fresh row rather than
    being restored, matching Sequelize's paranoid default scope on findOrCreate."""
    row = conn.execute(
        'SELECT id_category FROM category WHERE name = ? AND deletionDate IS NULL LIMIT 1', (name,),
    ).fetchone()
    if row:
        return row[0], False
    cur = conn.execute(
        'INSERT INTO category (name, creationDate, updatedOn, deletionDate) VALUES (?, ?, ?, NULL)',
        (name, now, now),
    )
    return cur.lastrowid, True


def upsert_game(conn, rom_name, fields, now):
    """Same as boServer.ts's Game.findOne({paranoid: false}) + restore()/update(), or create():
    looks up by romName *including* soft-deleted rows (paranoid: false) since the unique
    constraint still occupies that romName, restores it (clears deletedAt) if found instead of
    colliding on create()."""
    row = conn.execute('SELECT id_game FROM game WHERE romName = ? LIMIT 1', (rom_name,)).fetchone()
    if row:
        conn.execute(
            """UPDATE game SET id_category=?, fullname=?, shortname=?, subname=?, manufacturer=?,
               year=?, hi=?, player_alt=?, player_sim=?, updatedAt=?, deletedAt=NULL
               WHERE id_game=?""",
            (fields['id_category'], fields['fullname'], fields['shortname'], fields['subname'],
             fields['manufacturer'], fields['year'], fields['hi'], fields['player_alt'],
             fields['player_sim'], now, row[0]),
        )
    else:
        conn.execute(
            """INSERT INTO game (id_category, romName, fullname, shortname, subname, manufacturer,
               year, hi, player_alt, player_sim, createdAt, updatedAt, deletedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)""",
            (fields['id_category'], rom_name, fields['fullname'], fields['shortname'],
             fields['subname'], fields['manufacturer'], fields['year'], fields['hi'],
             fields['player_alt'], fields['player_sim'], now, now),
        )


def js_like_parse_int(value):
    """Mirrors JS's `parseInt(value, 10)` used on manifest.games[].year in boServer.ts: reads a
    leading optionally-signed integer and ignores any trailing junk, returns None for null/no
    match instead of JS's NaN (never written to the DB either way - see importStartingPack())."""
    if value is None:
        return None
    match = re.match(r'\s*[-+]?\d+', value)
    return int(match.group(0)) if match else None


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

def default_summary():
    return {
        'gamesUpserted': 0, 'romFilesWritten': 0, 'biosFilesWritten': 0, 'marqueesWritten': 0,
        'flyersWritten': 0, 'logosWritten': 0, 'favoritesReplaced': False, 'genreIniReplaced': False,
        'nplayersIniReplaced': False, 'categoriesCreated': [], 'directoriesImported': [], 'warnings': [],
        'errors': [],
    }


def import_starting_pack(zf, manifest, rom_path, marquee_path, flyer_path, logo_path, category_dir,
                          ini_path, db_path, summary, log):
    # genre.ini/Multiplayer.ini first, before touching the database at all - same order as
    # boServer.ts's importStartingPack(): on a genuinely fresh install, the CREATE TABLE below is
    # what creates category/game in the first place, and a starting pack is meant to be
    # importable as the very first thing on such an install.
    genre_text = read_zip_text(zf, 'genre.ini')
    if genre_text is not None:
        write_text(os.path.join(category_dir, 'genre.ini'), genre_text)
        summary['genreIniReplaced'] = True
    else:
        summary['warnings'].append('genre.ini absent du ZIP (pack invalide ou obsolète) - catégories inchangées.')

    nplayers_text = read_zip_text(zf, 'Multiplayer.ini')
    if nplayers_text is not None:
        write_text(os.path.join(category_dir, 'Multiplayer.ini'), nplayers_text)
        summary['nplayersIniReplaced'] = True
    else:
        summary['warnings'].append(
            'Multiplayer.ini absent du ZIP (pack invalide ou obsolète) - nombre de joueurs inchangé.',
        )

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(CATEGORY_TABLE_SQL)
        conn.execute(GAME_TABLE_SQL)

        for bios_name in manifest.get('biosRoms', []):
            if extract_entry_to(zf, f'roms/{bios_name}.zip', rom_path):
                summary['biosFilesWritten'] += 1
            else:
                summary['warnings'].append(f'BIOS "{bios_name}" : absent du ZIP, ignoré.')

        category_ids = {}
        for game in manifest.get('games', []):
            rom_name = game['romName']
            try:
                category_id = None
                category_name = game.get('categoryName')
                if category_name:
                    if category_name not in category_ids:
                        cid, created = find_or_create_category(conn, category_name, now_timestamp())
                        category_ids[category_name] = cid
                        if created:
                            summary['categoriesCreated'].append(category_name)
                    category_id = category_ids[category_name]

                if game.get('hasRomFile'):
                    if extract_entry_to(zf, f'roms/{rom_name}.zip', rom_path):
                        summary['romFilesWritten'] += 1
                    else:
                        summary['warnings'].append(
                            f'{rom_name} : rom annoncée dans le manifest mais absente du ZIP.',
                        )

                if game.get('hasMarquee') and extract_entry_to(zf, f'marquees/{rom_name}.png', marquee_path):
                    summary['marqueesWritten'] += 1
                if game.get('hasFlyer') and extract_entry_to(zf, f'flyers/{rom_name}.png', flyer_path):
                    summary['flyersWritten'] += 1
                if game.get('hasLogo') and extract_entry_to(zf, f'logos/{rom_name}.png', logo_path):
                    summary['logosWritten'] += 1

                fields = {
                    'id_category': category_id,
                    'fullname': game.get('fullname'),
                    'shortname': game.get('shortname'),
                    'subname': game.get('subname'),
                    'manufacturer': game.get('manufacturer'),
                    'year': js_like_parse_int(game.get('year')),
                    'hi': 0,
                    'player_alt': game.get('player_alt', 0),
                    'player_sim': game.get('player_sim', 0),
                }
                upsert_game(conn, rom_name, fields, now_timestamp())
                summary['gamesUpserted'] += 1
                log(f"{rom_name} : {game.get('fullname')} importé.")
            except Exception as error:  # noqa: BLE001 - warn-and-continue, same policy as boServer.ts
                message = str(error) or 'erreur inattendue'
                summary['errors'].append(f'{rom_name} : {message}')
                log(f'{rom_name} : erreur ({message}).')

        conn.commit()
    finally:
        conn.close()

    favorites_text = read_zip_text(zf, 'favorites.ini')
    if favorites_text is not None:
        write_text(ensure_favorites_path(ini_path), favorites_text)
        summary['favoritesReplaced'] = True
    else:
        summary['warnings'].append('favorites.ini absent du ZIP, favoris inchangés.')


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def human_size(num_bytes):
    size = float(num_bytes)
    for unit in ('o', 'Kio', 'Mio', 'Gio'):
        if size < 1024:
            return f'{size:.1f} {unit}'
        size /= 1024
    return f'{size:.1f} Tio'


def fail(message):
    print(f'[import-starting-pack] {message}', file=sys.stderr)
    sys.exit(1)


def print_summary(summary):
    parts = [
        f"{summary['gamesUpserted']} jeu(x) importé(s)",
        f"{summary['romFilesWritten']} rom(s) écrite(s)",
        f"{summary['biosFilesWritten']} bios écrite(s)",
        f"{summary['marqueesWritten']} marquee(s)",
        f"{summary['flyersWritten']} flyer(s)",
        f"{summary['logosWritten']} logo(s)",
        'favoris remplacés' if summary['favoritesReplaced'] else 'favoris inchangés',
        'genre.ini remplacé' if summary['genreIniReplaced'] else 'genre.ini inchangé',
        'Multiplayer.ini remplacé' if summary['nplayersIniReplaced'] else 'Multiplayer.ini inchangé',
        f"{len(summary['errors'])} erreur(s)",
    ]
    print()
    print('[import-starting-pack] ' + ' — '.join(parts))
    if summary['categoriesCreated']:
        print(f"[import-starting-pack] Catégorie(s) créée(s) : {', '.join(summary['categoriesCreated'])}")
    if summary['directoriesImported']:
        dirs = ', '.join(f"{d['zipFolder']} ({d['filesWritten']})" for d in summary['directoriesImported'])
        print(f'[import-starting-pack] Dossier(s) importé(s) : {dirs}')
    for warning in summary['warnings']:
        print(f'[import-starting-pack] ATTENTION : {warning}')
    for error in summary['errors']:
        print(f'[import-starting-pack] ERREUR : {error}')


def main():
    # Line-buffer stdout even when redirected to a file/pipe (e.g. `python3 ... | tee log` over
    # ssh) - otherwise progress/summary lines only flush in one big block at exit, interleaved
    # out of order with stderr's own (already line-buffered) fail() messages.
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass

    parser = argparse.ArgumentParser(
        description="Importe un starting pack MAUI directement sur le disque, sans passer par "
                    "le formulaire du BO (limite Multer 500 Mio + double-buffering RAM complet - "
                    "invivable pour un gros pack sur Raspberry Pi).",
    )
    parser.add_argument('pack', help='Chemin du fichier ZIP du starting pack')
    parser.add_argument('-y', '--yes', action='store_true', help='Ne pas demander de confirmation avant import')
    args = parser.parse_args()

    if not os.path.isfile(args.pack):
        fail(f'Fichier introuvable : "{args.pack}".')

    print(f'[import-starting-pack] Pack : {args.pack} ({human_size(os.path.getsize(args.pack))})')

    config = load_config()
    mame_path, mame_binary_name = config.get('mamePath'), config.get('mameBinaryName')
    mame_binary = os.path.join(mame_path, mame_binary_name) if mame_path and mame_binary_name else None
    ini_path = mame_home_path()

    try:
        zf = zipfile.ZipFile(args.pack)
    except zipfile.BadZipFile as error:
        fail(f'ZIP invalide : {error}')
        return  # unreachable, keeps type-checkers happy

    with zf:
        manifest_text = read_zip_text(zf, 'manifest.json')
        manifest = None
        if manifest_text is not None:
            try:
                manifest = json.loads(manifest_text)
            except json.JSONDecodeError as error:
                fail(f'ZIP invalide : manifest.json illisible ({error}).')
            if manifest.get('formatVersion') != 1:
                fail(f"ZIP invalide : version de pack non supportée ({manifest.get('formatVersion')}).")
        else:
            folders = ', '.join(folder for folder, _ in IMPORTABLE_MAME_DIRECTORIES)
            if not any(zip_has_folder(zf, folder) for folder, _ in IMPORTABLE_MAME_DIRECTORIES):
                fail(f'ZIP invalide : manifest.json manquant, et aucun dossier reconnu ({folders}) dans le ZIP.')

        locations = get_mame_locations(ini_path)
        show_config = get_show_config(mame_binary, ini_path)
        resolved_ini = {**(show_config or {}), **locations['ui_ini']}
        rom_path = ensure_first_directory(show_config.get('rompath'), ini_path) if show_config else None

        if manifest is not None:
            missing = [
                label for label, value in [
                    ('chemin des roms (rompath - binaire mame configuré et valide ?)', rom_path),
                    ('marquees_directory (ui.ini)', locations['marquee_path']),
                    ('flyers_directory (ui.ini)', locations['flyer_path']),
                    ('logos_directory (ui.ini)', locations['logo_path']),
                    ('categorypath (ui.ini)', locations['category_dir']),
                ] if value is None
            ]
            if missing:
                fail('Configuration MAME incomplète, import impossible - manquant : ' + ', '.join(missing))

        summary = default_summary()
        directory_targets = resolve_directory_targets(zf, resolved_ini, ini_path, summary)

        space_targets = dict(directory_targets)
        if manifest is not None:
            space_targets.update({
                'roms': rom_path, 'marquees': locations['marquee_path'],
                'flyers': locations['flyer_path'], 'logos': locations['logo_path'],
            })
        check_disk_space(zf, space_targets)

        if manifest is not None:
            print(f"[import-starting-pack] {len(manifest.get('games', []))} jeu(x) dans le manifest "
                  f"(généré le {manifest.get('generatedAt', '?')}), {len(manifest.get('biosRoms', []))} bios.")
        if directory_targets:
            print(f"[import-starting-pack] Dossier(s) mame détecté(s) dans le ZIP : "
                  f"{', '.join(directory_targets.keys())}.")

        if not args.yes:
            answer = input(
                '[import-starting-pack] Ceci écrase les roms/favoris/médias déjà présents pour les '
                'jeux du pack. Continuer ? [o/N] ',
            )
            if answer.strip().lower() not in ('o', 'oui', 'y', 'yes'):
                print('[import-starting-pack] Annulé.')
                return

        def log(line):
            print(f'  {line}', flush=True)

        if manifest is not None:
            import_starting_pack(
                zf, manifest, rom_path, locations['marquee_path'], locations['flyer_path'],
                locations['logo_path'], locations['category_dir'], ini_path, database_path(), summary, log,
            )
        import_mame_directories(zf, directory_targets, summary, log)

    print_summary(summary)
    sys.exit(1 if summary['errors'] else 0)


if __name__ == '__main__':
    main()
