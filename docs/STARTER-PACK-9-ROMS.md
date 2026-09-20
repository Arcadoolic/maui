# Starter pack 9 — Data East : sélection de ROMs

Copie figée générée le 2026-09-20 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `/home/afronob/.mame/roms`
- **Jeux demandés** : `baddudes`, `btime`, `captaven`, `cobracom`, `hbarrel`, `kchamp`, `karnov`, `midres`, `robocop`, `slyspy`, `sidepckt`, `twocrude`, `vaportra`, `spinmast`
- **Zips copiés** : 15 (26.1 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `baddudes.zip` | jeu | `baddudes` | 1.4 Mio | `795d671bbe12a1ca3cbb6fb4421bd8acdc35fcfc` | MAME 0.289 ROMs (merged) |
| `btime.zip` | jeu | `btime` | 75.5 Kio | `07f48d4ff924db2d7d34f5a0bab178d356b35e26` | MAME 0.289 ROMs (merged) |
| `captaven.zip` | jeu | `captaven` | 8.0 Mio | `9c69fbc945ed7fdb3857184ba65ca7919964a6e8` | MAME 0.289 ROMs (merged) |
| `cobracom.zip` | jeu | `cobracom` | 578.6 Kio | `1cca950d2b16543d967faf28f6ed1cbc8bcc4814` | MAME 0.289 ROMs (merged) |
| `hbarrel.zip` | jeu | `hbarrel` | 720.0 Kio | `e65a3ff45d75b45133925c02eb7fbc7379b14d7f` | MAME 0.289 ROMs (merged) |
| `kchamp.zip` | jeu | `kchamp` | 241.9 Kio | `2c9beb7a8f6e2113d19f9405e47a9cc12b05ef93` | MAME 0.289 ROMs (merged) |
| `karnov.zip` | jeu | `karnov` | 731.8 Kio | `eb52741897940855acf81ee4985f8133249d59f5` | MAME 0.289 ROMs (merged) |
| `midres.zip` | jeu | `midres` | 1.9 Mio | `92807bbfa39ea9ce35dd0b2e855774a3fac09565` | MAME 0.289 ROMs (merged) |
| `robocop.zip` | jeu | `robocop` | 1.4 Mio | `44fa6191c4f9cfa4c3f622188a38c4ec50bce8f4` | MAME 0.289 ROMs (merged) |
| `secretag.zip` | parent | `slyspy` | 1.5 Mio | `0aa2fb63122fa56fefdaf1509cfc8a0cfbd5c283` | MAME 0.289 ROMs (merged) |
| `sidepckt.zip` | jeu | `sidepckt` | 162.8 Kio | `7fa71e6321249b53376a8d2fd05dc737771b35a6` | MAME 0.289 ROMs (merged) |
| `cbuster.zip` | parent | `twocrude` | 2.2 Mio | `a2f58b3e408a14f79412ecdf8c419d61f942aa38` | MAME 0.289 ROMs (merged) |
| `vaportra.zip` | jeu | `vaportra` | 1.5 Mio | `cd399761fbc6fb66852b7de8d8fda23837ae79c1` | MAME 0.289 ROMs (merged) |
| `spinmast.zip` | jeu | `spinmast` | 3.9 Mio | `ced5839100777c03927a7a0467926bb38692ba72` | MAME 0.289 ROMs (merged) |
| `neogeo.zip` | bios | `spinmast` | 1.8 Mio | `deb62b0074b8cae4f162c257662136733cfc76ad` | MAME 0.289 ROMs (bios-devices) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest /home/afronob/.mame/roms --markdown docs/STARTER-PACK-9-ROMS.md \
    --title "Starter pack 9 — Data East : sélection de ROMs" \
    baddudes btime captaven cobracom hbarrel kchamp karnov midres robocop slyspy sidepckt twocrude vaportra spinmast
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
