# Starter pack 7 — Konami : sélection de ROMs

Copie figée générée le 2026-09-19 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `/home/afronob/.mame/roms`
- **Jeux demandés** : `contra`, `scontra`, `tmnt`, `tmnt2`, `simpsons`, `ssriders`, `xmen`, `asterix`, `aliens`, `jackal`, `rushatck`, `yiear`, `pooyan`, `scramble`, `scobra`, `timeplt`, `gyruss`, `trackfld`, `hyperspt`, `salamand`, `gradius`, `lifefrce`
- **Zips copiés** : 21 (40.2 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `contra.zip` | jeu | `contra` | 1.7 Mio | `8f1b5a6e293d212b5d7729b1e78a8f62b7289085` | MAME 0.289 ROMs (merged) |
| `scontra.zip` | jeu | `scontra` | 2.4 Mio | `5043451fff126788eda20b237f7b31c51a5bcdb1` | MAME 0.289 ROMs (merged) |
| `tmnt.zip` | jeu | `tmnt` | 5.3 Mio | `ad01a68e53dddd311776373626763f679807ffb5` | MAME 0.289 ROMs (merged) |
| `tmnt2.zip` | jeu | `tmnt2` | 4.4 Mio | `4807944628ef25792eee5333a7026e08941a1e02` | MAME 0.289 ROMs (merged) |
| `simpsons.zip` | jeu | `simpsons` | 3.6 Mio | `bebef32f02e082282775d8908d5b461652a2e42e` | MAME 0.289 ROMs (merged) |
| `ssriders.zip` | jeu | `ssriders` | 6.8 Mio | `694884747b70206f3bfade399ccb1764bc625045` | MAME 0.289 ROMs (merged) |
| `xmen.zip` | jeu | `xmen` | 6.5 Mio | `52e40b6f524c921fbfc274e3d0674565d21a3018` | MAME 0.289 ROMs (merged) |
| `asterix.zip` | jeu | `asterix` | 4.0 Mio | `859b94d35c90a75e459a30334ec441f564e5da47` | MAME 0.289 ROMs (merged) |
| `aliens.zip` | jeu | `aliens` | 2.0 Mio | `fb17bb2ab2566fd9362d718db12240294cdc1d7e` | MAME 0.289 ROMs (merged) |
| `jackal.zip` | jeu | `jackal` | 1.1 Mio | `ee74f6d52e9dc95f54daa9fdbc75ac56c81a4e06` | MAME 0.289 ROMs (merged) |
| `gberet.zip` | parent | `rushatck` | 188.6 Kio | `78229148b8812f7af91bf09cd81a3795d15d3210` | MAME 0.289 ROMs (merged) |
| `yiear.zip` | jeu | `yiear` | 112.3 Kio | `12284f829f9d84a5abc12d8a895be8d4701ab534` | MAME 0.289 ROMs (merged) |
| `pooyan.zip` | jeu | `pooyan` | 81.6 Kio | `d67ab5143fa374c24d25faabfd916612131abf4c` | MAME 0.289 ROMs (merged) |
| `scramble.zip` | jeu | `scramble` | 194.9 Kio | `b9f393acaeb7a2c31ea3877b9ff5a6e0ad9b7749` | MAME 0.289 ROMs (merged) |
| `scobra.zip` | jeu | `scobra` | 120.9 Kio | `1789dc63d4815fae2ae699ccb162d8b8b10de0d2` | MAME 0.289 ROMs (merged) |
| `timeplt.zip` | jeu | `timeplt` | 103.0 Kio | `cab183f033e80a8eb9361aa5d21fc050e23aa9b7` | MAME 0.289 ROMs (merged) |
| `gyruss.zip` | jeu | `gyruss` | 83.7 Kio | `579fcb1c8cd42d3075121246084a19646e985cf6` | MAME 0.289 ROMs (merged) |
| `trackfld.zip` | jeu | `trackfld` | 453.3 Kio | `1086b43e2e03be9c030413a287bc7bf594b5333f` | MAME 0.289 ROMs (merged) |
| `hyperspt.zip` | jeu | `hyperspt` | 157.1 Kio | `d51ee9a2f03832505940e71b843e5917eff440b1` | MAME 0.289 ROMs (merged) |
| `salamand.zip` | jeu | `lifefrce`, `salamand` | 815.7 Kio | `6cbffdbcad25a4b2bf15435ada5f6b6dd5b9baf5` | MAME 0.289 ROMs (merged) |
| `nemesis.zip` | parent | `gradius` | 321.0 Kio | `34cc214c011b9e102c835aa2533cf62162da55f8` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest /home/afronob/.mame/roms --markdown docs/STARTER-PACK-7-ROMS.md \
    --title "Starter pack 7 — Konami : sélection de ROMs" \
    contra scontra tmnt tmnt2 simpsons ssriders xmen asterix aliens jackal rushatck yiear pooyan scramble scobra timeplt gyruss trackfld hyperspt salamand gradius lifefrce
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
