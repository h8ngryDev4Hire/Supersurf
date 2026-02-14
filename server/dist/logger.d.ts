/**
 * File Logger — multi-session debug logging with truncation.
 *
 * Architecture:
 *   - Server log:  ~/.supersurf/logs/server.log  (always-on backbone)
 *   - Session logs: ~/.supersurf/logs/sessions/supersurf-debug-{clientId}-{timestamp}.log
 *
 * The logger stays dumb — it writes to whatever file path it's given.
 * Session routing is handled by the connection lifecycle (enable/disable).
 */
export type DebugMode = false | 'truncate' | 'no_truncate';
export declare class FileLogger {
    logFilePath: string;
    enabled: boolean;
    private _truncate;
    constructor(logFilePath: string);
    get truncate(): boolean;
    set truncate(value: boolean);
    enable(): void;
    disable(): void;
    log(...args: unknown[]): void;
    private formatArg;
}
declare class LoggerRegistry {
    private serverLogger;
    private sessionLoggers;
    private _debugMode;
    get debugMode(): DebugMode;
    set debugMode(mode: DebugMode);
    /** Get or create the server-level logger. */
    getServerLogger(customLogPath?: string): FileLogger;
    /** Create a session log file and return its logger. */
    setSessionLog(sessionId: string): FileLogger;
    /** Close and remove a session logger. */
    clearSessionLog(sessionId: string): void;
    /** Get session logger if it exists, otherwise fall back to server logger. */
    getLogger(sessionId?: string | null): FileLogger;
    /** Reset for testing. */
    reset(): void;
}
/** Get the server-level logger (backwards compat). */
export declare function getLogger(customLogPath?: string): FileLogger;
/** Get the global logger registry for session management. */
export declare function getRegistry(): LoggerRegistry;
/**
 * Factory for prefixed debug loggers.
 * Only outputs when DEBUG_MODE is truthy.
 * If sessionId is provided, routes to that session's log file.
 */
export declare const createLog: (prefix: string, sessionId?: string | null) => (...args: unknown[]) => any;
export { LoggerRegistry };
//# sourceMappingURL=logger.d.ts.map