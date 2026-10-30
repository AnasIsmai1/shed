import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Optional KEY=VALUE file for settings a LaunchAgent cannot inherit from your shell (CLAUDE_CODE_OAUTH_TOKEN, SHED_DEFAULT_HARNESS). Owner-only.
const file = process.env.SHED_ENV_FILE || path.join(process.env.SHED_HOME || path.join(os.homedir(), '.shed'), 'env');
try {
  if (fs.statSync(file).mode & 0o077) console.error(`Ignoring ${file}: run chmod 600 on it.`);
  else for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no file: nothing to load */ }
