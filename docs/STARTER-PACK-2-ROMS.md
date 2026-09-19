# Starter pack 2 — Vs. System : sélection de ROMs

Copie figée générée le 2026-09-19 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `/home/afronob/.mame/roms`
- **Jeux demandés** : `suprmrio`, `duckhunt`, `vstennis`, `drmario`, `cluclu`, `iceclimb`
- **Zips copiés** : 6 (404.4 Kio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `suprmrio.zip` | jeu | `suprmrio` | 112.4 Kio | `70e284ed51c4d352fbe0e1a25371f2cffcb71a14` | MAME 0.289 ROMs (merged) |
| `duckhunt.zip` | jeu | `duckhunt` | 28.3 Kio | `f2b9c1fb530d2b68d89b5d72183e82e0218c5b74` | MAME 0.289 ROMs (merged) |
| `vstennis.zip` | jeu | `vstennis` | 133.0 Kio | `0f297c7b4151a725066b8927bf0e4d1808ab7d73` | MAME 0.289 ROMs (merged) |
| `drmario.zip` | jeu | `drmario` | 46.1 Kio | `d6577934b197e40a8e824991416fc31c75d27c5e` | MAME 0.289 ROMs (merged) |
| `cluclu.zip` | jeu | `cluclu` | 25.7 Kio | `f9d8c7eac6612cb7f82264679535416cbf5ba1db` | MAME 0.289 ROMs (merged) |
| `iceclimb.zip` | jeu | `iceclimb` | 58.9 Kio | `f39e33d4757db0179c9d67219e0fd9ca87a1c1da` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest /home/afronob/.mame/roms --markdown docs/STARTER-PACK-2-ROMS.md \
    --title "Starter pack 2 — Vs. System : sélection de ROMs" \
    suprmrio duckhunt vstennis drmario cluclu iceclimb
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
