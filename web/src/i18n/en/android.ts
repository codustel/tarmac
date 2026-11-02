import type fr from '../fr/android';

/** English texts — « android » namespace (same keys as fr/android.ts). */
const en: typeof fr = {
  'android.state.stopped': 'Stopped',
  'android.state.starting': 'Starting…',
  'android.state.booting': 'Booting Android…',
  'android.state.ready': 'Ready',
  'android.state.stopping': 'Stopping…',
  'android.tools.title': 'Tooling',
  'android.tools.allReady': 'All set',
  'android.tools.missing': { one: '{count} item to install', other: '{count} items to install' },
  'android.tools.sdk': 'SDK: {path}',
  'android.tools.copied': 'Command copied',
  'android.tools.installFirst': 'Install first: {list}',
  'android.tools.install': 'Install',
  'android.avds.title': 'Emulators',
  'android.avds.emptyTitle': 'No virtual device',
  'android.avds.emptyHint': 'Create one with the “{label}” row above, or from Android Studio’s Device Manager.',
  'android.avds.missingImage': 'System image missing: {image}',
  'android.avds.start': 'Start',
  'android.avds.coldTitle': 'Cold boot: skips the snapshot (useful if the emulator hangs while booting)',
  'android.avds.cold': 'Cold boot',
  'android.avds.stop': 'Stop',
  'android.install.done': 'Done',
  'android.install.failed': 'Failed ({code})',
  'android.install.close': 'Close',
};
export default en;
