import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'backend',
  'scripts',
  'test-handler-new-cases-digest-employee-75.js',
);

const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
