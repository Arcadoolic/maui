# Raspberry Pi 4 Model B — Debian Trixie 64 bits Lite : Installation MAME Awesome UI + MAME

**Contexte** : Debian 13 (Trixie) Lite arm64, sans environnement de bureau. Build
`electron-builder` AppImage arm64 déposé manuellement dans `/home/puckman` (pas
encore de target arm64 officiel dans `electron-builder.yml`, ce build est donc
"fait main" pour l'instant — voir `docs/RASPBERRY-PI-LAG.md` pour le contexte
plus large du support Raspberry Pi).

---

## 1. Installation de Homebrew (linuxbrew)

Nécessaire car MAME 0.289 n'est pas dispo (ou pas assez récent) dans les dépôts
Debian pour cette architecture.

```bash
sudo apt update
sudo apt install -y build-essential procps curl file git
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Ajoute Homebrew au PATH pour les futures sessions shell...
echo >> /home/puckman/.bashrc
echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv bash)"' >> /home/puckman/.bashrc
# ...et pour la session courante.
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv bash)"

sudo apt-get install build-essential
```

> ⚠️ Cette ligne dans `.bashrc` n'est lue que par les **shells interactifs**.
> Une session non-interactive (`ssh host cmd`) ne voit pas `mame` dans son
> `PATH`. Sans importance pour l'usage kiosk (cf. §4.4, `.bash_profile` source
> `.profile` → `.bashrc`), mais à garder en tête si un script/service lance
> `mame` directement.

## 2. Installation de MAME 0.289

```bash
brew install mame
```

Compilation depuis les sources pour arm64 : **très long** (plusieurs heures
sur un Pi 4). Le binaire se retrouve dans
`/home/linuxbrew/.linuxbrew/Cellar/mame/0.289/bin` — c'est ce chemin qu'il
faut renseigner dans la config MAUI (`mamePath` dans
`mame-awesome-ui-config.json`).

## 3. Dépendances système pour lancer l'AppImage

```bash
sudo apt install -y \
  zlib1g-dev libfuse2t64 \
  libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libcairo2 \
  libgtk-3-0t64 libpango-1.0-0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libxkbcommon0 libatspi2.0-0t64
chmod +x mame-awesome-ui-2.0.2-arm64.AppImage
```

Debian Lite ne fournit **aucun paquet desktop** par défaut, d'où la liste
longue. Détail de ce que chaque groupe corrige :

| Paquet | Pourquoi |
|---|---|
| `zlib1g-dev` | Le runtime AppImage fait un `dlopen("libz.so")` (nom **non versionné**) pour décompresser le squashfs. Debian ne fournit que `libz.so.1` (versionné) via `zlib1g` ; seul `zlib1g-dev` ajoute le symlink non versionné. |
| `libfuse2t64` | Le runtime AppImage (type 2) est basé sur l'ABI FUSE**2**. Debian 13 est passé à FUSE3 par défaut et ne livre plus `libfuse.so.2`. |
| `libatk*`, `libcups2t64`, `libcairo2`, `libgtk-3-0t64`, `libpango-1.0-0`, `libx{composite,damage,fixes,randr}*`, `libgbm1`, `libxkbcommon0`, `libatspi2.0-0t64` | Dépendances GTK/Chromium d'Electron, absentes car pas d'environnement de bureau sur Debian Lite. |

> 💡 Pour retrouver la liste exhaustive des libs manquantes d'un coup (plutôt
> qu'au fil des erreurs une par une) :
> ```bash
> ./mame-awesome-ui-2.0.2-arm64.AppImage --appimage-extract
> ldd squashfs-root/mame-awesome-ui | grep "not found"
> ```

## 4. Préparation de l'affichage (mode kiosk)

### 4.1 Extraction persistante de l'AppImage

```bash
rm -rf squashfs-root
# rien à supprimer, le dossier n'existait pas encore

./mame-awesome-ui-2.0.2-arm64.AppImage --appimage-extract
# crée ~/squashfs-root (persistant, ~300-400 Mo, contenu Electron extrait)
```

On extrait une fois pour toutes plutôt que de laisser l'AppImage se monter via
FUSE à chaque lancement : ça évite une dépendance à `/dev/fuse` / droits de
montage utilisateur à chaque boot, et le démarrage est plus rapide (pas de
ré-extraction).

### 4.2 Serveur X minimal + gestionnaire de fenêtres

```bash
sudo apt install -y xserver-xorg xinit x11-xserver-utils matchbox-window-manager
```

- `xserver-xorg` + `xinit` : le strict minimum pour avoir un serveur X, sans
  display manager complet (pas besoin de LightDM/GDM pour une seule appli en
  kiosk).
- `matchbox-window-manager` : **indispensable**, pas optionnel.
  `BrowserWindow.setFullScreen(true)` (utilisé dans `Home.vue`) passe par le
  hint X11 `_NET_WM_STATE_FULLSCREEN`, que seul un **window manager** applique
  (retrait des décorations, redimensionnement à l'écran). Sans WM, la fenêtre
  reste centrée à sa taille par défaut — symptôme observé : app lancée dans un
  petit carré au milieu de l'écran. `matchbox` est justement conçu pour de
  l'embarqué/kiosk single-app.

### 4.3 `~/.xinitrc`

```bash
cat > ~/.xinitrc << 'EOF'
#!/bin/sh
xset -dpms
xset s off
xset s noblank
matchbox-window-manager -use_titlebar no &
exec /home/puckman/squashfs-root/AppRun
EOF

chmod +x ~/.xinitrc
```

- `xset -dpms` / `s off` / `s noblank` : désactive la mise en veille de
  l'écran — indispensable pour une borne allumée en continu.
- `matchbox-window-manager` est lancé **en arrière-plan avant** l'app, pour
  qu'il soit prêt à honorer la demande de plein écran dès que la fenêtre
  Electron apparaît.
- `exec` remplace le shell par `AppRun` : quand l'app se ferme, la session X
  se termine proprement avec elle (pas de shell zombie qui traîne).

### 4.4 Démarrage automatique de X à la connexion (`~/.bash_profile`)

```bash
cat > ~/.bash_profile << 'EOF'
[ -f ~/.profile ] && . ~/.profile
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
    exec startx -- -nocursor
fi
EOF
```

- On source `~/.profile` en premier : c'est lui qui charge `~/.bashrc`, donc
  le `PATH` Homebrew (et `mame`) est bien disponible avant que l'app ne
  démarre.
- Le garde-fou `tty1` + `$DISPLAY` vide évite de redéclencher `startx` sur une
  session SSH classique (qui arrive sur un `pts/*`, pas `tty1`).

### 4.5 Autologin systemd sur tty1

```bash
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d

sudo tee /etc/systemd/system/getty@tty1.service.d/override.conf > /dev/null << 'EOF'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin puckman --noclear %I $TERM
EOF

sudo systemctl daemon-reload
sudo systemctl restart getty@tty1
```

Le premier `ExecStart=` (vide) est **obligatoire** : un drop-in systemd
*fusionne* avec l'unité parente par défaut. Sans le reset explicite, la
nouvelle ligne s'ajouterait à celle d'origine au lieu de la remplacer, et
`agetty` tenterait de démarrer deux fois sur le même tty (comportement
documenté dans `man systemd.service`, section *"assigning an empty string
resets the list"*).

> ⚠️ **Piège rencontré** : lancer `sudo systemctl restart getty@tty1` **avant**
> d'avoir installé `xserver-xorg`/`xinit` (§4.2) fait échouer `startx`
> instantanément dans `.bash_profile`. Comme il est appelé avec `exec`, la
> session de login se termine aussitôt → `agetty` relance en boucle → systemd
> bloque le service au bout de 5 tentatives (`start-limit-hit`) → tty1 affiche
> juste un curseur clignotant, plus aucun `agetty` dessus.
> **Respecter l'ordre des sections 4.2 → 4.3/4.4 → 4.5 évite ce piège.** Si ça
> arrive quand même (SSH reste toujours utilisable pour corriger) :
> ```bash
> sudo apt install -y xserver-xorg xinit x11-xserver-utils   # si pas déjà fait
> sudo systemctl reset-failed getty@tty1
> sudo systemctl restart getty@tty1
> ```
