# Starter pack 17 — Jaleco : sélection de ROMs

Copie figée générée le 2026-09-20 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `/home/afronob/.mame/roms`
- **Jeux demandés** : `64street`, `argus`, `astyanax`, `avspirit`, `bigrun`, `cischeat`, `citycon`, `exerion`, `fcombat`, `formatz`, `lomakai`, `momoko`, `naughtyb`, `p47`, `pinbo`, `popflame`, `psychic5`, `rodland`, `stdragon`
- **Zips copiés** : 19 (19.3 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `64street.zip` | jeu | `64street` | 1.4 Mio | `e8052d7325e0341d077f520bf9e4b5311a847aeb` | MAME 0.289 ROMs (merged) |
| `argus.zip` | jeu | `argus` | 156.4 Kio | `c7bb0d5931b646de6c9a6e6075e39141bd0a7bda` | MAME 0.289 ROMs (merged) |
| `astyanax.zip` | jeu | `astyanax` | 3.3 Mio | `19c2cbc1cc6496dc6123b29c9775e73e5dfd832a` | MAME 0.289 ROMs (merged) |
| `avspirit.zip` | jeu | `avspirit` | 1.3 Mio | `b76bdf326c054b8a9974552bdad59e98619de8e0` | MAME 0.289 ROMs (merged) |
| `bigrun.zip` | jeu | `bigrun` | 2.5 Mio | `00760e02398de1f9b12ae5a184cf1669b3af48fb` | MAME 0.289 ROMs (merged) |
| `cischeat.zip` | jeu | `cischeat` | 2.5 Mio | `edf3f95c5ea208554b1654499239b49ee0075d87` | MAME 0.289 ROMs (merged) |
| `citycon.zip` | jeu | `citycon` | 148.8 Kio | `825bbc0cf7a735deff6b1cfa60b250f105e620d7` | MAME 0.289 ROMs (merged) |
| `exerion.zip` | jeu | `exerion` | 122.9 Kio | `10eea5fea6f61d80bf289b760fe0fa7a80ca44c1` | MAME 0.289 ROMs (merged) |
| `fcombat.zip` | jeu | `fcombat` | 54.8 Kio | `8a3842cb17ba00547c210a57471b871a87c86195` | MAME 0.289 ROMs (merged) |
| `formatz.zip` | jeu | `formatz` | 72.3 Kio | `d830f269648da187e311fcfee9658f750107fc4a` | MAME 0.289 ROMs (merged) |
| `lomakai.zip` | jeu | `lomakai` | 338.0 Kio | `c19301b05dee6c8528904b19353f61c15a51fa9d` | MAME 0.289 ROMs (merged) |
| `momoko.zip` | jeu | `momoko` | 202.2 Kio | `9ea123b486e56ff020a25ba2ab1e3aca5b265686` | MAME 0.289 ROMs (merged) |
| `naughtyb.zip` | jeu | `naughtyb` | 47.3 Kio | `e1dac3f18fdff17459fe68d66edfebab394e893b` | MAME 0.289 ROMs (merged) |
| `p47.zip` | jeu | `p47` | 1.6 Mio | `8e79930765026c08d6347d9a58fb73ae9cd11dcc` | MAME 0.289 ROMs (merged) |
| `pinbo.zip` | jeu | `pinbo` | 86.6 Kio | `4246e93828c9743a1411bd0ad689b8d22c025af9` | MAME 0.289 ROMs (merged) |
| `popflame.zip` | jeu | `popflame` | 59.2 Kio | `c6653dd509235edce70ec212eb9d80bcc67bbc29` | MAME 0.289 ROMs (merged) |
| `psychic5.zip` | jeu | `psychic5` | 218.1 Kio | `c81baa0451d8551c30a20de25e638b266095a1bb` | MAME 0.289 ROMs (merged) |
| `rodland.zip` | jeu | `rodland` | 2.7 Mio | `0d973b3712d0d9484d79eada1dec9c7e8840feb5` | MAME 0.289 ROMs (merged) |
| `stdragon.zip` | jeu | `stdragon` | 2.5 Mio | `025d6201c2b41ea8b6b1ec99776c398b670d6d43` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest /home/afronob/.mame/roms --markdown docs/STARTER-PACK-17-ROMS.md \
    --title "Starter pack 17 — Jaleco : sélection de ROMs" \
    64street argus astyanax avspirit bigrun cischeat citycon exerion fcombat formatz lomakai momoko naughtyb p47 pinbo popflame psychic5 rodland stdragon
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
