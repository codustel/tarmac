// Web side of the example module: plain DOM, no framework (a module may bundle its own React).
const TEXT = {
  en: { title: 'Hello from a module', visits: 'Visits', projects: 'Projects seen by the module', core: 'Tarmac version', save: 'Save', greeting: 'Greeting' },
  fr: { title: 'Bonjour depuis un module', visits: 'Visites', projects: 'Projets vus par le module', core: 'Version de Tarmac', save: 'Enregistrer', greeting: 'Salutation' },
};

/** @type {import('@codustel/tarmac/modules').MountModule} */
export function mount(el, ctx) {
  const t = TEXT[ctx.lang];
  el.innerHTML = `
    <div style="max-width: 32rem; border: 1px solid var(--line); border-radius: 8px; padding: 16px; font-size: 13px">
      <h2 style="font-weight: 600; margin-bottom: 8px">${t.title}</h2>
      <dl data-summary style="display: grid; grid-template-columns: auto 1fr; gap: 4px 16px"></dl>
      <form style="display: flex; gap: 8px; margin-top: 12px">
        <input name="greeting" placeholder="${t.greeting}" style="flex: 1; border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; background: transparent" />
        <button style="border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px">${t.save}</button>
      </form>
      <p data-theme style="margin-top: 12px; opacity: .6"></p>
    </div>`;
  const dl = el.querySelector('[data-summary]');
  const themeLine = el.querySelector('[data-theme]');

  const load = async () => {
    const s = await (await ctx.api('/summary')).json();
    dl.innerHTML = '';
    for (const [label, value] of [[t.visits, s.visits], [t.projects, s.projects], [t.core, s.coreVersion], [t.greeting, s.greeting ?? '—']]) {
      dl.append(Object.assign(document.createElement('dt'), { textContent: label }), Object.assign(document.createElement('dd'), { textContent: String(value) }));
    }
  };
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const greeting = new FormData(e.currentTarget).get('greeting');
    await ctx.api('/greeting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ greeting }) });
    load();
  });

  const showTheme = (theme) => { themeLine.textContent = `theme: ${theme}`; };
  showTheme(ctx.theme());
  const off = ctx.onThemeChange(showTheme);
  load();
  return off;
}
