/**
 * Rattrapage artefact ↔ Tarmac (canal C). La db d'un artefact n'est lisible que par sa page ou par une
 * session de Claude desktop (le CLI `claude` n'a pas les outils d'artefact) : la session (`/suivi sync`)
 * exporte la db dans le dossier préparé ici (`suivi_sync_prepare`), Tarmac fusionne (`suivi_sync_merge`)
 * et renvoie les écritures à faire dans l'artefact.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SuiviService } from './service.js';
import { SuiviError } from './types.js';
import { tr, uiLang } from '../i18n.js';

export interface SyncJob {
  id: string;
  projectId: string;
  state: 'running' | 'done' | 'error';
  startedAt: string;
  endedAt: string | null;
  /** Résumé lisible (« 3 reçues, 1 envoyée »), ou l'erreur. */
  message: string;
  fromArtifact: number | null;
  toArtifact: number | null;
}

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;

export class SyncRunner {
  private jobs = new Map<string, SyncJob & { dir: string }>();

  constructor(private service: SuiviService, private onChange: (job: SyncJob) => void) {}

  status(projectId: string): SyncJob | null {
    const j = this.jobs.get(projectId);
    if (!j) return null;
    const { dir: _d, ...job } = j;
    return job;
  }

  /** Dossier d'échange d'un rattrapage (créé ici, jamais choisi par l'appelant). */
  prepare(projectId: string): string {
    const safe = projectId.replace(/[^\w.-]/g, '_');
    const dir = path.join(fs.realpathSync(os.tmpdir()), 'tarmac-sync', `${safe}-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(path.join(dir, 'dump'), { recursive: true });
    const prev = this.jobs.get(projectId);
    if (prev?.state === 'running') return prev.dir;
    this.jobs.set(projectId, { id: path.basename(dir), projectId, state: 'running', startedAt: new Date().toISOString(), endedAt: null, message: tr({ en: 'Preparing…', fr: 'Préparation…' }, undefined, uiLang()), fromArtifact: null, toArtifact: null, dir });
    return dir;
  }

  /** Étape 2 (appelée par Claude via MCP) : fusion de l'export et lots d'écritures pour l'artefact. */
  merge(projectId: string) {
    const j = this.jobs.get(projectId);
    if (!j) throw new SuiviError(tr({ en: 'No catch-up prepared for this project (suivi_sync_prepare)', fr: 'Aucun rattrapage préparé pour ce projet (suivi_sync_prepare)' }), 409);
    // `list` avec out_dir range les documents sous <out_dir>/tasks/.
    const dump = [path.join(j.dir, 'dump', 'tasks'), path.join(j.dir, 'dump')].find((d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith('.json'))) ?? path.join(j.dir, 'dump');
    const r = this.service.mergeArtifactDump(projectId, dump, path.join(j.dir, 'out'));
    j.fromArtifact = r.fromArtifact.created + r.fromArtifact.updated;
    j.toArtifact = r.toArtifact;
    j.message = uiLang() === 'fr'
      ? `${plural(j.fromArtifact, 'mise')} à jour reçue(s) de l'artefact, ${plural(r.toArtifact, 'écriture')} à faire dans l'artefact.`
      : `${plural(j.fromArtifact, 'update')} received from the artifact, ${plural(r.toArtifact, 'write')} to apply in the artifact.`;
    // Rattrapage terminé côté Tarmac : le prochain `prepare` repart d'un dossier vide.
    j.state = 'done';
    j.endedAt = new Date().toISOString();
    this.service.recordSync(projectId, 'C', j.message);
    this.emit(j);
    return r;
  }

  private emit(j: SyncJob) {
    this.onChange(this.status(j.projectId)!);
  }
}
