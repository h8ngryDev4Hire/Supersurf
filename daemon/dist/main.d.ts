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
declare const SUPERSURF_DIR: string;
declare const PID_FILE: string;
declare const SOCK_FILE: string;
declare const IDLE_TIMEOUT_MS: number;
declare function parseArgs(argv: string[]): {
    port: number;
    debug: boolean;
};
/** Check if a process with the given PID is alive. */
declare function isProcessAlive(pid: number): boolean;
/** Clean stale PID/socket files if the referenced process is dead. */
declare function cleanStaleFiles(): void;
export { parseArgs, isProcessAlive, cleanStaleFiles, SUPERSURF_DIR, PID_FILE, SOCK_FILE, IDLE_TIMEOUT_MS };
//# sourceMappingURL=main.d.ts.map