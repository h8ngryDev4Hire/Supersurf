#!/usr/bin/env node
/**
 * SuperSurf Daemon — standalone coordinator for multiple MCP sessions.
 *
 * Manages a single Chrome extension connection (WebSocket) and multiplexes
 * tool calls from multiple MCP servers (Unix domain socket).
 *
 * Usage:
 *   supersurf-daemon [--port <n>] [--debug]
 *
 * Files:
 *   ~/.supersurf/daemon.pid   — PID file for process detection
 *   ~/.supersurf/daemon.sock  — Unix domain socket for MCP server IPC
 *   ~/.supersurf/logs/daemon.log — debug log (when --debug)
 *
 * @module main
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileLogger } from 'shared';
import { ExtensionBridge } from './extension-bridge';
import { SessionRegistry } from './session';
import { RequestScheduler } from './scheduler';
import { IPCServer } from './ipc';

const SUPERSURF_DIR = path.join(os.homedir(), '.supersurf');
const PID_FILE = path.join(SUPERSURF_DIR, 'daemon.pid');
const SOCK_FILE = path.join(SUPERSURF_DIR, 'daemon.sock');
const LOG_FILE = path.join(SUPERSURF_DIR, 'logs', 'daemon.log');
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ─── CLI Parsing ──────────────────────────────────────────────

function parseArgs(argv: string[]): { port: number; debug: boolean } {
  let port = 5555;
  let debug = false;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      port = parseInt(argv[i + 1], 10);
      if (isNaN(port)) {
        console.error('Invalid port number');
        process.exit(1);
      }
      i++;
    } else if (argv[i] === '--debug') {
      debug = true;
    }
  }

  return { port, debug };
}

// ─── PID File Management ──────────────────────────────────────

/** Check if a process with the given PID is alive. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Clean stale PID/socket files if the referenced process is dead. */
function cleanStaleFiles(): void {
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (!isNaN(pid) && !isProcessAlive(pid)) {
        fs.unlinkSync(PID_FILE);
        if (fs.existsSync(SOCK_FILE)) {
          fs.unlinkSync(SOCK_FILE);
        }
      }
    } catch {
      // If we can't read the PID file, clean both
      try { fs.unlinkSync(PID_FILE); } catch {}
      try { fs.unlinkSync(SOCK_FILE); } catch {}
    }
  } else if (fs.existsSync(SOCK_FILE)) {
    // Orphaned socket file without a PID file — clean it
    try { fs.unlinkSync(SOCK_FILE); } catch {}
  }
}

/** Write current PID to the PID file. */
function writePidFile(): void {
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

/** Remove PID and socket files on shutdown. */
function cleanupFiles(): void {
  try { fs.unlinkSync(PID_FILE); } catch {}
  try { fs.unlinkSync(SOCK_FILE); } catch {}
}

// ─── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { port, debug } = parseArgs(process.argv);

  // Initialize logger — always create, only enable if --debug
  const logger = new FileLogger(LOG_FILE);
  if (debug) {
    logger.enable();
    (global as any).DAEMON_DEBUG = true;
    (global as any).DAEMON_LOGGER = logger;
  }

  logger.log(`[Daemon] Starting daemon (port=${port}, pid=${process.pid})`);

  // Ensure ~/.supersurf/ exists
  if (!fs.existsSync(SUPERSURF_DIR)) {
    fs.mkdirSync(SUPERSURF_DIR, { recursive: true });
  }

  // Clean stale files from a crashed previous instance
  cleanStaleFiles();

  // Check if daemon is already running
  if (fs.existsSync(PID_FILE)) {
    const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (!isNaN(existingPid) && isProcessAlive(existingPid)) {
      console.error(`Daemon already running (pid ${existingPid})`);
      process.exit(1);
    }
  }

  // Write PID file
  writePidFile();

  // Initialize components
  const bridge = new ExtensionBridge(port, '127.0.0.1');
  const sessions = new SessionRegistry();
  const scheduler = new RequestScheduler(bridge, sessions);
  const ipc = new IPCServer(SOCK_FILE, bridge, sessions, scheduler);

  // Idle timeout: exit after 10 minutes with no sessions
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function resetIdleTimer(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function startIdleTimer(): void {
    resetIdleTimer();
    idleTimer = setTimeout(() => {
      logger.log('[Daemon] Idle timeout — no sessions for 10 minutes, exiting');
      shutdown();
    }, IDLE_TIMEOUT_MS);
  }

  ipc.setSessionCountCallback((count: number) => {
    logger.log(`[Daemon] Session count: ${count}`);
    if (count === 0) {
      startIdleTimer();
    } else {
      resetIdleTimer();
    }
  });

  // Graceful shutdown
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.log('[Daemon] Shutting down...');
    resetIdleTimer();
    scheduler.drainAll();
    await ipc.stop();
    await bridge.stop();
    cleanupFiles();
    logger.log('[Daemon] Shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start extension WebSocket server
  try {
    await bridge.start();
    logger.log(`[Daemon] Extension WebSocket listening on port ${port}`);
  } catch (error: any) {
    console.error(`Failed to start extension WebSocket: ${error.message}`);
    cleanupFiles();
    process.exit(1);
  }

  // Start IPC server
  try {
    await ipc.start();
    logger.log(`[Daemon] IPC listening on ${SOCK_FILE}`);
  } catch (error: any) {
    console.error(`Failed to start IPC server: ${error.message}`);
    await bridge.stop();
    cleanupFiles();
    process.exit(1);
  }

  // Start idle timer (no sessions yet)
  startIdleTimer();

  logger.log('[Daemon] Daemon ready');
}

// Export for testing
export { parseArgs, isProcessAlive, cleanStaleFiles, SUPERSURF_DIR, PID_FILE, SOCK_FILE, IDLE_TIMEOUT_MS };

main().catch((error) => {
  console.error('Daemon fatal error:', error);
  cleanupFiles();
  process.exit(1);
});
