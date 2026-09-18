# Splash screen en plein écran sur le cabinet (Raspberry Pi)

Statut : **pas prioritaire**, noté le 2026-09-18. Hypothèse non vérifiée sur la Pi.

## Symptôme

Sur le cabinet (Debian arm64, Raspberry Pi), le splash screen s'affiche en plein
écran alors qu'il devrait être une petite fenêtre (346×354) centrée.

## Ce qu'est le splash

- `src/views/Init.vue` : route `/init`. Fond noir + `src/assets/splash_screen_arcade.png`,
  et un message d'erreur si le bootstrap de la base échoue.
- La fenêtre est créée par `createSplashWin()` (`src/background.ts`) : `frame: false`,
  fond `#000000`, **aucune taille donnée** (défaut Electron 800×600).
- `Init.vue` la redimensionne à l'exécution : `setResizable(true)`, `setFullScreen(false)`,
  `setSize(346, 354)`, `center()`.
- C'est **la même `BrowserWindow`** qui sert ensuite à `Home` (`loadPath(win, 'init')`
  puis navigation vers `/home`). `Home.vue` la passe en plein écran si
  `config.fullscreen`, sinon `setSize(1280, 720)` + `center()`.

## Cause probable

Le cabinet lance, dans `~/.xinitrc` :

```sh
matchbox-window-manager -use_titlebar no &
exec /home/puckman/squashfs-root/AppRun
```

Matchbox est un gestionnaire de fenêtres de type kiosque : il agrandit à l'écran
toute fenêtre de type « normal » et ignore les demandes de taille/position du
client. `setSize()` et `center()` sont donc sans effet ; sur un bureau classique
(macOS, GNOME…) ils fonctionnent, d'où l'absence du problème en dev.

## Piste de correction

1. Créer la fenêtre du splash avec `type: 'splash'` (sous Linux, Electron pose
   `_NET_WM_WINDOW_TYPE_SPLASH`, que matchbox est censé respecter : fenêtre centrée à sa
   taille au lieu d'être maximisée), et lui donner sa taille dès la création
   (`width: 346, height: 354`) plutôt que par `setSize()` après coup.
2. `type` ne se change pas après création, et la fenêtre est réutilisée par `Home` :
   `Home` risquerait d'hériter du comportement splash. Le plus propre est donc une
   **fenêtre dédiée au splash**, fermée quand `Home` est prêt (changement plus large
   dans `background.ts` : le flux `loadPath(win, 'init')` du callback BO et la gestion
   de `win` sont à revoir).

## À vérifier

- Que matchbox respecte bien `_NET_WM_WINDOW_TYPE_SPLASH` (à tester sur la Pi, pas
  vérifiable en dev sur x86).
- Que `Home` se met bien en plein écran depuis une fenêtre fraîche sous matchbox.
- Test = rebuild d'un AppImage arm64 + déploiement sur la Pi (`puckman@192.168.1.136`).
  L'AppImage est extraite dans `~/squashfs-root`, lancée par `startx` ; un reboot
  relance l'app.
