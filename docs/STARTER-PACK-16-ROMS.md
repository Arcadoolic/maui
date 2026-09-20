# Starter pack 16 — SNK (Neo Geo 2) : sélection de ROMs

Copie figée générée le 2026-09-20 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `/home/afronob/.mame/roms`
- **Jeux demandés** : `kof94`, `kof95`, `kof96`, `kof2000`, `kof2001`, `kof2002`, `samsho3`, `samsho4`, `fatfury2`, `fatfury3`, `fatfursp`, `aof2`, `aof3`, `alpham2`, `bstars`, `burningf`, `lastblad`, `shocktro`, `wh1`, `nitd`
- **Zips copiés** : 21 (637.4 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `kof94.zip` | jeu | `kof94` | 12.2 Mio | `6cf5b88ce4912cba7168ed1b13f041b516e17af2` | MAME 0.289 ROMs (merged) |
| `neogeo.zip` | bios | `alpham2`, `aof2`, `aof3`, `bstars`, `burningf`, `fatfursp`, `fatfury2`, `fatfury3`, `kof2000`, `kof2001`, `kof2002`, `kof94`, `kof95`, `kof96`, `lastblad`, `nitd`, `samsho3`, `samsho4`, `shocktro`, `wh1` | 1.8 Mio | `deb62b0074b8cae4f162c257662136733cfc76ad` | MAME 0.289 ROMs (bios-devices) |
| `kof95.zip` | jeu | `kof95` | 16.8 Mio | `ffae969acfefba0a3340ebf4ef2bc479ebf2d724` | MAME 0.289 ROMs (merged) |
| `kof96.zip` | jeu | `kof96` | 23.8 Mio | `e67dae774ed70372002cebc410bf299754cb8c09` | MAME 0.289 ROMs (merged) |
| `kof2000.zip` | jeu | `kof2000` | 79.3 Mio | `247723ba4705c21af936dba3c763e3e69f0e33ec` | MAME 0.289 ROMs (merged) |
| `kof2001.zip` | jeu | `kof2001` | 104.4 Mio | `e88210e63f63b8ce95d00cdf5f71d91dc3ecd4dd` | MAME 0.289 ROMs (merged) |
| `kof2002.zip` | jeu | `kof2002` | 200.5 Mio | `18fe1d531239a7cab118a39953b0857dd0091104` | MAME 0.289 ROMs (merged) |
| `samsho3.zip` | jeu | `samsho3` | 18.2 Mio | `bade10335d5941df8312f90e6113890dea9cc00d` | MAME 0.289 ROMs (merged) |
| `samsho4.zip` | jeu | `samsho4` | 22.0 Mio | `c4f405b91d5f692df42c762d70c447a88cc9fa27` | MAME 0.289 ROMs (merged) |
| `fatfury2.zip` | jeu | `fatfury2` | 7.6 Mio | `32494f9933fdb1ca3c9682367058b23bdbd7b471` | MAME 0.289 ROMs (merged) |
| `fatfury3.zip` | jeu | `fatfury3` | 18.7 Mio | `917e8db9a445b8590704ffdad39b366b528af067` | MAME 0.289 ROMs (merged) |
| `fatfursp.zip` | jeu | `fatfursp` | 11.0 Mio | `d60168977196b1eaf7da43cde8c069dde23b87f9` | MAME 0.289 ROMs (merged) |
| `aof2.zip` | jeu | `aof2` | 12.0 Mio | `c74dc779e3f3c65b0c171540949eb83720973893` | MAME 0.289 ROMs (merged) |
| `aof3.zip` | jeu | `aof3` | 16.5 Mio | `eeba3f6119fbda4b925b71f890036f5c1acdf183` | MAME 0.289 ROMs (merged) |
| `alpham2.zip` | jeu | `alpham2` | 6.2 Mio | `2349c6d01a593177182a488e14943af84c55294b` | MAME 0.289 ROMs (merged) |
| `bstars.zip` | jeu | `bstars` | 3.3 Mio | `71930e4c4c71c047f88d846cba00871c66305d3d` | MAME 0.289 ROMs (merged) |
| `burningf.zip` | jeu | `burningf` | 11.6 Mio | `cda0e9dd68846d71083023a1b657c5c7729a7b36` | MAME 0.289 ROMs (merged) |
| `lastblad.zip` | jeu | `lastblad` | 25.6 Mio | `8202ced66e87e9167c9359210bf397ef1ec71880` | MAME 0.289 ROMs (merged) |
| `shocktro.zip` | jeu | `shocktro` | 19.0 Mio | `c058aa4ae4a5f0f0ac5a1eaf7784bab0c7cc60ee` | MAME 0.289 ROMs (merged) |
| `wh1.zip` | jeu | `wh1` | 5.3 Mio | `7c5efcdc488cd7e3a0e8095c5431e8a1e07b132c` | MAME 0.289 ROMs (merged) |
| `nitd.zip` | jeu | `nitd` | 21.8 Mio | `419ef027fdead7c79f5e1db3309c7762b317b7a2` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest /home/afronob/.mame/roms --markdown docs/STARTER-PACK-16-ROMS.md \
    --title "Starter pack 16 — SNK (Neo Geo 2) : sélection de ROMs" \
    kof94 kof95 kof96 kof2000 kof2001 kof2002 samsho3 samsho4 fatfury2 fatfury3 fatfursp aof2 aof3 alpham2 bstars burningf lastblad shocktro wh1 nitd
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
