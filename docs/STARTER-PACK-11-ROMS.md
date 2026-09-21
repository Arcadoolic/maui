# Starter pack 11 — Midway : sélection de ROMs

Copie figée générée le 2026-09-20 par `scripts/select-roms.py` (MAME 0.289). Ne contient que les zips de ROMs nécessaires : ni artwork, ni flyers, marquees ou logos.

- **Source** : `/var/mnt/capsule-emulation/Mame_0289`
- **Destination** : `~/.mame/roms`
- **Jeux demandés** : `mk`, `mk2`, `mk3`, `umk3`, `nbajam`, `nbajamte`, `rampage`, `spyhunt`, `tapper`, `rbtapper`, `defender`, `joust`, `720`, `tron`, `crusnusa`
- **Zips copiés** : 17 (127.1 Mio)

## Zips copiés

| Zip | Rôle | Requis par | Taille | SHA-1 | Dossier source |
|---|---|---|---|---|---|
| `mk.zip` | jeu | `mk` | 29.6 Mio | `faa59cbca33c0efb5cdda8777e5b832302523a4b` | MAME 0.289 ROMs (merged) |
| `mk2.zip` | jeu | `mk2` | 16.4 Mio | `0d933a2e2e8006118b1900771a0509b47e64c219` | MAME 0.289 ROMs (merged) |
| `mk3.zip` | jeu | `mk3` | 21.0 Mio | `f680b7aa9b1c5673b39a9a8491735d0302f681f7` | MAME 0.289 ROMs (merged) |
| `umk3.zip` | jeu | `umk3` | 22.2 Mio | `4a73f29e6db47374a62d262bcef4d6287891881f` | MAME 0.289 ROMs (merged) |
| `nbajam.zip` | jeu | `nbajam` | 13.2 Mio | `186307b3be17d2db96c02c3fb03ed173b9368c69` | MAME 0.289 ROMs (merged) |
| `nbajamte.zip` | jeu | `nbajamte` | 7.7 Mio | `51d0b85cced87f8c63df25aa898991abd4be35fc` | MAME 0.289 ROMs (merged) |
| `rampage.zip` | jeu | `rampage` | 287.9 Kio | `edd84b3645bd954071a762c03a3365b4ec63a7e0` | MAME 0.289 ROMs (merged) |
| `spyhunt.zip` | jeu | `spyhunt` | 226.3 Kio | `d581b41ec43d5cd5edabbc37d9a5421dbef32605` | MAME 0.289 ROMs (merged) |
| `midssio.zip` | device | `rbtapper`, `spyhunt`, `tapper`, `tron` | 163 o | `54275c9833e497f71f76ab239030cc386c863991` | MAME 0.289 ROMs (bios-devices) |
| `midcsd.zip` | device | `spyhunt` | 222 o | `62b4fb2c960937bb08af4ce40f142c015c985e7b` | MAME 0.289 ROMs (bios-devices) |
| `tapper.zip` | jeu | `rbtapper`, `tapper` | 345.3 Kio | `0285616746369b487f1451985c65cd1d282a6138` | MAME 0.289 ROMs (merged) |
| `defender.zip` | jeu | `defender` | 196.1 Kio | `c5a6bcfbe02ad108143a5e2198ccb30ed22abfdd` | MAME 0.289 ROMs (merged) |
| `joust.zip` | jeu | `joust` | 65.9 Kio | `670aea785c0ce57f8626db4036840755a13c7eac` | MAME 0.289 ROMs (merged) |
| `720.zip` | jeu | `720` | 1.0 Mio | `8168e83c3898fa52aadd91728686989e5fd5c70d` | MAME 0.289 ROMs (merged) |
| `tron.zip` | jeu | `tron` | 173.3 Kio | `6507001eb96f1cbaf0e70dec3626d25baf0e5083` | MAME 0.289 ROMs (merged) |
| `crusnusa.zip` | jeu | `crusnusa` | 14.6 Mio | `8be186ecd42cd0108a766a76895fa80dbd50da4e` | MAME 0.289 ROMs (merged) |
| `tms320c31.zip` | device | `crusnusa` | 573 o | `ddadaf48004421e04838506d9c07bb9cfd3625c0` | MAME 0.289 ROMs (bios-devices) |

## Refaire la copie

```bash
python3 scripts/select-roms.py \
    --source /var/mnt/capsule-emulation/Mame_0289 --dest ~/.mame/roms --markdown docs/STARTER-PACK-11-ROMS.md \
    --title "Starter pack 11 — Midway : sélection de ROMs" \
    mk mk2 mk3 umk3 nbajam nbajamte rampage spyhunt tapper rbtapper defender joust 720 tron crusnusa
```

Vérifier qu'un set est complet : `mame -rompath <destination> -verifyroms <jeu>`.
