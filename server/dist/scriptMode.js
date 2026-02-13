"use strict";
/**
 * Script Mode — JSON-RPC 2.0 over stdin/stdout
 * No MCP overhead, no auth required.
 * Adapted from Blueprint MCP (Apache 2.0)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScriptMode = startScriptMode;
const readline_1 = __importDefault(require("readline"));
const backend_1 = require("./backend");
async function startScriptMode(config) {
    const backend = new backend_1.StatefulBackend(config);
    await backend.initialize(null, {});
    const rl = readline_1.default.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
    });
    rl.on('line', async (line) => {
        try {
            const trimmed = line.trim();
            if (!trimmed)
                return;
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                const results = await Promise.all(parsed.map((req) => handleRequest(req, backend)));
                console.log(JSON.stringify(results));
            }
            else {
                const result = await handleRequest(parsed, backend);
                console.log(JSON.stringify(result));
            }
        }
        catch (error) {
            const errorResponse = {
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32700,
                    message: `Parse error: ${error.message}`,
                },
            };
            console.log(JSON.stringify(errorResponse));
        }
    });
    rl.on('close', async () => {
        await backend.serverClosed();
        process.exit(0);
    });
    process.on('SIGINT', async () => {
        await backend.serverClosed();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        await backend.serverClosed();
        process.exit(0);
    });
}
async function handleRequest(request, backend) {
    const { jsonrpc, id, method, params } = request;
    if (jsonrpc !== '2.0') {
        return {
            jsonrpc: '2.0',
            id: id || null,
            error: { code: -32600, message: 'Invalid JSON-RPC version (must be "2.0")' },
        };
    }
    if (!method || typeof method !== 'string') {
        return {
            jsonrpc: '2.0',
            id: id || null,
            error: { code: -32600, message: 'Missing or invalid method' },
        };
    }
    try {
        const result = await backend.callTool(method, params || {}, { rawResult: true });
        return { jsonrpc: '2.0', id, result };
    }
    catch (error) {
        return {
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: error.message || String(error) },
        };
    }
}
//# sourceMappingURL=scriptMode.js.map