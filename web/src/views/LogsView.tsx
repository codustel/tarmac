import { useEffect, useMemo, useRef, useState } from 'react';
import { AnsiUp } from 'ansi_up';
import { ArrowDownToLine, Copy, Eraser } from 'lucide-react';
import { api, type Project } from '../api';
import { useLogs } from '../socket';
import { IconButton, copy, cx, useToast } from '../ui';
import { fmtTime, useT } from '../i18n';

const ansi = new AnsiUp();
ansi.use_classes = true;

export function LogsView({ app }: { app: Project }) {
  const toast = useToast();
  const t = useT();
  const [lines, setLines] = useLogs(app.id, api.logs);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const box = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const f = filter.toLowerCase();
    return f ? lines.filter((l) => l.text.toLowerCase().includes(f)) : lines;
  }, [lines, filter]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [visible, follow]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5 shrink-0">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('projects.logs.filter')}
          className="h-7 flex-1 rounded-md bg-panel-2 px-2 text-xs outline-none placeholder:text-faint focus:ring-1 focus:ring-accent"
        />
        <IconButton title={follow ? t('projects.logs.following') : t('projects.logs.follow')} onClick={() => setFollow((f) => !f)} className={cx(follow && 'text-accent')}>
          <ArrowDownToLine className="size-4" />
        </IconButton>
        <IconButton title={t('projects.action.copy')} onClick={() => copy(lines.map((l) => l.text.replace(/\x1b\[[0-9;]*m/g, '')).join('\n'), toast, t('projects.logs.copied'))}>
          <Copy className="size-4" />
        </IconButton>
        <IconButton title={t('projects.logs.clear')} onClick={() => setLines([])}><Eraser className="size-4" /></IconButton>
      </div>

      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (atBottom !== follow) setFollow(atBottom);
        }}
        className="flex-1 overflow-auto bg-[#0a0c10] py-2 font-mono text-[12px] leading-[1.55] text-zinc-300"
      >
        {visible.length === 0 ? (
          <div className="px-4 py-8 text-center text-zinc-500">{lines.length ? t('projects.logs.noMatch') : t('projects.logs.empty')}</div>
        ) : (
          visible.map((l, i) => (
            <div key={i} className={cx('log-line flex gap-3 px-4 hover:bg-white/[0.03]', l.stream === 'err' && 'bg-red-500/[0.06]', l.stream === 'sys' && 'text-indigo-300')}>
              <span className="select-none text-zinc-600 tabular-nums shrink-0">{fmtTime(l.t)}</span>
              <span className="whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: ansi.ansi_to_html(l.text) }} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
