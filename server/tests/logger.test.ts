import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileLogger } from '../src/logger';

describe('FileLogger', () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supersurf-logger-test-'));
    logPath = path.join(tempDir, 'test-debug.log');
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('creates log directory if missing', () => {
      const nestedDir = path.join(tempDir, 'nested', 'deep');
      const nestedLogPath = path.join(nestedDir, 'debug.log');

      new FileLogger(nestedLogPath);

      expect(fs.existsSync(nestedDir)).toBe(true);
    });

    it('truncates existing log file', () => {
      // Pre-create a file with content
      fs.writeFileSync(logPath, 'old log content\nmore old stuff\n');
      expect(fs.readFileSync(logPath, 'utf8')).toContain('old log content');

      new FileLogger(logPath);

      const content = fs.readFileSync(logPath, 'utf8');
      expect(content).toBe('');
    });

    it('works when log file does not exist yet', () => {
      expect(fs.existsSync(logPath)).toBe(false);
      const logger = new FileLogger(logPath);
      expect(logger.logFilePath).toBe(logPath);
    });

    it('stores the log file path', () => {
      const logger = new FileLogger(logPath);
      expect(logger.logFilePath).toBe(logPath);
    });
  });

  describe('enabled state', () => {
    it('starts disabled', () => {
      const logger = new FileLogger(logPath);
      expect(logger.enabled).toBe(false);
    });

    it('enable() sets enabled to true', () => {
      const logger = new FileLogger(logPath);
      logger.enable();
      expect(logger.enabled).toBe(true);
    });

    it('disable() sets enabled to false', () => {
      const logger = new FileLogger(logPath);
      logger.enable();
      logger.disable();
      expect(logger.enabled).toBe(false);
    });
  });

  describe('log()', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('writes to file when enabled', () => {
      const logger = new FileLogger(logPath);
      logger.enable();
      logger.log('test message');

      const content = fs.readFileSync(logPath, 'utf8');
      expect(content).toContain('test message');
    });

    it('does nothing when disabled', () => {
      const logger = new FileLogger(logPath);
      // Logger starts disabled
      logger.log('should not appear');

      // File may not exist or should be empty
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf8');
        expect(content).not.toContain('should not appear');
      }
    });

    it('writes timestamp prefix', () => {
      const logger = new FileLogger(logPath);
      logger.enable();
      logger.log('timestamp test');

      const content = fs.readFileSync(logPath, 'utf8');
      // Should match ISO timestamp format [YYYY-MM-DDTHH:MM:SS.sssZ]
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('also writes to console.error', () => {
      const logger = new FileLogger(logPath);
      logger.enable();
      logger.log('stderr test');

      expect(consoleErrorSpy).toHaveBeenCalledWith('stderr test');
    });

    it('handles multiple arguments', () => {
      const logger = new FileLogger(logPath);
      logger.enable();
      logger.log('part1', 'part2', 'part3');

      const content = fs.readFileSync(logPath, 'utf8');
      expect(content).toContain('part1 part2 part3');
    });

    it('serializes objects as JSON', () => {
      const logger = new FileLogger(logPath);
      logger.enable();
      logger.log('object:', { key: 'value', nested: { a: 1 } });

      const content = fs.readFileSync(logPath, 'utf8');
      expect(content).toContain('"key": "value"');
      expect(content).toContain('"a": 1');
    });

    it('handles non-serializable objects gracefully', () => {
      const logger = new FileLogger(logPath);
      logger.enable();

      const circular: any = {};
      circular.self = circular;
      logger.log('circular:', circular);

      const content = fs.readFileSync(logPath, 'utf8');
      // Should fall back to String(arg)
      expect(content).toContain('circular:');
    });

    it('appends multiple log lines', () => {
      const logger = new FileLogger(logPath);
      logger.enable();
      logger.log('line one');
      logger.log('line two');
      logger.log('line three');

      const content = fs.readFileSync(logPath, 'utf8');
      expect(content).toContain('line one');
      expect(content).toContain('line two');
      expect(content).toContain('line three');
    });

    it('enable() writes its own log message', () => {
      const logger = new FileLogger(logPath);
      logger.enable();

      const content = fs.readFileSync(logPath, 'utf8');
      expect(content).toContain('Logging enabled');
    });
  });

  describe('getLogger() singleton', () => {
    it('returns a FileLogger instance', async () => {
      // We need to reset the singleton between tests. The simplest way is
      // to dynamically import with a fresh module.
      // However, since getLogger is a singleton, we test it carefully.
      // Use a custom log path to avoid interfering with the default.
      const customPath = path.join(tempDir, 'singleton-test.log');

      // Reset the module to clear singleton state
      vi.resetModules();
      const { getLogger } = await import('../src/logger');

      const logger = getLogger(customPath);
      expect(logger).toBeDefined();
      expect(logger.logFilePath).toBe(customPath);
    });

    it('returns the same instance on subsequent calls', async () => {
      const customPath = path.join(tempDir, 'singleton-same.log');

      vi.resetModules();
      const { getLogger } = await import('../src/logger');

      const logger1 = getLogger(customPath);
      const logger2 = getLogger();

      // Second call should return the same instance (custom path ignored after first init)
      expect(logger1).toBe(logger2);
    });
  });
});
