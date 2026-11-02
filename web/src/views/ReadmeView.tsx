import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { BookOpen, FileText } from 'lucide-react';
import { api, type Project } from '../api';
import { Empty } from '../ui';
import { useT } from '../i18n';

const isRelative = (href: string) => !/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(href);

/** Rendu Markdown sécurisé ; images relatives servies par Tarmac, liens externes en nouvel onglet. */
function render(project: Project, md: string) {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    walkTokens(token: any) {
      if (token.type === 'image' && isRelative(token.href)) token.href = api.assetUrl(project.id, token.href);
    },
  });
  const html = marked.parse(md, { async: false }) as string;
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    if (isRelative(src)) img.setAttribute('src', api.assetUrl(project.id, src));
  });
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href')!;
    if (/^https?:/i.test(href)) a.setAttribute('target', '_blank'), a.setAttribute('rel', 'noreferrer');
    else if (!href.startsWith('#')) a.removeAttribute('href'); // lien vers un fichier local : non navigable
  });
  return doc.body.innerHTML;
}

export function ReadmeView({ project }: { project: Project }) {
  const t = useT();
  const q = useQuery({ queryKey: ['readme', project.id], queryFn: () => api.readme(project.id), enabled: !!project.readme, staleTime: 30_000 });
  const html = useMemo(() => (q.data && q.data.format === 'md' ? render(project, q.data.content) : null), [q.data, project]);

  if (!project.readme) {
    return <Empty icon={<BookOpen className="size-8" />} title={t('projects.readme.none')}>{t('projects.readme.noneHint')}</Empty>;
  }
  if (q.isLoading) return <div className="p-6 text-muted">{t('projects.loading')}</div>;
  if (q.error) return <div className="p-6 text-red-500">{(q.error as Error).message}</div>;

  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 z-[1] flex items-center gap-1.5 border-b border-line bg-panel/90 backdrop-blur px-5 py-2 font-mono text-[11px] text-faint">
        <FileText className="size-3.5" /> {q.data!.path}
      </div>
      {html !== null ? (
        <article
          className="prose prose-sm dark:prose-invert max-w-none px-6 py-5 prose-headings:font-semibold prose-a:text-accent prose-pre:bg-[#0a0c10] prose-pre:text-zinc-300 prose-code:before:content-none prose-code:after:content-none prose-img:inline-block prose-img:my-1 prose-table:text-[12px]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="whitespace-pre-wrap px-6 py-5 font-mono text-[12px] leading-relaxed text-fg">{q.data!.content}</pre>
      )}
    </div>
  );
}
