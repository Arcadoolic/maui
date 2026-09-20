# Starting packs — inventaire et reste à faire

Point d'entrée des starting packs thématiques (favoris + ROMs + artwork). Chaque pack a sa
copie de ROMs figée dans `docs/STARTER-PACK-<n>-ROMS.md` (générée par `scripts/select-roms.py`),
et le zip final est publié sur le dépôt HTTP décrit dans [STARTER-PACK-REPO.md](STARTER-PACK-REPO.md).

État au 2026-09-20 : 18 packs préparés, 17 publiés sur le dépôt (`index.json`, 274 jeux uniques,
aucun jeu dans deux packs).

## Packs

| # | Thème | Fichier du dépôt | Jeux | Doc de copie |
|---|---|---|---|---|
| 1 | Donkey Kong & co | `nintendo-pack` | 10 | [1](STARTER-PACK-1-ROMS.md) |
| 2 | Vs. System | `nintendo-nes-pack` | 6 | [2](STARTER-PACK-2-ROMS.md) |
| 3 | Sega | `sega-pack` | 14 | [3](STARTER-PACK-3-ROMS.md) |
| 4 | Namco | `namco-pack` | 19 | [4](STARTER-PACK-4-ROMS.md) |
| 5 | Neo Geo | `neogeo-pack` | 17 | [5](STARTER-PACK-5-ROMS.md) |
| 6 | Capcom | `capcom-pack` | 31 | [6](STARTER-PACK-6-ROMS.md) |
| 7 | Konami | `konami-pack` | 22 | [7](STARTER-PACK-7-ROMS.md) |
| 8 | Atari | `atari-pack` | 24 | [8](STARTER-PACK-8-ROMS.md) |
| 9 | Data East | `data-east-pack` | 14 | [9](STARTER-PACK-9-ROMS.md) |
| 10 | Taito | `taito-pack` | 7 | [10](STARTER-PACK-10-ROMS.md) |
| 11 | Midway | `midway-pack` | 15 | [11](STARTER-PACK-11-ROMS.md) |
| 12 | Centuri | `centuri-pack` | 10 | [12](STARTER-PACK-12-ROMS.md) |
| 13 | Williams | `williams-pack` | 12 | [13](STARTER-PACK-13-ROMS.md) |
| 14 | Nichibutsu | `nitchibutsu-pack` (sic) | 25 | [14](STARTER-PACK-14-ROMS.md) |
| 15 | Gremlin | `gremlin-pack` | 9 | [15](STARTER-PACK-15-ROMS.md) |
| 16 | SNK (Neo Geo 2, complète le 5) | `snk-pack` | 20 | [16](STARTER-PACK-16-ROMS.md) |
| 17 | Jaleco | `jaleco-pack` | 19 | [17](STARTER-PACK-17-ROMS.md) |
| 18 | Irem | *pas encore publié* | 12 | [18](STARTER-PACK-18-ROMS.md) |

Le thème d'un pack est celui du studio demandé, pas une règle stricte : les packs 12, 14 et 17
mélangent des jeux de plusieurs éditeurs (Centuri, Nichibutsu et Jaleco sont surtout des noms de
distributeurs ou de lots). Les noms de fichiers du dépôt sont ceux des packs déjà publiés.

## Refaire un pack

1. Vider `~/.mame/roms` et `~/.mame/ui/favorites.ini` (MAME réécrit ce fichier à sa sortie : aucun
   `mame` ne doit tourner pendant qu'on le modifie).
2. Vérifier les noms avec `mame -listfull <nom>`. Une liste collée contient souvent des noms qui ne
   sont pas des shortnames MAME (voir « Noms non résolus » ci-dessous) : les mapper et le dire.
3. Copier depuis la source réseau, en `--dry-run` d'abord :
   ```bash
   python3 -B scripts/select-roms.py --source /var/mnt/capsule-emulation/Mame_0289 \
       --dest ~/.mame/roms --markdown docs/STARTER-PACK-<n>-ROMS.md \
       --title "Starter pack <n> — <thème> : sélection de ROMs" <noms>
   ```
   Le script résout parents, BIOS et devices via `mame -listxml` et ne copie que des zips.
4. Vérifier : `mame -rompath ~/.mame/roms -verifyroms <noms>`. « best available » (NO GOOD DUMP /
   NEEDS REDUMP) est acceptable, « bad » ne l'est pas.
5. Écrire les favoris avec `add_games_to_favorites()` de `scripts/import-starting-pack.py`,
   uniquement pour les jeux demandés (jamais les BIOS, devices ou parents ajoutés en dépendance).
6. Récupérer les visuels ScreenScraper depuis l'app, puis `just starting-pack`.
7. Publier le zip sur le dépôt (STARTER-PACK-REPO.md, section 3).

## Jeux écartés : CHD absents

Le partage ne contient aucun CHD. Un jeu qui en a besoin est « bad » à la vérification : son zip est
supprimé et il reste hors pack.

- CPS3 : les sets `sfiii*` et `redearth` (pack 6 Capcom).
- `blitz` (NFL Blitz, Midway) — pack 11.
- `tsurugi` (Konami Viper, avec le BIOS `kviper`) — pack 17.

Pour les récupérer : trouver les CHD, les poser à côté des zips, puis les ajouter au pack.

## Noms non résolus

Noms collés qui n'existent pas dans MAME 0.289, en attente d'une réponse :

- `f1circus` — pack 14.
- `basesld` — pack 17.

Noms remplacés par un shortname (à revérifier en cas de doute) :

- `munchmo` → `mnchmobl` (Munch Mobile, driver `munchmo`) — pack 12.
- `yard` → `10yard` (10-Yard Fight, World set 1) — pack 18.
- `pbobblen` (pack 10) est la version Neo Geo de Puzzle Bobble, pas l'arcade Taito `pbobble`.

## Ce qu'il reste à couvrir

Analyse du 2026-09-20 : jeux d'arcade « parents » de MAME 0.289, avec zip sur le partage, comparés
aux manifests du dépôt. Les jeux d'argent (IGT, Aristocrat, Merit, Amcoe, Cal Omega, une partie
d'IGS), les bootlegs et les machines sans éditeur sont volontairement ignorés.

**Studios sans aucun jeu dans le dépôt**

| Studio | Jeux sur le partage | Exemples |
|---|---|---|
| Toaplan | 28 | `tigerh`, `fshark`, `twincobr`, `truxton`, `zerowing`, `outzone`, `batsugun`, `vimana` |
| Technos Japan | 28 | `ddragon`, `ddragon2`, `renegade`, `spdodgeb`, `vball`, `wwfsstar`, `wwfwfest`, `xsleena` |
| Tecmo | 37 | `rygar`, `wildfang`, `silkworm`, `gemini`, `solomon` |
| Kaneko | 42 | `berlwall`, `gtmr`, `gtmr2`, `bonkadv`, `shogwarr` |
| Cave | 23 | `donpachi`, `ddonpach`, `esprade`, `guwange`, `mushisam`, `ket` |
| Psikyo | 23 | `gunbird`, `gunbird2`, `s1945`, `s1945ii`, `tengai`, `samuraia` |
| Seibu Kaihatsu | 25 | `raiden`, `raiden2`, `raidendx` |
| Video System | 26 | `aerofgt`, `pspikes`, `crshrace` |
| Mitchell | 21 | `pang`, `spang` |
| Gaelco | 25 | `bigkarnk`, `thoop2`, `wrally`, `biomtoy` |
| Cinematronics | 23 | `starcas`, `tailg`, `armora`, `sundance`, `barrier`, `spacewar` |
| Universal | 21 | `mrdo`, `ladybug`, `cosmicg`, `zerohour` |
| Seta, Sammy, Banpresto, Visco | 22, 21, 26, 40 | pas vérifiés titre par titre |

**Studios présents mais peu couverts** (jeux dans le dépôt / jeux sur le partage)

- Exidy : 1 / 34 (`mtrap`, `venture`, `crossbow`, `pepper2`).
- Taito : 7 / 206.
- Konami : 19 / 257.
- Sega : 13 / 225.
- Namco : 19 / 196.
- Capcom : 31 / 122, SNK : 29 / 120, Data East : 10 / 118.
- Irem : 12 dans le pack 18 (non publié) / 57.

**Neo Geo** : 165 parents dans MAME, 37 dans les packs 5 et 16, il en reste 128 sur le partage.
Manques les plus visibles : `rbff1`, `rbff2`, `rbffspec`, `lastbld2`, `kof2003`, `mslug4`, `mslug5`,
`samsho5`, `samsh5sp`, `svc`, `matrim`, `sengoku` à `sengoku3`, `blazstar`, `kotm`, `kotm2`,
`ssideki` à `ssideki4`, `wakuwak7`, `pulstar`, `puzzledp`, `magdrop2`, `magdrop3`, `pbobbl2n`.

Ordre d'attaque proposé : autres jeux Irem restants, puis shoot'em up (Toaplan, Cave, Psikyo), puis
beat'em up et action (Technos, Tecmo, Kaneko, Seibu), puis le reste (Mitchell, Video System, Gaelco,
Cinematronics, Universal).
