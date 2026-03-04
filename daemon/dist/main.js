#!/usr/bin/env node
"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDLE_TIMEOUT_MS = exports.SOCK_FILE = exports.PID_FILE = exports.SUPERSURF_DIR = void 0;
exports.parseArgs = parseArgs;
exports.isProcessAlive = isProcessAlive;
exports.cleanStaleFiles = cleanStaleFiles;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const shared_1 = require("./shared");
const extension_bridge_1 = require("./extension-bridge");
const session_1 = require("./session");
const scheduler_1 = require("./scheduler");
const ipc_1 = require("./ipc");
const SUPERSURF_DIR = path_1.default.join(os_1.default.homedir(), '.supersurf');
exports.SUPERSURF_DIR = SUPERSURF_DIR;
const PID_FILE = path_1.default.join(SUPERSURF_DIR, 'daemon.pid');
exports.PID_FILE = PID_FILE;
const SOCK_FILE = path_1.default.join(SUPERSURF_DIR, 'daemon.sock');
exports.SOCK_FILE = SOCK_FILE;
const LOG_FILE = path_1.default.join(SUPERSURF_DIR, 'logs', 'daemon.log');
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
exports.IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MS;
// ─── CLI Parsing ──────────────────────────────────────────────
function parseArgs(argv) {
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
        }
        else if (argv[i] === '--debug') {
            debug = true;
        }
    }
    return { port, debug };
}
// ─── PID File Management ──────────────────────────────────────
/** Check if a process with the given PID is alive. */
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/** Clean stale PID/socket files if the referenced process is dead. */
function cleanStaleFiles() {
    if (fs_1.default.existsSync(PID_FILE)) {
        try {
            const pid = parseInt(fs_1.default.readFileSync(PID_FILE, 'utf8').trim(), 10);
            if (!isNaN(pid) && !isProcessAlive(pid)) {
                fs_1.default.unlinkSync(PID_FILE);
                if (fs_1.default.existsSync(SOCK_FILE)) {
                    fs_1.default.unlinkSync(SOCK_FILE);
                }
            }
        }
        catch {
            // If we can't read the PID file, clean both
            try {
                fs_1.default.unlinkSync(PID_FILE);
            }
            catch { }
            try {
                fs_1.default.unlinkSync(SOCK_FILE);
            }
            catch { }
        }
    }
    else if (fs_1.default.existsSync(SOCK_FILE)) {
        // Orphaned socket file without a PID file — clean it
        try {
            fs_1.default.unlinkSync(SOCK_FILE);
        }
        catch { }
    }
}
/** Write current PID to the PID file. */
function writePidFile() {
    fs_1.default.writeFileSync(PID_FILE, String(process.pid), 'utf8');
}
/** Remove PID and socket files on shutdown. */
function cleanupFiles() {
    try {
        fs_1.default.unlinkSync(PID_FILE);
    }
    catch { }
    try {
        fs_1.default.unlinkSync(SOCK_FILE);
    }
    catch { }
}
// ─── Main ──────────────────────────────────────────────────────
async function main() {
    const { port, debug } = parseArgs(process.argv);
    // Initialize logger — always create, only enable if --debug
    const logger = new shared_1.FileLogger(LOG_FILE);
    if (debug) {
        logger.enable();
        global.DAEMON_DEBUG = true;
        global.DAEMON_LOGGER = logger;
    }
    logger.log(`[Daemon] Starting daemon (port=${port}, pid=${process.pid})`);
    // Ensure ~/.supersurf/ exists
    if (!fs_1.default.existsSync(SUPERSURF_DIR)) {
        fs_1.default.mkdirSync(SUPERSURF_DIR, { recursive: true });
    }
    // Clean stale files from a crashed previous instance
    cleanStaleFiles();
    // Check if daemon is already running
    if (fs_1.default.existsSync(PID_FILE)) {
        const existingPid = parseInt(fs_1.default.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (!isNaN(existingPid) && isProcessAlive(existingPid)) {
            console.error(`Daemon already running (pid ${existingPid})`);
            process.exit(1);
        }
    }
    // Write PID file
    writePidFile();
    // Initialize components
    const bridge = new extension_bridge_1.ExtensionBridge(port, '127.0.0.1');
    const sessions = new session_1.SessionRegistry();
    const scheduler = new scheduler_1.RequestScheduler(bridge, sessions);
    const ipc = new ipc_1.IPCServer(SOCK_FILE, bridge, sessions, scheduler);
    // Idle timeout: exit after 10 minutes with no sessions
    let idleTimer = null;
    function resetIdleTimer() {
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
        }
    }
    function startIdleTimer() {
        resetIdleTimer();
        idleTimer = setTimeout(() => {
            logger.log('[Daemon] Idle timeout — no sessions for 10 minutes, exiting');
            shutdown();
        }, IDLE_TIMEOUT_MS);
    }
    ipc.setSessionCountCallback((count) => {
        logger.log(`[Daemon] Session count: ${count}`);
        if (count === 0) {
            startIdleTimer();
        }
        else {
            resetIdleTimer();
        }
    });
    // Graceful shutdown
    let shuttingDown = false;
    async function shutdown() {
        if (shuttingDown)
            return;
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
    }
    catch (error) {
        console.error(`Failed to start extension WebSocket: ${error.message}`);
        cleanupFiles();
        process.exit(1);
    }
    // Start IPC server
    try {
        await ipc.start();
        logger.log(`[Daemon] IPC listening on ${SOCK_FILE}`);
    }
    catch (error) {
        console.error(`Failed to start IPC server: ${error.message}`);
        await bridge.stop();
        cleanupFiles();
        process.exit(1);
    }
    // Start idle timer (no sessions yet)
    startIdleTimer();
    logger.log('[Daemon] Daemon ready');
}
main().catch((error) => {
    console.error('Daemon fatal error:', error);
    cleanupFiles();
    process.exit(1);
});
//# sourceMappingURL=main.js.map