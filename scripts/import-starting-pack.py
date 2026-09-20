#!/usr/bin/env python3
"""Import a MAUI starting pack ZIP (built by scripts/build-starting-pack.ts).

The single implementation for starting-pack import: both of src/boServer.ts's BO routes
(`/import`, a manual upload, and `/import/from-url`, browsing repo.maui.afronob.com) spawn this
script rather than importing in-process, and it can also be run standalone (e.g. over SSH,
directly on the machine hosting the MAME home) with no BO involved at all. Reads the ZIP as a
stream: `zipfile` only loads the central directory (a few KB) into memory, and every
rom/marquee/flyer/logo/config file is copied one entry at a time via shutil.copyfileobj - memory
use stays flat regardless of the pack's total size, and `zipfile` handles ZIP64 archives (>4 GiB
/ >65535 entries) natively, unlike the pinned 0.5.x AdmZip release boServer.ts is stuck on for an
unrelated webpack-parsing reason (see its import comment) and still uses for its own unrelated
MAUI config/database export feature.

Stdlib only, no `pip install` needed - deliberately, to match this repo's Debian Lite-friendly
deployment story (see docs/RASPBERRY-PI-DEPLOY.md).

Usage (on the machine hosting the MAME home, e.g. the Pi, after scp'ing the pack over):
    python3 import-starting-pack.py /home/puckman/mega-starting-pack-20260916.zip
    python3 import-starting-pack.py --yes /home/puckman/mega-starting-pack-20260916.zip

Or straight from repo.maui.afronob.com (see docs/STARTER-PACK-REPO.md), no local file needed:
    MAUI_REPO_USER=admin MAUI_REPO_PASSWORD=... \\
        python3 import-starting-pack.py --url https://repo.maui.afronob.com/some-pack.zip -y

With --only, just some games of a pack: only those games' roms/artwork (and the BIOS they need)
are read, and only they are added to the database and favorites. Combined with --url the pack is
never downloaded whole: its central directory and the needed entries are fetched with HTTP Range
requests (the repository must support them - nginx does).
        python3 import-starting-pack.py --url https://repo.maui.afronob.com/some-pack.zip \\
            --only sf2,ffight -y
"""

import argparse
import base64
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
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
    # repl as a function, not a string: re.sub interprets backslashes in a string replacement
    # (\1, \g<...>, \a, \U, ...), and a Windows home path like C:\Users\... contains \U, which
    # isn't a valid escape and raises "bad escape \U". A function's return value is inserted
    # literally, sidestepping that.
    path = re.sub(r'\$HOME|~', lambda _match: home, path, count=1)
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
    """Unlike get_mame_locations()'s own favorites_path, which stays None on purpose when
    favorites.ini doesn't exist yet (mame itself is meant to be the only writer), this resolves
    (creating the target ui_path directory if needed) where favorites.ini should be written - for
    importing a starting pack onto a brand new install that has no favorites.ini at all yet."""
    ui_ini_path = os.path.join(ini_path, 'ui.ini')
    ui_ini = parse_mame_ini_file(read_text(ui_ini_path)) if os.path.exists(ui_ini_path) else {}
    ui_path = ui_ini.get('ui_path')
    existing = get_first_existing_directory(ui_path, ini_path, 'favorites.ini') if ui_path else None
    if existing:
        return existing
    directory = ensure_first_directory(ui_path, ini_path)
    if not directory:
        raise RuntimeError('ui_path not found in ui.ini.')
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
    subdirectories sit under it (e.g. snapshot_directory's per-game subfolders). Guards against
    zip-slip: an entry whose relative path would resolve outside target_dir (via a `../` segment)
    is skipped rather than written."""
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
    both the disk-space preflight check and the later extraction pass (import_mame_directories())
    share the same resolution/warnings instead of duplicating it twice."""
    targets = {}
    for zip_folder, ini_key in IMPORTABLE_MAME_DIRECTORIES:
        if not zip_has_folder(zf, zip_folder):
            continue
        target_dir = ensure_first_directory(resolved_ini.get(ini_key), ini_path) if resolved_ini else None
        if not target_dir:
            summary['warnings'].append(f'{zip_folder}/: "{ini_key}" not found in the mame configuration, skipped.')
            continue
        targets[zip_folder] = target_dir
    return targets


def import_mame_directories(zf, directory_targets, summary, log):
    for zip_folder, target_dir in directory_targets.items():
        files_written = extract_zip_folder(zf, zip_folder, target_dir)
        summary['directoriesImported'].append({'zipFolder': zip_folder, 'filesWritten': files_written})
        log(f'{zip_folder}/: {files_written} file(s) copied to {target_dir}.')


# ---------------------------------------------------------------------------
# --only : import just some games of a pack
# ---------------------------------------------------------------------------

# Zip folders holding one file per game: what --only narrows down.
PER_GAME_FOLDERS = ('roms', 'marquees', 'flyers', 'logos')


def select_games(manifest, only, summary):
    """Copy of `manifest` restricted to the games named in `only` (romNames), keeping the pack's
    order: the import below then needs no idea of --only at all - games, favorites and database
    rows all come from this manifest. Only the BIOS/parent sets those games need (`biosName`)
    stay in biosRoms. Names the pack does not contain are reported as warnings, not errors: the
    BO builds the list from the manifest, so it can only differ if the pack changed meanwhile."""
    wanted = set(only)
    games = [game for game in manifest.get('games', []) if game['romName'] in wanted]
    for rom_name in sorted(wanted - {game['romName'] for game in games}):
        summary['warnings'].append(f'{rom_name}: not in this pack, skipped.')
    needed_bios = {game['biosName'] for game in games if game.get('biosName')}
    return {
        **manifest,
        'games': games,
        'biosRoms': [name for name in manifest.get('biosRoms', []) if name in needed_bios],
    }


def wanted_entries(manifest):
    """Names of the per-game zip entries the (already restricted) manifest asks for."""
    entries = set()
    for game in manifest.get('games', []):
        rom_name = game['romName']
        if game.get('hasRomFile'):
            entries.add(f'roms/{rom_name}.zip')
        if game.get('hasMarquee'):
            entries.add(f'marquees/{rom_name}.png')
        if game.get('hasFlyer'):
            entries.add(f'flyers/{rom_name}.png')
        if game.get('hasLogo'):
            entries.add(f'logos/{rom_name}.png')
    entries.update(f'roms/{name}.zip' for name in manifest.get('biosRoms', []))
    return entries


# ---------------------------------------------------------------------------
# Disk-space preflight - a pack this size silently filling up a Pi's SD card halfway through
# extraction (partially-imported roms, a truncated favorites.ini) is worse than refusing up
# front, so total each destination's requirement before writing anything.
# ---------------------------------------------------------------------------

def compute_required_space(zf, entry_filter=None):
    """entry_filter: with --only, the set of per-game entries (roms/, marquees/, flyers/, logos/)
    that will actually be extracted - the others are left out of the total. Any other folder
    (folders/, mame config directories...) is always extracted whole and always counted."""
    totals = {}
    for info in zf.infolist():
        if info.filename.endswith('/'):
            continue
        prefix = info.filename.split('/', 1)[0]
        if entry_filter is not None and prefix in PER_GAME_FOLDERS and info.filename not in entry_filter:
            continue
        totals[prefix] = totals.get(prefix, 0) + info.file_size
    return totals


def check_disk_space(zf, targets, entry_filter=None):
    """targets: {zip top-level prefix -> resolved destination directory}. Aborts with a clear
    error listing every undersized destination, before any file is written."""
    required = compute_required_space(zf, entry_filter)
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
            problems.append(f'{target_dir}: about {human_size(needed)} needed, '
                             f'{human_size(free)} available.')
    if problems:
        fail('Not enough disk space:\n  ' + '\n  '.join(problems))


# ---------------------------------------------------------------------------
# Database - plain sqlite3, no ORM: this script never imports sequelize-typescript (Node-only),
# so it writes to the exact same table schema Sequelize creates (verified against a live
# ~/.mame-awesome-ui/mame-awesome-ui.sqlite: `sqlite3 <db> ".schema game" ".schema category"`).
# CREATE TABLE IF NOT EXISTS mirrors Sequelize's sync() - never touches existing tables, only
# creates them on a genuinely fresh install: a starting pack is meant to be importable as the
# very first thing on a machine that's never launched the Electron app (no sqlite file yet).
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
    """Only matches a non-soft-deleted row: a name that was previously soft-deleted gets a fresh
    row rather than being restored, matching Category.model.ts's paranoid default scope on
    Sequelize's own findOrCreate()."""
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
    """Looks up by romName *including* soft-deleted rows (Game.model.ts's paranoid:true means a
    plain lookup hides them) since the unique constraint still occupies that romName, restores it
    (clears deletedAt) if found instead of colliding on a plain insert."""
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
        'flyersWritten': 0, 'logosWritten': 0, 'favoritesAdded': 0,
        'categoriesCreated': [], 'directoriesImported': [], 'warnings': [],
        'errors': [],
    }


FAVORITES_HEADER = '[ROOT_FOLDER]\n[Favorite]\n\n'
FAVORITE_ROM_NAME_RE = re.compile(r'^(?![0-9]$)[a-z0-9]+$')


def favorite_entry(rom_name, fullname):
    """One machine entry in mame's favorites.ini layout: 16 lines, the rom name on lines 1 and 8,
    its description on line 2, and fixed filler/flags around them (playtime 0, then two "1"s).
    mame ships no command line option to add a favorite - the file is only ever written by its
    own in-game menu - so the layout is reproduced here from what mame itself writes."""
    return '\n'.join([
        rom_name, fullname, '', '', '', '0', '', rom_name, '', '', '', '1', '', '', '', '1',
    ]) + '\n'


def add_games_to_favorites(favorites_path, games, summary):
    """Appends every manifest game not already listed to mame's own favorites.ini, keeping
    whatever is there (unlike the old behavior of replacing the whole file with the pack's copy).
    Rom names are matched line by line, same rule as MameIniParser.parseFavorites(). MAUI then
    picks the new favorites up from that file, so no separate DB write is needed for them here.
    A mame instance still running rewrites favorites.ini from its own memory when it exits and
    would drop these entries."""
    if os.path.exists(favorites_path):
        text = read_text(favorites_path)
    else:
        text = '\ufeff' + FAVORITES_HEADER
    newline = '\r\n' if '\r\n' in text else '\n'
    known = {line.strip() for line in text.splitlines() if FAVORITE_ROM_NAME_RE.match(line.strip())}

    added = ''
    for game in games:
        rom_name = game['romName']
        if rom_name in known:
            continue
        known.add(rom_name)
        added += favorite_entry(rom_name, game.get('fullname') or rom_name)
        summary['favoritesAdded'] += 1

    if not added:
        return
    if not text.endswith('\n'):
        text += newline
    write_text(favorites_path, text + added.replace('\n', newline))


def import_starting_pack(zf, manifest, rom_path, marquee_path, flyer_path, logo_path,
                          ini_path, db_path, summary, log):
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(CATEGORY_TABLE_SQL)
        conn.execute(GAME_TABLE_SQL)

        for bios_name in manifest.get('biosRoms', []):
            if extract_entry_to(zf, f'roms/{bios_name}.zip', rom_path):
                summary['biosFilesWritten'] += 1
            else:
                summary['warnings'].append(f'BIOS "{bios_name}": missing from the ZIP, skipped.')

        category_ids = {}
        games = manifest.get('games', [])
        emit_progress('import', 0, len(games))
        for index, game in enumerate(games, start=1):
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
                            f'{rom_name}: rom listed in the manifest but missing from the ZIP.',
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
                log(f"{rom_name}: {game.get('fullname')} imported.")
            except Exception as error:  # noqa: BLE001 - one rom failing shouldn't abort the whole import
                message = str(error) or 'unexpected error'
                summary['errors'].append(f'{rom_name}: {message}')
                log(f'{rom_name}: error ({message}).')
            emit_progress('import', index, len(games))

        conn.commit()
    finally:
        conn.close()

    add_games_to_favorites(ensure_favorites_path(ini_path), manifest.get('games', []), summary)


# ---------------------------------------------------------------------------
# --url : download the pack from repo.maui.afronob.com before importing it, so this script can
# run unattended on a cabinet's BO instead of requiring an scp'd file already on disk.
# ---------------------------------------------------------------------------

class HttpRangeFile(io.RawIOBase):
    """Read-only, seekable view of a remote file, backed by HTTP Range requests: what
    zipfile.ZipFile needs to open a pack's central directory and pull individual entries out of
    it without downloading the whole ZIP. One window is cached (WINDOW bytes, more for a bigger
    read), so a sequential extraction costs one request per window and not one per 64 KiB copy
    buffer; a failed request is retried a few times before giving up."""

    WINDOW = 4 * 1024 * 1024
    RETRIES = 3

    def __init__(self, url, user='', password=''):
        super().__init__()
        self.url = url
        self.headers = {}
        if user or password:
            credentials = base64.b64encode(f'{user}:{password}'.encode('utf-8')).decode('ascii')
            self.headers['Authorization'] = f'Basic {credentials}'
        self.position = 0
        self.window_start = 0
        self.window = b''
        # A 1-byte range answers with the total size in Content-Range - and proves the server
        # honours ranges at all, without which reading a ZIP this way would silently fetch it whole.
        with self._request('bytes=0-0') as response:
            content_range = response.headers.get('Content-Range', '')
            if response.status != 206 or '/' not in content_range:
                raise RuntimeError('the repository does not support HTTP Range requests.')
            self.size = int(content_range.rsplit('/', 1)[1])

    def _request(self, byte_range):
        request = urllib.request.Request(self.url, headers={**self.headers, 'Range': byte_range})
        last_error = None
        for _ in range(self.RETRIES):
            try:
                return urllib.request.urlopen(request, timeout=60)
            except urllib.error.HTTPError:
                raise
            except (urllib.error.URLError, OSError) as error:
                last_error = error
        raise last_error

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            self.position = offset
        elif whence == io.SEEK_CUR:
            self.position += offset
        else:
            self.position = self.size + offset
        self.position = max(0, self.position)
        return self.position

    def _fill(self, wanted):
        start = self.position
        end = min(self.size, start + max(wanted, self.WINDOW)) - 1
        with self._request(f'bytes={start}-{end}') as response:
            self.window = response.read()
        self.window_start = start

    def read(self, size=-1):
        if self.position >= self.size:
            return b''
        if size is None or size < 0:
            size = self.size - self.position
        size = min(size, self.size - self.position)
        chunks = []
        while size > 0:
            offset = self.position - self.window_start
            if not (0 <= offset < len(self.window)):
                self._fill(size)
                offset = 0
            chunk = self.window[offset:offset + size]
            chunks.append(chunk)
            self.position += len(chunk)
            size -= len(chunk)
        return b''.join(chunks)

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)


def emit_progress(phase, done, total):
    """Machine-readable progress line, only when the BO asks for it (MAUI_PROGRESS=1): it parses
    these into a progress bar instead of listing them. Kept off by default so a terminal run
    stays readable. total 0 = unknown (indeterminate bar)."""
    if os.environ.get('MAUI_PROGRESS') == '1':
        print(f'@@PROGRESS {phase} {done} {total}', flush=True)


def download_to_tempfile(url, user, password):
    """Downloads `url` into a temp .zip file and returns its path. zipfile.ZipFile needs a
    seekable file (it reads the central directory from the end), so true streaming extraction
    straight from an HTTP response isn't possible with the stdlib - download-to-temp-then-open is
    required. Preflights free disk space against Content-Length when the server reports one
    (same 5%-margin convention as check_disk_space()); otherwise lets copyfileobj surface ENOSPC
    cleanly instead of guessing."""
    request = urllib.request.Request(url)
    if user or password:
        credentials = base64.b64encode(f'{user}:{password}'.encode('utf-8')).decode('ascii')
        request.add_header('Authorization', f'Basic {credentials}')

    fd, temp_path = tempfile.mkstemp(suffix='.zip')
    try:
        with os.fdopen(fd, 'wb') as dst, urllib.request.urlopen(request) as response:
            content_length = response.headers.get('Content-Length')
            if content_length:
                needed = int(content_length) * 1.05
                free = shutil.disk_usage(os.path.dirname(temp_path)).free
                if needed > free:
                    raise RuntimeError(
                        f'about {human_size(int(content_length))} needed for the download, '
                        f'{human_size(free)} available.',
                    )
            total = int(content_length) if content_length else 0
            downloaded = 0
            last_emit = 0.0
            emit_progress('download', 0, total)
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                dst.write(chunk)
                downloaded += len(chunk)
                now = time.monotonic()
                if now - last_emit >= 0.25:
                    last_emit = now
                    emit_progress('download', downloaded, total)
            emit_progress('download', downloaded, downloaded)
    except BaseException:
        os.unlink(temp_path)
        raise
    return temp_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def human_size(num_bytes):
    size = float(num_bytes)
    for unit in ('B', 'KiB', 'MiB', 'GiB'):
        if size < 1024:
            return f'{size:.1f} {unit}'
        size /= 1024
    return f'{size:.1f} TiB'


def fail(message):
    print(f'[import-starting-pack] {message}', file=sys.stderr)
    sys.exit(1)


def print_summary(summary):
    parts = [
        f"{summary['gamesUpserted']} game(s) imported",
        f"{summary['romFilesWritten']} rom(s) written",
        f"{summary['biosFilesWritten']} bios written",
        f"{summary['marqueesWritten']} marquee(s)",
        f"{summary['flyersWritten']} flyer(s)",
        f"{summary['logosWritten']} logo(s)",
        f"{summary['favoritesAdded']} favorite(s) added",
        f"{len(summary['errors'])} error(s)",
    ]
    print()
    print('[import-starting-pack] ' + ' — '.join(parts))
    if summary['categoriesCreated']:
        print(f"[import-starting-pack] Categories created: {', '.join(summary['categoriesCreated'])}")
    if summary['directoriesImported']:
        dirs = ', '.join(f"{d['zipFolder']} ({d['filesWritten']})" for d in summary['directoriesImported'])
        print(f'[import-starting-pack] Folder(s) imported: {dirs}')
    for warning in summary['warnings']:
        print(f'[import-starting-pack] WARNING: {warning}')
    for error in summary['errors']:
        print(f'[import-starting-pack] ERROR: {error}')


def main():
    # Line-buffer stdout even when redirected to a file/pipe (e.g. `python3 ... | tee log` over
    # ssh) - otherwise progress/summary lines only flush in one big block at exit, interleaved
    # out of order with stderr's own (already line-buffered) fail() messages.
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass

    parser = argparse.ArgumentParser(
        description="Imports a MAUI starting pack directly onto the disk, bypassing "
                    "the BO form (Multer 500 MiB limit + full RAM double-buffering - "
                    "unusable for a big pack on a Raspberry Pi).",
    )
    parser.add_argument('pack', nargs='?', help='Path of the starting pack ZIP file (local)')
    parser.add_argument('--url', help='HTTP(S) URL of the pack to download before importing (repo.maui.afronob.com)')
    parser.add_argument(
        '--user', help='Basic-auth username for --url - manual testing only, visible in '
                        '`ps`/the shell history; prefer the MAUI_REPO_USER variable',
    )
    parser.add_argument(
        '--password', help='Basic-auth password for --url - manual testing only, visible '
                            'in `ps`/the shell history; prefer the MAUI_REPO_PASSWORD variable',
    )
    parser.add_argument(
        '--only', help='Comma-separated romNames: import only these games of the pack (their roms, '
                        'artwork and required BIOS). With --url the pack is then read with HTTP Range '
                        'requests instead of being downloaded whole',
    )
    parser.add_argument('-y', '--yes', action='store_true', help='Do not ask for confirmation before importing')
    args = parser.parse_args()

    if bool(args.pack) == bool(args.url):
        fail('Provide either a local pack path or --url - never both, and not neither.')

    only = None
    if args.only is not None:
        only = [name.strip() for name in args.only.split(',') if name.strip()]
        if not only:
            fail('--only needs at least one romName.')
        bad = [name for name in only if not re.fullmatch(r'[\w.-]+', name)]
        if bad:
            fail(f'--only: invalid romName(s): {", ".join(bad)}.')

    if args.url and only:
        # Never downloaded whole: zipfile reads the central directory and each wanted entry
        # through HTTP Range requests (see HttpRangeFile).
        user = args.user or os.environ.get('MAUI_REPO_USER', '')
        password = args.password or os.environ.get('MAUI_REPO_PASSWORD', '')
        print(f'[import-starting-pack] Reading: {args.url} ({len(only)} game(s) wanted)')
        try:
            remote = HttpRangeFile(args.url, user, password)
        except (urllib.error.URLError, OSError, RuntimeError) as error:
            fail(f'Cannot read the pack: {error}')
            return
        try:
            _run_import(remote, args.yes, only, args.url)
        finally:
            remote.close()
        return

    temp_path = None
    if args.url:
        user = args.user or os.environ.get('MAUI_REPO_USER', '')
        password = args.password or os.environ.get('MAUI_REPO_PASSWORD', '')
        print(f'[import-starting-pack] Downloading: {args.url}')
        try:
            temp_path = download_to_tempfile(args.url, user, password)
        except (urllib.error.URLError, OSError, RuntimeError) as error:
            fail(f'Download failed: {error}')
    pack_path = temp_path if args.url else args.pack

    try:
        _run_import(pack_path, args.yes, only)
    finally:
        if temp_path is not None:
            os.unlink(temp_path)


def _run_import(pack_source, skip_confirmation, only=None, pack_label=None):
    """pack_source: a path, or an already-open file-like object (HttpRangeFile) - zipfile takes
    either. only: romNames to restrict the import to (see select_games())."""
    if isinstance(pack_source, str):
        if not os.path.isfile(pack_source):
            fail(f'File not found: "{pack_source}".')
        print(f'[import-starting-pack] Pack: {pack_source} ({human_size(os.path.getsize(pack_source))})')
    else:
        print(f'[import-starting-pack] Pack: {pack_label} ({human_size(pack_source.size)}, read partially)')

    config = load_config()
    mame_path, mame_binary_name = config.get('mamePath'), config.get('mameBinaryName')
    mame_binary = os.path.join(mame_path, mame_binary_name) if mame_path and mame_binary_name else None
    ini_path = mame_home_path()

    try:
        zf = zipfile.ZipFile(pack_source)
    except zipfile.BadZipFile as error:
        fail(f'Invalid ZIP: {error}')
        return  # unreachable, keeps type-checkers happy

    with zf:
        manifest_text = read_zip_text(zf, 'manifest.json')
        manifest = None
        if manifest_text is not None:
            try:
                manifest = json.loads(manifest_text)
            except json.JSONDecodeError as error:
                fail(f'Invalid ZIP: unreadable manifest.json ({error}).')
            if manifest.get('formatVersion') != 1:
                fail(f"Invalid ZIP: unsupported pack version ({manifest.get('formatVersion')}).")
        else:
            if only:
                fail('--only needs a pack with a manifest.json.')
            folders = ', '.join(folder for folder, _ in IMPORTABLE_MAME_DIRECTORIES)
            if not any(zip_has_folder(zf, folder) for folder, _ in IMPORTABLE_MAME_DIRECTORIES):
                fail(f'Invalid ZIP: manifest.json missing, and no recognized folder ({folders}) in the ZIP.')

        locations = get_mame_locations(ini_path)
        show_config = get_show_config(mame_binary, ini_path)
        resolved_ini = {**(show_config or {}), **locations['ui_ini']}
        rom_path = ensure_first_directory(show_config.get('rompath'), ini_path) if show_config else None

        if manifest is not None:
            missing = [
                label for label, value in [
                    ('roms path (rompath - mame binary configured and valid?)', rom_path),
                    ('marquees_directory (ui.ini)', locations['marquee_path']),
                    ('flyers_directory (ui.ini)', locations['flyer_path']),
                    ('logos_directory (ui.ini)', locations['logo_path']),
                    ('categorypath (ui.ini)', locations['category_dir']),
                ] if value is None
            ]
            if missing:
                fail('Incomplete MAME configuration, import impossible - missing: ' + ', '.join(missing))

        summary = default_summary()
        entry_filter = None
        if only:
            manifest = select_games(manifest, only, summary)
            entry_filter = wanted_entries(manifest)
        directory_targets = resolve_directory_targets(zf, resolved_ini, ini_path, summary)

        space_targets = dict(directory_targets)
        if manifest is not None:
            space_targets.update({
                'roms': rom_path, 'marquees': locations['marquee_path'],
                'flyers': locations['flyer_path'], 'logos': locations['logo_path'],
            })
        check_disk_space(zf, space_targets, entry_filter)

        if manifest is not None:
            print(f"[import-starting-pack] {len(manifest.get('games', []))} game(s) "
                  f"{'selected in' if only else 'in'} the manifest "
                  f"(generated on {manifest.get('generatedAt', '?')}), {len(manifest.get('biosRoms', []))} bios.")
        if directory_targets:
            print(f"[import-starting-pack] mame folder(s) detected in the ZIP: "
                  f"{', '.join(directory_targets.keys())}.")

        if not skip_confirmation:
            answer = input(
                '[import-starting-pack] This overwrites the roms and media of the pack games (and the '
                'category files, if any), then adds these games to your MAME favorites '
                'without touching yours. Continue? [y/N] ',
            )
            if answer.strip().lower() not in ('y', 'yes'):
                print('[import-starting-pack] Cancelled.')
                return

        def log(line):
            print(f'  {line}', flush=True)

        # Before import_starting_pack(): a manifest-driven pack's genre.ini/Multiplayer.ini now
        # live under folders/ (same zip folder IMPORTABLE_MAME_DIRECTORIES already uses for a raw
        # categorypath backup - no need for a second, dedicated read of them here), and writing
        # them early, before import_starting_pack()'s own game-upsert loop, means they've already
        # made it to disk even if that loop fails partway through.
        import_mame_directories(zf, directory_targets, summary, log)
        if manifest is not None:
            import_starting_pack(
                zf, manifest, rom_path, locations['marquee_path'], locations['flyer_path'],
                locations['logo_path'], ini_path, database_path(), summary, log,
            )

    print_summary(summary)
    sys.exit(1 if summary['errors'] else 0)


if __name__ == '__main__':
    main()
