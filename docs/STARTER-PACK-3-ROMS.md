# Starter pack 3 — Sega : sélection de ROMs

Copie figée générée le 2026-09-19 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `~/.mame/roms`
- **Jeux demandés** : `aburner2`, `aliensyn`, `outrun`, `sharrier`, `goldnaxe`, `vf`, `vcop`, `hangon`, `columns`, `shinobi`, `shdancer`, `toutrun`, `dnmtdeka`, `diehard`
- **Zips copiés** : 18 (52.7 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `aburner2.zip` | jeu | `aburner2` | 1.6 Mio | `e2aba5531dd572ebc6ae6a14c3a2ec98107970b6` | MAME 0.289 ROMs (merged) |
| `aliensyn.zip` | jeu | `aliensyn` | 1.2 Mio | `fff88fbc1116f0778a1c20f8edf92271b57357a5` | MAME 0.289 ROMs (merged) |
| `outrun.zip` | jeu | `outrun` | 2.9 Mio | `2cd7a2fe226d6ab3f8ec11252f451c4d8dba4f6a` | MAME 0.289 ROMs (merged) |
| `sharrier.zip` | jeu | `sharrier` | 766.4 Kio | `55854b9dff6801d57f383f244c015c19fdeac888` | MAME 0.289 ROMs (merged) |
| `goldnaxe.zip` | jeu | `goldnaxe` | 4.0 Mio | `bed75bbd953f06a39c31cbf0da6ccbb818489ac8` | MAME 0.289 ROMs (merged) |
| `vf.zip` | jeu | `vf` | 13.6 Mio | `f0f594599454e85e8b3a082943b1839f1a2ac920` | MAME 0.289 ROMs (merged) |
| `model1io.zip` | device | `vf` | 4.6 Kio | `1587dcdbe3faf79d4dfa8c7248fc88698cac6ae8` | MAME 0.289 ROMs (bios-devices) |
| `vcop.zip` | jeu | `vcop` | 9.2 Mio | `09ad1270098476c85f5165ebfac9a3f0d4c47636` | MAME 0.289 ROMs (merged) |
| `model1io2.zip` | device | `vcop` | 126.4 Kio | `7d10b47a99dea847058452aaa12e734a36e79446` | MAME 0.289 ROMs (bios-devices) |
| `hd44780.zip` | device | `vcop` | 965 o | `1b3e7285b59ee52972115e223d000fb93413eb0b` | MAME 0.289 ROMs (bios-devices) |
| `hangon.zip` | jeu | `hangon` | 608.4 Kio | `40892467346cc862be2fadc5871b7b99260e6b7f` | MAME 0.289 ROMs (merged) |
| `columns.zip` | jeu | `columns` | 207.1 Kio | `aa0666c382b6d97dba7468b1bb0ce3622fe7fbb3` | MAME 0.289 ROMs (merged) |
| `shinobi.zip` | jeu | `shinobi` | 2.0 Mio | `a7a0ce96dedfa13669ff617a392fb3a0bbf43ef5` | MAME 0.289 ROMs (merged) |
| `shdancer.zip` | jeu | `shdancer` | 3.6 Mio | `5e75a6aa62f01345b5a04868ecbe2993dfd5a5e1` | MAME 0.289 ROMs (merged) |
| `toutrun.zip` | jeu | `toutrun` | 2.7 Mio | `e7b38c6b5bbe8fd04e63f19f4f1e68d49af7a30e` | MAME 0.289 ROMs (merged) |
| `diehard.zip` | parent | `diehard`, `dnmtdeka` | 7.0 Mio | `93286b62da9c630ded1f862c97e40eeea1e71f4f` | MAME 0.289 ROMs (merged) |
| `stvbios.zip` | bios | `diehard`, `dnmtdeka` | 3.3 Mio | `a5c64cefd986993f78ffe0d54bcb9cac05767326` | MAME 0.289 ROMs (bios-devices) |
| `segabill.zip` | device | `diehard`, `dnmtdeka` | 3.0 Kio | `4631db7f7f5160a3a6591d3102722be869710f66` | MAME 0.289 ROMs (bios-devices) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest ~/.mame/roms --markdown docs/STARTER-PACK-3-ROMS.md \
    --title "Starter pack 3 — Sega : sélection de ROMs" \
    aburner2 aliensyn outrun sharrier goldnaxe vf vcop hangon columns shinobi shdancer toutrun dnmtdeka diehard
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
