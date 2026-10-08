# Lag de l'interface sur Raspberry Pi

Analyse des causes probables du lag observé sur Raspberry Pi (CPU ARM, GPU
limité), constaté en usage normal (navigation dans la liste de jeux).

Toutes les références sont au format `fichier:ligne` relatif à la racine du
dépôt.

## Résumé

Le facteur le plus probable est la combinaison de deux choses qui
s'aggravent l'une l'autre :

1. La liste de jeux est rendue en entier dans le DOM, sans virtualisation
   (fenêtrage).
2. Chaque ligne de cette liste applique des effets CSS coûteux (`blur`,
   `saturate`, `box-shadow`), pas seulement la ligne sélectionnée.

Sur un GPU faible comme celui d'un Raspberry Pi, ce combo peut faire
basculer Chromium en rendu logiciel, ce qui aggrave encore la situation.

## 1. Rendu de la liste de jeux — pas de virtualisation

`src/components/Games.vue:8` — le tableau `games` est rendu en entier avec
`v-for`, sans fenêtrage (aucune lib comme `vue-virtual-scroller` dans
`package.json`). Pour une grosse romlist (centaines/milliers d'entrées),
toutes les lignes restent vivantes dans le DOM, y compris celles hors
écran. La sélection se fait en animant `top` sur toute la liste
(`src/components/Games.vue:52-56`) plutôt qu'en ne rendant que les lignes
visibles.

C'est le facteur le plus susceptible d'être GPU-bound sur le Pi : plus la
romlist est grande, plus le lag augmente.

## 2. Effets CSS coûteux appliqués à toutes les lignes

- `src/components/Games.vue:161` — `box-shadow: 0 0 30px #000000` sur
  `.marquee`
- `src/components/Games.vue:177` — `filter: saturate(2)` sur `.marqueeArt`
- `src/components/Games.vue:193` — `filter: blur(8px) brightness(0.6)` sur
  `.flyerLogoFallback .flyerBackground`

`filter: blur()` est l'un des effets CSS les plus coûteux à calculer.
Comme ces styles ne sont pas limités à la ligne sélectionnée, le
compositeur doit les recalculer pour toutes les lignes visibles
simultanément.

Autres effets, moins impactants :
- `src/views/Home.vue:293-303` — 6 couches de `text-shadow` +
  `filter: saturate(1.3)` sur les titres.
- `src/views/Home.vue:264-270` — fond `background.jpg` en 3457x1512px
  (1,4 Mo) avec `background-size: cover`.
- `src/components/Hiscores.vue:82` — `box-shadow: 0 0 65px rgb(0,0,0)`,
  actif uniquement quand le panneau hiscores est affiché.

Aucun usage de `backdrop-filter` dans le code.

## 3. Artwork chargé en pleine résolution, sans lazy-loading

Chaque ligne charge son image marquee/flyer via un chemin `file://`
(`src/components/Games.vue:71-78`), sans `loading="lazy"` ni
redimensionnement. Les scans utilisés sont en résolution native, décodés
pour chaque ligne même si elle est hors écran.

## 4. Polling manette à 60 Hz en continu, même sans manette branchée

`src/class/Gamepads.class.ts:153` — la boucle de polling se
replanifie elle-même via `requestAnimationFrame`, donc au rythme de
rafraîchissement de l'écran (~60 Hz).

`src/views/Home.vue:266` démarre ce polling sans vérifier qu'une manette
est effectivement connectée (`Gamepads.class.ts:44-51`). Résultat :
~60 appels JS/seconde en continu tant que `Home.vue` est monté, même sans
aucune manette branchée — une charge constante qui entre en concurrence
avec le rendu.

Les événements `CustomEvent` dispatchés (`Gamepads.class.ts:118-124,
141-148`) ne le sont, eux, que sur changement d'état d'un bouton/axe — pas
à chaque frame, donc peu coûteux en soi.

## 5. Pas de réglage GPU explicite + pas de sandbox/isolation

`src/background.ts:119-122` — `webPreferences` avec `nodeIntegration:
true, contextIsolation: false, sandbox: false`. Aucun switch GPU
(`app.disableHardwareAcceleration()` ou équivalent) n'est configuré nulle
part dans le dépôt (confirmé par recherche sur `src/`).

Sur un Pi, le GPU n'est pas toujours bien pris en charge par Chromium, qui
peut alors basculer silencieusement en rendu logiciel (SwiftShader) — ce
qui rend les filtres du point 2 encore plus coûteux.

L'absence de sandbox/isolation signifie aussi que tout code Node
synchrone s'exécute sur le même thread que le rendu :
- `src/class/MameService.class.ts:38-42` — `execFileSync(mame,
  ['-showconfig', ...])` à chaque lancement de l'app (démarrage
  uniquement).
- `src/class/MameService.class.ts:100-106` — `execFileSync(mame,
  ['-lx', romName, ...])` par ROM non encore en base, pendant un import
  (pas en navigation normale).

Ces appels bloquent le thread du renderer pendant leur exécution, plus
long sur un CPU ARM que sur une machine de dev — mais ils n'affectent que
le démarrage/import, pas le lag en navigation continue.

## 6. SQLite / base de données — pas un facteur de lag en continu

`src/class/Database.class.ts` utilise `sequelize` + `sqlite3` (binding
async, pas `better-sqlite3`) — les requêtes ne bloquent pas l'event loop.
`sequelize.sync()` (`:39-41`) et les migrations Umzug (`:70-97`)
s'exécutent au démarrage, pas pendant la navigation. Le seul point
d'attention Pi-spécifique est que `sqlite3` est un module natif à
recompiler pour ARM64 (`just rebuild` existe pour ça dans `package.json`),
ce qui peut affecter le temps de démarrage/import mais pas le lag en
régime établi.

## Pistes de correction, par ordre d'impact attendu

1. Virtualiser la liste de jeux (`Games.vue`) pour ne rendre que les
   lignes visibles.
2. Limiter `box-shadow` / `filter: saturate` / `filter: blur` à la seule
   ligne sélectionnée, au lieu de toutes les lignes.
3. Lazy-loader les images marquee/flyer, ou les redimensionner en amont.
4. Ne démarrer le polling gamepad (`requestAnimationFrame`) que si au
   moins une manette est détectée connectée (`gamepadconnected` event),
   et le suspendre sinon.
5. Envisager `app.disableHardwareAcceleration()` en test pour comparer si
   le rendu logiciel forcé est plus stable qu'un fallback GPU
   partiellement supporté sur le Pi — à valider empiriquement, ça peut
   aussi aller dans l'autre sens.

## Raspberry Pi 3 Model B (1 Go) — mesures du 2026-10-07

Borne `arcade-frogger` : Pi 3 Model B Rev 1.2, 905 Mio de RAM, Debian 13 arm64,
MAUI 2.6.0, MAME 0.289 (Homebrew), X en 1152x864 (mode choisi par X, l'écran
propose aussi 1920x1080 et 1280x720). 62 favoris, 10 marquees de 1200 px de
large.

### Écran d'accueil au repos, sans jeu lancé

| Processus | CPU | RSS |
|---|---|---|
| Electron GPU (`VizCompositorThread`) | 92 % | 125 Mo |
| Electron renderer (`Compositor` 27 %, thread principal 18 %) | 58 % | 191 Mo |
| Electron main (BO, ONLINE, scores) | 3 % | 181 Mo |
| Xorg | 2 % | 93 Mo |

Chromium tourne en rendu logiciel (le processus GPU est lancé avec
`--use-gl=disabled`) : chaque image est composée par le CPU. Et l'écran n'est
jamais au repos : l'animation infinie du badge ONLINE (`online-halo`,
`src/components/OnlineBadge.vue`) redemande une image 60 fois par seconde. Un
cœur et demi sur quatre part donc dans un écran immobile.

Le BO, lui, ne coûte rien en CPU tant que personne ne l'ouvre (3 % pour tout le
processus principal).

### Pendant un jeu

`gng` lancé en plein écran (`-str 30 -nothrottle`) : les processus Electron
disparaissent du haut de `top`, MAME prend 92 % d'un cœur et Xorg 8 %. Chromium
cesse de produire des images quand sa fenêtre est recouverte : le front ne vole
pas de CPU à MAME, inutile de le mettre en pause à la main.

### Vitesse de MAME

| Jeu | Sans vidéo (`-bench 30`) | Avec vidéo, 1152x864 |
|---|---|---|
| `dkong` | 259 % | |
| `gng` | 215 % | 136 % |
| `bublbobl` | 160 % | |

L'affichage coûte cher : `gng` perd un tiers de sa vitesse entre l'émulation
seule et l'image à l'écran. C'est la marge que la résolution peut rendre.

### Ce qui en découle

- Mode **Lite** du front (`src/class/UiMode.ts`, réglage « Interface » de
  l'onglet MAUI du BO, automatique sous 2 Gio de RAM ou en rendu logiciel) :
  même écran, sans animation infinie, transitions, filtres ni ombres floues,
  fond réduit à 1280 px, fenêtre de 13 lignes au lieu de 41 dans la liste.
- **Mode d'écran** (`src/class/DisplayMode.ts`, réglage « Screen mode » du même
  onglet, sur borne dédiée seulement) : appliqué par `xrandr` au démarrage,
  avant l'ouverture de la fenêtre. « Automatic » plafonne à 1080 lignes, et à
  720 en mode Lite ; MAME suit le mode du bureau. Sur ce Pi 3, le réglage
  automatique passe donc de 1152x864 à 1280x720.
- **BO à la demande** (`src/boCore.ts`, `src/class/BoOnDemand.ts`) : express et
  les pages du BO ne sont plus chargés au démarrage. Le port 3131 reste ouvert ;
  la première requête charge le BO (comme les touches scores + nouveau joueur
  tenues 2 s sur la borne, qui affichent aussi son adresse), et il est relâché
  après 15 minutes sans requête (réglage de l'onglet MAUI). Le gain est en
  mémoire, pas en CPU. Node ne décharge pas le code d'un module : seul un
  redémarrage de l'application rend tout.

### Résultats sur le Pi, build de test du 2026-10-07

Mode Lite et mode d'écran automatiques (aucun réglage touché), BO jamais ouvert
depuis le démarrage :

| | Avant (2.6.0, 1152x864) | Après (Lite, 1280x720) |
|---|---|---|
| CPU total au repos sur l'écran d'accueil | ~37 % des 4 cœurs occupés | 99 % d'inactivité |
| Processus principal, RSS | 181 Mo | 172 Mo |
| Processus principal, RSS une fois le BO chargé | (toujours chargé) | 183 Mo |

Le mode Lite rend à lui seul le cœur et demi que l'écran d'accueil consommait.
Le BO à la demande rend une dizaine de Mo et se charge en 0,9 s à la première
requête : un gain réel mais modeste, comme attendu.

### Étude 720p

`-str 30 -nothrottle`, front Lite affiché derrière, même session :

| Jeu | 1920x1080 | 1280x720 | Écart |
|---|---|---|---|
| `dkong` | 123 % | 145 % | +18 % |
| `gng` | 115 % | 132 % | +15 % |
| `bublbobl` | 100 % | 109 % | +9 % |

À 1080 lignes `bublbobl` n'a plus aucune marge sur un Pi 3 ; à 720 il en
retrouve un peu. 1280x720 fait à peu près le même nombre de pixels que le
1152x864 d'origine (`gng` : 136 % avant, 132 % après), donc le passage
automatique à 720p ne coûte rien et donne une image 16:9. « Automatic » reste
donc à 720 lignes en mode Lite, et 1080p est à éviter sur ce matériel.

Reste à essayer : l'accélération GPU de Chromium (`--ignore-gpu-blocklist
--use-gl=angle --use-angle=gles-egl`), devenue secondaire maintenant que
l'écran d'accueil ne coûte plus rien au repos.

### Vitesse des jeux des packs, mesure du 2026-10-08

Les 391 jeux des 22 packs du dépôt ont été mesurés un par un sur ce Pi 3 avec
`mame <rom> -bench 30` (sans affichage ni son réels, donc quelques points
au-dessus de la vitesse en jeu) : aucune erreur, pas de bridage thermique
(68 à 72 °C).

| Vitesse | Jeux | Part |
|---|---|---|
| Sous 100 % | 112 | 29 % |
| 100 à 120 % | 59 | 15 % |
| 120 % et plus | 220 | 56 % |

- Capcom, Nichibutsu, Tecmo, Centuri et Gottlieb passent presque entièrement.
- Irem (34 sur 55) et Sega (24 sur 39) sont en majorité trop lents ; le Neo Geo
  est presque entièrement entre 100 et 120 %.
- `mwalk` (System 18) tourne à 52 %, et le saut d'images maximal ne le remonte
  qu'à 63 % : c'est l'émulation qui sature un cœur, pas le rendu.
- Des jeux très anciens sont parmi les plus lents (`pong` 37 %, `kungfum` 42 %,
  `ldrun` 41 %, `elim2` 29 %), sans doute à cause de leur son analogique (non
  vérifié) : une liste par système ne les aurait pas trouvés.

Seuls les jeux à 120 % ou plus sont proposés à une borne de cette classe
(2 Gio de mémoire ou moins, `src/class/GameSpeed.ts`). Les mesures sont dans
`scripts/pi3-speeds.json` de maui-repository, qui les écrit dans le manifeste de
chaque pack (`pi3Speeds`).
