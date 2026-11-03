import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, CloudUpload, Files, GitBranch, Pin, Plus, RefreshCw, TerminalSquare, Trash2, X } from 'lucide-react';
import { api, type DirEntry, type Project, type ScmAction, type ScmChange, type ScmCode, type ScmLog, type ScmStatus, type TerminalSession } from '../api';
import { socket } from '../socket';
import { fmtCount, SCM_COLOR, ScmView } from './Scm';
import { copy, useToast } from '../ui';
import { TerminalView } from '../views/TerminalView';
import { CommandMenu } from '../views/CommandMenu';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { FileIcon, languageOf } from './fileIcon';
import { monaco } from './monaco';
import { fmtBytes, translateNow, useT } from '../i18n';
import { cx } from '../ui';
import { applyMonacoTheme } from './theme';

/** Police du code (comme les consoles de l'app). */
const CODE_FONT = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;
/** Identifiants Monaco quand ils diffèrent de ceux de VS Code. */
const MONACO_LANG: Record<string, string> = {
  shellscript: 'shell', dotenv: 'ini', properties: 'ini', dockercompose: 'yaml', jsonc: 'json',
  javascriptreact: 'javascript', typescriptreact: 'typescript',
};

type Doc =
  | { kind: 'loading' }
  | { kind: 'text'; model: monaco.editor.ITextModel; mtime: number; savedAlt: number; view: monaco.editor.ICodeEditorViewState | null }
  | { kind: 'image' }
  | { kind: 'binary' | 'too-large'; size: number }
  | { kind: 'error'; message: string }
  | { kind: 'diff'; original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel; view: monaco.editor.IDiffEditorViewState | null };

interface Tab { path: string; preview: boolean; pinned?: boolean }
type View = 'explorer' | 'scm';
interface Saved { tabs: Tab[]; active: string | null; expanded: string[]; panel: boolean; view: View; sideOpen: boolean }

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
/** Onglet de diff (Source Control) : `diff:index:<chemin>` (HEAD ↔ index) ou `diff:work:<chemin>` (index ↔ disque). */
const diffKey = (path: string, staged: boolean) => `diff:${staged ? 'index' : 'work'}:${path}`;
const parseDiff = (key: string) => {
  const m = /^diff:(index|work):(.+)$/.exec(key);
  return m ? { staged: m[1] === 'index', file: m[2] } : null;
};
/** Fichier réel derrière un onglet (diff ou non). */
const fileOf = (key: string) => parseDiff(key)?.file ?? key;
const tabName = (key: string) => {
  const d = parseDiff(key);
  return d ? `${baseName(d.file)} (${translateNow(d.staged ? 'ide.diff.index' : 'ide.diff.workingTree')})` : baseName(key);
};
/** Onglets épinglés d'abord, ordre relatif conservé. */
const pinnedFirst = (ts: Tab[]) => [...ts.filter((t) => t.pinned), ...ts.filter((t) => !t.pinned)];
const storageKey = (id: string) => `ide:ws:${id}`;
const loadSaved = (id: string): Saved => {
  try {
    const s = JSON.parse(localStorage.getItem(storageKey(id)) ?? 'null');
    if (s) return { tabs: s.tabs ?? [], active: s.active ?? null, expanded: s.expanded ?? [], panel: s.panel ?? true, view: s.view === 'scm' ? 'scm' : 'explorer', sideOpen: s.sideOpen ?? true };
  } catch { /* état illisible */ }
  return { tabs: [], active: null, expanded: [], panel: true, view: 'explorer', sideOpen: true };
};

/** Un projet ouvert dans l'IDE : explorateur, onglets de fichiers, éditeur Monaco, terminal. */
export function Workspace({ project, visible, onDirty }: { project: Project; visible: boolean; onDirty: (n: number) => void }) {
  const toast = useToast();
  // `t` désigne les onglets dans ce composant : le traducteur s'appelle `tr`.
  const tr = useT();
  const id = project.id;
  const saved = useMemo(() => loadSaved(id), [id]);

  // ─── Explorateur ───
  const [dirs, setDirs] = useState<Record<string, DirEntry[] | Error>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(saved.expanded));
  const loadDir = useCallback(async (path: string) => {
    try {
      const entries = await api.fsList(id, path);
      setDirs((d) => ({ ...d, [path]: entries }));
    } catch (e: any) {
      setDirs((d) => ({ ...d, [path]: e }));
    }
  }, [id]);
  const refreshTree = useCallback(() => {
    for (const p of ['', ...expanded]) loadDir(p);
  }, [expanded, loadDir]);
  useEffect(() => { refreshTree(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleDir = (path: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else {
        n.add(path);
        if (!dirs[path]) loadDir(path);
      }
      return n;
    });
  };

  // ─── Documents et onglets ───
  const docs = useRef(new Map<string, Doc>());
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const [tabs, setTabs] = useState<Tab[]>(saved.tabs);
  const [active, setActive] = useState<string | null>(saved.active);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const refreshDirty = useCallback((path: string) => {
    const d = docs.current.get(path);
    const isDirty = d?.kind === 'text' && d.model.getAlternativeVersionId() !== d.savedAlt;
    setDirty((s) => {
      if (s.has(path) === isDirty) return s;
      const n = new Set(s);
      if (isDirty) n.add(path); else n.delete(path);
      return n;
    });
  }, []);

  /** Contenus gauche / droite d'un onglet de diff. */
  const diffContents = useCallback(async (file: string, staged: boolean) => {
    const [left, right] = await Promise.all([
      api.scmShow(id, file, staged ? 'HEAD' : 'INDEX'),
      staged ? api.scmShow(id, file, 'INDEX') : api.fsRead(id, file).catch((e) => (e.status === 404 ? { kind: 'text' as const, content: '' } : Promise.reject(e))),
    ]);
    if (left.kind !== 'text' || right.kind !== 'text') return null;
    return [left.content, right.content] as const;
  }, [id]);

  const loadDoc = useCallback(async (path: string) => {
    if (docs.current.has(path)) return;
    const dk = parseDiff(path);
    if (dk) {
      docs.current.set(path, { kind: 'loading' });
      bump();
      try {
        const c = await diffContents(dk.file, dk.staged);
        if (!docs.current.has(path)) return;
        if (!c) docs.current.set(path, { kind: 'error', message: translateNow('ide.diff.binary') });
        else {
          const lang = languageOf(baseName(dk.file));
          const mapped = lang ? MONACO_LANG[lang] ?? lang : undefined;
          const known = mapped && monaco.languages.getLanguages().some((l) => l.id === mapped) ? mapped : undefined;
          docs.current.set(path, { kind: 'diff', original: monaco.editor.createModel(c[0], known), modified: monaco.editor.createModel(c[1], known), view: null });
        }
      } catch (e: any) {
        docs.current.set(path, { kind: 'error', message: e.message });
      }
      return bump();
    }
    if (IMAGE_EXT.test(path)) {
      docs.current.set(path, { kind: 'image' });
      return bump();
    }
    docs.current.set(path, { kind: 'loading' });
    bump();
    try {
      const r = await api.fsRead(id, path);
      if (!docs.current.has(path)) return; // onglet fermé entre-temps
      if (r.kind !== 'text') {
        docs.current.set(path, { kind: r.kind, size: r.size });
      } else {
        const uri = monaco.Uri.from({ scheme: 'file', path: `/${encodeURIComponent(id)}/${path}` });
        monaco.editor.getModel(uri)?.dispose();
        const lang = languageOf(baseName(path));
        const mapped = lang ? MONACO_LANG[lang] ?? lang : undefined;
        const known = mapped && monaco.languages.getLanguages().some((l) => l.id === mapped);
        const model = monaco.editor.createModel(r.content, known ? mapped : undefined, uri);
        const doc: Doc = { kind: 'text', model, mtime: r.mtime, savedAlt: model.getAlternativeVersionId(), view: null };
        docs.current.set(path, doc);
        model.onDidChangeContent(() => {
          refreshDirty(path);
          // Comme VS Code : modifier un onglet d'aperçu le rend permanent.
          setTabs((ts) => (ts.some((t) => t.path === path && t.preview) ? ts.map((t) => (t.path === path ? { ...t, preview: false } : t)) : ts));
        });
      }
    } catch (e: any) {
      docs.current.set(path, { kind: 'error', message: e.message });
    }
    bump();
  }, [id, refreshDirty, diffContents]);

  /** Onglets de diff ouverts remis à jour (après un changement disque ou git). */
  const refreshDiffs = useCallback(async () => {
    for (const [key, d] of docs.current) {
      const dk = parseDiff(key);
      if (!dk || d.kind !== 'diff') continue;
      const c = await diffContents(dk.file, dk.staged).catch(() => null);
      if (!c || d.original.isDisposed()) continue;
      if (d.original.getValue() !== c[0]) d.original.setValue(c[0]);
      if (d.modified.getValue() !== c[1]) d.modified.setValue(c[1]);
    }
  }, [diffContents]);

  const disposeDoc = (path: string) => {
    const d = docs.current.get(path);
    if (d?.kind === 'text') d.model.dispose();
    if (d?.kind === 'diff') {
      if (diffEditor.current?.getModel()?.original === d.original) diffEditor.current.setModel(null);
      d.original.dispose();
      d.modified.dispose();
    }
    docs.current.delete(path);
    setDirty((s) => {
      if (!s.has(path)) return s;
      const n = new Set(s);
      n.delete(path);
      return n;
    });
  };

  // Restauration des onglets de la session précédente.
  useEffect(() => {
    for (const t of saved.tabs) loadDoc(t.path);
    return () => {
      for (const p of [...docs.current.keys()]) disposeDoc(p);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ouvre un onglet par fichier (`preview` : onglet d'aperçu remplacé par le suivant, comme VS Code). */
  const openFile = (path: string, preview: boolean) => {
    setTabs((ts) => {
      const existing = ts.find((t) => t.path === path);
      if (existing) return preview || !existing.preview ? ts : ts.map((t) => (t.path === path ? { ...t, preview: false } : t));
      const prev = preview ? ts.find((t) => t.preview && !dirty.has(t.path)) : undefined;
      if (prev) {
        disposeDoc(prev.path);
        return ts.map((t) => (t === prev ? { path, preview: true } : t));
      }
      const i = ts.findIndex((t) => t.path === active);
      const next = [...ts];
      next.splice(Math.max(i + 1, ts.filter((t) => t.pinned).length), 0, { path, preview });
      return next;
    });
    setActive(path);
    loadDoc(path);
  };

  const closeTabs = (paths: string[]) => {
    if (paths.length === 0) return;
    const unsaved = paths.filter((p) => dirty.has(p));
    if (unsaved.length && !confirm(tr('ide.editor.confirmCloseUnsaved', { files: unsaved.map(baseName).join(', ') }))) return;
    const ts = tabsRef.current;
    const i = ts.findIndex((t) => t.path === active);
    const next = ts.filter((t) => !paths.includes(t.path));
    setTabs(next);
    if (active && paths.includes(active)) {
      // Voisin le plus proche encore ouvert (à droite d'abord, comme VS Code).
      const after = ts.slice(i + 1).find((t) => !paths.includes(t.path)) ?? [...ts.slice(0, i)].reverse().find((t) => !paths.includes(t.path));
      setActive(after?.path ?? null);
    }
    for (const p of paths) disposeDoc(p);
  };
  const closeTab = (path: string) => closeTabs([path]);
  const setPinned = (path: string, on: boolean) =>
    setTabs((ts) => pinnedFirst(ts.map((t) => (t.path === path ? { ...t, pinned: on || undefined, preview: false } : t))));

  /** Déplie l'arborescence jusqu'au fichier et le fait défiler à l'écran. */
  const reveal = (path: string) => {
    const parts = path.split('/');
    const ancestors = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
    for (const a of ancestors) if (!dirs[a]) loadDir(a);
    setExpanded((s) => new Set([...s, ...ancestors]));
    setTimeout(() => document.querySelector(`[data-ide-path="${CSS.escape(`${id}:${path}`)}"]`)?.scrollIntoView({ block: 'center' }), 300);
  };

  // ─── Menu contextuel des onglets ───
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuItems = (path: string): MenuItem[] => {
    const t = tabs.find((x) => x.path === path)!;
    const i = tabs.indexOf(t);
    const all = tabs.map((x) => x.path);
    const file = fileOf(path);
    const abs = `${project.dir}/${file}`;
    return [
      { label: tr(t.pinned ? 'ide.tabs.unpin' : 'ide.tabs.pin'), onClick: () => setPinned(path, !t.pinned) },
      ...(t.preview ? [{ label: tr('ide.tabs.keepOpen'), hint: tr('ide.tabs.doubleClick'), onClick: () => openFile(path, false) }] : []),
      'separator',
      { label: tr('ide.tabs.close'), hint: tr('ide.tabs.middleClick'), onClick: () => closeTab(path) },
      { label: tr('ide.tabs.closeOthers'), disabled: tabs.length < 2, onClick: () => closeTabs(all.filter((p) => p !== path)) },
      { label: tr('ide.tabs.closeRight'), disabled: i === tabs.length - 1, onClick: () => closeTabs(all.slice(i + 1)) },
      { label: tr('ide.tabs.closeSaved'), disabled: tabs.every((x) => dirty.has(x.path)), onClick: () => closeTabs(all.filter((p) => !dirty.has(p))) },
      { label: tr('ide.tabs.closeUnpinned'), disabled: tabs.every((x) => x.pinned), onClick: () => closeTabs(tabs.filter((x) => !x.pinned).map((x) => x.path)) },
      { label: tr('ide.tabs.closeAll'), onClick: () => closeTabs(all) },
      'separator',
      { label: tr('ide.tabs.copyPath'), onClick: () => copy(abs, toast, tr('ide.tabs.pathCopied')) },
      { label: tr('ide.tabs.copyRelPath'), onClick: () => copy(file, toast, tr('ide.tabs.relPathCopied')) },
      'separator',
      { label: tr('ide.tabs.revealInExplorer'), onClick: () => reveal(file) },
      { label: tr('ide.tabs.revealInFinder'), onClick: () => api.open(abs, 'finder').catch((e) => toast('err', e.message)) },
    ];
  };

  // ─── Glisser-déposer : déposer parmi les épinglés épingle l'onglet, et inversement ───
  const [dragTab, setDragTab] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ path: string | null; after: boolean } | null>(null);
  const resetDrag = () => { setDragTab(null); setDropAt(null); };
  const onTabDrop = () => {
    if (!dragTab || !dropAt || dropAt.path === dragTab) return resetDrag();
    setTabs((ts) => {
      const moved = ts.find((t) => t.path === dragTab);
      if (!moved) return ts;
      const rest = ts.filter((t) => t.path !== dragTab);
      const at = dropAt.path === null ? rest.length : rest.findIndex((t) => t.path === dropAt.path) + (dropAt.after ? 1 : 0);
      const pin = dropAt.path !== null && !!ts.find((t) => t.path === dropAt.path)?.pinned;
      rest.splice(at, 0, { ...moved, pinned: pin || undefined, preview: pin ? false : moved.preview });
      return pinnedFirst(rest);
    });
    resetDrag();
  };

  const save = useCallback(async (path: string) => {
    const d = docs.current.get(path);
    if (d?.kind !== 'text') return;
    const content = d.model.getValue();
    const alt = d.model.getAlternativeVersionId();
    let r: { mtime: number };
    try {
      r = await api.fsWrite(id, path, content, d.mtime);
    } catch (e: any) {
      if (e.status !== 409 || !confirm(tr('ide.editor.confirmOverwrite', { name: baseName(path) }))) {
        if (e.status !== 409) toast('err', e.message);
        return;
      }
      try {
        r = await api.fsWrite(id, path, content, d.mtime, true);
      } catch (e2: any) {
        return toast('err', e2.message);
      }
    }
    d.mtime = r.mtime;
    d.savedAlt = alt;
    refreshDirty(path);
  }, [id, refreshDirty, toast]);

  /** Recharge les fichiers modifiés sur le disque (par Claude, git…) s'ils n'ont pas de modifications locales. */
  const syncFromDisk = useCallback(async (paths: string[]) => {
    for (const path of paths) {
      const d = docs.current.get(path);
      if (d?.kind !== 'text' || d.model.getAlternativeVersionId() !== d.savedAlt) continue;
      try {
        const st = await api.fsStat(id, path);
        if (Math.abs(st.mtime - d.mtime) <= 1) continue;
        const r = await api.fsRead(id, path);
        if (r.kind !== 'text' || d.model.isDisposed()) continue;
        if (r.content !== d.model.getValue()) d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text: r.content }], () => null);
        d.mtime = r.mtime;
        d.savedAlt = d.model.getAlternativeVersionId();
        refreshDirty(path);
      } catch { /* fichier supprimé : on garde la version ouverte */ }
    }
  }, [id, refreshDirty]);

  useEffect(() => {
    if (!visible) return;
    const onFocus = () => {
      syncFromDisk(tabsRef.current.map((t) => t.path));
      refreshTree();
    };
    onFocus();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(() => document.visibilityState === 'visible' && active && syncFromDisk([active]), 3000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [visible, active, syncFromDisk, refreshTree]);

  useEffect(() => onDirty(dirty.size), [dirty.size, onDirty]);
  useEffect(() => {
    if (dirty.size === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty.size]);

  // ─── Éditeur Monaco (une instance, un modèle par fichier) ───
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffHost = useRef<HTMLDivElement>(null);
  const diffEditor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const shown = useRef<string | null>(null);
  const saveActive = useRef<() => void>(() => {});
  saveActive.current = () => { if (active) save(active); };
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null);

  useEffect(() => {
    const theme = applyMonacoTheme();
    const ed = monaco.editor.create(host.current!, {
      model: null,
      theme,
      automaticLayout: true,
      fontFamily: CODE_FONT,
      fontSize: 12,
      lineHeight: 18,
      tabSize: 2,
      minimap: { enabled: true },
      smoothScrolling: true,
      renderLineHighlight: 'all',
      bracketPairColorization: { enabled: true },
      stickyScroll: { enabled: true },
      scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 10 },
    });
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveActive.current());
    ed.onDidChangeCursorPosition((e) => setCursor({ line: e.position.lineNumber, col: e.position.column }));
    editor.current = ed;
    const diff = monaco.editor.createDiffEditor(diffHost.current!, {
      theme,
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      fontFamily: CODE_FONT,
      fontSize: 12,
      lineHeight: 18,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      renderSideBySideInlineBreakpoint: 600,
      scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 10 },
    });
    diffEditor.current = diff;
    return () => {
      diff.setModel(null);
      diff.dispose();
      ed.dispose();
    };
  }, []);

  const activeDoc = active ? docs.current.get(active) : undefined;
  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    const prev = shown.current ? docs.current.get(shown.current) : undefined;
    if (prev?.kind === 'text' && shown.current !== active && !prev.model.isDisposed()) prev.view = ed.saveViewState();
    if (prev?.kind === 'diff' && shown.current !== active && !prev.original.isDisposed()) prev.view = diffEditor.current!.saveViewState();
    const diff = diffEditor.current!;
    // `display` et non `visibility` : Monaco rend certains éléments du diff `visible` d'office (bande verticale
    // et clics interceptés au-dessus de l'éditeur texte quand le diff est masqué).
    diffHost.current!.style.display = activeDoc?.kind === 'diff' ? 'block' : 'none';
    if (activeDoc?.kind === 'diff') {
      ed.setModel(null);
      if (diff.getModel()?.original !== activeDoc.original) {
        diff.setModel({ original: activeDoc.original, modified: activeDoc.modified });
        if (activeDoc.view) diff.restoreViewState(activeDoc.view);
      }
      shown.current = active;
    } else if (activeDoc?.kind === 'text') {
      if (ed.getModel() !== activeDoc.model) {
        ed.setModel(activeDoc.model);
        if (activeDoc.view) ed.restoreViewState(activeDoc.view);
        if (visible) ed.focus();
      }
      shown.current = active;
    } else {
      ed.setModel(null);
      shown.current = null;
    }
  });

  // ⌘S hors de l'éditeur (explorateur, onglets) quand cet espace est affiché.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveActive.current();
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyG') {
        e.preventDefault();
        setView('scm');
        setSideOpen(true);
      }
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        setPanel((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  // ─── Terminal ───
  const [panel, setPanel] = useState(saved.panel);
  const [terms, setTerms] = useState<TerminalSession[]>([]);
  const [activeTerm, setActiveTerm] = useState<string | null>(null);
  const termsRef = useRef(terms);
  termsRef.current = terms;
  const addTerminal = useCallback((s: TerminalSession) => {
    setTerms((t) => [...t, s]);
    setActiveTerm(s.id);
  }, []);
  const newTerminal = useCallback(async () => {
    try {
      addTerminal(await api.openTerminal(id, { shell: true, cols: 120, rows: 14 }));
    } catch (e: any) {
      toast('err', e.message);
    }
  }, [id, toast, addTerminal]);
  // Premier terminal créé à l'ouverture du panneau (une seule fois, même en double montage React).
  const autoTerm = useRef(false);
  useEffect(() => {
    if (!panel || !visible || autoTerm.current || termsRef.current.length > 0) return;
    autoTerm.current = true;
    newTerminal();
  }, [panel, visible, newTerminal]);
  useEffect(() => () => { for (const t of termsRef.current) api.closeTerminal(t.id).catch(() => null); }, []);
  const killTerminal = (sid: string) => {
    api.closeTerminal(sid).catch(() => null);
    const next = terms.filter((t) => t.id !== sid);
    setTerms(next);
    if (activeTerm === sid) setActiveTerm(next.at(-1)?.id ?? null);
    if (next.length === 0) {
      setPanel(false);
      autoTerm.current = false;
    }
  };

  // ─── Source Control ───
  const [view, setView] = useState<View>(saved.view);
  const [sideOpen, setSideOpen] = useState(saved.sideOpen);
  const showView = (v: View) => {
    if (v === view && sideOpen) setSideOpen(false);
    else { setView(v); setSideOpen(true); }
  };
  const [scm, setScm] = useState<ScmStatus | null>(null);
  const [scmLog, setScmLog] = useState<ScmLog | null>(null);
  const [scmError, setScmError] = useState<string | null>(null);
  const [scmBusy, setScmBusy] = useState(0);
  const scmRun = useRef({ timer: 0, running: false, again: false });
  const fetchScm = useCallback(async () => {
    const r = scmRun.current;
    if (r.running) return void (r.again = true);
    r.running = true;
    try {
      const [st, lg] = await Promise.all([api.scm(id), api.scmLog(id)]);
      setScm(st);
      setScmLog(lg);
      setScmError(null);
    } catch (e: any) {
      setScmError(e.message);
    } finally {
      r.running = false;
      if (r.again) { r.again = false; fetchScm(); }
    }
  }, [id]);
  const refreshScm = useCallback(() => {
    clearTimeout(scmRun.current.timer);
    scmRun.current.timer = window.setTimeout(fetchScm, 150);
  }, [fetchScm]);
  useEffect(() => { refreshDiffs(); }, [scm, refreshDiffs]);
  const runScm = async (action: ScmAction, body?: Parameters<typeof api.scmAction>[2]) => {
    setScmBusy((n) => n + 1);
    try {
      await api.scmAction(id, action, body);
      return true;
    } catch (e: any) {
      toast('err', e.message);
      return false;
    } finally {
      setScmBusy((n) => n - 1);
      refreshScm();
    }
  };
  /** Décorations de l'explorateur : lettre par fichier, couleur héritée par les dossiers parents. */
  const decor = useMemo(() => {
    const files = new Map<string, ScmCode>();
    const folders = new Map<string, string>();
    if (!scm) return { files, folders };
    const rank = (c: ScmCode) => (c === '!' ? 3 : c === 'U' || c === 'A' || c === 'C' ? 1 : 2);
    for (const c of [...scm.staged, ...scm.changes, ...scm.conflicts]) files.set(c.path, c.code);
    const best = new Map<string, ScmCode>();
    for (const [p, code] of files) {
      for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) {
        const d = p.slice(0, i);
        const cur = best.get(d);
        if (!cur || rank(code) > rank(cur)) best.set(d, code);
      }
    }
    for (const [d, code] of best) folders.set(d, SCM_COLOR[code === 'D' || code === 'R' || code === 'T' ? 'M' : code]);
    return { files, folders };
  }, [scm]);
  const openChange = (c: ScmChange, staged: boolean, preview: boolean) => {
    if (!staged && c.code === 'U') openFile(c.path, preview);
    else openFile(diffKey(c.path, staged), preview);
  };

  // Temps réel : le serveur signale chaque changement disque du projet (sessions Claude, git, autre éditeur).
  const onFsChange = useRef<(paths: string[], all: boolean) => void>(() => {});
  onFsChange.current = (paths, all) => {
    refreshScm();
    const files = paths.filter((p) => p !== '.git' && !p.startsWith('.git/'));
    if (all) refreshTree();
    else {
      const parents = new Set(files.map((p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')));
      for (const d of parents) if (d === '' || (dirs[d] && expanded.has(d))) loadDir(d);
    }
    const open = tabsRef.current.map((t) => t.path);
    syncFromDisk(all ? open : open.filter((t) => files.includes(t)));
  };
  useEffect(() => {
    const unwatch = socket.watchProject(id);
    const off = socket.on((msg) => {
      if (msg.type === 'reconnect') refreshScm();
      else if (msg.type === 'ide:fs' && msg.projectId === id) onFsChange.current(msg.paths, msg.all);
    });
    refreshScm();
    return () => { off(); unwatch(); };
  }, [id, refreshScm]);

  // ─── Persistance ───
  useEffect(() => {
    localStorage.setItem(storageKey(id), JSON.stringify({ tabs, active, expanded: [...expanded], panel, view, sideOpen } satisfies Saved));
  }, [id, tabs, active, expanded, panel, view, sideOpen]);

  // ─── Redimensionnement ───
  const [sideW, setSideW] = useState(260);
  const [panelH, setPanelH] = useState(240);
  const drag = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    e.preventDefault();
    const start = axis === 'x' ? e.clientX : e.clientY;
    const from = axis === 'x' ? sideW : panelH;
    const move = (ev: PointerEvent) => {
      if (axis === 'x') setSideW(Math.max(160, Math.min(600, from + ev.clientX - start)));
      else setPanelH(Math.max(100, Math.min(window.innerHeight - 200, from - (ev.clientY - start))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ─── Rendu de l'arborescence ───
  const rows: React.ReactNode[] = [];
  const walk = (path: string, depth: number) => {
    const entries = dirs[path];
    if (!entries) return rows.push(<div key={`${path}/…`} style={{ paddingLeft: 18 + depth * 12 }} className="h-[22px] text-[12px] leading-[22px] text-faint">{tr('ide.explorer.loading')}</div>);
    if (entries instanceof Error) return rows.push(<div key={`${path}/!`} style={{ paddingLeft: 18 + depth * 12 }} className="h-[22px] text-[12px] leading-[22px] text-red-600 dark:text-red-400">{entries.message}</div>);
    for (const e of entries) {
      const p = path ? `${path}/${e.name}` : e.name;
      const open = expanded.has(p);
      const isActive = p === fileOf(active ?? '');
      const code = e.type === 'file' ? decor.files.get(p) : undefined;
      const color = dirty.has(p) ? 'var(--ide-git-m)' : code ? SCM_COLOR[code] : e.type === 'dir' ? decor.folders.get(p) : undefined;
      rows.push(
        <div
          key={p}
          title={p}
          data-ide-path={`${id}:${p}`}
          onClick={() => (e.type === 'dir' ? toggleDir(p) : openFile(p, false))}
          onDoubleClick={() => e.type === 'file' && openFile(p, false)}
          style={{ paddingLeft: 2 + depth * 12 }}
          className={cx('ide-row mx-1.5 flex h-[22px] cursor-pointer select-none items-center gap-1 pr-1.5 text-[13px]', isActive && 'bg-accent/10 font-medium text-fg hover:!bg-accent/15')}
        >
          {e.type === 'dir'
            ? (open ? <ChevronDown className="size-4 shrink-0 text-faint" /> : <ChevronRight className="size-4 shrink-0 text-faint" />)
            : <FileIcon name={e.name} />}
          <span className="flex-1 truncate" style={{ color }}>{e.name}</span>
          {code && <span className="w-3 shrink-0 text-center text-[12px]" style={{ color: SCM_COLOR[code] }}>{code}</span>}
          {!code && color && e.type === 'dir' && <span className="shrink-0 text-[8px]" style={{ color }}>●</span>}
        </div>,
      );
      if (e.type === 'dir' && open) walk(p, depth + 1);
    }
  };
  walk('', 0);

  const crumbs = active ? fileOf(active).split('/') : [];
  const scmCount = scm ? scm.counts.staged + scm.counts.changes + scm.counts.conflicts : 0;
  const branch = scm?.branch ?? project.repo?.git?.branch ?? null;

  return (
    <div className="flex h-full flex-col bg-panel text-fg" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="flex min-h-0 flex-1">
        {/* Barre d'activité */}
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-bg pt-1.5">
          {([['explorer', Files, tr('ide.activity.explorer')], ['scm', GitBranch, tr('ide.activity.scm')]] as const).map(([v, Icon, title]) => {
            const on = view === v && sideOpen;
            return (
              <button key={v} title={title} onClick={() => showView(v)} className={cx('relative grid size-9 place-items-center rounded-md transition-colors', on ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-panel-2 hover:text-fg')}>
                <Icon className="size-5" strokeWidth={1.75} />
                {v === 'scm' && scmCount > 0 && (
                  <span className="absolute -bottom-0.5 -right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[9px] font-semibold leading-4 text-accent-fg tabular-nums ring-2 ring-bg">{fmtCount(scmCount)}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Barre latérale : explorateur ou Source Control */}
        <aside className="flex shrink-0 flex-col border-r border-line bg-bg" style={{ width: sideW, display: sideOpen ? 'flex' : 'none' }}>
          {view === 'scm' && (
            project.repo
              ? <ScmView
                  projectId={id}
                  status={scm}
                  log={scmLog}
                  error={scmError}
                  busy={scmBusy > 0}
                  onAction={runScm}
                  onRefresh={fetchScm}
                  onOpenChange={openChange}
                  onOpenFile={(p) => openFile(p, false)}
                  onReveal={(p) => { setView('explorer'); reveal(p); }}
                  onCopy={(p) => copy(p, toast, tr('ide.tabs.relPathCopied'))}
                />
              : <div className="px-4 py-3 text-[12px] text-muted">{tr('ide.scm.notRepo')}</div>
          )}
          <div className="flex min-h-0 flex-1 flex-col" style={{ display: view === 'explorer' ? 'flex' : 'none' }}>
          <div className="flex h-[35px] items-center px-4 text-[11px] font-semibold tracking-wider text-faint">{tr('ide.explorer.header')}</div>
          <div className="group mx-1.5 flex h-[22px] items-center gap-1 pl-0.5 text-[11px] font-semibold tracking-wide text-muted">
            <ChevronDown className="size-4 text-faint" />
            <span className="flex-1 truncate uppercase">{project.name}</span>
            <button title={tr('ide.explorer.refresh')} onClick={refreshTree} className="ide-icon-btn opacity-0 group-hover:opacity-100"><RefreshCw className="size-3.5" /></button>
            <button title={tr('ide.explorer.collapseAll')} onClick={() => setExpanded(new Set())} className="ide-icon-btn opacity-0 group-hover:opacity-100"><ChevronsDownUp className="size-3.5" /></button>
          </div>
          <div className="ide-scroll min-h-0 flex-1 overflow-auto pb-4">{rows}</div>
          </div>
        </aside>
        <div onPointerDown={drag('x')} hidden={!sideOpen} className="w-1 shrink-0 cursor-col-resize transition-colors hover:bg-accent" style={{ marginLeft: -2, marginRight: -2, zIndex: 1 }} />

        {/* Éditeur + terminal */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="ide-scroll flex h-[35px] shrink-0 overflow-x-auto overflow-y-hidden bg-bg">
            {tabs.map((t) => {
              const on = t.path === active;
              const isDirty = dirty.has(t.path);
              const marker = dropAt?.path === t.path && dragTab !== t.path ? (dropAt.after ? 'right' : 'left') : null;
              return (
                <div
                  key={t.path}
                  title={t.path}
                  draggable
                  onDragStart={(e) => { setDragTab(t.path); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.path); }}
                  onDragOver={(e) => {
                    if (!dragTab) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    const after = e.clientX > r.left + r.width / 2;
                    if (dropAt?.path !== t.path || dropAt.after !== after) setDropAt({ path: t.path, after });
                  }}
                  onDrop={(e) => { e.preventDefault(); onTabDrop(); }}
                  onDragEnd={resetDrag}
                  onClick={() => setActive(t.path)}
                  onDoubleClick={() => openFile(t.path, false)}
                  onAuxClick={(e) => e.button === 1 && closeTab(t.path)}
                  onContextMenu={(e) => { e.preventDefault(); setActive(t.path); setMenu({ path: t.path, x: e.clientX, y: e.clientY }); }}
                  className={cx(
                    'group relative flex h-full shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-line pl-3 pr-1.5 text-[13px] transition-colors',
                    on ? 'bg-panel font-medium text-fg shadow-[inset_0_2px_0_var(--accent)]' : 'text-muted shadow-[inset_0_-1px_0_var(--line)] hover:bg-panel-2/60 hover:text-fg',
                  )}
                  style={{ opacity: dragTab === t.path ? 0.5 : 1 }}
                >
                  {marker && <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent" style={{ [marker]: -1 }} />}
                  <FileIcon name={baseName(fileOf(t.path))} />
                  <span className={t.preview ? 'italic' : ''}>{tabName(t.path)}</span>
                  {t.pinned ? (
                    <button
                      title={isDirty ? tr('ide.tabs.unpinDirty') : tr('ide.tabs.unpin')}
                      onClick={(e) => { e.stopPropagation(); setPinned(t.path, false); }}
                      className="grid size-5 place-items-center rounded text-muted hover:bg-panel-2 hover:text-fg"
                    >
                      {isDirty ? <span className="size-2 rounded-full bg-current" /> : <Pin className="size-3.5 rotate-45" />}
                    </button>
                  ) : (
                  <button
                    title={isDirty ? tr('ide.tabs.closeDirty') : tr('ide.tabs.close')}
                    onClick={(e) => { e.stopPropagation(); closeTab(t.path); }}
                    className="grid size-5 place-items-center rounded text-muted hover:bg-panel-2 hover:text-fg"
                  >
                    {isDirty
                      ? <><span className="size-2 rounded-full bg-current group-hover:hidden" /><X className="hidden size-3.5 group-hover:block" /></>
                      : <X className={on ? 'size-3.5' : 'size-3.5 opacity-0 group-hover:opacity-100'} />}
                  </button>
                  )}
                </div>
              );
            })}
            {/* Zone vide : déposer ici place l'onglet en dernier (non épinglé). */}
            <div
              className="min-w-8 flex-1"
              onDragOver={(e) => { if (dragTab) { e.preventDefault(); if (dropAt?.path !== null) setDropAt({ path: null, after: true }); } }}
              onDrop={(e) => { e.preventDefault(); onTabDrop(); }}
              style={{ boxShadow: dropAt?.path === null ? 'inset 2px 0 0 var(--accent), inset 0 -1px 0 var(--line)' : 'inset 0 -1px 0 var(--line)' }}
            />
          </div>

          {active && (
            <div className="flex h-[26px] shrink-0 items-center gap-0.5 px-3 text-[12px] text-muted">
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  {i > 0 && <ChevronRight className="size-3.5 text-faint" />}
                  {i === crumbs.length - 1 && <FileIcon name={c} />}
                  <span className={i === crumbs.length - 1 ? 'text-fg' : ''}>{c}</span>
                </span>
              ))}
            </div>
          )}

          <div className="ide-editor relative min-h-0 flex-1">
            <div ref={host} className="absolute inset-0" />
            <div ref={diffHost} className="absolute inset-0" style={{ display: 'none' }} />
            {activeDoc && activeDoc.kind !== 'text' && activeDoc.kind !== 'diff' && (
              <div className="absolute inset-0 grid place-items-center bg-panel p-6 text-[13px] text-muted">
                {activeDoc.kind === 'loading' && tr('ide.editor.opening')}
                {activeDoc.kind === 'image' && <img src={api.fsRawUrl(id, active!)} alt={active!} className="max-h-full max-w-full object-contain" style={{ backgroundImage: 'repeating-conic-gradient(var(--panel-2) 0 25%, var(--panel) 0 50%)', backgroundSize: '16px 16px' }} />}
                {activeDoc.kind === 'binary' && tr('ide.editor.binary', { size: fmtBytes(activeDoc.size) })}
                {activeDoc.kind === 'too-large' && tr('ide.editor.tooLarge', { size: fmtBytes(activeDoc.size) })}
                {activeDoc.kind === 'error' && <span className="text-red-600 dark:text-red-400">{activeDoc.message}</span>}
              </div>
            )}
            {!active && (
              <div className="absolute inset-0 grid place-items-center text-[13px] text-faint">
                <div className="space-y-1.5 text-center">
                  <div>{tr('ide.editor.emptyTitle')}</div>
                  <div>{tr('ide.editor.emptyHint')}</div>
                </div>
              </div>
            )}
          </div>

          {/* Terminal */}
          {panel && (
            <>
              <div onPointerDown={drag('y')} className="h-1 shrink-0 cursor-row-resize transition-colors hover:bg-accent" style={{ marginTop: -2, marginBottom: -2, zIndex: 1 }} />
              <div className="flex shrink-0 flex-col border-t border-line bg-panel" style={{ height: panelH }}>
                <div className="flex h-[35px] shrink-0 items-center gap-1 px-3 text-[11px]">
                  <span className="border-b-2 border-accent pb-1 pt-1.5 font-semibold tracking-wider text-fg">TERMINAL</span>
                  <div className="flex-1" />
                  <CommandMenu project={project} kind="git" variant="ide" onStarted={addTerminal} />
                  <CommandMenu project={project} kind="supabase" variant="ide" onStarted={addTerminal} />
                  <button title={tr('ide.terminal.new')} onClick={newTerminal} className="ide-icon-btn"><Plus className="size-4" /></button>
                  {activeTerm && <button title={tr('ide.terminal.close')} onClick={() => killTerminal(activeTerm)} className="ide-icon-btn"><Trash2 className="size-3.5" /></button>}
                  <button title={tr('ide.terminal.hide')} onClick={() => setPanel(false)} className="ide-icon-btn"><X className="size-4" /></button>
                </div>
                <div className="flex min-h-0 flex-1">
                  <div className="min-w-0 flex-1 pl-2">
                    {terms.map((t) => (
                      <div key={t.id} className="h-full" style={{ display: t.id === activeTerm ? 'block' : 'none' }}>
                        <TerminalView sid={t.id} active={visible && panel && t.id === activeTerm} followTheme />
                      </div>
                    ))}
                  </div>
                  {terms.length > 1 && (
                    <div className="ide-scroll w-40 shrink-0 overflow-auto border-l border-line py-1 text-[12px]">
                      {terms.map((t, i) => (
                        <div key={t.id} onClick={() => setActiveTerm(t.id)} className={cx('ide-row mx-1 flex h-[22px] cursor-pointer items-center gap-1.5 px-2', t.id === activeTerm ? 'bg-accent/10 text-fg hover:!bg-accent/15' : 'text-muted')}>
                          <TerminalSquare className="size-3.5" />
                          <span className="truncate" title={t.label}>{t.kind === 'command' ? t.label : `zsh ${i + 1}`}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Barre d'état */}
      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-bg px-3 text-[12px] text-muted">
        {branch && <button title={tr('ide.status.scm')} onClick={() => showView('scm')} className="flex items-center gap-1 font-medium text-fg hover:text-accent"><GitBranch className="size-3.5 text-accent" />{branch}{scmCount > 0 ? '*' : ''}</button>}
        {scm?.upstream && (
          <button title={tr('ide.status.sync', { upstream: scm.upstream })} disabled={scmBusy > 0} onClick={() => runScm('sync')} className="flex items-center gap-1 hover:text-fg">
            <RefreshCw className={`size-3.5 ${scmBusy > 0 ? 'animate-spin' : ''}`} />{scm.behind}↓ {scm.ahead}↑
          </button>
        )}
        {scm && !scm.upstream && scm.branch && (
          <button title={tr('ide.status.publish')} disabled={scmBusy > 0} onClick={() => runScm('push')} className="flex items-center gap-1 hover:text-fg"><CloudUpload className="size-3.5" /></button>
        )}
        {!panel && <button onClick={() => setPanel(true)} className="flex items-center gap-1 hover:text-fg"><TerminalSquare className="size-3.5" />{tr('ide.status.terminal')}</button>}
        <div className="flex-1" />
        {activeDoc?.kind === 'text' && cursor && <span>{tr('ide.status.cursor', { line: cursor.line, col: cursor.col })}</span>}
        {activeDoc?.kind === 'text' && <span>{activeDoc.model.getLanguageId()}</span>}
        {dirty.size > 0 && <span style={{ color: 'var(--ide-git-m)' }}>{tr('ide.status.unsaved', { count: dirty.size })}</span>}
      </div>
      {menu && tabs.some((t) => t.path === menu.path) && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.path)} onClose={closeMenu} />}
    </div>
  );
}
