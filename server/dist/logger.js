"use strict";
/**
 * File Logger — writes debug logs to file + stderr
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLog = exports.FileLogger = void 0;
exports.getLogger = getLogger;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const env_paths_1 = __importDefault(require("env-paths"));
class FileLogger {
    logFilePath;
    enabled = false;
    constructor(logFilePath) {
        this.logFilePath = logFilePath;
        const logDir = path_1.default.dirname(this.logFilePath);
        if (!fs_1.default.existsSync(logDir)) {
            fs_1.default.mkdirSync(logDir, { recursive: true });
        }
        if (fs_1.default.existsSync(this.logFilePath)) {
            fs_1.default.truncateSync(this.logFilePath, 0);
        }
    }
    enable() {
        this.enabled = true;
        this.log('[FileLogger] Logging enabled — writing to:', this.logFilePath);
    }
    disable() {
        this.enabled = false;
    }
    log(...args) {
        if (!this.enabled)
            return;
        const timestamp = new Date().toISOString();
        const message = args
            .map((arg) => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                }
                catch {
                    return String(arg);
                }
            }
            return String(arg);
        })
            .join(' ');
        const logLine = `[${timestamp}] ${message}\n`;
        fs_1.default.appendFileSync(this.logFilePath, logLine, 'utf8');
        console.error(message);
    }
}
exports.FileLogger = FileLogger;
let instance = null;
function getLogger(customLogPath) {
    if (!instance) {
        let logPath;
        if (customLogPath) {
            logPath = customLogPath;
        }
        else {
            const paths = (0, env_paths_1.default)('supersurf', { suffix: '' });
            logPath = path_1.default.join(paths.log, 'supersurf-debug.log');
        }
        instance = new FileLogger(logPath);
    }
    return instance;
}
/** Factory for prefixed debug loggers. Only outputs when DEBUG_MODE is true. */
const createLog = (prefix) => (...args) => global.DEBUG_MODE && getLogger().log(prefix, ...args);
exports.createLog = createLog;
//# sourceMappingURL=logger.js.map