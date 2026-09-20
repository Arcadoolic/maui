# Starter pack 15 — Gremlin : sélection de ROMs

Copie figée générée le 2026-09-20 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `/home/afronob/.mame/roms`
- **Jeux demandés** : `blockade`, `comotion`, `depthch`, `hustle`, `frogs`, `headon`, `005`, `elim2`, `elim4`
- **Zips copiés** : 8 (234.4 Kio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `blockade.zip` | jeu | `blockade` | 1.6 Kio | `d571e16ba6e3d6970f8425379932003b14f370f4` | MAME 0.289 ROMs (merged) |
| `comotion.zip` | jeu | `comotion` | 4.7 Kio | `06a1072aaa39aeca74a8a590b4a551c7cd7afbbc` | MAME 0.289 ROMs (merged) |
| `depthch.zip` | jeu | `depthch` | 16.6 Kio | `5e254d69b848c8d217c4bb80268d757ab0f0ba6b` | MAME 0.289 ROMs (merged) |
| `hustle.zip` | jeu | `hustle` | 2.9 Kio | `3c66b00370a361848058254ea66671e150176814` | MAME 0.289 ROMs (merged) |
| `frogs.zip` | jeu | `frogs` | 6.9 Kio | `92b4de2c78839783f70f658634418ca663139df8` | MAME 0.289 ROMs (merged) |
| `headon.zip` | jeu | `headon` | 42.2 Kio | `fdd256c62a3808a5b8282dbc4535338604e6c5f4` | MAME 0.289 ROMs (merged) |
| `005.zip` | jeu | `005` | 55.4 Kio | `bc77cc7a50bad866f18fcc271676a7d5a5da3388` | MAME 0.289 ROMs (merged) |
| `elim2.zip` | jeu | `elim2`, `elim4` | 104.4 Kio | `538f8c6de69c3ec298f1098a071dc3cf3698db74` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest /home/afronob/.mame/roms --markdown docs/STARTER-PACK-15-ROMS.md \
    --title "Starter pack 15 — Gremlin : sélection de ROMs" \
    blockade comotion depthch hustle frogs headon 005 elim2 elim4
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
