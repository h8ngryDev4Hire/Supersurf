/**
 * File Logger — writes debug logs to file + stderr
 */

import fs from 'fs';
import path from 'path';
import envPaths from 'env-paths';

class FileLogger {
  logFilePath: string;
  enabled: boolean = false;

  constructor(logFilePath: string) {
    this.logFilePath = logFilePath;

    const logDir = path.dirname(this.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    if (fs.existsSync(this.logFilePath)) {
      fs.truncateSync(this.logFilePath, 0);
    }
  }

  enable(): void {
    this.enabled = true;
    this.log('[FileLogger] Logging enabled — writing to:', this.logFilePath);
  }

  disable(): void {
    this.enabled = false;
  }

  log(...args: unknown[]): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const message = args
      .map((arg) => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');

    const logLine = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(this.logFilePath, logLine, 'utf8');
    console.error(message);
  }
}

let instance: FileLogger | null = null;

export function getLogger(customLogPath?: string): FileLogger {
  if (!instance) {
    let logPath: string;
    if (customLogPath) {
      logPath = customLogPath;
    } else {
      const paths = envPaths('supersurf', { suffix: '' });
      logPath = path.join(paths.log, 'supersurf-debug.log');
    }
    instance = new FileLogger(logPath);
  }
  return instance;
}

export { FileLogger };

/** Factory for prefixed debug loggers. Only outputs when DEBUG_MODE is true. */
export const createLog = (prefix: string) =>
  (...args: unknown[]) =>
    (global as any).DEBUG_MODE && getLogger().log(prefix, ...args);
