import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

export function resolveConfigPath(): string {
  const envPath = process.env['SENTIROUTE_CONFIG'];
  if (envPath && existsSync(envPath)) return envPath;

  const cwdPath = join(process.cwd(), 'sentiroute.yaml');
  if (existsSync(cwdPath)) return cwdPath;

  const cwdYmlPath = join(process.cwd(), 'sentiroute.yml');
  if (existsSync(cwdYmlPath)) return cwdYmlPath;

  const userDir = platform() === 'win32'
    ? join(process.env['APPDATA'] || join(homedir(), 'AppData', 'Roaming'), 'SentiRoute')
    : join(homedir(), '.config', 'sentiroute');

  const userPath = join(userDir, 'config.yaml');
  if (existsSync(userPath)) return userPath;

  throw new Error(
    `No config file found. Create a sentiroute.yaml file or set SENTIROUTE_CONFIG.\n` +
    `Searched:\n` +
    `  - ${envPath ? envPath : '(SENTIROUTE_CONFIG not set or file not found)'}\n` +
    `  - ${cwdPath}\n` +
    `  - ${cwdYmlPath}\n` +
    `  - ${userPath}`
  );
}
