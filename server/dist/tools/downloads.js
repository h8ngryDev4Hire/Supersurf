"use strict";
/**
 * Download tool handler.
 * Extension downloads the file to Chrome's Downloads folder,
 * then server moves it to the agent-specified destination.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onBrowserDownload = onBrowserDownload;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../logger");
const log = (0, logger_1.createLog)('[Downloads]');
async function onBrowserDownload(ctx, args, options) {
    const url = args.url;
    if (!url)
        return ctx.error('`url` is required', options);
    const filename = args.filename;
    const destination = args.destination;
    // Send download command to extension
    const result = await ctx.ext.sendCmd('download', { url, filename }, 5 * 60 * 1000);
    if (!result?.success) {
        return ctx.error(result?.error || 'Download failed', options);
    }
    const downloadPath = result.filePath;
    const fileSize = result.fileSize;
    const mimeType = result.mimeType;
    // If no destination specified, return the file where it landed
    if (!destination) {
        if (options.rawResult) {
            return { success: true, path: downloadPath, size: fileSize, mimeType };
        }
        return ctx.formatResult('browser_download', {
            text: `Downloaded to ${downloadPath} (${formatBytes(fileSize)})`,
        }, options);
    }
    // Move file to destination
    if (!downloadPath) {
        return ctx.error('Download completed but file path not available from browser', options);
    }
    try {
        const resolvedDest = resolveDestination(destination, downloadPath);
        // Ensure parent directory exists
        const parentDir = path_1.default.dirname(resolvedDest);
        if (!fs_1.default.existsSync(parentDir)) {
            fs_1.default.mkdirSync(parentDir, { recursive: true });
        }
        fs_1.default.renameSync(downloadPath, resolvedDest);
        log(`Moved ${downloadPath} → ${resolvedDest}`);
        if (options.rawResult) {
            return { success: true, path: resolvedDest, size: fileSize, mimeType };
        }
        return ctx.formatResult('browser_download', {
            text: `Downloaded and saved to ${resolvedDest} (${formatBytes(fileSize)})`,
        }, options);
    }
    catch (err) {
        // If rename fails (cross-device), fall back to copy + delete
        if (err.code === 'EXDEV') {
            try {
                const resolvedDest = resolveDestination(destination, downloadPath);
                const parentDir = path_1.default.dirname(resolvedDest);
                if (!fs_1.default.existsSync(parentDir)) {
                    fs_1.default.mkdirSync(parentDir, { recursive: true });
                }
                fs_1.default.copyFileSync(downloadPath, resolvedDest);
                fs_1.default.unlinkSync(downloadPath);
                log(`Copied (cross-device) ${downloadPath} → ${resolvedDest}`);
                if (options.rawResult) {
                    return { success: true, path: resolvedDest, size: fileSize, mimeType };
                }
                return ctx.formatResult('browser_download', {
                    text: `Downloaded and saved to ${resolvedDest} (${formatBytes(fileSize)})`,
                }, options);
            }
            catch (copyErr) {
                return ctx.error(`Download succeeded but failed to move file: ${copyErr.message}`, options);
            }
        }
        return ctx.error(`Download succeeded but failed to move file: ${err.message}`, options);
    }
}
/**
 * Resolve the destination path.
 * If destination is a directory, append the original filename.
 * If destination is a file path, use it directly.
 */
function resolveDestination(destination, downloadPath) {
    const resolved = path_1.default.resolve(destination);
    // If destination exists and is a directory, or ends with separator, append filename
    if ((fs_1.default.existsSync(resolved) && fs_1.default.statSync(resolved).isDirectory()) ||
        destination.endsWith('/') || destination.endsWith(path_1.default.sep)) {
        return path_1.default.join(resolved, path_1.default.basename(downloadPath));
    }
    return resolved;
}
function formatBytes(bytes) {
    if (!bytes)
        return 'unknown size';
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
//# sourceMappingURL=downloads.js.map