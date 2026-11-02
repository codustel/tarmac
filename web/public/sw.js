// Service worker minimal : rend l'app installable (PWA). Aucun cache : l'UI vient toujours de Tarmac local.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
