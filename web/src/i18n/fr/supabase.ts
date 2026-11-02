import type { Entry } from '../core';

/** Textes français — espace « supabase ». Clés préfixées par « supabase. ». */
export default {
  'supabase.status.running': 'En cours',
  'supabase.status.partial': 'Partiel',
  'supabase.status.stopped': 'Arrêtée',
  'supabase.docker.title': 'Docker injoignable',
  'supabase.docker.hint': '{error}. Vérifie que Docker Desktop (ou OrbStack / Colima) est lancé.',
  'supabase.empty.title': 'Aucune instance Supabase locale',
  'supabase.empty.hint': 'Les conteneurs créés par {cmd} apparaissent ici automatiquement.',
  'supabase.instance.noLocal': 'projet local non trouvé dans les dossiers scannés',
  'supabase.instance.mails': 'Mails',
  'supabase.instance.apiCopied': 'URL API copiée',
  'supabase.instance.copyApi': 'Copier l’URL API',
  'supabase.instance.openVsCode': 'Ouvrir le projet dans VS Code',
  'supabase.instance.copyDb': 'Copier l’URL Postgres',
  'supabase.instance.dbCopied': 'URL Postgres copiée',
  'supabase.instance.services': 'Services',
  'supabase.notCreated.title': 'Projets Supabase sans conteneurs · {count}',
  'supabase.notCreated.copyStart': 'Copier la commande de démarrage',
  'supabase.notCreated.copied': 'Commande copiée',
} satisfies Record<string, Entry>;
