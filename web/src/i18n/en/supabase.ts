import type fr from '../fr/supabase';

/** English texts — « supabase » namespace (same keys as fr/supabase.ts). */
const en: typeof fr = {
  'supabase.status.running': 'Running',
  'supabase.status.partial': 'Partial',
  'supabase.status.stopped': 'Stopped',
  'supabase.docker.title': 'Docker unreachable',
  'supabase.docker.hint': '{error}. Make sure Docker Desktop (or OrbStack / Colima) is running.',
  'supabase.empty.title': 'No local Supabase instance',
  'supabase.empty.hint': 'Containers created by {cmd} show up here automatically.',
  'supabase.instance.noLocal': 'local project not found in the scanned folders',
  'supabase.instance.mails': 'Mail',
  'supabase.instance.apiCopied': 'API URL copied',
  'supabase.instance.copyApi': 'Copy the API URL',
  'supabase.instance.openVsCode': 'Open the project in VS Code',
  'supabase.instance.copyDb': 'Copy the Postgres URL',
  'supabase.instance.dbCopied': 'Postgres URL copied',
  'supabase.instance.services': 'Services',
  'supabase.notCreated.title': 'Supabase projects without containers · {count}',
  'supabase.notCreated.copyStart': 'Copy the start command',
  'supabase.notCreated.copied': 'Command copied',
};
export default en;
