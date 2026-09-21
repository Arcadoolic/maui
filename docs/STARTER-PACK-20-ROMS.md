# Starter pack 20 — Seibu Kaihatsu : sélection de ROMs

Copie figée générée le 2026-09-21 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `~/.mame/roms`
- **Jeux demandés** : `raiden`, `raiden2`, `rdft`, `rdft2`, `rfjet`, `viprp1`, `deadang`, `dbldynj`, `empcity`, `stinger`, `wiz`, `darkmist`, `kncljoe`, `scion`, `senkyu`
- **Zips copiés** : 17 (115.8 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `raiden.zip` | jeu | `raiden` | 3.3 Mio | `c1bad95b0f252927f339de89f0d731737d6ea228` | MAME 0.289 ROMs (merged) |
| `raiden2.zip` | jeu | `raiden2` | 22.4 Mio | `d390a44f7de30e9531618c86af9aad670afc13ba` | MAME 0.289 ROMs (merged) |
| `rdft.zip` | jeu | `rdft` | 19.1 Mio | `0abae9e04bf004ef6941b6522bfbf64ff5c73a1c` | MAME 0.289 ROMs (merged) |
| `rdft2.zip` | jeu | `rdft2` | 19.6 Mio | `0cfa47394ed0180f3a6e77705c1b93ee80335cb9` | MAME 0.289 ROMs (merged) |
| `rfjet.zip` | jeu | `rfjet` | 20.5 Mio | `ae24dfd2ff3c0f03f666c586cc43270e81dc4509` | MAME 0.289 ROMs (merged) |
| `viprp1.zip` | jeu | `viprp1` | 16.4 Mio | `addf3a46041f7acd129b1202e25ff0afdb9f38c1` | MAME 0.289 ROMs (merged) |
| `deadang.zip` | jeu | `deadang` | 1.1 Mio | `f8bb046e1c9f24a82ffe0a48acd0af8a2f4aec6d` | MAME 0.289 ROMs (merged) |
| `dbldynj.zip` | jeu | `dbldynj` | 1.8 Mio | `69d38c2da58d8ae7805a4080ea556fd079531c9c` | MAME 0.289 ROMs (merged) |
| `empcity.zip` | jeu | `empcity` | 516.4 Kio | `c418c542d7c790a73bf1a5f629b9e92a8301e72b` | MAME 0.289 ROMs (merged) |
| `m68705p5.zip` | device | `empcity` | 266 o | `59694128e4591ba01f3d67b56cf5de97faa375c5` | MAME 0.289 ROMs (bios-devices) |
| `stinger.zip` | jeu | `stinger` | 99.3 Kio | `6ddd89f54cd2c5820c7a88f309cb7c883db85f18` | MAME 0.289 ROMs (merged) |
| `wiz.zip` | jeu | `wiz` | 143.3 Kio | `0b10e7d793e5fefe399250084de97b297dab7963` | MAME 0.289 ROMs (merged) |
| `darkmist.zip` | jeu | `darkmist` | 339.1 Kio | `1731008cc36d991c9663fbded0ea3862fc76b685` | MAME 0.289 ROMs (merged) |
| `t5182.zip` | device | `darkmist` | 2.6 Kio | `11365ef292e979c3b5c914d1b58453f6b229ba59` | MAME 0.289 ROMs (bios-devices) |
| `kncljoe.zip` | jeu | `kncljoe` | 188.6 Kio | `2fb332b7038176810e4f7cb8f1a55f09e8797945` | MAME 0.289 ROMs (merged) |
| `scion.zip` | jeu | `scion` | 62.7 Kio | `57ed9787379cf21e6bf9abd244407e0c88d5f1da` | MAME 0.289 ROMs (merged) |
| `senkyu.zip` | jeu | `senkyu` | 10.4 Mio | `1c788677a1861f0beb82914e615322128552e5fc` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest ~/.mame/roms --markdown docs/STARTER-PACK-20-ROMS.md \
    --title "Starter pack 20 — Seibu Kaihatsu : sélection de ROMs" \
    raiden raiden2 rdft rdft2 rfjet viprp1 deadang dbldynj empcity stinger wiz darkmist kncljoe scion senkyu
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
