# Starter pack 12 — Centuri : sélection de ROMs

Copie figée générée le 2026-09-20 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `/home/afronob/.mame/roms`
- **Jeux demandés** : `aztarac`, `challeng`, `dday`, `mnchmobl`, `phoenix`, `pleiadce`, `pleiads`, `route16`, `targ`, `thepit`
- **Zips copiés** : 9 (589.6 Kio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `aztarac.zip` | jeu | `aztarac` | 32.1 Kio | `f73363019611c862d940f7e006754c7e206e64ee` | MAME 0.289 ROMs (merged) |
| `challeng.zip` | jeu | `challeng` | 14.6 Kio | `325323db1b927b14119571c06b1880fe124cacf6` | MAME 0.289 ROMs (merged) |
| `dday.zip` | jeu | `dday` | 31.8 Kio | `c7763d6a4906caf9de2f5df3a6afd5a8e65c02db` | MAME 0.289 ROMs (merged) |
| `joyfulr.zip` | parent | `mnchmobl` | 48.7 Kio | `6b5071af0046eeac4a8cf8aea853aaa5bc15cb85` | MAME 0.289 ROMs (merged) |
| `phoenix.zip` | jeu | `phoenix` | 216.8 Kio | `c133e03348602d342509466d65be49bc78b6c4e2` | MAME 0.289 ROMs (merged) |
| `pleiads.zip` | parent | `pleiadce`, `pleiads` | 96.1 Kio | `bbae45636d7b9b269897da6cae9009c66a03965b` | MAME 0.289 ROMs (merged) |
| `route16.zip` | jeu | `route16` | 63.0 Kio | `23f571dd28e9d644d47f4415276eb60f60a96e61` | MAME 0.289 ROMs (merged) |
| `targ.zip` | jeu | `targ` | 15.0 Kio | `4301587de769ebec76aea41ae7005df84e9ac699` | MAME 0.289 ROMs (merged) |
| `thepit.zip` | jeu | `thepit` | 71.7 Kio | `453057c078b0d3f135b9be02435c4c2b041eab48` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest /home/afronob/.mame/roms --markdown docs/STARTER-PACK-12-ROMS.md \
    --title "Starter pack 12 — Centuri : sélection de ROMs" \
    aztarac challeng dday mnchmobl phoenix pleiadce pleiads route16 targ thepit
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
