import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type IntegrationResult, type TerminalSession } from '../api';
import { socket } from '../socket';
import { useToast } from '../ui';
import { useT } from '../i18n';
import { TOOL_NAMES, nextStep, sessionOutcome, type ManagedId } from './logic';

export type JobKind = 'install' | 'login' | 'update';
export interface Job { id: string; kind: JobKind; session: TerminalSession; rest: ManagedId[]; /** Échec : console gardée visible, file en pause jusqu'à « Continuer ». */ paused?: boolean }

interface Handlers {
  /** Console terminée en échec : la console reste visible, la file est en pause. */
  onFailed?: (job: Job, exitCode: number | null) => void;
  /** Console terminée avec succès, session déjà fermée : effets propres à l'appelant (after-install, rafraîchissements). */
  onSuccess?: (job: Job) => void | Promise<void>;
  /** Plus d'outil à lancer : `ok` faux quand l'échec a été passé par « Continuer ». */
  onDone?: (job: Job, ok: boolean) => void;
  /** Console fermée par l'utilisateur avant la fin. */
  onAbort?: (job: Job) => void;
  /** Lancement d'une console (aussi pour chaque outil suivant de la file). */
  onStart?: (id: string) => void;
  /** Le lancement de la console a échoué. */
  onStartError?: (id: string, error: Error) => void;
}

/**
 * Flux d'une console d'outil : lancement, détection de fin (évènement socket + relevé des consoles toutes les 2 s),
 * échec gardé visible avec « Continuer », file d'outils. Partagé par la carte Outils et la garde au premier appel.
 */
export function useToolJob(handlers: Handlers) {
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const jobRef = useRef<Job | null>(null);
  jobRef.current = job;
  const h = useRef(handlers);
  h.current = handlers;
  const finished = useRef<Set<string>>(new Set());

  // Fin d'une console : session fermée, effets de l'appelant, puis outil suivant (un échec ne coupe pas la file).
  const finish = useCallback(async (cur: Job, exitCode: number | null) => {
    if (finished.current.has(cur.session.id)) return;
    finished.current.add(cur.session.id);
    const step = nextStep(cur.rest, exitCode);
    if (step.failed) {
      // Console gardée avec sa sortie, file en pause : la suite part sur « Continuer » ou à la fermeture.
      h.current.onFailed?.(cur, exitCode);
      setJob({ ...cur, session: { ...cur.session, status: 'exited', exitCode }, paused: true });
      return;
    }
    api.closeTerminal(cur.session.id).catch(() => null);
    await h.current.onSuccess?.(cur);
    setJob(null);
    if (step.next) await startRef.current(step.next, 'install', step.rest);
    else h.current.onDone?.(cur, true);
  }, []);

  // Après un échec : on ferme la session et on passe à l'outil suivant coché.
  const proceed = useCallback(async (cur: Job) => {
    api.closeTerminal(cur.session.id).catch(() => null);
    setJob(null);
    const step = nextStep(cur.rest, 1);
    if (step.next) await startRef.current(step.next, 'install', step.rest);
    else h.current.onDone?.(cur, false);
  }, []);

  const start = useCallback(async (id: string, kind: JobKind, rest: ManagedId[] = []) => {
    setBusy(id);
    h.current.onStart?.(id);
    try {
      const session = await api.toolAction(id, kind);
      const cur: Job = { id, kind, session, rest };
      setJob(cur);
      // Processus déjà terminé à la création : pas d'évènement à attendre.
      if (session.status === 'exited') void finish(cur, session.exitCode);
    } catch (e) {
      h.current.onStartError?.(id, e as Error);
      // Échec de lancement : on passe à l'outil suivant de la file.
      const step = nextStep(rest, 1);
      if (step.next) void startRef.current(step.next, 'install', step.rest);
    } finally {
      setBusy(null);
    }
  }, [finish]);
  const startRef = useRef(start);
  startRef.current = start;

  // Détection de fin : évènement socket, avec relevé de la liste des consoles toutes les 2 s en secours.
  useEffect(() => {
    if (!job) return;
    const check = (list: TerminalSession[], gone: boolean) => {
      const cur = jobRef.current;
      if (!cur || cur.paused) return;
      const o = sessionOutcome(list, cur.session.id);
      // Absente d'un évènement socket : on ne conclut pas ; absente de la liste relevée : fermée de l'extérieur.
      if (o.done && (gone || list.some((x) => x.id === cur.session.id))) void finish(cur, o.exitCode);
    };
    const off = socket.on((msg) => {
      if (msg.type === 'terminals' && msg.projectId === '__system__') check(msg.sessions as TerminalSession[], false);
    });
    const timer = setInterval(() => { api.terminals().then((l) => check(l, true)).catch(() => null); }, 2000);
    return () => { off(); clearInterval(timer); };
  }, [job?.session.id, finish]);

  const closeConsole = useCallback(() => {
    const cur = jobRef.current;
    if (cur?.paused) { void proceed(cur); return; }
    if (cur) {
      finished.current.add(cur.session.id);
      api.closeTerminal(cur.session.id).catch(() => null);
    }
    setJob(null);
    if (cur) h.current.onAbort?.(cur);
  }, [proceed]);

  return { job, busy, start, proceed, closeConsole };
}

/**
 * Suite d'une installation réussie (carte Outils et garde) : `after-install`, intégration Tarmac annoncée par un
 * toast (décision 9 : rien de caché), réglages relus (agent coché dans le menu et Réglages → Agents).
 * Renvoie l'intégration posée (sortie comprise) pour l'afficher sur la ligne de l'outil, `null` sans intégration.
 */
export function useAfterInstall() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  return useCallback(async (id: string): Promise<IntegrationResult | null> => {
    const r = await api.toolAfterInstall(id).catch((e: Error) => { toast('err', e.message); return null; });
    const integration = r?.integration ?? null;
    if (integration) {
      const name = TOOL_NAMES[id] ?? id;
      toast(integration.ok ? 'ok' : 'err', `${name} : ${integration.ok ? t('tools.integration.done') : t('tools.integration.failed', { error: integration.error ?? '' })}`);
      qc.invalidateQueries({ queryKey: ['settings'] });
    }
    return integration;
  }, [t, toast, qc]);
}
