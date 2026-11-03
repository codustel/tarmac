<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/tarmac-logo-dark.svg">
    <img src="brand/tarmac-logo-light.svg" alt="Tarmac" width="360">
  </picture>
</p>

<p align="center"><strong>Tarmac — la piste locale de vos projets et de vos sessions Claude Code</strong></p>

<p align="center">Créé par <strong>Ismaël Belaaouad</strong> · Codustel — <a href="https://www.linkedin.com/in/codustel/">LinkedIn</a> · <a href="https://x.com/ismael_b_ai">X</a></p>

<p align="center"><a href="README.md">English version</a></p>

**Tarmac for Claude Code** est un tableau de bord local pour macOS. Il trouve tous les projets de vos dossiers de
code, les démarre et les arrête sur un port libre, affiche leurs logs en direct, offre une console et un menu Git
dans le navigateur, et ouvre des sessions Claude Code que vous suivez aussi depuis claude.ai ou votre téléphone. Il
tourne comme service de session sur `http://tarmac.localhost` et s'installe comme une app (PWA).

L'interface est en anglais ou en français (réglage **Langue**, ou langue du navigateur). La documentation détaillée
de `docs/` est en anglais.

![Tarmac : vue Projets](docs/assets/projects.webp)

| Todolist Claude | Console et menu Git | Réglages |
|---|---|---|
| ![Todolist Claude](docs/assets/todolist.webp) | ![Console et menu Git](docs/assets/console-git.webp) | ![Réglages](docs/assets/settings.webp) |

## Pourquoi Tarmac

Une dizaine de projets, chacun avec son `pnpm dev`, son port, son `.env`, sa pile Supabase et ses sessions Claude
Code. Tarmac les met sur une seule piste : une page pour voir ce qui existe, ce qui tourne, ce qui n'est pas à jour
avec GitHub et ce sur quoi Claude travaille, sans ouvrir dix terminaux ni se souvenir de quelle app a pris le
port 3000.

Tout reste sur votre Mac : Tarmac n'écoute que sur `127.0.0.1` et n'a aucune télémétrie. Ses seuls appels réseau
sont `git fetch` sur vos dépôts et l'API GitHub avec votre propre token, pour lister vos dépôts.

## Fonctionnalités

- **Projets** : apps web et API (Next, Vite, Nuxt, Astro, SvelteKit, Express, Fastify, NestJS, Django, FastAPI,
  Rails, Laravel, Go, Rust…), workers et projets Python, trouvés dans vos dossiers de code, monorepos compris. Un
  groupe par projet, nommé d'après son dépôt Git.
- **Lancement** : démarrer, arrêter, redémarrer, statut et logs en direct, port attribué sans conflit (fixe par
  app), apps lancées hors de Tarmac détectées et adoptées, « Libérer les ports » après un plantage.
- **Consoles** : un terminal interactif par projet dans le navigateur, commandes détectées (scripts
  `package.json`, `manage.py`, `cargo`, `go`…), virtualenv Python activé.
- **Git** : une trentaine de commandes expliquées dans un menu avec recherche (synchroniser, commiter, branches,
  mettre de côté, annuler), confirmation pour les commandes destructrices ; avance / retard et modifications non
  commitées d'un coup d'œil.
- **Claude Code** : toutes les sessions de chaque projet (actives ou terminées), sessions nouvelles ou reprises
  avec Remote Control dans une console intégrée, ouvertes aussi depuis claude.ai/code et l'app mobile.
- **Utilisation Claude** : votre plan et votre utilisation en direct dans la barre latérale (session de 5 h, semaine,
  limites par modèle comme Fable), lus avec la connexion de Claude Code ; le jeton reste sur votre Mac et n'est
  envoyé qu'à Anthropic.
- **Todolist Claude** : un suivi des tâches par projet que Claude tient à jour via le serveur MCP `tarmac` et le
  skill `/suivi`, reflété dans un artefact claude.ai et dans une copie `Todolist/` du dépôt. Un bouton **▶ Claude**
  envoie une tâche en attente à une session Claude au repos dans Tarmac, ou à une nouvelle session.
- **GitHub** : vos dépôts et organisations, ceux qui sont clonés, « Cloner » en un clic (`gh` ou SSH).
- **Supabase local** : instances lancées, Studio, Mailpit, URL de l'API et de Postgres, projet rattaché.
- **Docker** : conteneurs groupés par projet compose avec état, santé, ports, CPU et mémoire, projet rattaché,
  démarrer / arrêter / redémarrer (Docker Desktop, OrbStack, Colima).
- **Et aussi** : README rendu, éditeur et vue de contrôle de source intégrés, ouverture dans VS Code / Cursor / Zed /
  WebStorm, projets ouverts dans VS Code signalés, URL de production par app, favoris, émulateurs Android, thème
  clair / sombre.

## Prérequis

- macOS (Apple silicon ou Intel).
- [Node.js](https://nodejs.org) **22.13 ou plus récent** (Tarmac utilise `node:sqlite`, intégré à Node).
- Facultatif : [GitHub CLI](https://cli.github.com) (`gh`), Docker Desktop / OrbStack / Colima (vue Docker, Supabase local),
  [Claude Code](https://claude.com/claude-code) (sessions et Todolist Claude).

## Installation

```bash
npm install -g @codustel/tarmac
tarmac setup
```

`tarmac setup` crée `~/.tarmac/env`, installe un service de session (LaunchAgent), puis, avec votre accord et votre
mot de passe (`sudo`), ajoute `tarmac.localhost` à `/etc/hosts` et redirige le port 80 vers le port 7777 de Tarmac.
Enfin, il propose l'intégration Claude Code. Lancez d'abord `tarmac setup --dry-run` pour voir chaque action sans
rien modifier.

**L'adresse de référence est `http://tarmac.localhost:7777`** : elle marche toujours, avec ou sans `sudo` (Chrome,
Firefox et Safari résolvent `*.localhost` d'eux-mêmes). L'adresse sans port, `http://tarmac.localhost`, est un
bonus : `tarmac setup` vérifie que le port 80 atteint vraiment Tarmac et garde sinon l'adresse avec le port
(certains Mac chargent la redirection sans l'appliquer ; voir [Dépannage](docs/troubleshooting.md#port-80)).
`tarmac setup --no-sudo` saute ces étapes facultatives.

Pour installer Tarmac comme une app dans Chrome, laissez quelques secondes à la page : Chrome n'affiche son bouton
d'installation qu'après un court usage. En attendant, passez par le menu **⋮ → Caster, enregistrer et partager →
Installer la page en tant qu'application**.

Une installation **App Manager** (ancien nom de Tarmac) est migrée : son service est remplacé et ses données sont
copiées de `~/.app-manager` vers `~/.tarmac` (l'original est conservé). Si un `~/.tarmac` plus ancien existe déjà,
`tarmac setup` le signale et propose de le mettre de côté (`~/.tarmac.old-<date>`, rien n'est supprimé) avant la
copie.

## Premiers pas

1. Ouvrez `http://tarmac.localhost` (`tarmac open`). Cliquez sur **Installer l'app** dans la barre latérale pour
   avoir une icône dans le Dock.
2. Dans **Réglages**, vérifiez les dossiers à scanner (par défaut les dossiers de code usuels qui existent :
   `~/Developer`, `~/Projects`, `~/dev`, `~/code`…), puis connectez la CLI GitHub en un clic.
3. Lancez une app avec **Démarrer**, ouvrez sa console, ou ouvrez une session Claude depuis son onglet **Claude**.
4. Avec l'intégration Claude Code, tapez `/suivi init` dans une session pour créer la Todolist Claude du projet.

`~/Documents` est protégé par macOS : acceptez la demande d'accès pour `node` au premier scan (voir
[Troubleshooting](docs/troubleshooting.md#access-to-documents)).

## Commandes

```text
tarmac status | start | stop | restart | logs | open
tarmac doctor          # vérifie Node, le service, le port, le domaine, gh, Docker et Claude Code
tarmac update          # npm install -g @codustel/tarmac@latest, puis redémarrage
tarmac uninstall       # --purge supprime aussi ~/.tarmac
```

Les fenêtres ouvertes, app installée comprise, détectent une nouvelle version et se rechargent ; les apps et
consoles en cours ne sont pas touchées par une mise à jour.

## Documentation (en anglais)

- [Configuration](docs/configuration.md) : dossiers, ports, domaine, variables d'environnement, réglages.
- [Claude Code](docs/claude-code.md) : sessions, Remote Control, serveur MCP, Todolist Claude et `/suivi`.
- [Security](docs/security.md) : où Tarmac écoute, ce qu'il peut lancer, ce qui demande `sudo` et pourquoi.
- [Troubleshooting](docs/troubleshooting.md) : accès à `~/Documents`, port 80, app installée, migration.
- [Windows (WSL 2)](docs/windows.md) : utiliser Tarmac sous Windows, et ce qui n'y marche pas.
- [Uninstall](docs/uninstall.md).

## FAQ

**Pourquoi `tarmac.localhost` ?** Les navigateurs considèrent `localhost` et `*.localhost` comme des contextes
sécurisés, nécessaires à l'app installée (PWA), au service worker et au presse-papiers. `http://tarmac.test`
fonctionne aussi et redirige vers cette adresse.

**Windows ou Linux ?** Tarmac est fait pour macOS et `tarmac setup` ne tourne que là. Sous Windows, il tourne dans
WSL 2, lancé à la main, avec quelques fonctions en moins : voir [Windows (WSL 2)](docs/windows.md).

**Le port 80 est déjà pris.** Tarmac reste alors sur `http://tarmac.localhost:7777` ; rien d'autre ne change.

**Un autre port ou domaine ?** Oui : `tarmac setup --domain mon.localhost`, et `TARMAC_PORT` dans `~/.tarmac/env`
(voir [Configuration](docs/configuration.md)).

**Faut-il un abonnement Claude ?** Seulement pour les fonctions Claude. Remote Control demande Claude Code connecté
à claude.ai (`/login`), pas une clé d'API.

## Contribuer

Issues et pull requests bienvenues, en français ou en anglais : voir [CONTRIBUTING.md](CONTRIBUTING.md). Les
failles de sécurité se signalent en privé ([SECURITY.md](SECURITY.md)).

## Licence

[MIT](LICENSE) — © 2026 Ismaël Belaaouad ([Codustel](https://www.linkedin.com/in/codustel/)). Suivez le projet sur [LinkedIn](https://www.linkedin.com/in/codustel/) et [X](https://x.com/ismael_b_ai).

Projet indépendant, non affilié à Anthropic. Claude et Claude Code sont des marques d'Anthropic.
