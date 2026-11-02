import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  DockerService, bindMounts, computeStats, dockerAct, dockerOverview, dockerStats, engineAppOf, isComposeProject, isContainerId,
  isDockerAction, linkProject, parseContainer, parseExitCode, parseHealth, parsePorts, type LinkableProject, type RawContainer,
} from './docker.js';
import { demoDockerAction, demoDockerOverview, demoDockerStats, resetDemoDocker, type DemoFixtures } from './demo/index.js';

const ID_API = 'a'.repeat(64);
const ID_DB = 'b'.repeat(64);
const ID_SOLO = 'c'.repeat(64);

const raw = (over: Partial<RawContainer>): RawContainer => ({
  Id: ID_API, Names: ['/demo-api-1'], Image: 'node:22', State: 'running', Status: 'Up 2 hours', Created: 1_760_000_000,
  Labels: {}, Ports: [], Mounts: [], ...over,
});

const LIST: RawContainer[] = [
  raw({
    Id: ID_API, Names: ['/rocket-api-api-1'], Status: 'Up 2 hours (healthy)',
    Labels: { 'com.docker.compose.project': 'rocket-api', 'com.docker.compose.service': 'api', 'com.docker.compose.project.working_dir': '/work/Developer/rocket-api' },
    Ports: [{ PrivatePort: 3000, PublicPort: 4100, IP: '0.0.0.0', Type: 'tcp' }, { PrivatePort: 3000, PublicPort: 4100, IP: '::', Type: 'tcp' }],
  }),
  raw({
    Id: ID_DB, Names: ['/rocket-api-db-1'], Image: 'postgres:17', State: 'exited', Status: 'Exited (137) 3 days ago',
    Labels: { 'com.docker.compose.project': 'rocket-api', 'com.docker.compose.service': 'db' },
    Ports: [], Mounts: [{ Type: 'bind', Source: '/work/Developer/rocket-api/db' }, { Type: 'volume', Source: '/var/lib/docker/volumes/x' }],
  }),
  raw({ Id: ID_SOLO, Names: ['/scratch'], Image: 'alpine', Status: 'Up 5 minutes', Labels: null, Ports: null }),
];

// ─── Lecture ────────────────────────────────────────────────────────────────
test('docker : santé et code de sortie lus dans le statut', () => {
  assert.equal(parseHealth('Up 2 hours (healthy)'), 'healthy');
  assert.equal(parseHealth('Up 3 seconds (health: starting)'), 'starting');
  assert.equal(parseHealth('Up 1 minute (unhealthy)'), 'unhealthy');
  assert.equal(parseHealth('Up 2 hours'), null);
  assert.equal(parseExitCode('Exited (137) 3 days ago'), 137);
  assert.equal(parseExitCode('Exited (0) About a minute ago'), 0);
  assert.equal(parseExitCode('Up 2 hours'), null);
});

test('docker : ports publiés sans doublon IPv4/IPv6, liens HTTP seulement pour les ports web', () => {
  const ports = parsePorts([
    { PrivatePort: 5432, PublicPort: 54322, IP: '0.0.0.0', Type: 'tcp' },
    { PrivatePort: 3000, PublicPort: 4100, IP: '0.0.0.0', Type: 'tcp' },
    { PrivatePort: 3000, PublicPort: 4100, IP: '::', Type: 'tcp' },
    { PrivatePort: 53, PublicPort: 5353, Type: 'udp' },
    { PrivatePort: 6379, Type: 'tcp' }, // non publié
  ]);
  assert.deepEqual(ports, [
    { private: 3000, public: 4100, type: 'tcp', http: true },
    { private: 53, public: 5353, type: 'udp', http: false },
    { private: 5432, public: 54322, type: 'tcp', http: false },
  ]);
  assert.deepEqual(parsePorts(null), []);
});

test('docker : conteneur lu (nom, projet compose, service, dossier, Supabase)', () => {
  const c = parseContainer(LIST[0]);
  assert.equal(c.name, 'rocket-api-api-1');
  assert.equal(c.group, 'rocket-api');
  assert.equal(c.service, 'api');
  assert.equal(c.workingDir, '/work/Developer/rocket-api');
  assert.equal(c.health, 'healthy');
  assert.equal(c.ports.length, 1);
  const solo = parseContainer(LIST[2]);
  assert.equal(solo.group, null);
  assert.deepEqual(solo.ports, []);
  const sb = parseContainer(raw({ Names: ['/supabase_db_nebula'], Labels: { 'com.supabase.cli.project': 'nebula' } }));
  assert.equal(sb.group, 'nebula');
  assert.equal(sb.supabaseProject, 'nebula');
  assert.deepEqual(bindMounts(LIST[1]), ['/work/Developer/rocket-api/db']);
});

test('docker : projet Tarmac relié (Supabase, dossier compose, montage, monorepo)', () => {
  const projects: LinkableProject[] = [
    { id: 'p1', name: 'rocket-api', dir: '/work/Developer/rocket-api', repoDir: '/work/Developer/rocket-api', supabaseProjectId: null },
    { id: 'p2', name: 'admin', dir: '/work/Developer/mission/apps/admin', repoDir: '/work/Developer/mission', supabaseProjectId: 'mission' },
    { id: 'p3', name: 'api', dir: '/work/Developer/mission/apps/api', repoDir: '/work/Developer/mission', supabaseProjectId: 'mission' },
    { id: 'p4', name: 'rocket', dir: '/work/Developer/rocket', repoDir: null, supabaseProjectId: null },
  ];
  assert.deepEqual(linkProject({ supabaseProject: 'mission', workingDir: null }, [], projects), { id: 'p3', name: 'api' }); // le moins profond
  assert.deepEqual(linkProject({ supabaseProject: null, workingDir: '/work/Developer/rocket-api' }, [], projects), { id: 'p1', name: 'rocket-api' });
  assert.deepEqual(linkProject({ supabaseProject: null, workingDir: '/work/Developer/rocket-api/docker' }, [], projects), { id: 'p1', name: 'rocket-api' });
  // compose à la racine d'un monorepo : le moins profond des projets qu'il contient
  assert.equal(linkProject({ supabaseProject: null, workingDir: '/work/Developer/mission' }, [], projects)?.id, 'p3');
  assert.equal(linkProject({ supabaseProject: null, workingDir: '/work/Developer/mission/apps/admin/docker' }, [], projects)?.id, 'p2');
  assert.equal(linkProject({ supabaseProject: null, workingDir: null }, ['/work/Developer/rocket-api/db'], projects)?.id, 'p1');
  // préfixe de nom sans séparateur : pas de faux lien (rocket ≠ rocket-api)
  assert.equal(linkProject({ supabaseProject: null, workingDir: '/work/Developer/rocket-apix' }, [], projects), null);
  assert.equal(linkProject({ supabaseProject: null, workingDir: null }, ['/', os.homedir(), '/tmp/data'], projects), null);
  assert.equal(linkProject({ supabaseProject: 'inconnu', workingDir: 'relatif/dossier' }, [], projects), null);
});

test('docker : CPU, mémoire, réseau et disque comme `docker stats`', () => {
  const s = {
    cpu_stats: { cpu_usage: { total_usage: 2_000_000_000 }, system_cpu_usage: 110_000_000_000, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: 1_000_000_000 }, system_cpu_usage: 100_000_000_000 },
    memory_stats: { usage: 300 * 2 ** 20, limit: 2 * 2 ** 30, stats: { inactive_file: 100 * 2 ** 20 } },
    networks: { eth0: { rx_bytes: 1000, tx_bytes: 500 }, eth1: { rx_bytes: 24, tx_bytes: 12 } },
    blkio_stats: { io_service_bytes_recursive: [{ op: 'read', value: 10 }, { op: 'Write', value: 7 }, { op: 'read', value: 5 }] },
    pids_stats: { current: 9 },
  };
  const { stats, sample } = computeStats('x', s);
  assert.equal(stats.cpu, 40); // 1e9 / 1e10 × 4 cœurs × 100
  assert.equal(stats.memUsed, 200 * 2 ** 20);
  assert.equal(stats.memLimit, 2 * 2 ** 30);
  assert.deepEqual([stats.netRx, stats.netTx, stats.blkRead, stats.blkWrite, stats.pids], [1024, 512, 15, 7, 9]);
  assert.deepEqual(sample, { total: 2_000_000_000, system: 110_000_000_000, online: 4 });

  // one-shot : pas de precpu → écart avec l'instantané précédent ; sans référence → null
  const oneShot = { ...s, precpu_stats: {}, cpu_stats: { cpu_usage: { total_usage: 2_500_000_000 }, system_cpu_usage: 120_000_000_000, online_cpus: 4 } };
  assert.equal(computeStats('x', oneShot, sample).stats.cpu, 20);
  assert.equal(computeStats('x', oneShot).stats.cpu, null);
  // cgroup v1 et valeurs absentes
  const v1 = computeStats('x', { memory_stats: { usage: 50, limit: 100, stats: { total_inactive_file: 20 } } }).stats;
  assert.deepEqual([v1.memUsed, v1.netRx, v1.blkRead, v1.cpu], [30, null, null, null]);
});

test('docker : liste blanche des actions, identifiants et projets validés', () => {
  for (const a of ['start', 'stop', 'restart']) assert.ok(isDockerAction(a));
  for (const a of ['kill', 'rm', 'exec', 'pause', 'start;rm', '', undefined, 'STOP']) assert.ok(!isDockerAction(a), String(a));
  assert.ok(isContainerId(ID_API));
  assert.ok(isContainerId('0123456789ab'));
  for (const id of ['abc', '../../x', 'rocket-api-db-1', `${'a'.repeat(12)};ls`, 'A'.repeat(12), 'a'.repeat(65), 42]) assert.ok(!isContainerId(id), String(id));
  assert.ok(isComposeProject('rocket-api'));
  assert.ok(isComposeProject('supabase_1.x'));
  for (const p of ['', '-x', 'Rocket', 'a/b', 'a b', '..', 'x'.repeat(101)]) assert.ok(!isComposeProject(p), p);
});

test('docker : application du moteur à ouvrir', () => {
  const none = () => false;
  const both = () => true;
  const onlyOrb = (a: string) => a === 'OrbStack';
  assert.equal(engineAppOf('/nope/.orbstack/run/docker.sock', none), 'OrbStack');
  assert.equal(engineAppOf('/nope/.colima/default/docker.sock', both), null);
  assert.equal(engineAppOf('/nope/.docker/run/docker.sock', both), 'Docker');
  assert.equal(engineAppOf('/nope/.docker/run/docker.sock', onlyOrb), 'OrbStack');
  assert.equal(engineAppOf(null, none), null);
  assert.equal(engineAppOf(null, onlyOrb), 'OrbStack');
});

// ─── Faux moteur sur un socket Unix ─────────────────────────────────────────
async function fakeEngine(fn: (socket: string, calls: string[]) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdk-'));
  const socket = path.join(dir, 'd.sock');
  const calls: string[] = [];
  const state = new Map(LIST.map((c) => [c.Id, c.State]));
  const server = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    const send = (code: number, body?: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    const url = req.url ?? '';
    if (url === '/version') return send(200, { Version: '28.0.4', Platform: { Name: 'Docker Desktop 4.40.0' } });
    if (url === '/info') return send(200, { NCPU: 8, MemTotal: 16 * 2 ** 30 });
    if (url === '/system/df') return send(200, { LayersSize: 5000, Images: [{}, {}], Volumes: [{ UsageData: { Size: 10 } }, { UsageData: { Size: -1 } }] });
    if (url.startsWith('/containers/json')) {
      const all = LIST.map((c) => ({ ...c, State: state.get(c.Id)! }));
      return send(200, url.includes('all=1') ? all : all.filter((c) => c.State === 'running'));
    }
    let m = url.match(/^\/containers\/([a-f0-9]{64})\/json$/);
    if (m) return send(200, { State: { StartedAt: '2026-11-02T10:00:00Z', FinishedAt: '2026-10-30T08:00:00Z' } });
    m = url.match(/^\/containers\/([a-f0-9]{64})\/stats\?stream=false(&one-shot=true)?$/);
    if (m) {
      const n = calls.filter((c) => c.includes(`/containers/${m![1]}/stats`)).length;
      return send(200, {
        cpu_stats: { cpu_usage: { total_usage: n * 1e9 }, system_cpu_usage: 100e9 + n * 10e9, online_cpus: 2 },
        precpu_stats: m[2] ? {} : { cpu_usage: { total_usage: 0 }, system_cpu_usage: 100e9 },
        memory_stats: { usage: 1000, limit: 4000, stats: { inactive_file: 0 } },
      });
    }
    m = url.match(/^\/containers\/([a-f0-9]{64})\/(start|stop|restart)$/);
    if (m && req.method === 'POST') { state.set(m[1], m[2] === 'stop' ? 'exited' : 'running'); return send(204); }
    send(404, { message: 'page not found' });
  });
  await new Promise<void>((r) => server.listen(socket, r));
  try { await fn(socket, calls); } finally { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
}

const projects: LinkableProject[] = [{ id: 'p1', name: 'rocket-api', dir: '/work/Developer/rocket-api', repoDir: null, supabaseProjectId: null }];
const service = (socket: string | null) => new DockerService({ socket: () => socket, installed: () => false, projects: () => projects });

test('docker : vue d’ensemble lue sur le socket du moteur', async () => {
  await fakeEngine(async (socket, calls) => {
    const o = await service(socket).overview();
    assert.equal(o.engine.status, 'ok');
    assert.equal(o.engine.name, 'Docker Desktop 4.40.0');
    assert.equal(o.engine.cpus, 8);
    assert.deepEqual(o.images, { count: 2, size: 5000 });
    assert.deepEqual(o.volumes, { count: 2, size: 10 });
    assert.deepEqual(o.containers.map((c) => c.name), ['rocket-api-api-1', 'rocket-api-db-1', 'scratch']);
    const [api, db] = o.containers;
    assert.deepEqual(api.project, { id: 'p1', name: 'rocket-api' });
    assert.equal(db.project?.id, 'p1'); // relié par son montage
    assert.equal(api.since, '2026-11-02T10:00:00Z');
    assert.equal(db.since, '2026-10-30T08:00:00Z');
    assert.equal(db.exitCode, 137);
    assert.ok(calls.every((c) => c.startsWith('GET ')), 'lecture seule');
  });
});

test('docker : stats en instantanés (one-shot après le premier), seulement des conteneurs en cours', async () => {
  await fakeEngine(async (socket, calls) => {
    const svc = service(socket);
    const first = await svc.stats();
    assert.deepEqual(first.map((s) => s.id).sort(), [ID_API, ID_SOLO]);
    assert.equal(first[0].cpu, 20); // 1e9 / 10e9 × 2 cœurs × 100
    const second = await svc.stats();
    assert.equal(second[0].cpu, 20);
    assert.ok(calls.some((c) => c === `GET /containers/${ID_API}/stats?stream=false`));
    assert.ok(calls.some((c) => c === `GET /containers/${ID_API}/stats?stream=false&one-shot=true`));
    assert.ok(!calls.some((c) => c.includes(ID_DB) && c.includes('stats')), 'conteneur arrêté : pas de stats');
  });
});

test('docker : actions limitées aux conteneurs connus, identifiant complet envoyé au moteur', async () => {
  await fakeEngine(async (socket, calls) => {
    const svc = service(socket);
    assert.deepEqual(await svc.act('stop', { id: ID_API.slice(0, 12) }), { ok: true, ids: [ID_API] });
    assert.ok(calls.includes(`POST /containers/${ID_API}/stop`));
    await assert.rejects(svc.act('start', { id: 'd'.repeat(64) }), (e: any) => e.code === 'ENOTFOUND');
    await assert.rejects(svc.act('start', { id: '../../images/prune' }), (e: any) => e.code === 'EBADID');
    await assert.rejects(svc.act('kill' as any, { id: ID_API }), (e: any) => e.code === 'EBADACTION');
    await assert.rejects(svc.act('start', { group: 'Bad Group' }), (e: any) => e.code === 'EBADID');
    await assert.rejects(svc.act('start', { group: 'absent' }), (e: any) => e.code === 'ENOTFOUND');
    const posts = () => calls.filter((c) => c.startsWith('POST'));
    assert.equal(posts().length, 1, 'aucun appel du moteur pour une requête refusée');
    const r = await svc.act('restart', { group: 'rocket-api' });
    assert.deepEqual(r.ids.sort(), [ID_API, ID_DB]);
    assert.deepEqual(posts().slice(1).sort(), [`POST /containers/${ID_API}/restart`, `POST /containers/${ID_DB}/restart`]);
  });
});

test('docker : moteur absent ou arrêté', async () => {
  const absent = await new DockerService({ socket: () => null, installed: () => false, projects: () => [] }).overview();
  assert.equal(absent.engine.status, 'absent');
  const notStarted = await new DockerService({ socket: () => null, installed: (a) => a === 'Docker', projects: () => [] }).overview();
  assert.deepEqual([notStarted.engine.status, notStarted.engine.app], ['stopped', 'Docker']);
  const dead = await service(path.join(os.tmpdir(), `tarmac-no-docker-${process.pid}.sock`)).overview();
  assert.equal(dead.engine.status, 'stopped');
  assert.deepEqual(dead.containers, []);
});

// ─── Mode démo ──────────────────────────────────────────────────────────────
const demoFx = {
  supabase: {
    instances: [{
      projectId: 'mission-control', status: 'running', ports: { api: 64321, db: 64322, studio: 64323, mail: 64324 },
      services: [{ name: 'db', state: 'running', status: 'Up 3 hours (healthy)', image: 'supabase/postgres' }, { name: 'studio', state: 'running', status: 'Up 3 hours', image: 'supabase/studio' }],
    }],
  },
  docker: {
    engine: { name: 'Docker Desktop 4.40.0', version: '28.0.4', cpus: 12, memTotalGb: 16 },
    images: { count: 18, sizeGb: 7.4 },
    volumes: { count: 6, sizeGb: 1.2 },
    containers: [
      { name: 'rocket-api-postgres-1', image: 'postgres:17', project: 'rocket-api', service: 'postgres', workingDir: '~/Developer/rocket-api', state: 'running', health: 'healthy', since: '-5h', ports: [[5432, 55432]], cpu: 0.9, memMb: 64 },
      { name: 'launch-queue-worker-1', image: 'launch-queue-worker', project: 'launch-queue', service: 'worker', state: 'exited', exitCode: 1, since: '-1d' },
    ],
  },
} as unknown as DemoFixtures;

test('démo docker : conteneurs factices, stacks Supabase déduites, actions en mémoire', () => {
  resetDemoDocker();
  const o = demoDockerOverview(demoFx);
  assert.equal(o.engine.status, 'ok');
  const names = o.containers.map((c) => c.name);
  assert.deepEqual(names, ['rocket-api-postgres-1', 'launch-queue-worker-1', 'supabase_db_mission-control', 'supabase_studio_mission-control']);
  const studio = o.containers.find((c) => c.name.startsWith('supabase_studio'))!;
  assert.deepEqual(studio.ports, [{ private: 3000, public: 64323, type: 'tcp', http: false }]); // `http` calculé par docker.ts
  assert.equal(studio.supabaseProject, 'mission-control');
  assert.ok(o.containers[0].workingDir?.endsWith('/Developer/rocket-api'));
  assert.equal(o.containers[1].exitCode, 1);

  const stats = demoDockerStats(demoFx);
  assert.equal(stats.length, 3, 'seulement les conteneurs en cours');
  assert.ok(stats.every((s) => s.cpu! > 0 && s.memUsed > 0 && s.memLimit >= s.memUsed));

  const worker = o.containers[1];
  demoDockerAction(demoFx, 'start', { id: worker.id });
  assert.equal(demoDockerOverview(demoFx).containers[1].state, 'running');
  demoDockerAction(demoFx, 'stop', { group: 'mission-control' });
  assert.ok(demoDockerOverview(demoFx).containers.filter((c) => c.group === 'mission-control').every((c) => c.state === 'exited'));
  assert.throws(() => demoDockerAction(demoFx, 'stop', { id: 'f'.repeat(64) }));
  resetDemoDocker();
});

test('démo docker : jamais d’appel au vrai moteur', async () => {
  await fakeEngine(async (socket, calls) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-demo-docker-'));
    fs.writeFileSync(path.join(dir, 'fixtures.json'), JSON.stringify(demoFx));
    const saved = { fx: process.env.TARMAC_DEMO_FIXTURES, host: process.env.DOCKER_HOST };
    process.env.TARMAC_DEMO_FIXTURES = dir;
    process.env.DOCKER_HOST = `unix://${socket}`; // un vrai moteur joignable : il ne doit pas être appelé
    try {
      const o = await dockerOverview();
      assert.equal(o.containers.length, 4);
      const ports = Object.fromEntries(o.containers.flatMap((c) => c.ports.map((p) => [p.public, p.http])));
      assert.deepEqual(ports, { 55432: false, 64322: false, 64323: true });
      assert.equal((await dockerStats()).length, 3);
      await dockerAct('stop', { id: o.containers[0].id });
      assert.deepEqual(calls, []);
    } finally {
      for (const [k, v] of [['TARMAC_DEMO_FIXTURES', saved.fx], ['DOCKER_HOST', saved.host]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      resetDemoDocker();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
