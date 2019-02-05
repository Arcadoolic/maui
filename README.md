# Fiche Projet

## Description

<!-- Décrire ici l'object business du projet-->

## Contacts

<!-- Ecrire sous la forme <Prénom NOM, email@infopro-digital.com -->
| | |
| --- | --- |
| **Directeur de projet** |  |
| **Chef de projet technique** |  |
| **Chef de projet fonctionnel** |  |
| **Lead développeur** |  |

## URL

Les parties marquée ```{{login}}``` dans les URL correspondent au login utilisateur. 

<!-- Supprimez les sections inutiles -->

### Front
<!-- Si les parties front/middle/back sont dans un autre projet, merci de rajouter
    les liens vers la page web dans GitLab -->

| | |
|---|---|
| **Prod** | http:// |
| **Preprod** | http:// |
| **Dev** | http:// |
| **Sandbox** | http://{{login}}. |

### Middle

| | |
|---|---|
| **Prod** | http:// |
| **Preprod** | http:// |
| **Dev** | http:// |
| **Sandbox** | http://{{login}}. |

### Back

| | |
|---|---|
| **Prod** | http:// |
| **Preprod** | http:// |
| **Dev** | http:// |
| **Sandbox** | http://{{login}}. |

## Sources

**Dépot GIT** : 
**Dossier de déploiement** : 

### Initialisation du projet

```
$ composer install -o
$ cd _build
$ phing init
```

### Liens symboliques

***Choisir entre l'une ou l'autre des méthodes suivantes :***

<!-- Méthode legacy - Les commandes pour créer les liens symboliques -->
Géré par le fichier [```_build/build.xml```](_build/build.xml) dans le target ```init```. Executez la commande ```phing init``` depuis le dossier ```_build```.

<!-- Méthode modern - Les commandes pour créer les liens symboliques -->
Géré par le fichier [```RoboFile.php```](RoboFile.php) dans le méthode ```projectInit```.

Executez la commande ```php vendor/codegyre/robo/robo project:init``` depuis la racine de votre projet.

Note : Les serveurs de développements possèdent un script vous permettant de lancer la version courte de la commande ```robo project:init``` depuis un des répertoires de votre projet.

## Bases de données

<!-- Listez ici le nom des bases de données utilisées par le projet -->

## Les comptes de test

<!-- Documentez ici les comptes utilisables pour le développement et le debug.
     Attention, documentez les compte admin et super admin UNIQUEMENT POUR LES
     ENVIRONNEMENT DE DEVELOPPEMENT, JAMAIS LA PRODUCTION !!!! -->

| Type | Environnement | Login | Passwd |
|---|---|---|---|
| **Utilisateur de test** | Prod | | |
| **Utilisateur de test** | PreProd | | |
| **Utilisateur de test** | Dév |  | |
| **Administrateur** | Dév | admin | usine |
| **Super Admin** | Dév | root | usine |

## Dépendances

### Librairies

Gérées via Composer. Voir [```composer.json```](composer.json)

### API

<!-- Mettez ici les API dont dépend le projet -->

## Documentations

* **Wordpress** : http://owned/wp_intranetdsi/?p=
* **MCD** : 
* **Workflow** :
* **Les CRON** :
