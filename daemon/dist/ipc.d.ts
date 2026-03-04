/**
 * IPC Server — Unix socket server for MCP session connections.
 *
 * Accepts connections from MCP servers over a Unix domain socket.
 * Protocol:
 *   1. MCP server sends: { type: "session_register", sessionId: "..." }\n
 *   2. Daemon responds: { type: "session_ack", browser: "...", buildTimestamp: "..." }\n
 *      or { type: "session_reject", reason: "..." }\n
 *   3. Post-handshake: NDJSON (newline-delimited JSON-RPC 2.0) for tool calls
 *
 * @module ipc
 */
import type { ExtensionBridge } from './extension-bridge';
import type { SessionRegistry } from './session';
import type { RequestScheduler } from './scheduler';
/** Callback invoked when the number of sessions changes (for idle timeout management). */
export type SessionCountCallback = (count: number) => void;
/**
 * Unix domain socket server for MCP session connections.
 * Handles session handshake, NDJSON message routing, and cleanup.
 */
export declare class IPCServer {
    private server;
    private socketPath;
    private bridge;
    private sessions;
    private scheduler;
    private onSessionCountChange;
    constructor(socketPath: string, bridge: ExtensionBridge, sessions: SessionRegistry, scheduler: RequestScheduler);
    /** Set a callback for session count changes (used by idle timeout). */
    setSessionCountCallback(cb: SessionCountCallback): void;
    /** Start listening on the Unix socket. */
    start(): Promise<void>;
    /** Handle a new connection from an MCP server. */
    private handleConnection;
    /** Route a JSON-RPC 2.0 request into the scheduler. */
    private handleRequest;
    /** Write an NDJSON line to a socket. */
    private sendLine;
    /** Gracefully shut down the IPC server. */
    stop(): Promise<void>;
}
//# sourceMappingURL=ipc.d.ts.map