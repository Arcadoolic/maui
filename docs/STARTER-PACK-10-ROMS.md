# Starter pack 10 — Taito : sélection de ROMs

Copie figée générée le 2026-09-20 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `/home/afronob/.mame/roms`
- **Jeux demandés** : `invaders`, `elevator`, `bublbobl`, `arkanoid`, `opwolf`, `chasehq`, `pbobblen`
- **Zips copiés** : 10 (15.0 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `invaders.zip` | jeu | `invaders` | 244.0 Kio | `c082308cd3d400501feda664722cc6974f1bfb84` | MAME 0.289 ROMs (merged) |
| `elevator.zip` | jeu | `elevator` | 80.4 Kio | `2081eab67c624ec8dd486c56852917e15cd5e3ca` | MAME 0.289 ROMs (merged) |
| `m68705p5.zip` | device | `arkanoid`, `elevator` | 266 o | `59694128e4591ba01f3d67b56cf5de97faa375c5` | MAME 0.289 ROMs (bios-devices) |
| `bublbobl.zip` | jeu | `bublbobl` | 1.3 Mio | `f26ecd6b57f0c8938a13dfd8079fe6d5a658773f` | MAME 0.289 ROMs (merged) |
| `arkanoid.zip` | jeu | `arkanoid` | 748.3 Kio | `ce311259ccac25da8c27ff219b6f966485a51920` | MAME 0.289 ROMs (merged) |
| `opwolf.zip` | jeu | `opwolf` | 1.9 Mio | `84559d2ef98b2288b0768b85ab3d48c628dc55bc` | MAME 0.289 ROMs (merged) |
| `cchip.zip` | device | `opwolf` | 2.6 Kio | `364f2302a145a0fd6de767d7f8484badde1d1a6e` | MAME 0.289 ROMs (bios-devices) |
| `chasehq.zip` | jeu | `chasehq` | 5.3 Mio | `d7cecfbc391813e35c04589b8303138a50575ecc` | MAME 0.289 ROMs (merged) |
| `pbobblen.zip` | jeu | `pbobblen` | 3.6 Mio | `1e5ce0db94b740280de3064ed84088dd6e3bae1e` | MAME 0.289 ROMs (merged) |
| `neogeo.zip` | bios | `pbobblen` | 1.8 Mio | `deb62b0074b8cae4f162c257662136733cfc76ad` | MAME 0.289 ROMs (bios-devices) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest /home/afronob/.mame/roms --markdown docs/STARTER-PACK-10-ROMS.md \
    --title "Starter pack 10 — Taito : sélection de ROMs" \
    invaders elevator bublbobl arkanoid opwolf chasehq pbobblen
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
