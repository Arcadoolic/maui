# Starter pack 4 — Namco : sélection de ROMs

Copie figée générée le 2026-09-19 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `~/.mame/roms`
- **Jeux demandés** : `puckman`, `galaga`, `galaxian`, `digdug`, `digdug2`, `mappy`, `polepos`, `xevious`, `rallyx`, `nrallyx`, `bosco`, `superpac`, `todruaga`, `pacland`, `galaga88`, `dspirit`, `motos`, `rthunder`, `splatter`
- **Zips copiés** : 24 (5.4 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `puckman.zip` | jeu | `puckman` | 466.4 Kio | `0a1574318c2d843c455467131a4986f93bde6cb0` | MAME 0.289 ROMs (merged) |
| `galaga.zip` | jeu | `galaga` | 95.4 Kio | `8f49376546ee044e20b1a6b7998608995bad9e43` | MAME 0.289 ROMs (merged) |
| `namco51.zip` | device | `bosco`, `digdug`, `galaga`, `polepos`, `xevious` | 716 o | `1c1d782a3ba9c035cdf96fd869c5f20fb11ecee8` | MAME 0.289 ROMs (bios-devices) |
| `namco54.zip` | device | `bosco`, `galaga`, `polepos`, `xevious` | 592 o | `dfa670c9c41b9307ba4f56fe7d0c017c3a5f3566` | MAME 0.289 ROMs (bios-devices) |
| `galaxian.zip` | jeu | `galaxian` | 245.9 Kio | `63693a2a66aad6aea8ac5d0a1589da95ff88c1fa` | MAME 0.289 ROMs (merged) |
| `digdug.zip` | jeu | `digdug` | 101.5 Kio | `1a849eb0aa52047c9cc341ee49f31d5be1985345` | MAME 0.289 ROMs (merged) |
| `namco53.zip` | device | `digdug`, `polepos` | 675 o | `191e3ae26e3e489cbec756cdc4534c25fdbd4208` | MAME 0.289 ROMs (bios-devices) |
| `digdug2.zip` | jeu | `digdug2` | 53.1 Kio | `72c3521c7f1daa6bbbb393e7c8aa932700ed4600` | MAME 0.289 ROMs (merged) |
| `mappy.zip` | jeu | `mappy` | 38.5 Kio | `fda59666ed5a83c6be3d03f674e9477b3879bae0` | MAME 0.289 ROMs (merged) |
| `polepos.zip` | jeu | `polepos` | 236.2 Kio | `5022d91826409a88b698a23bcd40c1bc47d498a1` | MAME 0.289 ROMs (merged) |
| `namco52.zip` | device | `bosco`, `polepos` | 389 o | `565eb69839d8f08247621ca051280be6f2c7841c` | MAME 0.289 ROMs (bios-devices) |
| `xevious.zip` | jeu | `xevious` | 142.0 Kio | `12735ab7ab5ac1b7a56874d1afe4fbbdf79a7ed5` | MAME 0.289 ROMs (merged) |
| `namco50.zip` | device | `bosco`, `xevious` | 898 o | `1507687c65843d996fb29b4eab1795105ed28846` | MAME 0.289 ROMs (bios-devices) |
| `rallyx.zip` | jeu | `rallyx` | 61.4 Kio | `7e65d5827e6209643775041a5d520e81a08aed9c` | MAME 0.289 ROMs (merged) |
| `nrallyx.zip` | jeu | `nrallyx` | 27.5 Kio | `4baaad7c2f1370ebb9b6dc3e99bfd42fb0593d4b` | MAME 0.289 ROMs (merged) |
| `bosco.zip` | jeu | `bosco` | 99.9 Kio | `be6ecf214c4053a1f88dcc0c00b8e6116bb1e135` | MAME 0.289 ROMs (merged) |
| `superpac.zip` | jeu | `superpac` | 27.3 Kio | `6a32d0569255d7d278300d292c901395c6112d5b` | MAME 0.289 ROMs (merged) |
| `todruaga.zip` | jeu | `todruaga` | 70.6 Kio | `cd3dcc4854831fb4dd9c29818588c86934e2d8eb` | MAME 0.289 ROMs (merged) |
| `pacland.zip` | jeu | `pacland` | 182.5 Kio | `1721db5741a0850d77edb5669e1d7729d526f1fb` | MAME 0.289 ROMs (merged) |
| `galaga88.zip` | jeu | `galaga88` | 719.9 Kio | `a80edcf8e8d78b4371ed6fc1f46d78e31af28802` | MAME 0.289 ROMs (merged) |
| `dspirit.zip` | jeu | `dspirit` | 1.2 Mio | `1a8ca59d90c3d69566d0a208cea021dc8e6c5e8a` | MAME 0.289 ROMs (merged) |
| `motos.zip` | jeu | `motos` | 38.1 Kio | `7498a168d5e6e5b0185219bf3b8ad8fe7d4cfba3` | MAME 0.289 ROMs (merged) |
| `rthunder.zip` | jeu | `rthunder` | 504.8 Kio | `4e09354b4813d4f0f6fda7ba571bca92454d8e0a` | MAME 0.289 ROMs (merged) |
| `splatter.zip` | jeu | `splatter` | 1.2 Mio | `7536a20094481a07a1627f6bd23760859de0ab54` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest ~/.mame/roms --markdown docs/STARTER-PACK-4-ROMS.md \
    --title "Starter pack 4 — Namco : sélection de ROMs" \
    puckman galaga galaxian digdug digdug2 mappy polepos xevious rallyx nrallyx bosco superpac todruaga pacland galaga88 dspirit motos rthunder splatter
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
