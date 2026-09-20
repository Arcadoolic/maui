# Dépôt de starting packs — repo.maui.afronob.com

**Contexte** : dépôt HTTP statique hébergeant les starting packs (favoris +
ROMs + artwork, produits par `just starting-pack`), hébergé sur le serveur
`miyamoto` (déjà utilisé pour d'autres apps du même écosystème). Sert de
contournement à la limite de 500 Mio de l'upload `/import` du BO (buffer
RAM via Multer) — voir `STARTER-PACK-REPO-PLAN.md` à la racine du repo pour
le design complet, l'historique des décisions et le reste du travail
d'implémentation (BO, script Python `--url`, etc.). Ce document ne couvre
que ce qui est **déjà en production** : publier un pack et régénérer les
manifests, à la main, aujourd'hui.

Inventaire des packs préparés, méthode de copie des ROMs et reste à couvrir :
[STARTER-PACKS.md](STARTER-PACKS.md).

---

## 1. Accès au serveur

```bash
ssh -J mccoy.info.local afronob@miyamoto.afronob.com
```

Le SSH direct depuis le réseau de dev échoue — toujours passer par le jump
host `mccoy.info.local`. `afronob` a un `sudo -n ALL` (pas de mot de passe
sudo à saisir).

## 2. Accès au dépôt (côté consommateur : navigateur, `curl`, script BO)

- **URL** : `https://repo.maui.afronob.com/`
- **Auth** : HTTP Basic, utilisateur `admin`. Le mot de passe a été généré
  aléatoirement côté serveur au provisioning et doit être dans le
  gestionnaire de mots de passe de l'équipe — si besoin de le retrouver ou
  de vérifier qu'il y est bien : demander à la personne qui a fait le
  provisioning initial (2026-09-17), il ne doit plus traîner sur le
  serveur.
- **Listing de dossier activé** (`autoindex`) : `https://repo.maui.afronob.com/`
  liste tous les fichiers publiés — pratique pour choisir un pack au
  navigateur, protégé par la même basic auth que tout le reste.
- **`index.json`** : `https://repo.maui.afronob.com/index.json` liste les
  packs avec taille, date, et (si connu) date de génération / nombre de
  jeux — pensé pour être consommé par un futur picker BO plutôt que
  parsé à l'oeil.

```bash
curl -u admin:<mdp> https://repo.maui.afronob.com/index.json
curl -u admin:<mdp> -O https://repo.maui.afronob.com/<pack>.zip
```

### 2.1. Import partiel (jeux choisis) — prérequis : requêtes `Range`

Depuis l'onglet MAME > Repository du BO, on peut ne récupérer que certains jeux d'un pack
(cases à cocher par jeu). Le BO lance alors `import-starting-pack.py --url <pack>.zip --only
<rom1>,<rom2>,…` : le script **ne télécharge pas le pack**, il lit son index (*central directory*)
puis uniquement les entrées voulues (ROM, marquee/flyer/logo de chaque jeu, BIOS/parent requis)
avec des requêtes HTTP `Range`. Le BO en fait autant pour connaître la taille de chaque jeu (barre
d'espace disque) : deux petites requêtes `Range` par pack.

- **Le serveur doit répondre `206 Partial Content`** (nginx le fait par défaut sur des fichiers
  statiques, `Accept-Ranges: bytes`). Sans cela le script s'arrête avec « the repository does not
  support HTTP Range requests » plutôt que de télécharger le pack entier, et le BO se rabat sur une
  estimation de taille (taille du pack répartie sur ses jeux).
- La liste des jeux d'un pack vient de son `<pack>.manifest.json` : un pack sans manifest lisible
  (manifest de secours, voir 3.2) s'affiche mais ses jeux ne peuvent pas être choisis.
- Un jeu présent dans plusieurs packs est coché partout à la fois mais récupéré une seule fois (dans
  le premier pack de la liste).
- `--only` se lance aussi à la main : `python3 scripts/import-starting-pack.py --url … --only
  dkong,mario -y`. Sans `--only`, l'import reste celui du pack entier (téléchargé dans un fichier
  temporaire).

## 3. Publier un nouveau pack

Aucun pipeline CI ne fait ça aujourd'hui — c'est manuel, en 2 étapes
**toujours dans cet ordre** (l'étape 4 ne fait rien d'utile sur un pack pas
encore présent).

### 3.1. Upload du zip

```bash
scp -o ProxyJump=mccoy.info.local mon-pack.zip afronob@miyamoto.afronob.com:/tmp/
ssh -J mccoy.info.local afronob@miyamoto.afronob.com '
    sudo install -o www-data -g www-data -m 664 /tmp/mon-pack.zip /data/production/repo-maui/zip/mon-pack.zip
    rm /tmp/mon-pack.zip
'
```

`sudo install` plutôt qu'un simple déplacement : pose direct les bons
owner/permissions (`www-data:www-data`, `664`) sans dépendre d'un
`newgrp www-data`/relogin de la session courante.

> 💡 Un module rsync `[repo-maui]` existe déjà dans `/etc/rsyncd.conf` sur
> ce serveur (pointant vers `/data/production/repo-maui`, uid/gid
> `www-data`), mais restreint à trois IPs précises (probablement des
> runners CI, à l'image des modules équivalents pour les autres apps de ce
> serveur). Inutilisable depuis un poste de dev — reste un candidat naturel
> le jour où un pipeline automatisé publie des packs.

### 3.2. Régénération des manifests + `index.json`

```bash
ssh -J mccoy.info.local afronob@miyamoto.afronob.com \
    'cd /data/production/repo-maui && python3 generate-repo-manifests.py'
```

`scripts/generate-repo-manifests.py` (versionné dans ce repo, déployé une
fois pour toutes à `/data/production/repo-maui/generate-repo-manifests.py`
— volontairement **hors** de `zip/`, donc jamais servi par nginx) scanne
tous les `*.zip` de `zip/` et, pour chacun :

- **skip** s'il a déjà un `<nom>.manifest.json` à côté — rejouable après
  chaque nouvel upload sans retraiter les packs existants ;
- sinon extrait le `manifest.json` interne du zip (produit par
  `build-starting-pack.ts`, `formatVersion: 1`) et l'écrit **tel quel**
  comme `<nom>.manifest.json` ;
- si le zip n'a pas de `manifest.json` interne, qu'il n'est pas reconnu, ou
  que le zip lui-même est corrompu, écrit un manifest de secours
  (`{"formatVersion": null, "note": "...", "entries": [...]}`) plutôt que
  d'interrompre tout le scan sur un seul zip problématique ;

puis reconstruit `index.json` à partir de tous les manifests présents
(nom, taille, date, et `generatedAt`/nombre de jeux quand le manifest le
permet).

Pour redéployer une nouvelle version du script lui-même (après une
modification dans ce repo) :
```bash
scp -o ProxyJump=mccoy.info.local scripts/generate-repo-manifests.py \
    afronob@miyamoto.afronob.com:/tmp/generate-repo-manifests.py
ssh -J mccoy.info.local afronob@miyamoto.afronob.com \
    'sudo install -o afronob -g afronob -m 755 /tmp/generate-repo-manifests.py /data/production/repo-maui/generate-repo-manifests.py && rm /tmp/generate-repo-manifests.py'
```

### 3.3. Vérifier

```bash
curl -u admin:<mdp> https://repo.maui.afronob.com/index.json
curl -u admin:<mdp> https://repo.maui.afronob.com/mon-pack.manifest.json
curl -u admin:<mdp> -o /dev/null -w '%{http_code}\n' https://repo.maui.afronob.com/mon-pack.zip
```

## 4. Gotchas rencontrés en production

> ⚠️ **Renouvellement de certificat peut casser le suivi systemd de
> nginx.** Cet hôte a un hook global pre/post-certbot qui arrête/relance
> nginx autour de l'émission/renouvellement d'un certificat. Le
> redémarrage peut échouer (`bind() ... Address already in use`) si
> l'ancien process maître n'a pas relâché les ports à temps — le site
> continue d'être servi entre-temps par l'ancien process (pas de coupure
> visible), mais `systemctl status nginx` affiche `failed`, et un futur
> `systemctl reload nginx` échouerait tant que ce n'est pas corrigé.
> **Vérifier après chaque renouvellement** (`sudo systemctl is-active
> nginx` doit répondre `active`, pas seulement "le site répond au
> navigateur") :
> ```bash
> sudo systemctl is-active nginx
> # si "failed" :
> sudo nginx -t                                          # confirme que la conf est valide
> sudo ss -tlnp | grep -E ':80 |:443 '                    # identifie le PID de l'ancien master orphelin
> sudo kill -QUIT <pid-ancien-master>                     # arrêt propre, laisse finir les requêtes en cours
> sudo systemctl start nginx
> sudo systemctl is-active nginx                          # doit repasser "active"
> ```

> 💡 **`certbot --nginx` seul réécrit le vhost** — utiliser
> `certbot certonly --nginx -d ...` à la place pour obtenir/renouveler un
> certificat sans toucher au fichier de conf écrit à la main
> (`/etc/nginx/sites-available/repo-maui-production.conf`).

## 5. Ce qui reste à automatiser

Voir `STARTER-PACK-REPO-PLAN.md` (étapes 1, 4, 5, 6) : script Python
`import-starting-pack.py --url`, champs de config `repoUrl`/`repoUser`/
`repoPassword`, routes BO pour parcourir et importer un pack depuis ce
dépôt sans passer par `scp`/SSH à la main, et empaquetage du script dans
`electron-builder.yml`. Tant que ça n'est pas fait, ce document décrit
l'unique façon de publier un pack.
