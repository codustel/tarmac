#!/usr/bin/env node
// Faux `gh` du mode démo (consoles de clonage) : `gh repo clone <owner/repo> <dossier>` affiche une progression
// crédible puis crée un dépôt vide avec la bonne remote. Aucun accès réseau ; toute autre commande échoue.
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const [cmd, sub, fullName, dest] = process.argv.slice(2);
if (cmd !== 'repo' || sub !== 'clone' || !/^[\w.-]+\/[\w.-]+$/.test(fullName ?? '') || !dest) {
  console.error('gh (demo): only `gh repo clone <owner/repo> <dir>` is available');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shown = dest.replace(os.homedir(), '~');
const steps = [
  `Cloning into '${shown}'...`,
  'remote: Enumerating objects: 1284, done.',
  'remote: Counting objects: 100% (412/412), done.',
  'remote: Compressing objects: 100% (231/231), done.',
  'remote: Total 1284 (delta 197), reused 352 (delta 158), pack-reused 872',
];
for (const s of steps) { console.log(s); await sleep(280); }
for (let p = 0; p <= 100; p += 10) { process.stdout.write(`\rReceiving objects: ${String(p).padStart(3)}% (${Math.round(12.84 * p)}/1284), ${(p * 0.0231).toFixed(2)} MiB | 18.4 MiB/s`); await sleep(90); }
console.log(', done.');
console.log('Resolving deltas: 100% (742/742), done.');
fs.mkdirSync(dest, { recursive: true });
execFileSync('git', ['-C', dest, 'init', '-q', '-b', 'main']);
execFileSync('git', ['-C', dest, 'remote', 'add', 'origin', `https://github.com/${fullName}.git`]);
