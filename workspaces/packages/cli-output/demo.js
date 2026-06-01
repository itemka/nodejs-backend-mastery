// Visual catalog of every cli-output role. Run it to eyeball the palette:
//
//   pnpm --filter @workspaces/cli-output demo
//
// Colors follow chalk's NO_COLOR/FORCE_COLOR/TTY detection, so:
//   - in a terminal you see colors,
//   - piped or under NO_COLOR=1 you see plain text,
//   - FORCE_COLOR=1 forces colors even when piped.

import * as ui from './index.js';

/** @type {Array<'heading' | 'success' | 'warn' | 'error' | 'muted' | 'accent' | 'prefix'>} */
const ROLES = ['heading', 'success', 'warn', 'error', 'muted', 'accent', 'prefix'];

console.log(ui.heading('=== cli-output theme demo ==='));
console.log();

for (const role of ROLES) {
  console.log(`${role.padEnd(9)} ${ui[role](`${role} — the quick brown fox jumps`)}`);
}

console.log(`${'ok'.padEnd(9)} ${ui.ok('operation succeeded')}`);
console.log(`${'fail'.padEnd(9)} ${ui.fail('operation failed')}`);
console.log();
console.log(`${'symbols'.padEnd(9)} ${JSON.stringify(ui.symbols)}`);
