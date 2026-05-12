import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

export interface ResolvedPath {
  path: string;
  exists: boolean;
}

export function resolveConfigPath(): ResolvedPath {
  const envPath = process.env['SENTIROUTE_CONFIG'];
  if (envPath) {
    if (existsSync(envPath)) return { path: envPath, exists: true };
    throw new Error(`SENTIROUTE_CONFIG is set but file not found: ${envPath}`);
  }

  const cwdPath = join(process.cwd(), 'sentiroute.yaml');
  if (existsSync(cwdPath)) return { path: cwdPath, exists: true };

  const cwdYmlPath = join(process.cwd(), 'sentiroute.yml');
  if (existsSync(cwdYmlPath)) return { path: cwdYmlPath, exists: true };

  const userDir = platform() === 'win32'
    ? join(process.env['APPDATA'] || join(homedir(), 'AppData', 'Roaming'), 'SentiRoute')
    : join(homedir(), '.config', 'sentiroute');

  const userPath = join(userDir, 'config.yaml');
  if (existsSync(userPath)) return { path: userPath, exists: true };

  // No config found — return CWD path as default for auto-creation
  return { path: cwdPath, exists: false };
}
