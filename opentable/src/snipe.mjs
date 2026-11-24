import { readFileSync } from 'node:fs';
import { runSnipe } from './sniper.mjs';

const args = new Set(process.argv.slice(2));
const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
await runSnipe(config, {
  dryRun: args.has('--dry-run'),
  now: args.has('--now'),
  log: (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`),
});
