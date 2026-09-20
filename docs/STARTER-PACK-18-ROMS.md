# Starter pack 18 — Irem : sélection de ROMs

Copie figée générée le 2026-09-20 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `/home/afronob/.mame/roms`
- **Jeux demandés** : `rtype`, `kungfum`, `imgfight`, `xmultipl`, `uccops`, `inthunt`, `gunforce`, `10yard`, `spelunkr`, `rtype2`, `nbbatman`, `hharry`
- **Zips copiés** : 12 (30.0 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `rtype.zip` | jeu | `rtype` | 1.8 Mio | `459ea4faa118614163d8229698e4bbecb1884255` | MAME 0.289 ROMs (merged) |
| `kungfum.zip` | jeu | `kungfum` | 358.8 Kio | `730d09af85206bb6777908e0ba70105b89fcfb98` | MAME 0.289 ROMs (merged) |
| `imgfight.zip` | jeu | `imgfight` | 923.0 Kio | `985f9b212811e101760942f129a994fc928ae541` | MAME 0.289 ROMs (merged) |
| `xmultipl.zip` | jeu | `xmultipl` | 1013.3 Kio | `23af3673870b76991a7e15aa87e6dfd53e8bfc3a` | MAME 0.289 ROMs (merged) |
| `uccops.zip` | jeu | `uccops` | 7.3 Mio | `dfafe806790572a5eb10b9b7cad11303d0903282` | MAME 0.289 ROMs (merged) |
| `inthunt.zip` | jeu | `inthunt` | 3.6 Mio | `6750cfcdff7ccadd98f42d835b4ad383139533ed` | MAME 0.289 ROMs (merged) |
| `gunforce.zip` | jeu | `gunforce` | 1.2 Mio | `7fab89338bbea2516f5c949ce86e71ae3751fb91` | MAME 0.289 ROMs (merged) |
| `10yard.zip` | jeu | `10yard` | 145.4 Kio | `e16ecbca6e0a8e7b6f593844bc81336cf682a8f4` | MAME 0.289 ROMs (merged) |
| `spelunkr.zip` | jeu | `spelunkr` | 136.6 Kio | `889f6d73dc2b132faab548013d8ce164cf3d4a06` | MAME 0.289 ROMs (merged) |
| `rtype2.zip` | jeu | `rtype2` | 1.9 Mio | `fbf2b9d79c1151c32c2a320e1e6bd9c5d89db8e6` | MAME 0.289 ROMs (merged) |
| `nbbatman.zip` | jeu | `nbbatman` | 9.3 Mio | `88f6f61a5a8a13e0f275cc8c9ac77e07c2d0a8bd` | MAME 0.289 ROMs (merged) |
| `hharry.zip` | jeu | `hharry` | 2.3 Mio | `ab801da2a200589284d32fb606ed61bb779bcad6` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest /home/afronob/.mame/roms --markdown docs/STARTER-PACK-18-ROMS.md \
    --title "Starter pack 18 — Irem : sélection de ROMs" \
    rtype kungfum imgfight xmultipl uccops inthunt gunforce 10yard spelunkr rtype2 nbbatman hharry
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
