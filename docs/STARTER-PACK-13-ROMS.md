# Starter pack 13 — Williams : sélection de ROMs

Copie figée générée le 2026-09-20 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `/home/afronob/.mame/roms`
- **Jeux demandés** : `stargate`, `robotron`, `sinistar`, `bubbles`, `blaster`, `joust2`, `mpatrol`, `splat`, `inferno`, `narc`, `smashtv`, `strkforc`
- **Zips copiés** : 12 (9.9 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `stargate.zip` | jeu | `stargate` | 36.3 Kio | `e328246567c12a591a5924d04e9f862281cc7ef3` | MAME 0.289 ROMs (merged) |
| `robotron.zip` | jeu | `robotron` | 109.8 Kio | `0d1e138bbbb90bd785568890000ba4e9fa4c6518` | MAME 0.289 ROMs (merged) |
| `sinistar.zip` | jeu | `sinistar` | 88.0 Kio | `a51551f2b9930bbbbdb5d6b71056182553125f20` | MAME 0.289 ROMs (merged) |
| `bubbles.zip` | jeu | `bubbles` | 92.0 Kio | `7a07c477345d7b8091cdc1c98a0e704a1b326c3c` | MAME 0.289 ROMs (merged) |
| `blaster.zip` | jeu | `blaster` | 211.5 Kio | `545c35db11f2db3dd5b8f61cd1c4d11078643d9c` | MAME 0.289 ROMs (merged) |
| `joust2.zip` | jeu | `joust2` | 184.4 Kio | `275c9e77aae2dd236b935fe84f4fc403094fbbf5` | MAME 0.289 ROMs (merged) |
| `mpatrol.zip` | jeu | `mpatrol` | 47.8 Kio | `156805e5610bc7d016f8990acfd0a0b821db100c` | MAME 0.289 ROMs (merged) |
| `splat.zip` | jeu | `splat` | 40.3 Kio | `648bea4ce17f786e9f371a9934551cec5f0bafd2` | MAME 0.289 ROMs (merged) |
| `inferno.zip` | jeu | `inferno` | 66.0 Kio | `e3a29e4b244241a775584508d0fb8daa0c627ddb` | MAME 0.289 ROMs (merged) |
| `narc.zip` | jeu | `narc` | 6.0 Mio | `8b362cb16774109f10460a0df20d56746469ba72` | MAME 0.289 ROMs (merged) |
| `smashtv.zip` | jeu | `smashtv` | 1.2 Mio | `f64332c58c937ff7e4fe51b493a00da820b51404` | MAME 0.289 ROMs (merged) |
| `strkforc.zip` | jeu | `strkforc` | 1.9 Mio | `bbcd64d33d50be32021331d7352d04dd0791e698` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest /home/afronob/.mame/roms --markdown docs/STARTER-PACK-13-ROMS.md \
    --title "Starter pack 13 — Williams : sélection de ROMs" \
    stargate robotron sinistar bubbles blaster joust2 mpatrol splat inferno narc smashtv strkforc
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
