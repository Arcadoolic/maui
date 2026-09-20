# Starter pack 14 — Nichibutsu : sélection de ROMs

Copie figée générée le 2026-09-20 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `/home/afronob/.mame/roms`
- **Jeux demandés** : `mooncrst`, `moonqsr`, `mshuttle`, `seicross`, `magmax`, `terracre`, `dangar`, `legion`, `terraf`, `armedf`, `cclimber`, `friskyt`, `wiping`, `dacholer`, `skelagon`, `itaten`, `cop01`, `galivan`, `mightguy`, `ninjemak`, `kozure`, `horekid`, `cclimbr2`, `rjammer`, `dynamski`
- **Zips copiés** : 25 (5.3 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `mooncrst.zip` | jeu | `mooncrst` | 309.6 Kio | `919c9f8775e90b3068d5119398a32c277fe37d41` | MAME 0.289 ROMs (merged) |
| `moonqsr.zip` | jeu | `moonqsr` | 16.6 Kio | `2d666edd816f54d255b2c227f376195aac78e837` | MAME 0.289 ROMs (merged) |
| `mshuttle.zip` | jeu | `mshuttle` | 65.6 Kio | `1ef883445b6861354eea8179acec2520cfe06503` | MAME 0.289 ROMs (merged) |
| `seicross.zip` | jeu | `seicross` | 55.7 Kio | `1c1bc8439d810be8cce730464397c1d50dc8dc0e` | MAME 0.289 ROMs (merged) |
| `magmax.zip` | jeu | `magmax` | 137.1 Kio | `224c50594bc4ba96096373592af99eb0d56c33bc` | MAME 0.289 ROMs (merged) |
| `terracre.zip` | jeu | `terracre` | 192.8 Kio | `e5e033f408edff22dc300e32836fd2b648b19a4d` | MAME 0.289 ROMs (merged) |
| `dangar.zip` | jeu | `dangar` | 280.7 Kio | `56dd6cc2e243c0be25e4a4709cc780072ad0ca11` | MAME 0.289 ROMs (merged) |
| `legion.zip` | jeu | `legion` | 508.8 Kio | `17c6b5c6ca260180ec2e4243a2a5e74552ce096a` | MAME 0.289 ROMs (merged) |
| `terraf.zip` | jeu | `terraf` | 800.6 Kio | `752604fd052a4680d8b5af217a1a36228169fb29` | MAME 0.289 ROMs (merged) |
| `armedf.zip` | jeu | `armedf` | 449.0 Kio | `4fb0986e62e30bb4215bb2d2c3733cf9b31767fa` | MAME 0.289 ROMs (merged) |
| `cclimber.zip` | jeu | `cclimber` | 120.9 Kio | `bd09e5889496af70c41d9a811a85e6f16eebe2d5` | MAME 0.289 ROMs (merged) |
| `friskyt.zip` | jeu | `friskyt` | 71.4 Kio | `bada7f8c20cfcc317ec632b61becf98f88921ef2` | MAME 0.289 ROMs (merged) |
| `wiping.zip` | jeu | `wiping` | 50.9 Kio | `72a623be15ab39eb2b7b29aed4b44b74764f13fe` | MAME 0.289 ROMs (merged) |
| `dacholer.zip` | jeu | `dacholer` | 48.0 Kio | `2a87d765147681b2083071030095be756f7c5e8d` | MAME 0.289 ROMs (merged) |
| `sfx.zip` | parent | `skelagon` | 67.3 Kio | `0b749a83ca1ac9c65295e402d3d2831688671a4f` | MAME 0.289 ROMs (merged) |
| `itaten.zip` | jeu | `itaten` | 55.5 Kio | `5b79b12e12e6ccc706f8a673e542cf9cbcb8a9ee` | MAME 0.289 ROMs (merged) |
| `cop01.zip` | jeu | `cop01` | 115.7 Kio | `67b3322f2b0e55446bb91eecfd396690f8ab11c8` | MAME 0.289 ROMs (merged) |
| `galivan.zip` | jeu | `galivan` | 211.4 Kio | `11e1db5ac80be26eeb3679c779b636c5f91434af` | MAME 0.289 ROMs (merged) |
| `mightguy.zip` | jeu | `mightguy` | 116.8 Kio | `0e251c40625633b77855795ad3fb91eeffb5c22d` | MAME 0.289 ROMs (merged) |
| `ninjemak.zip` | jeu | `ninjemak` | 590.5 Kio | `c6e5fc8066ba170dd50a8a5e1479abdcfdbd98f1` | MAME 0.289 ROMs (merged) |
| `kozure.zip` | jeu | `kozure` | 361.8 Kio | `ad8c5c1e331f4349a7fd954decc11db63de4e7e4` | MAME 0.289 ROMs (merged) |
| `horekid.zip` | jeu | `horekid` | 336.3 Kio | `54b36e31dcb998fdbcd782ebd64e91fbde42d3b7` | MAME 0.289 ROMs (merged) |
| `cclimbr2.zip` | jeu | `cclimbr2` | 373.7 Kio | `12a06ef2f3b57caa70bbc6104c29ba62b495bae3` | MAME 0.289 ROMs (merged) |
| `rjammer.zip` | jeu | `rjammer` | 90.7 Kio | `3efbbf2fc5cde46dc6c599a4aa83783c6b786e0a` | MAME 0.289 ROMs (merged) |
| `dynamski.zip` | jeu | `dynamski` | 35.2 Kio | `ec69a8cb5dc79af218a0f7f213433f0e3e47bc62` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest /home/afronob/.mame/roms --markdown docs/STARTER-PACK-14-ROMS.md \
    --title "Starter pack 14 — Nichibutsu : sélection de ROMs" \
    mooncrst moonqsr mshuttle seicross magmax terracre dangar legion terraf armedf cclimber friskyt wiping dacholer skelagon itaten cop01 galivan mightguy ninjemak kozure horekid cclimbr2 rjammer dynamski
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
