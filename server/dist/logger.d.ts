/**
 * File Logger — writes debug logs to file + stderr
 */
declare class FileLogger {
    logFilePath: string;
    enabled: boolean;
    constructor(logFilePath: string);
    enable(): void;
    disable(): void;
    log(...args: unknown[]): void;
}
export declare function getLogger(customLogPath?: string): FileLogger;
export { FileLogger };
/** Factory for prefixed debug loggers. Only outputs when DEBUG_MODE is true. */
export declare const createLog: (prefix: string) => (...args: unknown[]) => any;
//# sourceMappingURL=logger.d.ts.map