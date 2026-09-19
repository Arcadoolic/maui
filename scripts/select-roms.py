#!/usr/bin/env python3
"""Copy a hand-picked selection of MAME ROM sets (plus what they depend on) from a full ROM
collection into a MAME roms directory, and freeze what was copied in a Markdown file.

For each requested machine it resolves, through `mame -listxml`, every zip the machine needs to
run: its own set, its parent (cloneof), any BIOS/parent it borrows ROMs from (romof, followed
recursively), and any referenced device that ships ROMs of its own. It then copies those zips out
of the source collection - and only those: no artwork, no flyers/marquees/logos.

Sources are the "ROMs" folders of a collection laid out like `MAME 0.289 ROMs (merged)` and
`MAME 0.289 ROMs (bios-devices)`: in a merged set a clone has no zip of its own, its ROMs live in
the parent's zip, which is why the parent is always part of the selection.

Stdlib only. Run on the machine that has both the collection and the `mame` binary:
    python3 scripts/select-roms.py --source /var/mnt/capsule-emulation/Mame_0289 \\
        --dest ~/.mame/roms --markdown docs/STARTER-PACK-1-ROMS.md \\
        dkong dkongjr dkong3 mario popeye punchout spnchout sheriff spacefev radarscp
Afterwards, `mame -rompath <dest> -verifyroms <name>` checks a set is complete.
"""

import argparse
import datetime
import hashlib
import os
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET


def fail(message):
    print(f'[select-roms] {message}', file=sys.stderr)
    sys.exit(1)


def list_xml(mame, name):
    """Returns {machine name: <machine> element} for `name` and every device it references (the
    same `-listxml <name>` output carries both), or None if mame doesn't know that name."""
    result = subprocess.run([mame, '-listxml', name], capture_output=True, text=True)
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        root = ET.fromstring(result.stdout)
    except ET.ParseError:
        return None
    machines = {m.get('name'): m for m in root.findall('machine')}
    return machines if name in machines else None


def has_own_roms(machine):
    """A device/BIOS machine counts as needing a zip when it lists at least one real ROM (a
    dumped one - nodump has no CRC) that isn't merged in from another set."""
    return any(r.get('crc') and r.get('status') != 'nodump' and not r.get('merge')
               for r in machine.findall('rom'))


def resolve(mame, requested):
    """Returns (needed, unknown): needed is an ordered {zip name: {'role': ..., 'for': set of the
    requested machines that need it}}, unknown the requested names mame doesn't know."""
    needed = {}
    unknown = []

    def add(zip_name, role, for_name):
        entry = needed.setdefault(zip_name, {'role': role, 'for': set()})
        entry['for'].add(for_name)

    for name in requested:
        machines = list_xml(mame, name)
        if machines is None:
            unknown.append(name)
            continue
        machine = machines[name]
        add(name, 'jeu', name)
        # e.g. pong: a netlist-driven machine with no ROM files at all, so nothing to copy.
        needed[name]['no_roms'] = not machine.findall('rom') and not machine.get('cloneof')

        parent = machine.get('cloneof')
        if parent:
            add(parent, 'parent', name)
        # romof chain: BIOS or parent set this machine borrows ROMs from, and theirs in turn.
        seen = {name}
        link = machine.get('romof')
        while link and link not in seen:
            seen.add(link)
            linked = list_xml(mame, link)
            if linked is None:
                break
            add(link, 'bios' if linked[link].get('isbios') == 'yes' else 'parent', name)
            link = linked[link].get('romof')

        for ref in machine.findall('device_ref'):
            device = machines.get(ref.get('name'))
            if device is None:
                continue
            if has_own_roms(device):
                add(ref.get('name'), 'device', name)
            # A device can also be a thin variant whose ROMs are merged in from a parent device
            # (qsound_hle borrows qsound's dl-1425.bin): the parent's zip is then what's needed.
            seen_devices = {ref.get('name')}
            link = device.get('romof')
            while link and link not in seen_devices:
                seen_devices.add(link)
                linked = machines.get(link) or (list_xml(mame, link) or {}).get(link)
                if linked is None:
                    break
                add(link, 'device', name)
                link = linked.get('romof')
    return needed, unknown


def find_zip(source_dirs, zip_name, role):
    """First source folder holding `<zip_name>.zip`. BIOS and device sets live in the
    bios-devices folder, so it's searched first for those roles, last for games."""
    ordered = sorted(source_dirs, key=lambda d: ('bios-devices' in d.lower()) != (role in ('bios', 'device')))
    for directory in ordered:
        candidate = os.path.join(directory, zip_name + '.zip')
        if os.path.isfile(candidate):
            return candidate
    return None


def sha1_of(path):
    digest = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def human_size(size):
    for unit in ('o', 'Kio', 'Mio'):
        if size < 1024:
            return f'{size:.0f} {unit}' if unit == 'o' else f'{size:.1f} {unit}'
        size /= 1024
    return f'{size:.1f} Gio'


def write_markdown(path, args, mame_version, requested, rows, missing, unknown):
    total = sum(row['size'] for row in rows)
    lines = [
        f'# {args.title}',
        '',
        f'Copie figée générée le {datetime.date.today().isoformat()} par `scripts/select-roms.py` '
        f'(MAME {mame_version}). Ne contient que les zips de ROMs nécessaires : ni artwork, ni '
        'flyers, marquees ou logos.',
        '',
        f'- **Source** : `{args.source}`',
        f'- **Destination** : `{args.dest}`',
        f'- **Jeux demandés** : {", ".join(f"`{n}`" for n in requested)}',
        f'- **Zips copiés** : {len(rows)} ({human_size(total)})',
        '',
        '## Zips copiés',
        '',
        '| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |',
        '|---|---|---|---|---|---|',
    ]
    for row in rows:
        lines.append(
            f"| `{row['zip']}.zip` | {row['role']} | {', '.join(f'`{n}`' for n in sorted(row['for']))} "
            f"| {human_size(row['size'])} | `{row['sha1']}` | {row['folder']} |",
        )
    if unknown or missing:
        lines += ['', '## À traiter', '']
        for name in unknown:
            lines.append(f'- `{name}` : inconnu de MAME {mame_version}, ignoré.')
        for zip_name in missing:
            lines.append(f'- `{zip_name}.zip` : requis mais absent de la source.')
    lines += [
        '',
        '## Refaire la copie',
        '',
        '```bash',
        'python3 scripts/select-roms.py \\',
        f'    --source {args.source} --dest {args.dest} --markdown {args.markdown} \\',
        f'    --title "{args.title}" \\',
        f'    {" ".join(requested)}',
        '```',
        '',
        'Vérifier qu\'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.',
        '',
    ]
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('machines', nargs='+', help='machine names, as in `mame -listfull`')
    parser.add_argument('--source', required=True,
                        help='collection root, holding one or more "... ROMs ..." folders')
    parser.add_argument('--dest', default=os.path.join('~', '.mame', 'roms'))
    parser.add_argument('--mame', default='mame', help='mame binary (default: mame from PATH)')
    parser.add_argument('--markdown', help='write the frozen selection to this .md file')
    parser.add_argument('--title', default='Sélection de ROMs du starter pack', help='title of the .md file')
    parser.add_argument('--dry-run', action='store_true', help='resolve and report, copy nothing')
    args = parser.parse_args()

    args.dest = os.path.expanduser(args.dest)
    if not shutil.which(args.mame):
        fail(f'binaire mame introuvable ("{args.mame}").')
    source_dirs = [os.path.join(args.source, d) for d in sorted(os.listdir(args.source))
                   if 'roms' in d.lower() and os.path.isdir(os.path.join(args.source, d))]
    if not source_dirs:
        fail(f'aucun dossier "ROMs" dans {args.source}.')

    version = subprocess.run([args.mame, '-version'], capture_output=True, text=True).stdout.split()[0]
    requested = list(dict.fromkeys(args.machines))
    needed, unknown = resolve(args.mame, requested)
    if unknown:
        print(f"[select-roms] Inconnu de MAME {version} : {', '.join(unknown)}", file=sys.stderr)

    rows, missing = [], []
    for zip_name, info in needed.items():
        source = find_zip(source_dirs, zip_name, info['role'])
        if source is None:
            # A clone has no zip of its own in a merged set: its ROMs come with the parent's.
            if info['role'] == 'jeu':
                reason = ('aucune ROM requise par ce jeu' if info.get('no_roms')
                          else 'clone : ses ROMs sont dans le zip de son parent')
                print(f'[select-roms] {zip_name}.zip absent de la source ({reason}).')
                continue
            missing.append(zip_name)
            print(f'[select-roms] {zip_name}.zip ({info["role"]}) absent de la source.', file=sys.stderr)
            continue
        rows.append({
            'zip': zip_name, 'role': info['role'], 'for': info['for'], 'size': os.path.getsize(source),
            'sha1': sha1_of(source), 'folder': os.path.basename(os.path.dirname(source)), 'path': source,
        })

    if not args.dry_run:
        os.makedirs(args.dest, exist_ok=True)
    for row in rows:
        target = os.path.join(args.dest, row['zip'] + '.zip')
        already = os.path.isfile(target) and os.path.getsize(target) == row['size']
        print(f"[select-roms] {row['zip']}.zip ({row['role']}, {human_size(row['size'])}) "
              f"{'déjà présent' if already else 'à copier' if args.dry_run else 'copié'}")
        if not args.dry_run and not already:
            shutil.copyfile(row['path'], target)

    if args.markdown and not args.dry_run:
        write_markdown(args.markdown, args, version, requested, rows, missing, unknown)
        print(f'[select-roms] Sélection figée dans {args.markdown}')
    print(f'[select-roms] {len(rows)} zip(s), {human_size(sum(r["size"] for r in rows))}.')
    sys.exit(1 if unknown or missing else 0)


if __name__ == '__main__':
    main()
