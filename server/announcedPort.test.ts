import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnnouncedPort } from './announcedPort.js';

const feed = (tracker: AnnouncedPort, lines: string[]) => lines.map((l) => tracker.take(l));

test("garde la première URL annoncée et ignore les services tiers (importeur tiers)", () => {
  const t = new AnnouncedPort();
  const got = feed(t, [
    '\x1b[32m  ➜  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m',
    'Importeur prêt : http://127.0.0.1:4102',
    'dl-img-avito 0.2.1 connecté (http://127.0.0.1:8001, accès Avito : direct)',
    'Prêt sur http://localhost:8001',
  ]);
  assert.deepEqual(got, [5173, null, null, null]);
});

test('ignore les lignes sans URL avant la première annonce', () => {
  const t = new AnnouncedPort();
  assert.deepEqual(feed(t, ['> vite --port 4102', 'VITE v8 ready', 'http://localhost:4102/', 'http://localhost:8000']), [
    null, null, 4102, null,
  ]);
});

test("une URL égale au port prévu fige aussi l'annonce", () => {
  const t = new AnnouncedPort();
  assert.equal(t.take('Local: http://localhost:4102/'), 4102);
  assert.equal(t.take('wmclean http://127.0.0.1:8000'), null);
});

test('chaque lancement repart de zéro', () => {
  const first = new AnnouncedPort();
  first.take('http://localhost:5173');
  assert.equal(first.take('http://localhost:8001'), null);
  assert.equal(new AnnouncedPort().take('http://localhost:8001'), 8001);
});
