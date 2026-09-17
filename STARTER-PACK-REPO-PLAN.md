# Dépôt de starting packs (repo.maui.afronob.com) + téléchargement/import BO

## Contexte

Les starting packs (favoris + ROMs + artwork, construits par `just starting-pack` /
`scripts/build-starting-pack.ts`) peuvent dépasser les capacités de l'upload
`/import` existant du BO : il passe par `memoryStorage()` de Multer avec une
limite dure de 500 Mio (`src/boServer.ts:2431`), qui bufferise tout le ZIP en
RAM avant extraction — inutilisable pour de grosses collections, en
particulier sur un Raspberry Pi.

La solution consiste à ne plus faire transiter les packs par le navigateur.
Les packs vivront sur un petit dépôt de fichiers HTTP
(`repo.maui.afronob.com`, hébergé sur le serveur `miyamoto` déjà
provisionné, le DNS pointant déjà dessus), et le BO de chaque borne les
téléchargera et les extraira localement via un script Python autonome, en
contournant complètement Multer/Express. Cela permet aussi à un admin de
parcourir les packs disponibles sans avoir à en télécharger un seul pour en
voir le contenu, grâce à un petit fichier manifest compagnon par pack.

Confirmé via reconnaissance sur le serveur (SSH via le jump host
`mccoy.info.local`, `afronob` dispose d'un `sudo -n ALL` sans mot de passe) :
- `/data/production/repo-maui/zip/` existe, est vide, appartient à
  `root:root` (chaque dossier voisin sous `/data/production` appartient à
  `www-data:www-data`).
- Seul nginx tourne sur cet hôte ; certbot/un timer systemd gèrent déjà les
  certificats des domaines voisins. `repo.maui.afronob.com` résout déjà vers
  cet hôte (alias de `miyamoto.afronob.com`) — aucun travail DNS nécessaire.
- Aucun dépôt Ansible accessible d'ici ne gère cet hôte (le checkout local
  `noc/ansible` est le dépôt corporate Infopro Digital, sans rapport) — le
  vhost sera écrit à la main via SSH, en suivant les conventions déjà en
  place sur le serveur.
- `/etc/nginx/sites-available/nes-card-wantlist-production.conf` est proche
  d'un modèle prêt à l'emploi : il documente déjà les commandes exactes
  `htpasswd`/`certbot` utilisées sur cet hôte et contient un bloc basic-auth
  (actuellement commenté) protégeant un emplacement de fichiers statiques.
  `htpasswd` est donc déjà installé. `sc-fonts-tools.conf` montre le motif
  pur `alias`/`try_files`/`Cache-Control` d'un site statique sans backend
  comme celui-ci.
- Confirmé par l'utilisateur : **basic auth** pour le contrôle d'accès,
  vhost écrit à la main, un **`<pack>.manifest.json` compagnon** extrait à
  côté de chaque zip (plutôt qu'un unique index global), et un périmètre de
  script limité à la remise en état de
  `origin/feat/starting-pack-import-script` + ajout de `--url` (la branche
  `origin/feat/decouple-bo-server` est hors périmètre — le BO tourne déjà
  localement par borne dans Electron ; le script Python est invoqué comme
  processus enfant local, jamais via HTTP).

## État d'avancement (2026-09-17)

L'étape 2 (« miyamoto : vhost nginx, basic auth, TLS ») a été exécutée en
production :
- `/data/production/repo-maui` et `/data/production/repo-maui/zip`
  appartiennent désormais à `www-data:www-data` (mode `2775`), `afronob` a
  été ajouté au groupe `www-data`.
- Fichier `htpasswd` créé (`/etc/nginx/htpasswd/repo-maui`, utilisateur
  `admin`, mot de passe généré aléatoirement côté serveur — jamais transité
  en clair par ce chat — et déposé temporairement dans
  `/root/repo-maui-admin-password.txt` en attendant d'être rangé dans un
  gestionnaire de mots de passe puis supprimé du serveur).
- Vhost `repo-maui-production.conf` déployé et activé, certificat TLS
  obtenu via `sudo certbot certonly --nginx -d repo.maui.afronob.com`
  (**pas** `certbot --nginx` sans `certonly` : ce dernier réécrit le vhost
  lui-même, alors qu'ici le vhost est volontairement écrit à la main —
  section mise à jour dans le plan ci-dessous en conséquence).
- **Incident mineur rencontré et corrigé** : un hook global pre/post de
  certbot sur cet hôte arrête/relance nginx autour de l'émission du
  certificat ; le redémarrage a échoué (« Address already in use ») car
  l'ancien process maître n'avait pas relâché les ports à temps. Le site
  restait servi entre-temps (pas de coupure), mais systemd marquait le
  service `failed`. Corrigé par un arrêt propre (`kill -QUIT`) de l'ancien
  process puis un `systemctl start nginx` classique — nginx est de nouveau
  `active` et suivi normalement par systemd. À garder en tête pour un futur
  renouvellement de certificat sur cet hôte (le renouvellement automatique
  pourrait reproduire le même symptôme).
- Vérifié en HTTPS : 401 sans identifiants (y compris sur le listing de
  dossier `/`), 404 avec identifiants sur les chemins hors `.zip`/`.json`,
  redirection 301 HTTP→HTTPS.
- `location /` passée en `autoindex on` (au lieu de `return 404;`) pour
  permettre à l'admin de parcourir les packs au navigateur avant que
  `index.json` (étape 3) existe — voir la note dans l'étape 2 ci-dessous.
- Pack de base `mame-starting-pack-20260911.zip` uploadé dans
  `/data/production/repo-maui/zip/` (depuis `~/Downloads`, via
  `scp`/`sudo install`, pas via le module rsync — voir note ci-dessous) et
  téléchargement vérifié en HTTPS avec authentification.
- **Découverte** : un module rsync `[repo-maui]` existe déjà dans
  `/etc/rsyncd.conf` sur miyamoto, pointant vers
  `/data/production/repo-maui` (uid/gid `www-data`), restreint à
  `127.0.0.1` et deux IPs (`51.15.182.108`, `82.65.178.12`) — probablement
  des runners CI, à l'image des modules équivalents pour les autres apps
  hébergées ici (`sc-fonts-tools`, `poke-app-*`, etc.). Publier un pack
  depuis un poste de dev classique ne passe donc pas par ce module (IP non
  whitelistée) ; ça reste du `scp`/`ssh` + `sudo install` en usage manuel.
  Si un pipeline CI publie un jour des packs ou des releases MAUI
  automatiquement, ce module rsync est le point d'entrée naturel à
  réutiliser plutôt qu'en créer un nouveau.
- **Étape 3 faite le 2026-09-17** : `scripts/generate-repo-manifests.py`
  écrit (voir §3, inchangé par rapport au design décrit), déployé sur
  miyamoto (`sudo install -o afronob -g afronob -m 755 ... /data/production/repo-maui/generate-repo-manifests.py`,
  hors de `zip/`, non servi par nginx), exécuté sur le pack déjà uploadé.
  Testé en local au préalable contre un vrai pack, un zip sans manifest
  interne et un zip corrompu (les trois cas produisent le fallback attendu
  ou le manifest verbatim, et une seconde exécution skip tout — voir §3
  pour le détail). `index.json` et
  `mame-starting-pack-20260911.manifest.json` vérifiés en HTTPS avec
  authentification.
- Restent à faire : étapes 1 et 4 à 6 (script Python `--url`,
  `Config.class.ts`, `boServer.ts`, `electron-builder.yml`).

## Extension future : hébergement des mises à jour MAUI

Le dépôt `repo.maui.afronob.com` a vocation, à terme, à héberger aussi les
artefacts de mise à jour de l'application MAUI elle-même (auto-update
Electron), en plus des starting packs. À anticiper dès maintenant dans
l'organisation du dépôt pour éviter une réorganisation plus tard :

- **Arborescence retenue** : un dossier `zip/` (existant, déjà en
  production, inchangé — starting packs + manifests compagnons +
  `index.json`) à côté d'un futur dossier `releases/` (mises à jour MAUI),
  plutôt que de renommer `zip/` maintenant. Renommer casserait la config
  nginx et le pack déjà publiés pour un gain surtout cosmétique ; `zip/`
  reste un nom exact pour ce qu'il contient.
  ```
  /data/production/repo-maui/
  ├── zip/                    # starting packs (existant)
  │   ├── <pack>.zip
  │   ├── <pack>.manifest.json
  │   └── index.json
  └── releases/               # futur : artefacts d'auto-update MAUI
      ├── latest.yml          # + latest-mac.yml / latest-linux.yml
      ├── *.dmg / *.AppImage / *.deb / *.zip
      └── *.blockmap
  ```
- **Format imposé par l'outillage** : `electron-builder`, avec un provider
  de publication `generic` (le plus simple à héberger soi-même, pas besoin
  de credentials cloud), dépose tout à plat dans un seul dossier par canal
  de version : `latest.yml`/`latest-mac.yml`/`latest-linux.yml` (lus par
  `electron-updater` au runtime) plus les installeurs et leurs
  `.blockmap`. C'est cette convention qui dicte la structure `releases/`
  ci-dessus — ne pas la sous-typer par OS, `electron-updater` s'appuie sur
  les noms de fichiers, pas sur des sous-dossiers.
- **Nginx** : quand cette fonctionnalité sera implémentée, le bloc
  `location ~ \.(zip|json)$` actuel (basé sur l'extension, pas sur le
  chemin) devra être remplacé par des blocs `location /zip/ { ... }` et
  `location /releases/ { ... }` séparés, chacun avec sa propre liste
  blanche d'extensions (`releases/` doit accepter `.yml`, `.blockmap`,
  `.dmg`, `.AppImage`, `.deb`, `.zip`, `.exe` en plus de `.json`). Le
  contrôle d'accès (`auth_basic`) devra probablement rester actif sur
  `zip/` mais être reconsidéré pour `releases/` — un cabinet en usine doit
  pouvoir vérifier les mises à jour même sans configuration BO préalable
  (l'auto-update tourne typiquement avant tout accès à un écran de config).
- Hors périmètre de ce plan : la génération des artefacts `releases/`
  elle-même (config `publish` d'`electron-builder`, déclenchement CI sur
  tag/release GitHub) n'est pas traitée ici et mériterait son propre plan
  une fois ce dépôt de starting packs stabilisé.

## Fichiers critiques

- `src/boServer.ts` — application Express du BO. Motifs à réutiliser :
  `renderForm()` (`:1907`, paramètres positionnels — à étendre avec de
  nouveaux paramètres optionnels, sans refactoriser en objet d'options), le
  handler `/import` existant (`:2791`) pour le motif de réponse en progression
  streamée (`res.write` par ligne, `renderPageHead`/`renderPageTail`),
  `renderScreenScraperCard()` (`:2006`) comme modèle de carte de formulaire
  d'identifiants, les types `IMPORTABLE_MAME_DIRECTORIES` /
  `StartingPackManifest` déjà importés ici.
- `src/class/Config.class.ts` — config en fichier JSON (`~/.mame-awesome-ui/
  mame-awesome-ui-config.json`). Même motif `load()`/`save()` champ par champ
  déjà utilisé pour `ssDevId`/`ssDevPassword`/etc. — ajouter `repoUrl`,
  `repoUser`, `repoPassword` de la même façon, sans nouveau mécanisme de
  stockage.
- `scripts/import-starting-pack.py` (à ressusciter depuis
  `origin/feat/starting-pack-import-script`, commit `c88dcd1`) — Python
  stdlib uniquement, reproduit la logique d'import de `boServer.ts` pour une
  extraction adaptée aux gros volumes/au Pi. Ajouter le mode `--url` ici.
- `scripts/build-starting-pack.ts` (`:398`) — seul producteur du
  `manifest.json` interne au ZIP (`StartingPackManifest`, `formatVersion: 1`,
  `games[]`, `biosRoms[]`) — non modifié, juste le schéma que lira le
  nouveau script côté dépôt.
- Nouveau : `scripts/generate-repo-manifests.py` (versionné dans ce dépôt,
  déployé par `scp` sur le serveur — pas écrit à la volée sur miyamoto).
- Nouveau : `src/staticPath.ts` reçoit un helper `getScriptsPath()` calqué
  sur son `getStaticPath()` existant, utilisé par la nouvelle route BO pour
  localiser le script aussi bien en dev qu'une fois packagé.

## Plan

### 1. `scripts/import-starting-pack.py` : remise en état + `--url` (à faire en premier, testable seul)

- `git fetch origin && git checkout -b feat/starting-pack-repo-import develop
  && git cherry-pick c88dcd1` (propre, 1 commit, sans conflit d'après la
  vérification préalable par `git merge-tree`).
- Rendre `pack` optionnel (`nargs='?'`), ajouter `--url` ; rejeter si les
  deux ou aucun ne sont fournis. Ajouter `download_to_tempfile(url)` :
  construit une `Request`, attache un `Authorization: Basic ...` à partir des
  variables d'environnement `MAUI_REPO_USER`/`MAUI_REPO_PASSWORD` (accepter
  aussi `--user`/`--password` pour des tests manuels uniquement, signalés
  dans `--help` comme visibles via `ps`), diffuse via
  `urllib.request.urlopen()` + `shutil.copyfileobj()` vers un
  `tempfile.mkstemp(suffix='.zip')`. Vérifier l'espace disque en amont via
  `Content-Length` quand il est présent (même marge de 5 % que la
  `check_disk_space()` existante) ; sinon laisser `copyfileobj` remonter
  proprement une `ENOSPC`. `zipfile.ZipFile` a besoin d'un fichier
  seekable (il lit le répertoire central depuis la fin), donc le passage par
  un fichier temporaire téléchargé puis ouvert est obligatoire — une
  extraction véritablement streamée depuis une réponse HTTP n'est pas
  faisable avec `zipfile` de la stdlib.
  Envelopper le reste de `main()` dans un `try/finally: os.unlink(temp_path)`
  quand une URL a été utilisée, pour que le fichier temporaire ne traîne
  jamais, en cas de succès comme d'échec.
- Pas de logique de cache/reprise — les packs sont déclenchés par un admin,
  peu fréquents, sur un chemin LAN court ; ça ne vaut pas la complexité à
  cette échelle.
- Tester seul avant de toucher au BO ou au serveur :
  `python3 -m http.server 8080` en local, puis
  `python3 scripts/import-starting-pack.py --url http://localhost:8080/test.zip -y`.

### 2. miyamoto : vhost nginx, basic auth, TLS (écrit à la main via SSH) — ✅ fait le 2026-09-17

Accessible via `ssh -J mccoy.info.local afronob@miyamoto.afronob.com`
(le SSH direct depuis ce réseau échoue — toujours passer par le jump host).

**Écart avec la séquence initialement prévue ci-dessous** : `sudo certbot
--nginx -d ...` (sans `certonly`) réécrit lui-même le vhost pour y insérer
ses propres directives SSL — incompatible avec un vhost volontairement
écrit à la main. Utiliser `sudo certbot certonly --nginx -d ...` à la
place (obtient le certificat via le challenge HTTP-01 sans toucher au
fichier de conf), en 3 temps :
1. Déployer d'abord une version du vhost qui ne contient que le bloc
   `listen 80` (le bloc 443 référencerait un certificat qui n'existe pas
   encore → `nginx -t` échouerait), l'activer, `nginx -t`, reload.
2. `sudo certbot certonly --nginx -d repo.maui.afronob.com --non-interactive
   --agree-tos` (réutilise le compte Let's Encrypt déjà enregistré sur cet
   hôte pour les domaines voisins, pas besoin de `--email`).
3. Déployer le vhost complet (les deux blocs, comme ci-dessous), `nginx -t`,
   reload.

**Incident rencontré à l'étape 2** : cet hôte a un hook global pre/post
certbot qui arrête/relance nginx autour de l'émission du certificat. Le
redémarrage a échoué (`bind() ... Address already in use`) car l'ancien
process maître n'avait pas relâché les ports à temps — nginx continuait à
servir le trafic entre-temps (pas de coupure), mais systemd marquait le
service `failed`, ce qui aurait cassé un futur `systemctl reload`. Corrigé
par `sudo kill -QUIT <pid de l'ancien master>` (arrêt propre) puis
`sudo systemctl start nginx`. À vérifier après chaque renouvellement de
certificat sur cet hôte (`sudo systemctl is-active nginx` doit rester
`active`, pas seulement « le site répond »).

```bash
# Propriété : repo-maui est root:root, chaque dossier voisin est www-data:www-data.
# www-data:www-data + afronob dans le groupe www-data permet à nginx (lecture)
# et aux futures publications scp/rsync d'afronob (écriture) de fonctionner
# sans sudo par fichier.
sudo chown -R www-data:www-data /data/production/repo-maui
sudo chmod 2775 /data/production/repo-maui /data/production/repo-maui/zip
sudo usermod -aG www-data afronob   # afronob doit se reconnecter (ou faire `newgrp www-data`) pour que ça s'applique

# Basic auth (htpasswd déjà installé sur cet hôte, utilisé par wantlist.ilovemyn.es)
sudo mkdir -p /etc/nginx/htpasswd
sudo htpasswd -c /etc/nginx/htpasswd/repo-maui admin   # demande un mot de passe ; à stocker dans un gestionnaire de mots de passe
```

Nouveau `/etc/nginx/sites-available/repo-maui-production.conf`, calqué
directement sur la convention documentée de
`nes-card-wantlist-production.conf` (commentaire d'en-tête avec les
commandes exactes de mise en place) et le motif `alias` statique de
`sc-fonts-tools.conf` :

```nginx
# /etc/nginx/sites-available/repo-maui-production.conf
#
# Prérequis :
#   fichier htpasswd : sudo htpasswd -c /etc/nginx/htpasswd/repo-maui <utilisateur>
#   certificat SSL   : sudo certbot certonly --nginx -d repo.maui.afronob.com
#
# Lien symbolique pour activer :
#   sudo ln -s /etc/nginx/sites-available/repo-maui-production.conf \
#              /etc/nginx/sites-enabled/repo-maui-production.conf

server {
    listen 80;
    listen [::]:80;
    server_name repo.maui.afronob.com;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name repo.maui.afronob.com;

    # --- SSL (renseigné par certbot) ---
    ssl_certificate     /etc/letsencrypt/live/repo.maui.afronob.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/repo.maui.afronob.com/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    auth_basic           "MAUI starter-pack repository";
    auth_basic_user_file /etc/nginx/htpasswd/repo-maui;

    root /data/production/repo-maui/zip;

    # Seuls les .zip et les .json compagnons (manifests + index.json, voir
    # scripts/generate-repo-manifests.py) sont censés être téléchargés ici.
    location ~ \.(zip|json)$ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=3600";
    }

    # Listing de dossier pour l'admin qui choisit un pack à la main. Sans
    # risque puisque tout ce server block est déjà derrière auth_basic
    # ci-dessus et que ce dossier ne contient jamais que des
    # .zip/.manifest.json/index.json.
    location / {
        autoindex on;
        autoindex_exact_size off;
        autoindex_localtime on;
    }

    add_header X-Frame-Options        "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff"    always;
    add_header Referrer-Policy        "no-referrer" always;
}
```

```bash
sudo ln -sf /etc/nginx/sites-available/repo-maui-production.conf \
            /etc/nginx/sites-enabled/repo-maui-production.conf
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl is-active nginx                   # confirme que systemd suit bien un process actif, pas juste "le site répond"
sudo ufw status verbose | grep -E '80|443'       # vérifier que le 443 est autorisé (le 80 l'est déjà)
```

Vérifié avec `curl`, sans le BO — résultats réels obtenus :
```bash
curl -I https://repo.maui.afronob.com/                               # 401 ✅ (listing lui-même protégé)
curl -u admin:<mdp> https://repo.maui.afronob.com/                    # 200, liste les .zip présents ✅
curl -I https://repo.maui.afronob.com/index.json                     # 401 ✅
curl -u admin:<mdp> https://repo.maui.afronob.com/index.json          # 404 tant que l'étape 3 n'a pas tourné (pas de 401) ✅
curl -I https://repo.maui.afronob.com/does-not-exist.py               # 401 ✅
curl -u admin:<mdp> https://repo.maui.afronob.com/does-not-exist.py   # 404 ✅
```
Décision prise le 2026-09-17 : `location /` a été passée en `autoindex on`
(plutôt que `return 404;`) pour permettre à un admin de parcourir les
packs disponibles au navigateur avant que `index.json` (étape 3) existe —
sans risque supplémentaire puisque l'ensemble du server block reste
derrière `auth_basic`. Effet de bord positif : avec `return 404;`, ce
chemin s'exécutait pendant la phase *rewrite* de nginx, **avant** la phase
*access* qui vérifie `auth_basic`, donc un chemin hors `.zip`/`.json`
répondait 404 même sans identifiants (sans faille, juste incohérent). Avec
`autoindex`, tout passe par le flux normal de service de fichiers
statiques, donc l'authentification est désormais exigée uniformément
partout sur le vhost, y compris pour un 404.

### 3. `scripts/generate-repo-manifests.py` (nouveau, versionné ici, déployé sur miyamoto) — ✅ fait le 2026-09-17

Stdlib uniquement (`zipfile`, `json`, `pathlib`, `argparse`), `--zip-dir`
optionnel (défaut `/data/production/repo-maui/zip`) pour rester testable en
local contre un dossier de test. Pour chaque `*.zip` :
- Ignorer si `<nom>.manifest.json` existe déjà à côté.
- Sinon, ouvrir en lecture seule, chercher l'entrée interne
  `manifest.json` : si présente et `formatVersion == 1`, l'écrire telle
  quelle comme fichier compagnon ; si absente ou non reconnue, écrire un
  fallback `{"formatVersion": null, "note": "no internal manifest.json found",
  "entries": [...zf.namelist()]}` (couvre le cas d'un zip « gros volumes »
  qui n'est pas une sortie de `build-starting-pack.ts`) — logger et
  continuer plutôt que d'interrompre tout le scan sur un zip défectueux.
- Ensuite, reconstruire `index.json` à la racine du dépôt à partir de tous
  les manifests compagnons (nom de fichier, taille, date de modification et
  — quand disponible — `generatedAt`/nombre de jeux), afin que le BO puisse
  récupérer un seul petit fichier pour alimenter son sélecteur.

À déployer et exécuter manuellement après chaque publication de pack (les
packs sont ajoutés rarement ; une étape manuelle fait remonter un zip
défectueux immédiatement plutôt que silencieusement dans un log de cron) :
```bash
scp scripts/generate-repo-manifests.py \
    afronob@miyamoto.afronob.com:/data/production/repo-maui/generate-repo-manifests.py
ssh -J mccoy.info.local afronob@miyamoto.afronob.com \
    'cd /data/production/repo-maui && python3 generate-repo-manifests.py'
```
Placé un niveau *au-dessus* de `zip/` (racine nginx), pas dedans — même si
la liste blanche `.zip|.json` ne servirait de toute façon pas un fichier
`.py`, garder le script hors de l'arborescence servie évite de compter
uniquement sur cette protection. Documenter cette séquence de publication
(upload du zip → exécution du script) dans un nouveau
`docs/STARTER-PACK-REPO.md`.

### 4. `src/class/Config.class.ts` : paramètres du dépôt

Ajouter `repoUrl`, `repoUser`, `repoPassword` (tous `string`, défaut `''`),
en suivant exactement le motif déjà utilisé pour `ssDevId` dans
`load()`/`save()`.

### 5. `src/boServer.ts` : UI et routes du BO

- Nouvelle carte `renderRepoImportCard(config, packs?, error?, info?)`,
  calquée sur `renderScreenScraperCard()` (formulaire d'identifiants) — un
  formulaire de paramètres (`POST /repo/save`) plus, une fois `repoUrl`
  renseigné, un lien pour parcourir le dépôt et un `<select>` alimenté à
  partir d'`index.json` une fois récupéré
  (`renderRepoPackPicker(packs)`).
- L'intégrer dans `renderForm()` à côté de `renderImportCard()`, protégée
  par le contrôle admin comme `renderMameDangerZoneCard()` :
  ```ts
  + renderImportCard(importError)
  + (isAdmin ? renderRepoImportCard(config, repoPacks, repoError, repoInfo) : '')
  + (isAdmin ? renderMameDangerZoneCard(mameInfo, dangerZoneInfo) : '')
  ```
  en étendant la liste de paramètres positionnels existante de
  `renderForm()` avec `repoPacks?`, `repoError?`, `repoInfo?` à la fin
  (même style que ses paramètres actuels — sans refactoriser en objet
  d'options).
- `POST /repo/save` — réservé aux admins (`req.session.boRole !== 'admin'`
  → 403, même contrôle que pour `/maui/export`/`/maui/import`), enregistre
  les trois champs de `Config`, retire un éventuel `/` final de `repoUrl`.
- `GET /import/from-url/packs` — réservé aux admins ; `fetch()` côté serveur
  (global depuis Node 24, déjà le motif utilisé dans
  `ScreenScraperClient.class.ts`) de `${config.repoUrl}/index.json` avec
  l'en-tête basic-auth construit à partir de
  `config.repoUser`/`repoPassword`, réaffiche le formulaire avec la liste de
  packs analysée (proxifié côté serveur pour que les identifiants ne passent
  jamais par le navigateur).
- `POST /import/from-url` — réservé aux admins ; valide `packFilename`
  contre `/^[\w.-]+\.zip$/` (il alimente une URL et un argv de processus
  enfant), puis :
  ```ts
  const child = spawn('python3', [scriptPath, '--url', packUrl, '-y'], {
      env: {...process.env, MAUI_REPO_USER: config.repoUser, MAUI_REPO_PASSWORD: config.repoPassword},
  });
  ```
  en streamant `child.stdout`/`child.stderr` vers la réponse exactement
  comme le handler `/import` existant streame les lignes de progression
  d'`importStartingPack()`. Utiliser `spawn`, pas l'`execFile` déjà importé
  en tête de fichier (`:8`) — la forme callback d'`execFile` bufferise
  toujours en interne jusqu'à `maxBuffer` (1 Mio par défaut) même avec des
  listeners attachés à ses flux, ce qu'un import verbeux de plusieurs
  centaines de jeux pourrait dépasser ; `spawn` ne bufferise jamais en
  interne. Ajouter `spawn` à l'import `child_process` existant.
  Les identifiants passent par l'`env` de l'enfant, jamais par l'`argv`,
  pour qu'ils ne fuitent pas via `ps`/`/proc/<pid>/cmdline` (ils sont déjà
  présents en clair dans le fichier JSON de `Config`, même niveau de
  confiance que `ssDevPassword`).
- `getScriptsPath()` dans `src/staticPath.ts` (calqué sur le
  `getStaticPath()` existant de ce fichier) :
  `join(__dirname, '..', '..', 'scripts')` en dev,
  `join(process.resourcesPath, 'scripts')` une fois packagé.
- Vérifier la disponibilité de `python3` avant de lancer le spawn (macOS ne
  fournit pas toujours un `python3` fonctionnel sans les Xcode CLT
  installés) — une vérification rapide via
  `execFile('python3', ['--version'], cb)` avec un message d'erreur clair
  affiché dans le BO plutôt que de laisser remonter un `ENOENT` brut.

### 6. `electron-builder.yml`

```yaml
extraResources:
  - from: migrations/
    to: migrations/
  - from: public/
    to: public/
  - from: scripts/import-starting-pack.py
    to: scripts/import-starting-pack.py
```
(`generate-repo-manifests.py` ne tourne jamais dans l'app packagée — pas
besoin d'entrée pour lui.)

## Vérification

1. **Script seul** : `python3 -m http.server` + `--url` contre celui-ci
   (étape 1).
2. **Serveur** : vérifications `curl` de l'étape 2 (401 sans auth, 404 pour
   les chemins non zip/json, 200 pour un vrai pack une fois uploadé).
3. **Générateur de manifests** : exécuter contre un dossier de test avec une
   vraie sortie de `build-starting-pack.ts` plus un zip sans manifest
   interne, confirmer que le fichier compagnon et le chemin de fallback
   fonctionnent tous les deux, et que `index.json` liste les deux.
4. **`--url` contre le vrai dépôt** : `MAUI_REPO_USER=... MAUI_REPO_PASSWORD=...
   python3 scripts/import-starting-pack.py --url https://repo.maui.afronob.com/<pack>.zip -y`.
5. **Aller-retour BO** : `just serve`, se connecter en tant qu'admin,
   enregistrer les paramètres du dépôt, parcourir (confirme qu'`index.json`
   est bien analysé et que le sélecteur se remplit), choisir un pack,
   confirmer la progression streamée et un résumé d'import réussi
   correspondant à ce que produirait un `/import` local du même zip.
   Refaire en session non-admin et confirmer que la carte est absente et que
   `/import/from-url`/`/repo/save` renvoient tous les deux 403.
6. **Multi-plateforme** : exécuter l'aller-retour aussi bien sur macOS
   (machine de dev) que sur une machine Linux, conformément à l'exigence
   dual-plateforme du CLAUDE.md — l'ajout de `--url` en lui-même est neutre
   côté plateforme (`urllib`/`tempfile`/`shutil`), mais la vérification
   préalable de `python3` (étape 5) est la seule dépendance réellement
   nouvelle et sensible à la plateforme introduite par cette fonctionnalité.
7. `just lint` et `npm test`. Aucun test existant ne touche aux routes de
   `boServer.ts` ni à `/import` (confirmé — rien dans `tests/unit/` ne
   référence l'un ou l'autre), donc ne pas ajouter de nouvelle
   infrastructure de test de routes Express pour ça ; en revanche, étendre
   la couverture existante de chargement/sauvegarde de champs de
   `Config.class.test.ts` avec les trois nouveaux champs, puisque ce fichier
   teste déjà exactement cela.

## Points ouverts à reconfirmer avant l'implémentation

- **Emplacement dans l'UI** : onglet mame (regroupé avec l'UI d'import
  existante, la section admin y existe déjà via la danger zone) vs. onglet
  maui (déjà entièrement protégé pour les admins) — le plan ci-dessus
  recommande l'onglet mame mais cela n'a pas été explicitement tranché avec
  l'utilisateur.
- **Mot de passe basic-auth** : à générer et stocker dans un gestionnaire de
  mots de passe, puis à saisir une fois par formulaire de paramètres BO de
  chaque borne.
- **Repli sur l'appartenance de groupe** : `usermod -aG www-data afronob`
  nécessite une reconnexion pour prendre effet — si c'est gênant en pleine
  session, publier un pack pourrait plutôt passer par
  `sudo install -o www-data -g www-data -m 664 <src>
  /data/production/repo-maui/zip/`, sans changer l'appartenance de groupe du
  tout.
