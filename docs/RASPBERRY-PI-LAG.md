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
