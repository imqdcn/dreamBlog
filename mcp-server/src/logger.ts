type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let currentLevel: Level = 'info';

export function setLogLevel(level: Level): void {
  currentLevel = level;
}

function ts(): string {
  return new Date().toISOString();
}

function log(level: Level, ...args: unknown[]): void {
  if (ORDER[level] < ORDER[currentLevel]) return;
  const prefix = `[${ts()}] [${level.toUpperCase()}]`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(prefix, ...args);
}

export const logger = {
  debug: (...a: unknown[]) => log('debug', ...a),
  info: (...a: unknown[]) => log('info', ...a),
  warn: (...a: unknown[]) => log('warn', ...a),
  error: (...a: unknown[]) => log('error', ...a),
};
