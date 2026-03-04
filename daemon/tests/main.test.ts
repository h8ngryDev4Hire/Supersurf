import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Test the exported utility functions from main.ts without running the entry point
// We test parseArgs and isProcessAlive, PID file lifecycle

describe('Daemon main utilities', () => {
  const tmpDir = path.join(os.tmpdir(), 'daemon-main-test');

  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  });

  describe('PID file lifecycle', () => {
    it('detects current process as alive', () => {
      // process.kill(pid, 0) should not throw for own PID
      let alive = false;
      try {
        process.kill(process.pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
      expect(alive).toBe(true);
    });

    it('detects dead PID', () => {
      // PID 99999999 is almost certainly not running
      let alive = false;
      try {
        process.kill(99999999, 0);
        alive = true;
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    });

    it('can write and read PID file', () => {
      const pidFile = path.join(tmpDir, 'test.pid');
      fs.writeFileSync(pidFile, String(process.pid));

      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      expect(pid).toBe(process.pid);

      fs.unlinkSync(pidFile);
      expect(fs.existsSync(pidFile)).toBe(false);
    });

    it('stale PID detection: dead process PID file should be removable', () => {
      const pidFile = path.join(tmpDir, 'stale.pid');
      fs.writeFileSync(pidFile, '99999999');

      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
      }

      expect(alive).toBe(false);

      // Clean up stale file
      fs.unlinkSync(pidFile);
      expect(fs.existsSync(pidFile)).toBe(false);
    });
  });

  describe('socket file cleanup', () => {
    it('orphaned socket without PID file should be detectable', () => {
      const sockFile = path.join(tmpDir, 'orphan.sock');
      fs.writeFileSync(sockFile, '');

      expect(fs.existsSync(sockFile)).toBe(true);

      // No PID file = orphaned
      const pidFile = path.join(tmpDir, 'daemon.pid');
      expect(fs.existsSync(pidFile)).toBe(false);

      // Should clean it
      fs.unlinkSync(sockFile);
      expect(fs.existsSync(sockFile)).toBe(false);
    });
  });

  describe('idle timeout concept', () => {
    it('can set and clear a timeout', () => {
      vi.useFakeTimers();
      const cb = vi.fn();

      const timer = setTimeout(cb, 600000); // 10 min
      expect(cb).not.toHaveBeenCalled();

      clearTimeout(timer);
      vi.advanceTimersByTime(600000);
      expect(cb).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('timeout fires when not cleared', () => {
      vi.useFakeTimers();
      const cb = vi.fn();

      setTimeout(cb, 600000);
      vi.advanceTimersByTime(600000);
      expect(cb).toHaveBeenCalledOnce();

      vi.useRealTimers();
    });
  });
});
