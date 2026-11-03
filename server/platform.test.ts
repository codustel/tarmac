import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import {
  CIM_PROCESSES, chain, commandArgs, commandLine, parseCimProcesses, detectShell, parseNetstat, parseTasklist, portOwnerHint, prependPath, quote, shellLabel,
  spawnCommand, type Shell,
} from './platform.js';

const zsh: Shell = { kind: 'posix', file: '/bin/zsh' };
const pwsh: Shell = { kind: 'pwsh', file: 'pwsh.exe' };
const ps51: Shell = { kind: 'powershell', file: 'powershell.exe' };
const decode = (args: string[]) => Buffer.from(args.at(-1)!, 'base64').toString('utf16le');

test('detectShell : $SHELL sous macOS, pwsh puis powershell.exe sous Windows', () => {
  assert.deepEqual(detectShell('darwin', { SHELL: '/bin/bash' }), { kind: 'posix', file: '/bin/bash' });
  assert.deepEqual(detectShell('darwin', {}), zsh);
  assert.deepEqual(detectShell('win32', {}, () => true), pwsh);
  assert.deepEqual(detectShell('win32', {}, () => false), ps51);
  assert.deepEqual([zsh, pwsh, ps51].map((s) => shellLabel(s)), ['zsh', 'pwsh', 'powershell']);
});

test('quote : sh et PowerShell', () => {
  assert.equal(quote("l'été", zsh), `'l'\\''été'`);
  assert.equal(quote("l'été", pwsh), `'l''été'`);
  assert.equal(quote('a ‘b’ $x `c` @{u}', ps51), `'a ‘‘b’’ $x \`c\` @{u}'`);
  // 5.1 : un `"` ne passe pas sans risque (argument coupé, option ajoutée à git) → refus.
  assert.throws(() => quote('x" --amend "y', ps51), /PowerShell 7/);
  assert.equal(quote('C:\\mon dossier\\', ps51), "'C:\\mon dossier\\\\'");
  assert.equal(quote('x" --amend "y', pwsh), `'x" --amend "y'`);
});

test('chain : && sauf en Windows PowerShell 5.1', () => {
  assert.equal(chain(['a', 'b', 'c'], zsh), 'a && b && c');
  assert.equal(chain(['a', 'b', 'c'], pwsh), 'a && b && c');
  assert.equal(chain(['a', 'b', 'c'], ps51), 'a; if ($?) { b; if ($?) { c } }');
  assert.equal(chain(['a'], ps51), 'a');
});

test('commandArgs : -c sous macOS, commande encodée sous Windows', () => {
  assert.deepEqual(commandArgs('ls -la', zsh), ['-c', 'ls -la']);
  const args = commandArgs(`git commit -m 'é "x"'`, pwsh);
  assert.deepEqual(args.slice(0, -1), ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
  assert.equal(decode(args), `git commit -m 'é "x"'`);
});

test('spawnCommand : inchangé sous macOS, via PowerShell sous Windows', () => {
  assert.deepEqual(spawnCommand('pnpm', ['run', 'dev'], zsh), { file: 'pnpm', args: ['run', 'dev'] });
  const npm = spawnCommand('pnpm', ['run', 'dev', '--port', '3100'], pwsh);
  assert.equal(npm.file, 'pwsh.exe');
  assert.equal(decode(npm.args), `& 'pnpm' 'run' 'dev' '--port' '3100'`);
  const script = spawnCommand('/bin/sh', ['-c', 'next dev -p 3101'], ps51);
  assert.equal(script.file, 'powershell.exe');
  assert.equal(decode(script.args), 'next dev -p 3101');
});

test('commandLine : arguments simples non échappés en sh', () => {
  assert.equal(commandLine('code', ['/srv/mon projet'], zsh), `code '/srv/mon projet'`);
  assert.equal(commandLine('code', ['C:\\src\\app'], pwsh), `& 'code' 'C:\\src\\app'`);
});

test('prependPath : clé Path unique sous Windows', () => {
  const win: Record<string, string | undefined> = { Path: 'C:\\Windows', PATH: 'doublon' };
  prependPath(win, ['C:\\app\\node_modules\\.bin'], 'win32');
  assert.deepEqual(win, { Path: 'C:\\app\\node_modules\\.bin;C:\\Windows' });
  const mac: Record<string, string | undefined> = { PATH: '/usr/bin' };
  prependPath(mac, ['/a', '/b'], 'darwin');
  assert.deepEqual(mac, { PATH: '/a:/b:/usr/bin' });
  prependPath(mac, [], 'darwin');
  assert.equal(mac.PATH, '/a:/b:/usr/bin');
});

test('parseNetstat : écoutes TCP v4 et v6, quelle que soit la langue de l’état', () => {
  const out = [
    '',
    'Connexions actives',
    '',
    '  Proto  Adresse locale         Adresse distante       État',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012',
    '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4242',
    '  TCP    127.0.0.1:5173         127.0.0.1:61000        ESTABLISHED     4242',
    '  TCP    127.0.0.1:61000        127.0.0.1:5173         ESTABLISHED     7777',
    '  TCP    0.0.0.0:51730          0.0.0.0:0              ABHÖREN         9999',
    '  TCP    [::1]:5173             [::]:0                 LISTENING       4243',
    '  UDP    0.0.0.0:5173           *:*                                    555',
  ].join('\r\n');
  assert.deepEqual(parseNetstat(out, 5173), [4242, 4243]);
  assert.deepEqual(parseNetstat(out, 51730), [9999]);
  assert.deepEqual(parseNetstat(out, 80), []);
});

test('parseTasklist : nom d’image ou rien', () => {
  assert.equal(parseTasklist('"node.exe","4242","Console","1","45 120 Ko"\r\n'), 'node.exe');
  assert.equal(parseTasklist('INFO: No tasks are running which match the specified criteria.\r\n'), '');
});

test('portOwnerHint', () => {
  assert.match(portOwnerHint(7777, 'darwin'), /^lsof /);
  assert.equal(portOwnerHint(7777, 'win32'), 'netstat -ano | findstr :7777');
});

// Aller-retour réel : la valeur échappée, relue par le shell, doit revenir telle quelle (pas d'injection).
const HOSTILE = [
  "l'apostrophe", "'; echo PWNED; '", '$(echo PWNED)', '`echo PWNED`', 'a`nb', 'ligne 1\nligne 2', '‘courbes’ ‚‛',
  '$env:HOME $HOME', '@{u} @(1) ${x}', '"; Write-Output PWNED; "', 'a "b" c', 'x" --amend "y', 'C:\\mon dossier\\',
  'a\\"b', '%PATH% & | > <', '-c', '',
];
const WIN = process.platform === 'win32';
// pwsh (7) sous macOS / Linux / Windows ; Windows PowerShell 5.1 seulement sous Windows.
const pwshPath = WIN ? 'pwsh.exe' : ['/usr/local/bin/pwsh', '/opt/homebrew/bin/pwsh', '/usr/bin/pwsh'].find((f) => fs.existsSync(f));
const shells: Shell[] = [
  ...(pwshPath && spawnSync(pwshPath, ['-NoProfile', '-Command', 'exit 0']).status === 0 ? [{ kind: 'pwsh' as const, file: pwshPath }] : []),
  ...(WIN ? [{ kind: 'powershell' as const, file: 'powershell.exe' }] : []),
];
// Programme natif qui renvoie ses arguments séparés par NUL (node : présent partout où tournent les tests).
const ECHO_ARGS = ['-e', "process.stdout.write(process.argv.slice(1).map((a) => a + String.fromCharCode(0)).join(''))"];

test('quote sh : aller-retour par /bin/sh', { skip: WIN && 'pas de /bin/sh' }, () => {
  for (const s of HOSTILE) {
    const out = execFileSync('/bin/sh', commandArgs(`printf %s ${quote(s, zsh)}`, zsh), { encoding: 'utf8' });
    assert.equal(out, s);
  }
});

for (const sh of shells) {
  test(`quote ${sh.kind} : aller-retour (chaîne et arguments d’un programme natif)`, () => {
    // Chaîne PowerShell : seule l'apostrophe compte (l'échappement natif de 5.1 ne vaut que pour les programmes).
    if (sh.kind === 'pwsh') {
      const script = HOSTILE.map((s) => `[Console]::Out.Write(${quote(s, sh)} + [char]0)`).join('; ');
      const out = execFileSync(sh.file, commandArgs(script, sh), { encoding: 'utf8' });
      assert.deepEqual(out.split('\0').slice(0, -1), HOSTILE);
    }
    // Arguments d'un programme natif (& 'prog' 'arg'…) ; PowerShell retire les chaînes vides.
    const args = HOSTILE.filter((s) => s && !(sh.kind === 'powershell' && s.includes('"')));
    const out = execFileSync(sh.file, commandArgs(commandLine(process.execPath, [...ECHO_ARGS, ...args], sh), sh), { encoding: 'utf8' });
    assert.deepEqual(out.split('\0').slice(0, -1), args);
  });
}

test('chain 5.1 : la suite ne s’exécute qu’après un succès (vérifié dans PowerShell)', { skip: !shells.length && 'PowerShell absent' }, () => {
  const sh: Shell = { kind: 'powershell', file: shells.at(-1)!.file };
  const exit = (code: number) => commandLine(process.execPath, ['-e', `process.exit(${code})`], sh);
  // Code de sortie non nul quand la dernière commande native échoue : on ne lit que la sortie.
  const run = (steps: string[]) => spawnSync(sh.file, commandArgs(chain(steps, sh), sh), { encoding: 'utf8' }).stdout.trim();
  assert.equal(run([exit(0), 'Write-Output A', exit(1), 'Write-Output B']), 'A');
  assert.equal(run([exit(1), 'Write-Output A']), '');
});

test('parseCimProcesses : lignes de Get-CimInstance', () => {
  const out = '4\t0\t9000\tSystem\t\r\n812\t640\t42\tclaude.exe\t"C:\\Users\\a\\.local\\bin\\claude.exe" --resume 0f1e2d3c\r\n\r\nbad line\r\n';
  assert.deepEqual(parseCimProcesses(out), [
    { pid: 4, ppid: 0, etimeSec: 9000, comm: 'System', args: '' },
    { pid: 812, ppid: 640, etimeSec: 42, comm: 'claude.exe', args: '"C:\\Users\\a\\.local\\bin\\claude.exe" --resume 0f1e2d3c' },
  ]);
});

test('CIM_PROCESSES : script valide dans PowerShell (process simulés)', { skip: !shells.length && 'PowerShell absent' }, () => {
  const sh = shells[0];
  const fake = "@([pscustomobject]@{ ProcessId = 812; ParentProcessId = 640; Name = 'codex.exe'; CommandLine = \"codex`tresume`r`nx\"; CreationDate = (Get-Date).AddSeconds(-30) })";
  const out = execFileSync(sh.file, commandArgs(CIM_PROCESSES.replace('Get-CimInstance Win32_Process', fake), sh), { encoding: 'utf8' });
  const [row] = parseCimProcesses(out);
  assert.equal(row.pid, 812);
  assert.equal(row.comm, 'codex.exe');
  assert.equal(row.args, 'codex resume x');
  assert.ok(row.etimeSec >= 29 && row.etimeSec <= 40, String(row.etimeSec));
});
