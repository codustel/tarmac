/** Demande d'installation ou de connexion d'un outil, publiée quand une action répond 424. */
export interface GateRequest { tool: string; state: string | undefined; installMethod: string | null | undefined; /** Page officielle (aucun moyen d'installation). */ docUrl?: string }

interface Pending { req: GateRequest; done: (ok: boolean) => void }
const queue: Pending[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const ask = (req: GateRequest) => new Promise<boolean>((done) => { queue.push({ req, done }); notify(); });

/** Petit magasin : la file des demandes en attente (une seule affichée à la fois). */
export const gate = {
  /** Demande directe (ex. bouton Installer de l'onglet GitHub) : `true` quand l'outil est prêt. */
  ask,
  current: (): GateRequest | null => queue[0]?.req ?? null,
  subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
  /** Clôt la demande affichée et toutes celles du même outil (double clic) : `true` = outil prêt (relance), `false` = annulé. */
  resolve(ok: boolean): void {
    const tool = queue[0]?.req.tool;
    const closed = queue.filter((p) => p.req.tool === tool);
    queue.splice(0, queue.length, ...queue.filter((p) => p.req.tool !== tool));
    closed.forEach((p) => p.done(ok));
    notify();
  },
};


/** Exécute `call` ; sur une erreur d'outil manquant (424), attend l'installation ou la connexion puis relance une seule fois. */
export async function withTool<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    const err = e as Error & { tool?: string; state?: string; installMethod?: string | null; docUrl?: string };
    if (!err.tool) throw e;
    if (!(await ask({ tool: err.tool, state: err.state, installMethod: err.installMethod, ...(err.docUrl ? { docUrl: err.docUrl } : {}) }))) throw e;
    return call();
  }
}
