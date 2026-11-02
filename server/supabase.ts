import http from 'node:http';
import { dockerSocketPath } from './config.js';
import { tr } from './i18n.js';
import { demo, demoSupabase } from './demo/index.js';

interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Labels: Record<string, string>;
  Ports: Array<{ PrivatePort: number; PublicPort?: number; IP?: string }>;
}

function dockerGet<T>(socketPath: string, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path, method: 'GET', timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) return reject(new Error(`Docker ${res.statusCode}: ${body}`));
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Docker timeout')));
    req.on('error', reject);
    req.end();
  });
}

export interface SupabaseInstance {
  projectId: string;
  status: 'running' | 'partial' | 'stopped';
  running: number;
  total: number;
  urls: { studio?: string; api?: string; mail?: string };
  dbUrl?: string;
  services: Array<{ name: string; state: string; status: string; image: string }>;
}

/** Service Supabase → port interne exposé (le port public est lu dans le mapping Docker). */
const SERVICE_PORTS: Record<string, { key: 'studio' | 'api' | 'mail' | 'db'; port: number }[]> = {
  studio: [{ key: 'studio', port: 3000 }],
  kong: [{ key: 'api', port: 8000 }],
  inbucket: [{ key: 'mail', port: 9000 }, { key: 'mail', port: 8025 }],
  mailpit: [{ key: 'mail', port: 8025 }],
  db: [{ key: 'db', port: 5432 }],
};

export async function listSupabase(): Promise<{ docker: 'ok' | 'unavailable'; error?: string; instances: SupabaseInstance[] }> {
  const d = demo();
  if (d) return demoSupabase(d);
  const socket = dockerSocketPath();
  if (!socket) return { docker: 'unavailable', error: tr({ en: 'No Docker socket found', fr: 'Aucun socket Docker trouvé' }), instances: [] };
  let containers: DockerContainer[];
  try {
    containers = await dockerGet<DockerContainer[]>(socket, '/containers/json?all=1');
  } catch (e: any) {
    return { docker: 'unavailable', error: e.message, instances: [] };
  }

  const byProject = new Map<string, DockerContainer[]>();
  for (const c of containers) {
    const pid = c.Labels?.['com.supabase.cli.project'];
    if (!pid) continue;
    byProject.set(pid, [...(byProject.get(pid) ?? []), c]);
  }

  const instances: SupabaseInstance[] = [];
  for (const [projectId, list] of byProject) {
    const running = list.filter((c) => c.State === 'running').length;
    const inst: SupabaseInstance = {
      projectId,
      running,
      total: list.length,
      status: running === 0 ? 'stopped' : running === list.length ? 'running' : 'partial',
      urls: {},
      services: [],
    };
    for (const c of list) {
      const name = c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12);
      // supabase_<service>_<projectId>
      const service = name.replace(/^supabase_/, '').replace(new RegExp(`_${projectId}$`), '');
      inst.services.push({ name: service, state: c.State, status: c.Status, image: c.Image });
      for (const sp of SERVICE_PORTS[service] ?? []) {
        const pub = c.Ports.find((p) => p.PrivatePort === sp.port && p.PublicPort)?.PublicPort;
        if (!pub) continue;
        if (sp.key === 'db') inst.dbUrl = `postgresql://postgres:postgres@127.0.0.1:${pub}/postgres`;
        else inst.urls[sp.key] ??= `http://127.0.0.1:${pub}`;
      }
    }
    inst.services.sort((a, b) => a.name.localeCompare(b.name));
    instances.push(inst);
  }
  instances.sort((a, b) => a.projectId.localeCompare(b.projectId));
  return { docker: 'ok', instances };
}
