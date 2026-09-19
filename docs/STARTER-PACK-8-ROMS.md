# Starter pack 8 — Atari : sélection de ROMs

Copie figée générée le 2026-09-19 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `/home/afronob/.mame/roms`
- **Jeux demandés** : `asteroid`, `astdelux`, `bzone`, `centiped`, `ccastles`, `gauntlet`, `gravitar`, `harddriv`, `irobot`, `klax`, `llander`, `marble`, `missile`, `milliped`, `paperboy`, `pong`, `roadblst`, `stunrun`, `starwars`, `tempest`, `atetris`, `toobin`, `vindictr`, `warlords`
- **Zips copiés** : 24 (13.5 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `asteroid.zip` | jeu | `asteroid` | 56.8 Kio | `51be7291e153c28e4c760ef1acda28915824a858` | MAME 0.289 ROMs (merged) |
| `astdelux.zip` | jeu | `astdelux` | 21.4 Kio | `83b13a5adec996c9d6fe08a25e63e03e16071fa7` | MAME 0.289 ROMs (merged) |
| `bzone.zip` | jeu | `bzone` | 40.1 Kio | `59a89eaecb70730088062fd2826853c0a766b2b0` | MAME 0.289 ROMs (merged) |
| `centiped.zip` | jeu | `centiped` | 84.2 Kio | `7b00b0b523ec0f07b9b28be0c616ca7d7f9190db` | MAME 0.289 ROMs (merged) |
| `ccastles.zip` | jeu | `ccastles` | 113.2 Kio | `4d120466a999bc12c0a81afdebe52fc2a2a906f8` | MAME 0.289 ROMs (merged) |
| `gauntlet.zip` | jeu | `gauntlet` | 1.2 Mio | `a1fd91c4e1f460b4d0e35979a2317f8fa436f7a8` | MAME 0.289 ROMs (merged) |
| `gravitar.zip` | jeu | `gravitar` | 110.7 Kio | `c49c0148101923a776cd284bd14bd44873411e75` | MAME 0.289 ROMs (merged) |
| `harddriv.zip` | jeu | `harddriv` | 2.7 Mio | `40fb1d3e166b169302f496be541cb64edc4337f5` | MAME 0.289 ROMs (merged) |
| `irobot.zip` | jeu | `irobot` | 85.0 Kio | `848a7d6d90c5e366f57b281caa1d6cf4b6293432` | MAME 0.289 ROMs (merged) |
| `klax.zip` | jeu | `klax` | 1.4 Mio | `42a21a3621f663c5338a11b26d186f999c6569d1` | MAME 0.289 ROMs (merged) |
| `llander.zip` | jeu | `llander` | 23.1 Kio | `bf405fe9f30cbfa45a412c06c9ff934913e333f7` | MAME 0.289 ROMs (merged) |
| `marble.zip` | jeu | `marble` | 460.4 Kio | `b6dc2eb19f80c1f9240e913d04a664349b444d3a` | MAME 0.289 ROMs (merged) |
| `atarisy1.zip` | bios | `marble`, `roadblst` | 56.0 Kio | `0c9bc4b948bd1816ebe13e2acb97931cbcc6ea15` | MAME 0.289 ROMs (bios-devices) |
| `missile.zip` | jeu | `missile` | 150.5 Kio | `28acd79e5e9e23cfde0e168ba0913fcf633577de` | MAME 0.289 ROMs (merged) |
| `milliped.zip` | jeu | `milliped` | 17.0 Kio | `4c9a07f4df373c25d560601dd743e0713df04d4a` | MAME 0.289 ROMs (merged) |
| `paperboy.zip` | jeu | `paperboy` | 531.3 Kio | `8958cb9fe25068f999cae29610ee1e9a0561f8d5` | MAME 0.289 ROMs (merged) |
| `roadblst.zip` | jeu | `roadblst` | 1.4 Mio | `aff1cc5539ea8bf352193c873422ac545bc808ec` | MAME 0.289 ROMs (merged) |
| `stunrun.zip` | jeu | `stunrun` | 1.7 Mio | `579257d5a6b9916ed88451e566a8c6d16221ed9a` | MAME 0.289 ROMs (merged) |
| `starwars.zip` | jeu | `starwars` | 58.9 Kio | `7c12ddf119fe7253fe4072609b8dbc3bb75ed67c` | MAME 0.289 ROMs (merged) |
| `tempest.zip` | jeu | `tempest` | 53.4 Kio | `4759782ab48e972ace2816c32487d605fe801138` | MAME 0.289 ROMs (merged) |
| `atetris.zip` | jeu | `atetris` | 585.3 Kio | `02ec479b2e9c1fea7ef6cf27d4826c9ac3ae6db9` | MAME 0.289 ROMs (merged) |
| `toobin.zip` | jeu | `toobin` | 1.4 Mio | `6e44758ac470d340a56ed3248e0fc5185ee0ff67` | MAME 0.289 ROMs (merged) |
| `vindictr.zip` | jeu | `vindictr` | 1.3 Mio | `141d1f9e4d655ec8a7df8fc5c0cdcf694f31efba` | MAME 0.289 ROMs (merged) |
| `warlords.zip` | jeu | `warlords` | 10.8 Kio | `5126889e1608bfa63037ab760fb9cd6ed80d3d0a` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest /home/afronob/.mame/roms --markdown docs/STARTER-PACK-8-ROMS.md \
    --title "Starter pack 8 — Atari : sélection de ROMs" \
    asteroid astdelux bzone centiped ccastles gauntlet gravitar harddriv irobot klax llander marble missile milliped paperboy pong roadblst stunrun starwars tempest atetris toobin vindictr warlords
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
