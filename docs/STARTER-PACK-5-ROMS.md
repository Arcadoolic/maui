# Starter pack 5 — Neo Geo : sélection de ROMs

Copie figée générée le 2026-09-19 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `~/.mame/roms`
- **Jeux demandés** : `mslug`, `mslug2`, `mslug3`, `mslugx`, `kof97`, `kof98`, `kof99`, `samsho`, `samsho2`, `garou`, `aof`, `fatfury1`, `wjammers`, `bstars2`, `maglord`, `kizuna`, `2020bb`
- **Zips copiés** : 18 (569.1 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `mslug.zip` | jeu | `mslug` | 12.6 Mio | `cc3c8f501ecb0365e5fe20080da2e908da404c17` | MAME 0.289 ROMs (merged) |
| `neogeo.zip` | bios | `2020bb`, `aof`, `bstars2`, `fatfury1`, `garou`, `kizuna`, `kof97`, `kof98`, `kof99`, `maglord`, `mslug`, `mslug2`, `mslug3`, `mslugx`, `samsho`, `samsho2`, `wjammers` | 1.8 Mio | `deb62b0074b8cae4f162c257662136733cfc76ad` | MAME 0.289 ROMs (bios-devices) |
| `mslug2.zip` | jeu | `mslug2` | 17.0 Mio | `94a7be1d4cd1cecd5491e0dca474e78c324eb8f4` | MAME 0.289 ROMs (merged) |
| `mslug3.zip` | jeu | `mslug3` | 83.1 Mio | `c0d11c329d4a42afe99e93dd3a37860490c35921` | MAME 0.289 ROMs (merged) |
| `mslugx.zip` | jeu | `mslugx` | 27.2 Mio | `73e02852f37b19e1db10d7eafe65c0d2047ff796` | MAME 0.289 ROMs (merged) |
| `kof97.zip` | jeu | `kof97` | 63.7 Mio | `2a299ff154709ad7e06e5ebac3b8b3ef9cbaab96` | MAME 0.289 ROMs (merged) |
| `kof98.zip` | jeu | `kof98` | 40.4 Mio | `37273fb348282f47385c7778a068b7b077594c28` | MAME 0.289 ROMs (merged) |
| `kof99.zip` | jeu | `kof99` | 106.2 Mio | `10eec54985b5de2258b82fc5fd8ec1eba48a49b1` | MAME 0.289 ROMs (merged) |
| `samsho.zip` | jeu | `samsho` | 8.7 Mio | `ce574d5e74164aef5476e29114a12efa4947c1a3` | MAME 0.289 ROMs (merged) |
| `samsho2.zip` | jeu | `samsho2` | 15.2 Mio | `126331506615a236038d2bbc0469f945c4c1f232` | MAME 0.289 ROMs (merged) |
| `garou.zip` | jeu | `garou` | 153.7 Mio | `b35ac29ed6789c1d07509ed727bc459ca45fe253` | MAME 0.289 ROMs (merged) |
| `aof.zip` | jeu | `aof` | 6.3 Mio | `21ef8e07d727afb25b3c25e27df596b63df610d1` | MAME 0.289 ROMs (merged) |
| `fatfury1.zip` | jeu | `fatfury1` | 3.9 Mio | `5c49f0de65bc7a289d66aa81bfa4b028941b0f39` | MAME 0.289 ROMs (merged) |
| `wjammers.zip` | jeu | `wjammers` | 3.9 Mio | `6b5efc7d62c41a996944df2f768e2230bfd563df` | MAME 0.289 ROMs (merged) |
| `bstars2.zip` | jeu | `bstars2` | 3.5 Mio | `265512237eb7a58c5ac4d9c78e1eeebd43306b11` | MAME 0.289 ROMs (merged) |
| `maglord.zip` | jeu | `maglord` | 2.9 Mio | `1f4fd57ef4af40728632fdcf1b6c8ddc49075e82` | MAME 0.289 ROMs (merged) |
| `kizuna.zip` | jeu | `kizuna` | 16.0 Mio | `718e11da323375a735555c0454d7a65077008e57` | MAME 0.289 ROMs (merged) |
| `2020bb.zip` | jeu | `2020bb` | 3.1 Mio | `17800d81096266cb6217843d3aa85319bf174f6c` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest ~/.mame/roms --markdown docs/STARTER-PACK-5-ROMS.md \
    --title "Starter pack 5 — Neo Geo : sélection de ROMs" \
    mslug mslug2 mslug3 mslugx kof97 kof98 kof99 samsho samsho2 garou aof fatfury1 wjammers bstars2 maglord kizuna 2020bb
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
