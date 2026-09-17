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
> `PATH`. Sans importance pour l'usage kiosk (cf. §5.4, `.bash_profile` source
> `.profile` → `.bashrc`), mais à garder en tête si un script/service lance
> `mame` directement.

## 2. Installation de MAME 0.289

```bash
brew install mame
```

Compilation depuis les sources pour arm64 : **très long** (plusieurs heures
sur un Pi 4). Le binaire se retrouve dans
`/home/linuxbrew/.linuxbrew/Cellar/mame/0.289/bin` (versionné), avec un
symlink stable `/home/linuxbrew/.linuxbrew/opt/mame/bin` qui pointe dessus —
c'est ce second chemin qu'il faut renseigner dans la config MAUI (`mamePath`
dans `mame-awesome-ui-config.json`), pour ne pas avoir à retoucher la config à
chaque `brew upgrade mame` (voir §3).

## 3. Pré-configuration de MAUI (saute l'écran de setup initial)

```bash
mkdir -p ~/.mame-awesome-ui

cat > ~/.mame-awesome-ui/mame-awesome-ui-config.json << 'EOF'
{"mamePath":"/home/linuxbrew/.linuxbrew/opt/mame/bin","mameBinaryName":"mame","ssDevId":"","ssDevPassword":"","ssSoftName":"","ssUserId":"","ssUserPassword":"","bezelAspect":"16:9","openDevTools":false,"fullscreen":true}
EOF
```

`Config.class.ts` (`getAppDataPath()`) résout toujours ce fichier à
`~/.mame-awesome-ui/mame-awesome-ui-config.json`, en dev comme en production —
donc déposer le JSON à cet endroit avant le premier lancement fait sauter
l'écran `/config` du premier démarrage (`Init.vue` ne redirige vers `/config`
que si ce fichier est absent). Les champs correspondent un à un à ceux
attendus par `Config.load()` ; `mamePath` doit être le **dossier** contenant
le binaire `mame`, pas le chemin du binaire lui-même.

> 💡 `opt/mame/bin` plutôt que `Cellar/mame/0.289/bin` : Homebrew réécrit ce
> symlink vers la nouvelle version à chaque `brew upgrade mame`, alors que le
> chemin `Cellar` versionné casserait silencieusement `mamePath` au prochain
> upgrade.

## 4. Dépendances système pour lancer l'AppImage

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

## 5. Préparation de l'affichage (mode kiosk)

### 5.1 Extraction persistante de l'AppImage

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

### 5.2 Serveur X minimal + gestionnaire de fenêtres

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

### 5.3 `~/.xinitrc`

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

### 5.4 Démarrage automatique de X à la connexion (`~/.bash_profile`)

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

### 5.5 Autologin systemd sur tty1

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
> d'avoir installé `xserver-xorg`/`xinit` (§5.2) fait échouer `startx`
> instantanément dans `.bash_profile`. Comme il est appelé avec `exec`, la
> session de login se termine aussitôt → `agetty` relance en boucle → systemd
> bloque le service au bout de 5 tentatives (`start-limit-hit`) → tty1 affiche
> juste un curseur clignotant, plus aucun `agetty` dessus.
> **Respecter l'ordre des sections 5.2 → 5.3/5.4 → 5.5 évite ce piège.** Si ça
> arrive quand même (SSH reste toujours utilisable pour corriger) :
> ```bash
> sudo apt install -y xserver-xorg xinit x11-xserver-utils   # si pas déjà fait
> sudo systemctl reset-failed getty@tty1
> sudo systemctl restart getty@tty1
> ```

### 5.6 Garder un terminal de secours (`tty2`)

`tty1` est entièrement pris par l'autologin + X — sans autre console active,
un crash graphique ne laisse aucun moyen de reprendre la main au clavier sur
la borne (`Ctrl+Alt+F2` ne fait rien sans `agetty` dessus). Garder un second
tty disponible coûte rien et évite de dépendre du SSH pour intervenir :

```bash
sudo systemctl enable --now getty@tty2
```

`Ctrl+Alt+F2` donne alors un vrai prompt de connexion, indépendant de l'état
de X/matchbox/l'app sur `tty1`.

## 6. Audio (sortie HDMI)

Le Pi 4 expose deux cartes ALSA HDMI (`vc4hdmi0`/`vc4hdmi1`, une par port
physique) plus le jack analogique (`Headphones`) — **sans configuration
explicite, le son par défaut ne sort ni sur l'une ni sur l'autre HDMI**, et
il faut corriger **deux couches indépendantes** : ALSA au niveau système, et
PulseAudio au niveau du binaire `mame` de Homebrew (qui embarque son propre
PulseAudio, démarré à la demande, indépendant de toute config ALSA système).

### 6.1 Identifier le port HDMI réellement branché

```bash
cat /proc/asound/cards
for f in /sys/class/drm/*/status; do echo "$f: $(cat "$f")"; done
```

Sur ce Pi : écran branché sur le port HDMI0 physique → `card 1: vc4hdmi0` →
`HDMI-A-1: connected`.

### 6.2 Sortie par défaut ALSA (système)

Sans `/etc/asound.conf`, ALSA retombe sur la première carte détectée
(`card 0`, le jack). `hw:` en accès direct échoue avec `Sample format non
available` sur ce chipset (il n'accepte en direct que de l'IEC958 trame par
trame) — il faut passer par la couche `plug` pour la conversion automatique :

```bash
sudo tee /etc/asound.conf > /dev/null << 'EOF'
pcm.!default {
    type plug
    slave.pcm "hw:vc4hdmi0,0"
}
ctl.!default {
    type hw
    card vc4hdmi0
}
EOF
```

Test : `aplay /usr/share/sounds/alsa/Front_Center.wav` (sans `-D`, donc via
le device par défaut) doit être audible sur l'écran.

### 6.3 Sink par défaut PulseAudio (MAME lui-même)

Le `mame` compilé par Homebrew utilise PulseAudio (pas ALSA en direct) via
son propre `pulseaudio` embarqué — confirmé par `mame -verbose` :
```
SDL Audio: Driver is pulseaudio
SDL Audio: Sink device 2: device 'vc4-hdmi-0 Stereo'
```
Ce PulseAudio a **sa propre notion de sortie par défaut**, indépendante du
`/etc/asound.conf` du §6.2 — le régler côté ALSA ne suffit donc pas pour le
son en jeu. Par défaut il pointait ici vers `alsa_output.0.stereo-fallback`
(le jack), pas le HDMI :

```bash
export PATH=/home/linuxbrew/.linuxbrew/bin:$PATH
pactl list sinks short
# 0  alsa_output.0.stereo-fallback   ...  (jack)
# 1  alsa_output.1.stereo-fallback   ...  (vc4-hdmi-0, l'écran)

pactl set-default-sink alsa_output.1.stereo-fallback
```

Ce choix est persisté par PulseAudio dans sa base d'état utilisateur
(`~/.config/pulse/*-default-sink`) — pas besoin de le refaire après chaque
redémarrage du démon Pulse (auto-spawné à la demande) ni après un reboot du
Pi (vérifié).

> 💡 Si `pactl` semble indisponible : il n'est pas dans le `PATH` par défaut
> hors shell interactif, il vit sous
> `/home/linuxbrew/.linuxbrew/bin/pactl` (installé comme dépendance du
> `mame` Homebrew, pas via `apt`).

## 7. Mise à jour de l'application (nouvel AppImage)

`~/squashfs-root` (référencé en dur par `~/.xinitrc`, §5.3) est une
extraction figée de l'AppImage — une nouvelle version ne remplace rien
automatiquement, il faut ré-extraire par-dessus.

```bash
# Depuis le poste de build, copier le nouvel AppImage sur le Pi
scp mame-awesome-ui-X.Y.Z-arm64.AppImage puckman@<ip-du-pi>:~/

# Sur le Pi : rendre exécutable et ré-extraire au même emplacement fixe
chmod +x ~/mame-awesome-ui-X.Y.Z-arm64.AppImage
rm -rf ~/squashfs-root
cd ~ && ./mame-awesome-ui-X.Y.Z-arm64.AppImage --appimage-extract

# Recharger la session graphique pour repartir sur le nouveau squashfs-root
sudo systemctl restart getty@tty1
```

`~/.xinitrc` pointe vers `~/squashfs-root/AppRun` par chemin fixe, pas vers
le nom du fichier AppImage — donc peu importe la version, aucune autre
modification n'est nécessaire tant que ce chemin de sortie d'extraction
reste le même. L'ancien `.AppImage` peut être supprimé une fois la nouvelle
version validée (`rm ~/mame-awesome-ui-<ancienne-version>-arm64.AppImage`).

**Ce qu'une mise à jour ne touche pas** (tout vit en dehors de
`squashfs-root`, donc survit au `rm -rf` ci-dessus) :
- Config MAUI : `~/.mame-awesome-ui/` (§3)
- Home MAME (roms, favoris, cfg, nvram) : `~/.mame/`
- Profil Electron (cache, localStorage, etc.) : `~/.config/mame-awesome-ui/`
- Config audio système et sink PulseAudio par défaut (§6)

**À revérifier après une mise à jour** : si la nouvelle version embarque une
version d'Electron plus récente, elle peut introduire nouvelles dépendances
système. Rejouer la vérification du §4 pour repérer d'éventuelles libs
manquantes avant de considérer la mise à jour terminée :

```bash
ldd ~/squashfs-root/mame-awesome-ui | grep "not found"
```
