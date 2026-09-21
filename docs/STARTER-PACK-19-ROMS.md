# Starter pack 19 — Tecmo : sélection de ROMs

Copie figée générée le 2026-09-20 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `~/.mame/roms`
- **Jeux demandés** : `bombjack`, `rygar`, `solomon`, `gaiden`, `tknight`, `starforc`, `gemini`, `silkworm`, `twcup90`, `gridiron`, `doa`, `guzzler`, `pbaction`, `riot`
- **Zips copiés** : 16 (40.6 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `bombjack.zip` | jeu | `bombjack` | 92.1 Kio | `69fd292c453b25011bbdf0e85a130c36bbee91f4` | MAME 0.289 ROMs (merged) |
| `rygar.zip` | jeu | `rygar` | 350.6 Kio | `dd9a5afe7e29936a579612aec53c0e54e78e4823` | MAME 0.289 ROMs (merged) |
| `solomon.zip` | jeu | `solomon` | 144.3 Kio | `1afe8b130a405acf50ed6f8edaf870533525bd59` | MAME 0.289 ROMs (merged) |
| `shadoww.zip` | parent | `gaiden` | 3.4 Mio | `4e99a32e031730f5314740c5829f8720a4b5d627` | MAME 0.289 ROMs (merged) |
| `wildfang.zip` | parent | `tknight` | 1.5 Mio | `1ee16026117305a88ebef64cb4d9b8f3d0a967a0` | MAME 0.289 ROMs (merged) |
| `starforc.zip` | jeu | `starforc` | 213.2 Kio | `45da4a6258f65492364ae7986d356f4652c54974` | MAME 0.289 ROMs (merged) |
| `gemini.zip` | jeu | `gemini` | 444.0 Kio | `76e471ae861f95667d65318dc0d5d472299a67cf` | MAME 0.289 ROMs (merged) |
| `silkworm.zip` | jeu | `silkworm` | 558.4 Kio | `133b2ea3e09df2a882d6972d671116f668a0abfc` | MAME 0.289 ROMs (merged) |
| `twcup90.zip` | jeu | `twcup90` | 1.3 Mio | `ac8857b812571bc4caa7513c4b92225e46375d6a` | MAME 0.289 ROMs (merged) |
| `ym2608.zip` | device | `twcup90` | 7.4 Kio | `06fc753d015b43ca1787f4cfd9331b1674202e64` | MAME 0.289 ROMs (bios-devices) |
| `gridiron.zip` | jeu | `gridiron` | 142.1 Kio | `88de199b4e8ed8137b6e7302d61c0341bb120ac1` | MAME 0.289 ROMs (merged) |
| `doa.zip` | jeu | `doa` | 30.6 Mio | `6f7d08a0bdec900b8224e70f2ac868e44eddca09` | MAME 0.289 ROMs (merged) |
| `segabill.zip` | device | `doa` | 3.0 Kio | `4631db7f7f5160a3a6591d3102722be869710f66` | MAME 0.289 ROMs (bios-devices) |
| `guzzler.zip` | jeu | `guzzler` | 61.0 Kio | `7eaef9e6b27b25e620b0f8770fdc49d78194a130` | MAME 0.289 ROMs (merged) |
| `pbaction.zip` | jeu | `pbaction` | 267.0 Kio | `29a5c05b64f22422cde8b26d982e3794f1e31d03` | MAME 0.289 ROMs (merged) |
| `riot.zip` | jeu | `riot` | 1.5 Mio | `dae336b0f00f6c9b460576ff8fa63bd4cfb3d7f4` | MAME 0.289 ROMs (merged) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest ~/.mame/roms --markdown docs/STARTER-PACK-19-ROMS.md \
    --title "Starter pack 19 — Tecmo : sélection de ROMs" \
    bombjack rygar solomon gaiden tknight starforc gemini silkworm twcup90 gridiron doa guzzler pbaction riot
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
