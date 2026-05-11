import pino from 'pino';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let requestLogger: pino.Logger | null = null;

export function getRequestLogger(dataDir: string): pino.Logger {
  if (requestLogger) return requestLogger;

  const logDir = join(dataDir, 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const today = new Date().toISOString().slice(0, 10);
  const logPath = join(logDir, `${today}.jsonl`);

  requestLogger = pino(
    {
      level: 'info',
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination({ dest: logPath, sync: false }),
  );

  return requestLogger;
}
