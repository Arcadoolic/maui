# Starter pack 1 — Donkey Kong & co : sélection de ROMs

Copie figée générée le 2026-09-19 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `~/.mame/roms`
- **Jeux demandés** : `dkong`, `dkongjr`, `dkong3`, `mario`, `popeye`, `punchout`, `spnchout`, `sheriff`, `spacefev`, `radarscp`
- **Zips copiés** : 10 (1.7 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `dkong.zip` | jeu | `dkong` | 233.9 Kio | `3cd59e0328a32e3c8879c68e6cbd7894307291f5` | MAME 0.289 ROMs (merged) |
| `dkongjr.zip` | jeu | `dkongjr` | 322.0 Kio | `cee63ac5ba654da3c3dae53e1bef04c7be03941d` | MAME 0.289 ROMs (merged) |
| `dkong3.zip` | jeu | `dkong3` | 135.4 Kio | `eaf75c9c417d6c5589c7213dea00c5eeb3ba6dba` | MAME 0.289 ROMs (merged) |
| `mario.zip` | jeu | `mario` | 242.9 Kio | `39b6f538d0172adf0f9fa675968182ba64c4e8f7` | MAME 0.289 ROMs (merged) |
| `popeye.zip` | jeu | `popeye` | 201.0 Kio | `758741fa2e0f23fa79c0ddfa4eb91953f884afc5` | MAME 0.289 ROMs (merged) |
| `punchout.zip` | jeu | `punchout` | 291.0 Kio | `a7159e5a344548ce025b00c79f55c394c7e405c8` | MAME 0.289 ROMs (merged) |
| `spnchout.zip` | jeu | `spnchout` | 242.1 Kio | `b5107ac4494958508d1962c2d251e0aa567a4a04` | MAME 0.289 ROMs (merged) |
| `sheriff.zip` | jeu | `sheriff` | 20.3 Kio | `71ffe4bb4d313cc384b504a0ac1ccf46941d72d2` | MAME 0.289 ROMs (merged) |
| `spacefev.zip` | jeu | `spacefev` | 14.5 Kio | `15baa2c9d94ddfd30746b3db9e93d86137143376` | MAME 0.289 ROMs (merged) |
| `radarscp.zip` | jeu | `radarscp` | 30.5 Kio | `2bab30094115501709cab930e12d2d7422339792` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest ~/.mame/roms --markdown docs/STARTER-PACK-1-ROMS.md \
    dkong dkongjr dkong3 mario popeye punchout spnchout sheriff spacefev radarscp
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
