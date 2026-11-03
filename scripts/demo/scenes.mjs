// Scènes capturées par capture.mjs (instance de démo). Fichiers : `<scène>/<langue>-<thème>[-NN].png`, vidéos
// `videos/<nom>.mp4`. COVERAGE relie chaque fonctionnalité du README à ses captures (tableau de index.md).
import fs from 'node:fs';
import path from 'node:path';

const ALL = [['en', 'dark'], ['en', 'light'], ['fr', 'dark'], ['fr', 'light']];
const v = (lang, theme, n) => `${lang}-${theme}${n ? `-${String(n).padStart(2, '0')}` : ''}`;
const RUNNING = ['rocket-api', 'launch-queue', 'orbit-insights', 'launchpad-docs'];
const CLONE = 'zero-gravity-ui';
/** Fenêtre de capture (comme capture.mjs). */
const VW_ = 1920, VH_ = 1080;

export const COVERAGE = [
  { feature: 'Projets : détection des types (web, API, worker, Python, mobile, monorepo), icônes, groupes', files: ['projets/en-dark-01.png', 'projets/en-light-01.png', 'projets/fr-dark-01.png', 'projets/fr-light-01.png'] },
  { feature: 'Badge et vue monorepo (Turborepo, « Start all »)', files: ['projets/en-dark-01.png', 'navigateur/en-dark-05.png'] },
  { feature: 'Filtres (en cours, favoris, dans VS Code, langages), tri, filtre GitHub', files: ['projets/en-dark-02.png', 'projets/en-dark-03.png', 'projets/en-dark-04.png', 'projets/en-dark-05.png', 'projets/en-dark-06.png'] },
  { feature: 'Favoris', files: ['projets/en-dark-03.png'] },
  { feature: '« Open in VS Code » / Finder, badge et filtre « dans l’éditeur »', files: ['projets/en-dark-04.png'] },
  { feature: 'URL de production cliquable et saisie manuelle', files: ['url-prod/'] },
  { feature: 'Lancer : démarrer, arrêter, statut, port automatique, logs en direct', files: ['demarrage/', 'videos/demarrage-logs.mp4', 'videos/demarrage-boutique-navigateur.mp4'] },
  { feature: 'Panneau projet (onglets)', files: ['panneau/', 'videos/ouverture-panneau.mp4'] },
  { feature: 'Navigateur interne et tailles d’écran (bureau, portable, tablette, mobile), « Start all » qui l’ouvre', files: ['navigateur/', 'videos/navigateur-tailles.mp4'] },
  { feature: 'Consoles : shell interactif, commandes détectées, virtualenv Python', files: ['console/'] },
  { feature: 'Git : menu de commandes, en avance / en retard, changements non commités', files: ['console-git/', 'videos/menu-git.mp4', 'projets/en-dark-01.png'] },
  { feature: 'Claude Code : sessions par projet, ouverture en onglet, onglet séparé du navigateur', files: ['claude/', 'panneau/en-dark-04.png', 'videos/ouverture-session-claude.mp4'] },
  { feature: 'Todolist Claude dans Tarmac (vue globale, vue projet, coche)', files: ['todolist/', 'videos/coche-tache.mp4'] },
  { feature: 'Todolist Claude : artefact claude.ai (gabarit rendu en local)', files: ['artefact/'] },
  { feature: 'GitHub : dépôts, clonés, « Clone » avec progression dans une console', files: ['github/', 'videos/clonage.mp4'] },
  { feature: 'Supabase local : instances, Studio, Mailpit, URL', files: ['supabase/'] },
  { feature: 'Docker : conteneurs par projet compose, état, santé, ports, CPU / mémoire, actions', files: ['docker/'] },
  { feature: 'Utilisation Claude dans la sidebar : plan, session 5 h, semaine, limites par modèle (Fable)', files: ['utilisation/'] },
  { feature: 'README rendu', files: ['panneau/en-dark-05.png', 'panneau/en-light-05.png'] },
  { feature: 'IDE intégré et vue de contrôle de source', files: ['ide/'] },
  { feature: 'Ports : attribution, historique, « Free the ports »', files: ['ports/'] },
  { feature: 'Android : diagnostic et émulateurs', files: ['android/'] },
  { feature: 'Installation en PWA', files: ['pwa/'] },
  { feature: 'Réglages', files: ['reglages/'] },
  { feature: 'Thème clair / sombre', files: ['bascule-theme/', 'videos/bascule-theme.mp4'] },
  { feature: 'Interface anglais / français', files: ['bascule-langue/', 'videos/bascule-langue.mp4'] },
];

export async function scenario(x) {
  const { api, projects, waitStatus, shot, record, newPage, go, row, openPanel, panel, panelTab, serveArtifact, sleep, say, want } = x;
  const ids = Object.fromEntries((await projects()).map((p) => [p.name, p.id]));
  const { home } = await api('/api/meta');
  const status = async (name) => (await projects()).find((p) => p.name === name)?.runtime.status;
  const start = async (name) => { if ((await status(name)) !== 'running') await api(`/api/projects/${ids[name]}/start`, 'POST'); };
  const stopAll = async () => {
    for (const p of await projects()) if (!['stopped', 'crashed'].includes(p.runtime.status)) await api(`/api/projects/${p.id}/stop`, 'POST').catch(() => null);
    for (const p of await projects()) if (p.serve) await waitStatus(p.name, 'stopped', 15_000).catch(() => null);
  };

  // ─── Préparation : apps arrêtées, consoles fermées, clone de démo retiré, deux sessions Claude ouvertes ──
  await api('/api/ports/free', 'POST');
  await stopAll();
  for (const t of await api('/api/terminals')) await api(`/api/terminals/${t.id}`, 'DELETE');
  if (home && fs.existsSync(path.join(home, 'Developer', CLONE))) { fs.rmSync(path.join(home, 'Developer', CLONE), { recursive: true, force: true }); await api('/api/scan', 'POST'); }
  await api(`/api/projects/${ids['rocket-api']}/url`, 'PUT', { url: '' });
  const sessions = await api('/api/claude/sessions');
  for (const title of ['Launch table with filters', 'Pagination on /v1/missions']) {
    const s = sessions.find((s_) => s_.title === title);
    await api(`/api/projects/${s.project.id}/claude`, 'POST', { resume: s.id, cols: 120, rows: 34 });
  }

  // ─── Démarrage d'un projet : avant / pendant / en cours, puis vidéos ──────────────────────────────────
  if (want('demarrage')) {
    const page = await newPage();
    await go(page, 'projects');
    await openPanel(page, 'nebula-store');
    await shot(page, 'demarrage', v('en', 'dark', 1), 'nebula-store arrêté : bouton Start, panneau Logs vide');
    await row(page, 'nebula-store').getByRole('button', { name: 'Start' }).click();
    await sleep(250);
    await shot(page, 'demarrage', v('en', 'dark', 2), 'Démarrage en cours (statut « Starting »)', { wait: 0 });
    await waitStatus('nebula-store', 'running');
    await sleep(1200);
    await panelTab(page, /^Logs/);
    await shot(page, 'demarrage', v('en', 'dark', 3), 'En cours : statut, port, journaux Vite en direct');
    await panelTab(page, /^Browser/);
    await sleep(2500);
    await shot(page, 'demarrage', v('en', 'dark', 4), 'Navigateur interne : la boutique Nebula Store');
    await page.context().close();

    const vp = await newPage();
    await go(vp, 'projects');
    await openPanel(vp, 'launch-queue');
    await record(vp, 'demarrage-logs', 'Démarrage du worker launch-queue (BullMQ), journaux en direct qui défilent', async () => {
      await sleep(800);
      await row(vp, 'launch-queue').getByRole('button', { name: 'Start' }).click();
      await sleep(9000);
    });
    await vp.context().close();

    await api(`/api/projects/${ids['nebula-store']}/stop`, 'POST');
    await waitStatus('nebula-store', 'stopped').catch(() => null);
    const vb = await newPage();
    await go(vb, 'projects');
    await openPanel(vb, 'nebula-store');
    await record(vb, 'demarrage-boutique-navigateur', 'Démarrage de la boutique (Vite), statut et port, puis navigateur interne', async () => {
      await sleep(800);
      await row(vb, 'nebula-store').getByRole('button', { name: 'Start' }).click();
      await waitStatus('nebula-store', 'running');
      await sleep(1800);
      await panelTab(vb, /^Browser/);
      await sleep(3500);
    });
    await vb.context().close();
  }

  // Apps en cours pour les vues suivantes (mission-control reste arrêté pour « Start all »).
  await start('nebula-store');
  for (const n of RUNNING) await start(n).catch((e) => say(`${n} : ${e.message}`));
  for (const n of ['nebula-store', ...RUNNING]) await waitStatus(n, 'running', 45_000).catch((e) => say(e.message));
  const port = (await projects()).find((p) => p.name === 'rocket-api').runtime.port;
  for (const p of ['/health', '/v1/missions?page=1', '/v1/launches', '/v1/launches/M-281', '/v1/missions?page=2', '/v1/launches/M-999']) {
    await fetch(`http://localhost:${port}${p}`).catch(() => null);
    await sleep(120);
  }
  await sleep(1500);

  const panelTabs = (lang) => [
    [/^Logs/, 'Logs : journaux en direct'],
    [lang === 'fr' ? /^Navigateur/ : /^Browser/, 'Navigateur interne : la boutique'],
    [/^Console/, 'Console : shell dans le dossier du projet'],
    [/^Claude(?! Todolist)/, 'Claude : sessions du projet, dont une active'],
    [/^README/, 'README illustré rendu'],
    [lang === 'fr' ? /^Todolist Claude/ : /^Claude Todolist/, 'Todolist Claude du projet'],
  ];

  for (const [lang, theme] of ALL) {
    const en = lang === 'en';
    const dark = theme === 'dark';
    const page = await newPage({ lang, theme });

    // ─── Projets ──────────────────────────────────────────────────────────────────────────────────────
    if (want('projets')) {
      await go(page, 'projects');
      await shot(page, 'projets', v(lang, theme, 1), 'Vue d’ensemble : types détectés et icônes, groupes, monorepo, apps en cours, Git, ports, URL de prod');
      if (en && dark) {
        const filter = async (re) => { await page.getByRole('button', { name: re }).first().click(); await sleep(600); };
        await filter(/^Running/);
        await shot(page, 'projets', v(lang, theme, 2), 'Filtre « Running » : apps démarrées et consoles actives');
        await filter(/^Favorites/);
        await shot(page, 'projets', v(lang, theme, 3), 'Filtre « Favorites » : projets favoris (étoile)');
        await filter(/^Open in VS Code/);
        await shot(page, 'projets', v(lang, theme, 4), 'Filtre « Open in VS Code » : projets ouverts dans l’éditeur (badge VS Code)');
        await filter(/^All projects/);
        await page.locator('select').filter({ hasText: 'GitHub: all' }).selectOption({ label: 'Out of sync (push / pull / changes)' });
        await sleep(600);
        await shot(page, 'projets', v(lang, theme, 5), 'Filtre GitHub « Out of sync » : à pousser, à tirer, changements non commités');
        await page.locator('select').filter({ hasText: 'GitHub:' }).selectOption({ label: 'GitHub: all' });
        await page.locator('select').filter({ hasText: 'Sort:' }).selectOption({ label: 'Sort: name' });
        await sleep(600);
        await shot(page, 'projets', v(lang, theme, 6), 'Tri par nom');
        await page.locator('select').filter({ hasText: 'Sort:' }).selectOption({ label: 'Sort: last modified' });
      }
    }

    // ─── Panneau projet : onglets ─────────────────────────────────────────────────────────────────────
    if (want('panneau')) {
      await go(page, 'projects');
      await openPanel(page, 'nebula-store');
      let n = 0;
      for (const [label, desc] of panelTabs(lang)) {
        n += 1;
        await panelTab(page, label);
        if (n === 2) await sleep(2500);
        if (n === 3 && !(await panel(page).locator('.xterm').count())) {
          await panel(page).getByRole('button', { name: /^Shell/ }).first().click();
          await sleep(1500);
          await page.keyboard.type('git status -sb && git log --oneline -6\n');
          await sleep(1200);
        }
        if (n === 4 || n === 6) await sleep(800);
        await shot(page, 'panneau', v(lang, theme, n), desc);
      }

      // Console avec le menu Git ouvert (anglais) + vidéo.
      if (en) {
        await panelTab(page, /^Console/);
        await shot(page, 'console-git', v(lang, theme, 1), 'Console : shell avec git status et git log');
        const gitBtn = panel(page).getByRole('button', { name: /^Git$/ }).first();
        await gitBtn.click();
        await sleep(700);
        await shot(page, 'console-git', v(lang, theme, 2), 'Menu Git ouvert : commandes expliquées, recherche, état de la branche');
        await gitBtn.click();
        await sleep(400);
        if (dark) {
          await record(page, 'menu-git', 'Ouverture du menu Git, survol des commandes, fermeture', async () => {
            await sleep(700);
            await gitBtn.click();
            await sleep(900);
            const items = page.locator('[title^="$ git"]');
            for (let i = 0; i < Math.min(6, await items.count()); i++) { await items.nth(i).hover(); await sleep(350); }
            await sleep(800);
            await gitBtn.click();
            await sleep(700);
          });
        }
      }
    }

    // ─── Sessions Claude ──────────────────────────────────────────────────────────────────────────────
    if (want('claude')) {
      await go(page, 'claude');
      await sleep(1200);
      await shot(page, 'claude', v(lang, theme, 1), 'Sessions Claude : onglets des sessions ouvertes (Remote Control), console Claude Code');
      await page.getByRole('button', { name: en ? /^History/ : /^Historique/ }).first().click();
      await sleep(900);
      await shot(page, 'claude', v(lang, theme, 2), 'Historique de toutes les sessions par projet (titre, branche, messages, active)');
    }

    // ─── Todolist Claude ──────────────────────────────────────────────────────────────────────────────
    if (want('todolist')) {
      await go(page, 'todolist');
      await shot(page, 'todolist', v(lang, theme, 1), 'Todolist Claude : vue globale, une carte par projet suivi (5 projets, chacun à sa couleur)');
      await page.mouse.move(VW_ / 2, VH_ / 2);
      await page.mouse.wheel(0, 2000);
      await sleep(700);
      await shot(page, 'todolist', v(lang, theme, 4), 'Todolist Claude : vue globale, listes « À tester » et « Prochaines étapes » sous les cartes');
      await page.mouse.move(VW_ / 2, VH_ / 2);
      await page.mouse.wheel(0, -4000);
      await sleep(400);
      await page.getByText('NEBULA STORE', { exact: false }).first().click();
      await sleep(1200);
      await shot(page, 'todolist', v(lang, theme, 2), 'Todolist d’un projet : phases, faites, à tester, sous-tâches lettrées');
    }

    // ─── Docker (5.2) : conteneurs groupés par projet compose ─────────────────────────────────────────
    if (want('docker')) {
      await go(page, 'docker');
      await sleep(2200); // statistiques (CPU, mémoire) après le premier relevé
      await shot(page, 'docker', v(lang, theme, 1), 'Docker : conteneurs groupés par projet compose, état, santé, ports, CPU et mémoire, projet rattaché');
    }

    // ─── Utilisation Claude (5.4) : gros plan du panneau de la sidebar ────────────────────────────────
    if (want('utilisation')) {
      await go(page, 'projects');
      const box = await page.locator('.usage-panel').boundingBox();
      if (!box) throw new Error('Panneau d’utilisation Claude absent');
      const logo = await page.locator('.sidebar-logo').boundingBox();
      const top = Math.max(0, Math.floor(box.y - 16));
      const bottom = Math.ceil(logo && logo.height ? logo.y + logo.height : box.y + box.height + 16);
      await shot(page, 'utilisation', v(lang, theme, 1), 'Utilisation Claude dans la sidebar (gros plan) : plan, session 5 h, semaine, Fable, remises à zéro', { clip: { x: 0, y: top, width: 224, height: bottom - top } });
      await shot(page, 'utilisation', v(lang, theme, 2), 'Sidebar entière : navigation, utilisation Claude au-dessus du logo, pied de page', { clip: { x: 0, y: 0, width: 224, height: VH_ } });
    }

    // ─── IDE intégré (5.5) : aux couleurs de Tarmac, clair et sombre, FR et EN ────────────────────────
    if (want('ide')) {
      await go(page, 'projects');
      await row(page, 'nebula-store').getByRole('button', { name: en ? 'Open in the built-in IDE' : 'Ouvrir dans l\'IDE intégré' }).click();
      await sleep(2500);
      await page.getByText('src', { exact: true }).first().click().catch(() => null);
      await sleep(500);
      await page.getByText('App.jsx', { exact: true }).first().click().catch(() => null);
      await sleep(2500);
      await shot(page, 'ide', v(lang, theme, 1), 'IDE intégré : arborescence, éditeur, fichiers modifiés, terminal');
      // Source Control (2e bouton de la barre d'activité) et diff du fichier modifié, défilé jusqu'au changement.
      await page.locator('nav.w-12 button').nth(1).click();
      await sleep(1500);
      await page.locator('aside .ide-row', { hasText: 'styles.css' }).first().click();
      await sleep(2500);
      await page.mouse.move(1500, 600);
      for (let i = 0; i < 22; i++) { await page.mouse.wheel(0, 200); await sleep(80); }
      await sleep(800);
      await shot(page, 'ide', v(lang, theme, 2), 'IDE : contrôle de source (changements, graphe) et diff du fichier modifié');
      await page.locator('[draggable="true"]', { hasText: 'App.jsx' }).first().click({ button: 'right' });
      await sleep(400);
      await shot(page, 'ide', v(lang, theme, 3), 'IDE : menu contextuel d’un onglet de fichier');
      await page.keyboard.press('Escape');
    }

    // ─── Vues en anglais (sombre et clair) ────────────────────────────────────────────────────────────
    if (en) {
      for (const [scene, hash, desc] of [
        ['github', 'github', 'GitHub : dépôts clonés et état, dépôts distants avec bouton Clone'],
        ['supabase', 'supabase', 'Supabase local : instance démarrée (services), instance arrêtée, apps liées'],
        ['ports', 'ports', 'Ports : plage, ports attribués, historique, « Free the ports »'],
        ['android', 'android', 'Android : diagnostic du SDK et appareils virtuels'],
        ['reglages', 'settings', 'Réglages'],
      ]) {
        if (!want(scene)) continue;
        await go(page, hash);
        await sleep(800);
        if (scene === 'supabase') { await page.locator('button:has(svg.lucide-chevron-down)').first().click().catch(() => null); await sleep(600); }
        await shot(page, scene, v(lang, theme, 1), desc);
      }
    }
    await page.context().close();
  }

  // ─── Version française des écrans du montage vidéo (4.6a) : mêmes scènes qu'en anglais, interface en français ──
  if (want('video-fr')) {
    const fp = await newPage({ lang: 'fr', theme: 'dark' });
    const fr = (n) => v('fr', 'dark', n);
    // Démarrage : arrêté → en cours de démarrage → en cours (journaux).
    await api(`/api/projects/${ids['nebula-store']}/stop`, 'POST').catch(() => null);
    await waitStatus('nebula-store', 'stopped').catch(() => null);
    await go(fp, 'projects');
    await openPanel(fp, 'nebula-store');
    await shot(fp, 'demarrage', fr(1), 'nebula-store arrêté : bouton Démarrer, panneau Logs vide');
    await row(fp, 'nebula-store').getByRole('button', { name: 'Démarrer' }).click();
    await sleep(250);
    await shot(fp, 'demarrage', fr(2), 'Démarrage en cours (statut « Démarrage »)', { wait: 0 });
    await waitStatus('nebula-store', 'running');
    await sleep(1200);
    await panelTab(fp, /^Logs/);
    await shot(fp, 'demarrage', fr(3), 'En cours : statut, port, journaux Vite en direct');
    // Navigateur interne : tailles d'écran.
    await panelTab(fp, /^Navigateur/);
    await sleep(2000);
    let n = 0;
    for (const [title, desc] of [['Pleine largeur', 'pleine largeur'], ['Portable 1280', 'portable 1280'], ['Tablette 768', 'tablette 768'], ['Mobile 390', 'mobile 390']]) {
      n += 1;
      await panel(fp).getByRole('button', { name: title }).click();
      await sleep(1500);
      await shot(fp, 'navigateur', fr(n), `Navigateur interne : taille ${desc}`);
    }
    await panel(fp).getByRole('button', { name: 'Pleine largeur' }).click();
    // Console : commande détectée, puis shell avec git status / git log et menu Git.
    await panelTab(fp, /^Console/);
    await panel(fp).locator('select').first().selectOption({ label: 'build' }).catch(async () => panel(fp).locator('select').first().selectOption({ index: 1 }));
    await panel(fp).getByRole('button', { name: /^(Exécuter|Run)$/ }).first().click();
    await sleep(4000);
    await shot(fp, 'console', fr(1), 'Commande détectée (script package.json « build ») lancée dans une console');
    await panel(fp).getByRole('button', { name: /^Shell/ }).first().click();
    await sleep(1500);
    await fp.keyboard.type('git status -sb && git log --oneline -6\n');
    await sleep(1500);
    await shot(fp, 'console-git', fr(1), 'Console : shell avec git status et git log');
    const gitBtn = panel(fp).getByRole('button', { name: /^Git$/ }).first();
    await gitBtn.click();
    await sleep(700);
    await shot(fp, 'console-git', fr(2), 'Menu Git ouvert : commandes expliquées, recherche, état de la branche');
    await gitBtn.click();
    await sleep(400);
    await fp.keyboard.press('Escape');
    await sleep(500);
    // « Tout démarrer » du monorepo.
    await go(fp, 'projects');
    await row(fp, 'mission-control').getByRole('button', { name: 'Tout démarrer' }).click();
    await waitStatus('admin', 'running', 45_000).catch(() => null);
    await sleep(4000);
    await shot(fp, 'navigateur', fr(5), '« Tout démarrer » du monorepo : apps démarrées, navigateur interne ouvert sur l’app web');
    await fp.keyboard.press('Escape');
    await sleep(500);
    // Filtre « Ouverts dans VS Code », URL de prod, PWA.
    await go(fp, 'projects');
    await fp.getByRole('button', { name: /^Ouverts dans VS Code/ }).first().click();
    await sleep(600);
    await shot(fp, 'projets', fr(4), 'Filtre « Ouverts dans VS Code » : projets ouverts dans l’éditeur (badge VS Code)');
    await fp.getByRole('button', { name: /^Tous les projets/ }).first().click();
    await sleep(600);
    await row(fp, 'rocket-api').getByRole('button', { name: 'Ajouter l\'URL de production' }).click();
    await sleep(500);
    await fp.keyboard.type('https://rocket-api.dev');
    await shot(fp, 'url-prod', fr(2), 'Saisie manuelle de l’URL de production (Entrée pour valider)');
    await fp.keyboard.press('Escape');
    await sleep(500);
    await api(`/api/projects/${ids['rocket-api']}/url`, 'PUT', { url: '' });
    await go(fp, 'projects');
    await fp.getByRole('button', { name: 'Installer l’app' }).click();
    await sleep(700);
    await shot(fp, 'pwa', fr(1), 'Installation en PWA : bouton « Installer l’app » et aide');
    await fp.getByRole('button', { name: 'Installer l’app' }).click();
    await sleep(400);
    // IDE intégré.
    await row(fp, 'nebula-store').getByRole('button', { name: 'Ouvrir dans l\'IDE intégré' }).click();
    await sleep(2500);
    await fp.getByText('src', { exact: true }).first().click().catch(() => null);
    await sleep(500);
    await fp.getByText('App.jsx', { exact: true }).first().click().catch(() => null);
    await sleep(2500);
    await shot(fp, 'ide', fr(1), 'IDE intégré : arborescence, éditeur, fichiers modifiés, terminal');
    // Pages GitHub, Supabase, Ports, Android.
    for (const [scene, hash, desc] of [
      ['github', 'github', 'GitHub : dépôts clonés et état, dépôts distants avec bouton Cloner'],
      ['supabase', 'supabase', 'Supabase local : instance démarrée (services), instance arrêtée, apps liées'],
      ['ports', 'ports', 'Ports : plage, ports attribués, historique, « Libérer les ports »'],
      ['android', 'android', 'Android : diagnostic du SDK et appareils virtuels'],
    ]) {
      await go(fp, hash);
      await sleep(800);
      if (scene === 'supabase') { await fp.locator('button:has(svg.lucide-chevron-down)').first().click().catch(() => null); await sleep(600); }
      await shot(fp, scene, fr(1), desc);
    }
    // Bascule de thème sombre → clair, en français.
    await go(fp, 'projects');
    await shot(fp, 'bascule-theme', fr(1), 'Avant la bascule : thème sombre (français)');
    await fp.getByRole('button', { name: 'Clair' }).click();
    await sleep(700);
    await shot(fp, 'bascule-theme', v('fr', 'light', 2), 'Après la bascule : thème clair (français)');
    await fp.getByRole('button', { name: 'Sombre' }).click();
    await sleep(500);
    await fp.context().close();
    // Artefact en français (la langue suit celle du navigateur).
    const art = await serveArtifact('orbit-labs/nebula-store');
    for (const theme of ['dark', 'light']) {
      const ap = await newPage({ lang: 'fr', theme, server: false });
      await ap.goto(art.url);
      await sleep(2500);
      await shot(ap, 'artefact', v('fr', theme, 1), 'Artefact Todolist (côté claude.ai) en français, gabarit rendu en local');
      await ap.context().close();
    }
    await art.close();
    await api('/api/settings', 'PUT', { theme: 'dark', language: 'en' });
  }

  const page = await newPage();

  // ─── URL de production ──────────────────────────────────────────────────────────────────────────────
  if (want('url-prod')) {
    await go(page, 'projects');
    await shot(page, 'url-prod', v('en', 'dark', 1), 'URL de production cliquable (nebula-store.app, launchpad-docs.dev)');
    await row(page, 'rocket-api').getByRole('button', { name: 'Add the production URL' }).click();
    await sleep(500);
    await page.keyboard.type('https://rocket-api.dev');
    await shot(page, 'url-prod', v('en', 'dark', 2), 'Saisie manuelle de l’URL de production (Entrée pour valider)');
    await page.keyboard.press('Enter');
    await sleep(1500);
    await shot(page, 'url-prod', v('en', 'dark', 3), 'URL saisie affichée sur la ligne de rocket-api');
    await api(`/api/projects/${ids['rocket-api']}/url`, 'PUT', { url: '' });
  }

  // ─── PWA ────────────────────────────────────────────────────────────────────────────────────────────
  if (want('pwa')) {
    await go(page, 'projects');
    await page.getByRole('button', { name: 'Install the app' }).click();
    await sleep(700);
    await shot(page, 'pwa', v('en', 'dark', 1), 'Installation en PWA : bouton « Install the app » et aide');
    await page.getByRole('button', { name: 'Install the app' }).click(); // referme l'aide
    await sleep(400);
  }

  // ─── Ouverture du panneau (vidéo) ───────────────────────────────────────────────────────────────────
  if (want('panneau')) {
    await go(page, 'projects');
    await record(page, 'ouverture-panneau', 'Clic sur un projet : ouverture du panneau, passage par les onglets', async () => {
      await sleep(700);
      await openPanel(page, 'rocket-api');
      await sleep(1200);
      for (const t of [/^Browser/, /^Console/, /^Claude(?! Todolist)/, /^README/, /^Logs/]) { await panelTab(page, t); await sleep(700); }
      await page.keyboard.press('Escape');
      await sleep(900);
    });
  }

  // ─── Navigateur interne : tailles d'écran, « Start all » ─────────────────────────────────────────────
  if (want('navigateur')) {
    await go(page, 'projects');
    await openPanel(page, 'nebula-store');
    await panelTab(page, /^Browser/);
    await sleep(2000);
    let n = 0;
    for (const [title, desc] of [['Full width', 'pleine largeur'], ['Laptop 1280', 'portable 1280'], ['Tablet 768', 'tablette 768'], ['Mobile 390', 'mobile 390']]) {
      n += 1;
      await panel(page).getByRole('button', { name: title }).click();
      await sleep(1500);
      await shot(page, 'navigateur', v('en', 'dark', n), `Navigateur interne : taille ${desc}`);
    }
    await record(page, 'navigateur-tailles', 'Navigateur interne : bascule bureau → portable → tablette → mobile', async () => {
      await sleep(600);
      for (const title of ['Full width', 'Laptop 1280', 'Tablet 768', 'Mobile 390', 'Full width']) { await panel(page).getByRole('button', { name: title }).click(); await sleep(1300); }
    });
    await page.keyboard.press('Escape');
    await sleep(500);
    // Apps du monorepo arrêtées (la scène video-fr les a démarrées) : le bouton redevient « Start all ».
    for (const p of await projects()) if (p.group?.name === 'mission-control' && !['stopped', 'crashed'].includes(p.runtime.status)) await api(`/api/projects/${p.id}/stop`, 'POST').catch(() => null);
    for (const n of ['admin', 'internal-api']) await waitStatus(n, 'stopped', 15_000).catch(() => null);
    await sleep(800);
    await row(page, 'mission-control').getByRole('button', { name: 'Start all' }).click();
    await waitStatus('admin', 'running', 45_000).catch(() => null);
    await sleep(4000);
    await shot(page, 'navigateur', v('en', 'dark', 5), '« Start all » du monorepo : apps démarrées, navigateur interne ouvert sur l’app web');
  }

  // ─── Consoles : commandes détectées, virtualenv ─────────────────────────────────────────────────────
  if (want('console')) {
    await go(page, 'projects');
    await openPanel(page, 'nebula-store');
    await panelTab(page, /^Console/);
    await panel(page).locator('select').first().selectOption({ label: 'build' }).catch(async () => panel(page).locator('select').first().selectOption({ index: 1 }));
    await panel(page).getByRole('button', { name: /^Run$/ }).first().click();
    await sleep(4000);
    await shot(page, 'console', v('en', 'dark', 1), 'Commande détectée (script package.json « build ») lancée dans une console');
    await page.keyboard.press('Escape');
    await openPanel(page, 'orbit-insights');
    await panelTab(page, /^Console/);
    await panel(page).getByRole('button', { name: /^Shell/ }).first().click();
    await sleep(1500);
    await page.keyboard.type('echo "venv: ${VIRTUAL_ENV/#$HOME/~}" && python --version && pip list 2>/dev/null | grep -iE "fastapi|uvicorn"\n');
    await sleep(2500);
    await shot(page, 'console', v('en', 'dark', 2), 'Shell (venv) : virtualenv Python activé automatiquement');
    await page.keyboard.press('Escape');
  }

  // ─── Claude : ouvrir une session en onglet, onglet séparé du navigateur ─────────────────────────────
  if (want('claude')) {
    await go(page, 'claude');
    await page.getByRole('button', { name: /^History/ }).first().click();
    await sleep(900);
    const resume = page.locator('div').filter({ has: page.getByText('Trajectory endpoint', { exact: true }) }).filter({ has: page.getByRole('button', { name: /^Resume/ }) }).last().getByRole('button', { name: /^Resume/ });
    await record(page, 'ouverture-session-claude', 'Reprise d’une session Claude depuis l’historique : nouvel onglet, Claude Code en Remote Control', async () => {
      await sleep(700);
      await resume.click();
      await sleep(4500);
    });
    await shot(page, 'claude', v('en', 'dark', 3), 'Session reprise ouverte dans un nouvel onglet');
    const term = (await api('/api/terminals')).find((t) => t.kind === 'claude' && /Trajectory/.test(t.label));
    if (term) {
      const tab = await page.context().newPage();
      await tab.goto(`${new URL(page.url()).origin}/#term/${term.id}`);
      await sleep(2000);
      await shot(tab, 'claude', v('en', 'dark', 4), 'Session ouverte dans un onglet séparé du navigateur (#term/…)');
      await tab.close();
    }
  }

  // ─── Todolist : coche d'une tâche (vidéo), artefact claude.ai ───────────────────────────────────────
  if (want('todolist')) {
    await go(page, 'todolist');
    await page.getByText('NEBULA STORE', { exact: false }).first().click();
    await sleep(1500);
    const box = panel(page).getByRole('checkbox', { name: /1\.4b/ });
    await box.scrollIntoViewIfNeeded().catch(() => null);
    await record(page, 'coche-tache', 'Coche d’une tâche de la Todolist (1.4b) : progression mise à jour', async () => {
      await sleep(800);
      await box.click();
      await sleep(2200);
    });
    await shot(page, 'todolist', v('en', 'dark', 3), 'Tâche 1.4b cochée');
    await box.click().catch(() => null); // décoche (état de départ)
    await sleep(800);
  }
  if (want('artefact')) {
    const art = await serveArtifact('orbit-labs/nebula-store');
    for (const theme of ['dark', 'light']) {
      const ap = await newPage({ theme, server: false });
      await ap.goto(art.url);
      await sleep(2500);
      await shot(ap, 'artefact', v('en', theme, 1), 'Artefact Todolist (côté claude.ai), gabarit rendu en local avec les tâches de démo');
      await ap.context().close();
    }
    await art.close();
  }

  // ─── GitHub : clonage avec progression ──────────────────────────────────────────────────────────────
  if (want('github')) {
    await go(page, 'github');
    const clone = page.locator('div').filter({ has: page.getByText(`orbit-labs/${CLONE}`, { exact: true }) }).filter({ has: page.getByRole('button', { name: /^Clone/ }) }).last().getByRole('button', { name: /^Clone/ });
    await record(page, 'clonage', `Clonage de ${CLONE} : progression dans une console, puis dépôt listé comme cloné`, async () => {
      await sleep(700);
      await clone.click();
      await sleep(1300);
      await shot(page, 'github', v('en', 'dark', 2), 'Clonage : progression dans une console', { wait: 0 });
      await sleep(2800);
    });
    await page.keyboard.press('Escape');
    await sleep(2000);
  }

  // ─── Bascules thème et langue ───────────────────────────────────────────────────────────────────────
  if (want('bascules')) {
    await go(page, 'projects');
    await shot(page, 'bascule-theme', v('en', 'dark', 1), 'Avant la bascule : thème sombre');
    await page.getByRole('button', { name: 'Light' }).click();
    await sleep(700);
    await shot(page, 'bascule-theme', v('en', 'light', 2), 'Après la bascule : thème clair');
    await page.getByRole('button', { name: 'Dark' }).click();
    await sleep(700);
    await record(page, 'bascule-theme', 'Bascule sombre → clair → sombre depuis la barre latérale', async () => {
      await sleep(900);
      await page.getByRole('button', { name: 'Light' }).click();
      await sleep(1600);
      await page.getByRole('button', { name: 'Dark' }).click();
      await sleep(1400);
    });
    await shot(page, 'bascule-langue', v('en', 'dark', 1), 'Avant la bascule : anglais');
    await page.locator('button[title="Français"]').click();
    await sleep(900);
    await shot(page, 'bascule-langue', v('fr', 'dark', 2), 'Après la bascule : français');
    await page.locator('button[title="English"]').click();
    await sleep(900);
    await record(page, 'bascule-langue', 'Bascule EN → FR → EN depuis la barre latérale', async () => {
      await sleep(900);
      await page.locator('button[title="Français"]').click();
      await sleep(1800);
      await page.locator('button[title="English"]').click();
      await sleep(1400);
    });
  }

  // ─── Ports : « Free the ports » (en dernier : arrête tout) ──────────────────────────────────────────
  if (want('ports')) {
    await go(page, 'ports');
    await page.getByRole('button', { name: /^Free the ports/ }).click();
    await sleep(500);
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await sleep(4000);
    await shot(page, 'ports', v('en', 'dark', 2), 'Après « Free the ports » : apps arrêtées, rapport des ports libérés');
  }
  await page.context().close();
  await api('/api/settings', 'PUT', { theme: 'dark', language: 'en' });
}
