# Refonte UX du BO (back-office)

Feuille de route pour rendre le BO (`src/boServer.ts`, servi sur
`BO_SERVER_PORT` = 3131, accessible depuis tout le LAN) utilisable par des
personnes non techniques (typiquement : un ami ou un proche qui aide une
fois à configurer une borne, pas un utilisateur régulier).

## Constat de départ (2026-09-22)

Le BO est un unique fichier Express (~7400 lignes) qui génère du HTML par
concaténation de strings : ~55 fonctions `render*Card`/`render*Page`, 49
routes, **un seul bloc `<style>`** partagé par toutes les pages
(`renderPageHead()`, `src/boServer.ts:1388`).

Points forts déjà en place (à ne pas casser) :
- Feedback de soumission (bouton désactivé + relabel) sur chaque `<form>`
  (`renderPageTail()`, `src/boServer.ts:2152`).
- Persistance du sous-onglet actif et de la position de scroll après un
  POST classique (même fonction).
- Confirmations JS avant les suppressions (`confirm()` avec le détail de ce
  qui va être supprimé) dans les Danger Zones.
- Beaucoup de boutons icône ont déjà un `aria-label`
  (`renderIconButton()`, `src/boServer.ts:4147`).

Faiblesses identifiées :
- **Pas de design system** : couleurs/espacements copiés à la main dans
  chaque `render*`, incohérences qui s'accumulent à chaque feature.
- **Contraste texte/fond non garanti** : les cartes (`.card`) sont un
  calque noir à 55 % d'opacité au-dessus d'une photo de fond en mosaïque —
  dans les zones claires de la photo, le texte blanc peut passer sous le
  ratio WCAG AA.
- **Aucune hiérarchie visuelle entre actions normales et destructrices** :
  "Delete the selection" (Danger Zone) a exactement le même style de
  bouton blanc que "Save" (`src/boServer.ts:2538`, `:3424`).
- **Nav pas accessible** : les onglets principaux n'ont pas
  `aria-current`, les sous-onglets (`renderSubtabbedPage()`,
  `src/boServer.ts:1348`, vrai pattern d'onglets côté client) n'ont pas les
  rôles ARIA (`tablist`/`tab`/`tabpanel`).
- **Focus clavier incomplet** : `input`/`select` ont un anneau de focus
  visible, pas les `button`/liens.
- **Cibles tactiles trop petites** : `.icon-button` fait ~26px de côté
  (padding 5px + icône 16px), sous les ~40-44px recommandés — gênant sur
  téléphone/tablette, or le BO est justement accessible depuis le LAN.
- **Jargon MAME non expliqué** : "cfg, nvram, snapshots", "plugin.ini",
  "mhiex"... compréhensible pour un dev, opaque pour un proche qui aide une
  fois. Pas de glossaire ni d'aide contextuelle.
- **Zéro test** sur `boServer.ts` (`tests/` n'a rien dessus) : tout
  refactor UI se fait sans filet.
- **Une action se rejoue au F5** (corrigé, voir Phase 0bis) : chaque route
  POST répondait directement avec la page re-rendue
  (`res.send(await renderFavoritesTab(...))`), sans Post/Redirect/Get - le
  navigateur restait donc sur l'URL du POST, et rafraîchir la page
  rejouait l'action (suppression, vote, sauvegarde...).

## Approche retenue

Refonte **incrémentale**, on garde le rendu serveur (pas de bascule vers
une SPA Vue pour l'instant — trop de flux à ré-architecturer : sessions,
progress bars streamées, uploads multipart — à reconsidérer plus tard si le
design system serveur montre ses limites).

Public cible principal pour les choix de clarté/langage : quelqu'un qui
aide une fois, pas un habitué — donc priorité au langage simple, aux
confirmations explicites et aux valeurs par défaut sûres plutôt qu'à la
densité d'information.

## Phases

### Phase 0 — Fondations (ce chantier)
Aucun changement de logique métier, uniquement le socle visuel/accessible
partagé par tous les écrans :
- Design tokens CSS (`:root` custom properties : couleurs, espacements,
  rayons) à la place des valeurs codées en dur.
- Contraste des `.card` remonté pour rester lisible quelle que soit la zone
  de la photo de fond derrière.
- `:focus-visible` sur tous les éléments interactifs (pas seulement
  `input`/`select`).
- Classe `.button-danger` distincte pour les actions irréversibles
  (Danger Zones), au lieu du même bouton blanc que "Save".
- Lien d'évitement ("Skip to content") + landmark `<main>`.
- `aria-current="page"` sur l'onglet principal actif ; rôles ARIA
  (`tablist`/`tab`/`tabpanel`) sur les sous-onglets.
- Cibles tactiles des boutons icône remontées à ~40px.

### Phase 0bis — Actions en arrière-plan (ce chantier)
Corrige "un F5 rejoue l'action" en interceptant les formulaires côté client
au lieu de toucher aux ~30 routes POST une par une :
- Un unique `document.addEventListener('submit', ...)` dans
  `renderPageTail()` intercepte tout `<form method="post">`, poste en
  `fetch()`, puis remplace le document entier (`document.open/write/close`)
  par la réponse - qui est déjà exactement le HTML qu'un GET aurait rendu.
  L'URL affichée ne bouge jamais : F5 relance un GET, jamais l'action.
- Si la réponse est un vrai `res.redirect()` (login, logout, `/repo/save`),
  `fetch()` le suit et `response.redirected`/`response.url` disent où :
  dans ce cas une vraie navigation (`location.href = response.url`) est
  faite à la place, pour que l'URL affichée soit correcte.
- Exclu (attribut `data-stream` sur le `<form>`, laissé en navigation
  classique) : les 5 routes dont la réponse est un flux `res.write()`
  affiché progressivement (`/import`, `/import/from-url`,
  `/favorites/refresh`, `/favorites/download-media`,
  `/maui/update/install`) - un remplacement en bloc à la fin du fetch
  perdrait le journal de progression en direct. Elles gardent le problème
  du F5 pour l'instant.
- L'upload d'avatar (`onchange="this.form.submit()"`) est passé à
  `requestSubmit()` : `submit()` ne déclenche pas l'évènement `submit` (une
  bizarrerie du DOM), donc l'interception ne s'appliquait pas.

### Phase 1 — Clarté du contenu (à planifier)
- Glossaire/info-bulles pour le jargon MAME (bouton "?" à côté des termes
  techniques plutôt que de réécrire toute la terminologie).
- Simplifier le vocabulaire des Danger Zones et des formulaires MAME/MAUI
  (reformuler pour quelqu'un qui ne sait pas ce qu'est un `.ini`).
- États vides et messages d'erreur reformulés en langage clair + une action
  suggérée (pas juste "erreur : ...").

### Phase 2 — Écran par écran (à planifier, ordre à confirmer)
Reprendre chaque onglet avec le design system de la Phase 0 : hiérarchie
visuelle claire (carte principale vs. secondaire), wizard pas-à-pas pour
les flux complexes (device probing, remap manette par jeu, import de
packs), retours visuels progressifs au lieu de rechargements de page bruts
là où c'est facile à faire sans casser le fallback non-JS.

### Phase 3 — Tests de régression visuelle/fonctionnelle
Ajouter une couverture Vitest minimale sur les fonctions `render*` (rendu
HTML pur, testable sans Electron) avant d'aller plus loin dans le
refactor, pour arrêter de travailler sans filet.

## Suivi

- [x] Phase 0 — fondations (branche `feat/bo-ux-foundations`)
- [x] Phase 0bis — actions en arrière-plan (branche `feat/bo-ux-foundations`)
- [ ] Phase 1 — clarté du contenu
- [ ] Phase 2 — écran par écran
- [ ] Phase 3 — tests de régression
