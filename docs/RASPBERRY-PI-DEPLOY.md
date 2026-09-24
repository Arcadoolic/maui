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
export SDL_AUDIO_DRIVER=alsa
exec /home/puckman/squashfs-root/AppRun
EOF

chmod +x ~/.xinitrc
```

- `xset -dpms` / `s off` / `s noblank` : désactive la mise en veille de
  l'écran — indispensable pour une borne allumée en continu.
- `matchbox-window-manager` est lancé **en arrière-plan avant** l'app, pour
  qu'il soit prêt à honorer la demande de plein écran dès que la fenêtre
  Electron apparaît.
- `export SDL_AUDIO_DRIVER=alsa` force MAME (donc SDL3) à sortir le son par
  ALSA au lieu de PulseAudio : voir §6.4 — sans elle, quitter une partie peut
  figer MAME. Placée avant `exec` pour être héritée par l'app puis par chaque
  `mame` qu'elle lance.
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

### 5.7 Relancer l'app sans mot de passe (sudoers)

Après une mise à jour (§7), reprendre sur la nouvelle version passe par
`sudo systemctl restart getty@tty1` : `agetty` relance la session, `startx` et
l'app repartent sur le nouveau `~/squashfs-root`. Pour que `puckman` puisse le
faire sans saisir de mot de passe, on lui ouvre **uniquement** ces deux
commandes, en chemins exacts et sans joker :

```bash
# 1. Écrire la règle dans un fichier temporaire et la faire valider par visudo
#    (une erreur de syntaxe dans /etc/sudoers.d peut bloquer sudo pour tout le monde)
cat > /tmp/puckman-restart-kiosk << 'EOF'
# Permet à l'utilisateur de la borne de relancer sa session graphique (autologin sur tty1),
# par exemple après une mise à jour de MAUI. Rien d'autre : commandes exactes, pas de joker.
puckman ALL=(root) NOPASSWD: /usr/bin/systemctl restart getty@tty1, /usr/bin/systemctl reset-failed getty@tty1
EOF
/usr/sbin/visudo -cf /tmp/puckman-restart-kiosk   # /usr/sbin n'est pas dans le PATH d'un utilisateur normal

# 2. L'installer avec les bons propriétaire et droits (sudo refuse un fichier lisible par d'autres)
sudo install -o root -g root -m 0440 /tmp/puckman-restart-kiosk /etc/sudoers.d/puckman-restart-kiosk
rm /tmp/puckman-restart-kiosk
```

Vérifier (depuis SSH ou `tty2`, voir ci-dessous) :

```bash
command -v systemctl                      # doit afficher /usr/bin/systemctl, le chemin de la règle
sudo -k                                   # oublie le mot de passe mis en cache par un sudo précédent
sudo -n -l | grep getty                   # liste les deux commandes autorisées
sudo -n systemctl reset-failed getty@tty1 # sans effet ici, mais prouve l'absence de mot de passe
sudo -n systemctl restart getty@tty1      # relance la session, sans mot de passe
```

`-n` fait échouer `sudo` au lieu de demander un mot de passe : si la règle est
absente ou invalide, ces deux dernières commandes répondent `sudo: a password
is required`. `sudo -k` évite un faux positif : un `sudo` récent, avec mot de
passe, reste valable quelques minutes et ferait tout passer. Ne pas se fier à
`sudo -n -l <commande>` : dès qu'une règle `NOPASSWD` existe, il répond « permis »
pour toute commande que `sudo` autorise, mot de passe ou non.

- `restart getty@tty1` ferme la session de `tty1`, donc l'app et X avec elle.
  Le lancer **depuis SSH ou `tty2`**, pas depuis un terminal de la session
  kiosk, qui serait coupé au milieu de la commande.
- `reset-failed getty@tty1` sert au piège du §5.5 (`start-limit-hit`) : il
  remet le compteur d'échecs à zéro avant de relancer.
- Le nom du fichier ne doit contenir ni `.` ni `~` (sudo ignore ces fichiers).
- Le bouton **Restart the application** du BO (onglet MAUI > Update, §7.1)
  lance cette même commande : sans la règle, il affiche une erreur au lieu de
  relancer. Il vérifie la règle avant d'agir (en lançant `reset-failed`, sans effet
  sur une unité saine), donc il ne coupe rien si elle manque. Si tu changes la commande ici, il faut aussi changer
  `src/class/KioskRestart.ts`.

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

> ⚠️ Depuis le §6.4, MAME est forcé sur ALSA (`SDL_AUDIO_DRIVER=alsa` dans
> `~/.xinitrc`) : ce paragraphe ne s'applique plus qu'en revenant à
> PulseAudio, et c'est alors le `/etc/asound.conf` du §6.2 qui décide de la
> sortie.

Par défaut le `mame` compilé par Homebrew utilise PulseAudio (pas ALSA en
direct) via son propre `pulseaudio` embarqué — confirmé par `mame -verbose` :
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

### 6.4 MAME se fige à la fermeture d'une partie (SDL3 + PulseAudio)

**Symptôme** : on quitte une partie (par exemple avec le bouton assigné à
« Quitter MAME » dans l'onglet Manettes du BO), le jeu s'arrête mais la
fenêtre MAME reste figée et le processus `mame` ne se termine jamais — il
faut le tuer (`kill -9`, un `SIGTERM` est ignoré).

**Cause** (trace `gdb -p <pid>` sur le processus figé) : deadlock dans
l'arrêt du son de SDL3. Le thread principal est dans
`osd_exit → SDL_QuitAudio → ClosePhysicalAudioDevice → SDL_WaitThread`, et
attend le thread de lecture audio, lui-même bloqué dans
`PULSEAUDIO_WaitDevice → pa_threaded_mainloop_wait` (PulseAudio 17 de
Homebrew). Reproductible sans écran, 2 fois sur 2 :

```bash
export DISPLAY=:0 XDG_RUNTIME_DIR=/run/user/$(id -u)
cd ~/.mame
MAME=/home/linuxbrew/.linuxbrew/Cellar/mame/0.289/bin/mame
# PulseAudio (défaut) : ne se termine pas, tué par le timeout (code 137)
timeout -s KILL 25 $MAME dkong -video none -skip_gameinfo -seconds_to_run 3 \
  -inipath ~/.mame -homepath ~/.mame
# ALSA : se termine normalement (code 0)
SDL_AUDIO_DRIVER=alsa timeout -s KILL 25 $MAME dkong -video none -skip_gameinfo \
  -seconds_to_run 3 -inipath ~/.mame -homepath ~/.mame
```

**Contournement** : `export SDL_AUDIO_DRIVER=alsa` dans `~/.xinitrc` (§5.3).
Avec ALSA, MAME ouvre bien la carte `vc4hdmi0` (visible dans
`/proc/asound/card1/pcm0p/sub0/status`, état `RUNNING`), celle que le
`/etc/asound.conf` du §6.2 déclare par défaut. Vérifié sur le cabinet : le
son du jeu sort bien sur l'écran HDMI, et quitter une partie ne fige plus MAME.

Ce réglage n'a pas sa place dans le code de l'app : il est propre à cette
installation (PulseAudio de Homebrew) et casserait le son sur macOS et
Windows.

> `/proc/<pid>/environ` est inutilisable pour vérifier la variable sur les
> processus Electron (la zone est réécrite par Chromium) : le test réel est
> de quitter une partie et de voir MAME se fermer.

## 7. Mise à jour de l'application (nouvel AppImage)

`~/squashfs-root` (référencé en dur par `~/.xinitrc`, §5.3) est une
extraction figée de l'AppImage — une nouvelle version ne remplace rien
automatiquement, il faut ré-extraire par-dessus.

### 7.1 Depuis le BO (méthode principale)

Le BO (`http://<ip-du-pi>:3131`, voir §3) tourne sur ce même Pi et a donc
un accès direct au système de fichiers local — inutile de passer par `scp` :
l'onglet **MAUI → Mise à jour** télécharge côté serveur la release choisie
sur [github.com/Arcadoolic/maui/releases](https://github.com/Arcadoolic/maui/releases),
l'extrait dans un dossier temporaire puis bascule
`~/squashfs-root` dessus par renommage atomique (au lieu du `rm -rf` +
ré-extraction manuel ci-dessous). Le dossier temporaire est créé **à côté de
`~/squashfs-root`** (`~/.mame-awesome-ui-update-XXXX`), pas dans `/tmp`, qui est
un autre système de fichiers sur le Pi : un `rename` entre les deux échoue
avec `EXDEV`. Les versions antérieures à ce correctif faisaient précisément
cela et laissaient le Pi **sans `~/squashfs-root`** (l'ancien déplacé en
`.old`, le nouveau jamais mis en place) : si c'est arrivé,
`mv ~/squashfs-root.old ~/squashfs-root` remet l'ancienne version en place.
Si la bascule échoue désormais, elle est annulée et l'ancienne version est
remise en place automatiquement. L'ancienne version reste disponible dans
`~/squashfs-root.old` le temps de valider la nouvelle - à supprimer une
fois satisfait (`rm -rf ~/squashfs-root.old`), une mise à jour suivante
l'écrase de toute façon.

Accessible à tout compte BO (rôle `user` compris, ex. `puckman`) pour les
releases publiées ; les comptes `admin` ont en plus accès aux builds de
développement (prereleases GitHub publiées automatiquement à chaque push sur
`develop` par le workflow `Build` - pas encore promus vers `main`, à réserver
aux tests). Le BO ne redémarre pas la session kiosk tout seul à la fin de l'installation :
le bouton **Restart the application**, en haut de la carte *Update*, le fait à la
demande (il relance `getty@tty1`, donc la session, `startx` et l'app sur la
nouvelle version ; la page attend le retour du serveur puis revient sur
l'onglet). Il demande la règle sudoers du §5.7. À défaut, relancer à la main
`sudo systemctl restart getty@tty1` (ou redémarrer le Pi).

### 7.2 En repli, en SSH direct (BO inaccessible, pas de réseau)

```bash
# Depuis le poste de build, copier le nouvel AppImage sur le Pi
scp mame-awesome-ui-X.Y.Z-arm64.AppImage puckman@<ip-du-pi>:~/

# Sur le Pi : rendre exécutable et ré-extraire au même emplacement fixe
chmod +x ~/mame-awesome-ui-X.Y.Z-arm64.AppImage
rm -rf ~/squashfs-root
cd ~ && ./mame-awesome-ui-X.Y.Z-arm64.AppImage --appimage-extract

# Recharger la session graphique pour repartir sur le nouveau squashfs-root
# (sans mot de passe si la règle sudoers du §5.7 est installée)
sudo systemctl restart getty@tty1
```

`~/.xinitrc` pointe vers `~/squashfs-root/AppRun` par chemin fixe, pas vers
le nom du fichier AppImage — donc peu importe la version, aucune autre
modification n'est nécessaire tant que ce chemin de sortie d'extraction
reste le même. L'ancien `.AppImage` peut être supprimé une fois la nouvelle
version validée (`rm ~/mame-awesome-ui-<ancienne-version>-arm64.AppImage`).

**Ce qu'une mise à jour ne touche pas** (tout vit en dehors de
`squashfs-root`, donc survit à son remplacement, que ce soit via le BO ou
le `rm -rf` manuel ci-dessus) :
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
