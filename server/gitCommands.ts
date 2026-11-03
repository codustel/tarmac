/**
 * Catalogue des commandes git proposées dans la console. Le serveur n'exécute que ces commandes
 * (pas de commande libre via l'API) ; les paramètres sont validés puis échappés.
 */
import { appError, type Loc } from './i18n.js';

export type GitArg = 'message' | 'branch' | 'optional-message';

export interface GitCommand {
  id: string;
  group: Loc;
  label: string;
  description: Loc;
  /** `{arg}` est remplacé par le paramètre échappé. */
  cmd: string;
  arg?: GitArg;
  argLabel?: Loc;
  /** Commande qui modifie / supprime des changements locaux → confirmation dans l'UI. */
  danger?: boolean;
}

export const GIT_COMMANDS: GitCommand[] = [
  // ── Situation
  { id: 'status', group: { en: 'Status', fr: 'Situation' }, label: 'git status', cmd: 'git status',
    description: {
      en: 'Repository state: current branch, modified, staged and untracked files.',
      fr: 'État du dépôt : branche courante, fichiers modifiés, indexés et non suivis.' } },
  { id: 'log', group: { en: 'Status', fr: 'Situation' }, label: 'git log', cmd: 'git --no-pager log --oneline --graph --decorate -n 30',
    description: {
      en: 'The last 30 commits as a graph, with branches and tags.',
      fr: 'Les 30 derniers commits sous forme de graphe, avec branches et tags.' } },
  { id: 'diff', group: { en: 'Status', fr: 'Situation' }, label: 'git diff', cmd: 'git --no-pager diff --stat && git --no-pager diff',
    description: {
      en: 'Changes not staged yet (what you changed since the last “add”).',
      fr: 'Modifications pas encore indexées (ce que tu as changé depuis le dernier « add »).' } },
  { id: 'diff-staged', group: { en: 'Status', fr: 'Situation' }, label: 'git diff --staged', cmd: 'git --no-pager diff --cached --stat && git --no-pager diff --cached',
    description: {
      en: 'What will go into the next commit (staged changes).',
      fr: 'Ce qui partira dans le prochain commit (changements indexés).' } },
  { id: 'branches', group: { en: 'Status', fr: 'Situation' }, label: 'git branch -vv -a', cmd: 'git --no-pager branch -vv -a',
    description: {
      en: 'All local and remote branches, with the tracked branch and how far ahead / behind it is.',
      fr: 'Toutes les branches locales et distantes, avec la branche suivie et l’avance / le retard.' } },
  { id: 'remote', group: { en: 'Status', fr: 'Situation' }, label: 'git remote -v', cmd: 'git remote -v',
    description: {
      en: 'Configured remotes (origin…) and their URLs.',
      fr: 'Dépôts distants configurés (origin…) et leurs URL.' } },

  // ── Synchroniser
  { id: 'fetch', group: { en: 'Sync', fr: 'Synchroniser' }, label: 'git fetch', cmd: 'git fetch --all --prune && git status -sb',
    description: {
      en: 'Gets the remote state without touching your code, then shows ahead / behind.',
      fr: 'Récupère l’état du distant sans toucher à ton code, puis affiche l’avance / le retard.' } },
  { id: 'pull', group: { en: 'Sync', fr: 'Synchroniser' }, label: 'git pull --ff-only', cmd: 'git pull --ff-only',
    description: {
      en: 'Gets and applies remote commits, only if there is no divergence (no implicit merge).',
      fr: 'Récupère et applique les commits distants, uniquement s’il n’y a pas de divergence (aucun merge implicite).' } },
  { id: 'pull-rebase', group: { en: 'Sync', fr: 'Synchroniser' }, label: 'git pull --rebase', cmd: 'git pull --rebase --autostash',
    description: {
      en: 'Replays your local commits on top of the remote ones (linear history). Work in progress is stashed then reapplied.',
      fr: 'Rejoue tes commits locaux par-dessus ceux du distant (historique linéaire). Les modifs en cours sont mises de côté puis réappliquées.' } },
  { id: 'push', group: { en: 'Sync', fr: 'Synchroniser' }, label: 'git push', cmd: 'git push',
    description: {
      en: 'Sends your local commits to the tracked remote branch.',
      fr: 'Envoie tes commits locaux sur la branche distante suivie.' } },
  { id: 'push-upstream', group: { en: 'Sync', fr: 'Synchroniser' }, label: 'git push -u origin HEAD', cmd: 'git push -u origin HEAD',
    description: {
      en: 'Publishes a new branch on GitHub and links it to the remote (first push of a branch).',
      fr: 'Publie une nouvelle branche sur GitHub et la lie au distant (premier push d’une branche).' } },

  // ── Commiter
  { id: 'add-all', group: { en: 'Commit', fr: 'Commiter' }, label: 'git add -A', cmd: 'git add -A && git status -s',
    description: {
      en: 'Stages all changes (modified, new, deleted) for the next commit.',
      fr: 'Indexe tous les changements (modifiés, nouveaux, supprimés) pour le prochain commit.' } },
  { id: 'commit', group: { en: 'Commit', fr: 'Commiter' }, label: 'git commit -m', cmd: 'git commit -m {arg}', arg: 'message', argLabel: { en: 'Commit message', fr: 'Message du commit' },
    description: {
      en: 'Creates a commit with the changes already staged.',
      fr: 'Crée un commit avec les changements déjà indexés.' } },
  { id: 'commit-all', group: { en: 'Commit', fr: 'Commiter' }, label: 'git add -A && git commit -m', cmd: 'git add -A && git commit -m {arg}', arg: 'message', argLabel: { en: 'Commit message', fr: 'Message du commit' },
    description: {
      en: 'Stages everything then commits in one step.',
      fr: 'Indexe tout puis commite en une seule étape.' } },
  { id: 'commit-push', group: { en: 'Commit', fr: 'Commiter' }, label: 'add + commit + push', cmd: 'git add -A && git commit -m {arg} && git push', arg: 'message', argLabel: { en: 'Commit message', fr: 'Message du commit' },
    description: {
      en: 'Stages everything, commits and pushes to GitHub — the everyday shortcut.',
      fr: 'Indexe tout, commite et pousse sur GitHub — le raccourci du quotidien.' } },
  { id: 'amend', group: { en: 'Commit', fr: 'Commiter' }, label: 'git commit --amend --no-edit', cmd: 'git commit --amend --no-edit', danger: true,
    description: {
      en: 'Adds the staged changes to the last commit without changing its message. Avoid it if that commit is already pushed.',
      fr: 'Ajoute les changements indexés au dernier commit sans changer son message. À éviter si ce commit est déjà poussé.' } },

  // ── Branches
  { id: 'switch', group: { en: 'Branches', fr: 'Branches' }, label: 'git switch', cmd: 'git switch {arg}', arg: 'branch', argLabel: { en: 'Branch', fr: 'Branche' },
    description: {
      en: 'Switches to an existing branch (local, or remote with the same name).',
      fr: 'Bascule sur une branche existante (locale, ou distante du même nom).' } },
  { id: 'create-branch', group: { en: 'Branches', fr: 'Branches' }, label: 'git switch -c', cmd: 'git switch -c {arg}', arg: 'branch', argLabel: { en: 'New branch', fr: 'Nouvelle branche' },
    description: {
      en: 'Creates a branch from the current branch and switches to it.',
      fr: 'Crée une branche à partir de la branche courante et bascule dessus.' } },
  { id: 'switch-prev', group: { en: 'Branches', fr: 'Branches' }, label: 'git switch -', cmd: 'git switch -',
    description: {
      en: 'Goes back to the previous branch.',
      fr: 'Revient sur la branche précédente.' } },
  { id: 'merge', group: { en: 'Branches', fr: 'Branches' }, label: 'git merge', cmd: 'git merge {arg}', arg: 'branch', argLabel: { en: 'Branch to merge', fr: 'Branche à fusionner' },
    description: {
      en: 'Merges the given branch into the current branch.',
      fr: 'Fusionne la branche indiquée dans la branche courante.' } },

  // ── Mettre de côté
  { id: 'stash', group: { en: 'Stash', fr: 'Mettre de côté' }, label: 'git stash -u', cmd: 'git stash push -u {arg}', arg: 'optional-message', argLabel: { en: 'Description (optional)', fr: 'Description (optionnelle)' },
    description: {
      en: 'Stashes all work in progress (including new files) to get a clean repository.',
      fr: 'Met de côté toutes les modifs en cours (y compris les nouveaux fichiers) pour retrouver un dépôt propre.' } },
  { id: 'stash-list', group: { en: 'Stash', fr: 'Mettre de côté' }, label: 'git stash list', cmd: 'git --no-pager stash list',
    description: {
      en: 'Lists the stashed changes.',
      fr: 'Liste les modifs mises de côté.' } },
  { id: 'stash-pop', group: { en: 'Stash', fr: 'Mettre de côté' }, label: 'git stash pop', cmd: 'git stash pop',
    description: {
      en: 'Reapplies the last stash and removes it from the list.',
      fr: 'Réapplique la dernière mise de côté et la retire de la liste.' } },

  // ── Annuler
  { id: 'unstage', group: { en: 'Undo', fr: 'Annuler' }, label: 'git restore --staged .', cmd: 'git restore --staged . && git status -s',
    description: {
      en: 'Unstages everything, without losing any change.',
      fr: 'Désindexe tout, sans perdre aucune modification.' } },
  { id: 'undo-commit', group: { en: 'Undo', fr: 'Annuler' }, label: 'git reset --soft HEAD~1', cmd: 'git reset --soft HEAD~1 && git status -s', danger: true,
    description: {
      en: 'Undoes the last commit but keeps its changes, staged. Avoid it if the commit is already pushed.',
      fr: 'Annule le dernier commit mais garde ses changements, indexés. À éviter si le commit est déjà poussé.' } },
  { id: 'restore', group: { en: 'Undo', fr: 'Annuler' }, label: 'git restore .', cmd: 'git restore . && git status -s', danger: true,
    description: {
      en: 'Discards unstaged changes of tracked files. Irreversible.',
      fr: 'Jette les modifications non indexées des fichiers suivis. Irréversible.' } },
  { id: 'clean-preview', group: { en: 'Undo', fr: 'Annuler' }, label: 'git clean -nd', cmd: 'git clean -nd',
    description: {
      en: 'Preview: lists the untracked files a clean would delete (deletes nothing).',
      fr: 'Aperçu : liste les fichiers non suivis qu’un nettoyage supprimerait (ne supprime rien).' } },
  { id: 'clean', group: { en: 'Undo', fr: 'Annuler' }, label: 'git clean -fd', cmd: 'git clean -fd', danger: true,
    description: {
      en: 'Deletes untracked files and folders (except .gitignore). Irreversible.',
      fr: 'Supprime les fichiers et dossiers non suivis (hors .gitignore). Irréversible.' } },
  { id: 'reset-remote', group: { en: 'Undo', fr: 'Annuler' }, label: 'git reset --hard @{u}', cmd: 'git fetch && git reset --hard @{u}', danger: true,
    description: {
      en: 'Aligns the branch exactly on the remote: ALL local changes and unpushed commits are lost.',
      fr: 'Aligne exactement la branche sur le distant : TOUTES les modifs et commits locaux non poussés sont perdus.' } },
];

export const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Construit la commande ; erreur si le paramètre est invalide. */
export function buildGitCommand(id: string, arg?: string): { cmd: GitCommand; shell: string } {
  const cmd = GIT_COMMANDS.find((c) => c.id === id);
  if (!cmd) throw appError('git.unknownCommand', undefined, 400);
  let value = '';
  if (cmd.arg === 'message') {
    const m = (arg ?? '').trim();
    if (!m) throw appError('git.messageRequired', undefined, 400);
    value = quote(m.slice(0, 2000));
  } else if (cmd.arg === 'optional-message') {
    const m = (arg ?? '').trim();
    value = m ? `-m ${quote(m.slice(0, 500))}` : '';
  } else if (cmd.arg === 'branch') {
    const b = (arg ?? '').trim();
    // Nom de branche git valide, sans option déguisée.
    if (!/^[A-Za-z0-9][\w./-]{0,199}$/.test(b) || b.includes('..') || b.endsWith('.lock') || b.endsWith('/')) throw appError('git.badBranch', undefined, 400);
    value = quote(b);
  }
  return { cmd, shell: cmd.cmd.replace('{arg}', value).replace(/\s+$/, '') };
}
