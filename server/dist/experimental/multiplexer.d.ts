/**
 * Multiplexer — session multiplexing for concurrent MCP clients.
 *
 * Implements IExtensionTransport. On start(), tries to bind the port (leader mode).
 * If port is taken, connects as a follower through the existing leader.
 * Followers transparently proxy commands through the leader to the extension.
 *
 * Leader responsibilities:
 *   - Accept extension connections (delegated to ExtensionServer)
 *   - Accept peer (follower) connections, proxy their requests to the extension
 *   - Track tab ownership per session (selectTab/createTab claim, closeTab releases)
 *   - Round-robin scheduler: one tool call per session turn, auto context-switch
 *   - Broadcast reconnect/tab-info events to relevant peers
 *   - Inject _sessionId into all commands for extension-side group isolation
 *
 * Follower responsibilities:
 *   - Connect to leader via WebSocket, send peer handshake
 *   - Forward sendCmd() calls through leader, manage own inflight map
 *   - On leader disconnect, attempt promotion (race with other followers)
 */
import { type IExtensionTransport } from '../bridge';
export declare class Multiplexer implements IExtensionTransport {
    private port;
    private host;
    private sessionId;
    private mode;
    private extensionServer;
    private peers;
    private leaderTabOwnership;
    private leaderAttachedTabId;
    private leaderGroupId;
    private requestQueue;
    private sessionOrder;
    private currentSessionIdx;
    private processingQueue;
    private currentExtensionTabId;
    private sessionGroupIds;
    private leaderSocket;
    private inflight;
    private _browser;
    private _buildTime;
    private _connected;
    private promotionInProgress;
    onReconnect: (() => void) | null;
    onTabInfoUpdate: ((tabInfo: any) => void) | null;
    constructor(port: number | undefined, host: string | undefined, sessionId: string);
    get connected(): boolean;
    get browser(): string;
    get buildTime(): string | null;
    start(): Promise<void>;
    private startAsLeader;
    private acceptPeer;
    private handlePeerMessage;
    private enqueueRequest;
    private drainQueue;
    private hasQueuedRequests;
    /**
     * Round-robin pick: advance through sessions, skip empty queues.
     */
    private pickNextRequest;
    /**
     * Execute a single queued request:
     * 1. Tab ownership check for tab-management methods
     * 2. Auto context-switch (selectTab by ID) if this session's tab != current extension tab
     * 3. Inject _sessionId for extension-side group isolation
     * 4. Execute the actual command
     * 5. Track ownership changes
     */
    private executeRequest;
    private getSessionAttachedTabId;
    private setSessionAttachedTabId;
    private setSessionGroupId;
    /**
     * Find which session owns a tab by its ID.
     */
    private findTabOwnerByTabId;
    /**
     * Filter tab list — show tabs owned by this session + unowned tabs.
     * Defense-in-depth: extension already filters by group via _sessionId.
     */
    private filterTabsForSession;
    private startAsFollower;
    private attemptPromotion;
    sendCmd(method: string, params?: Record<string, unknown>, timeout?: number): Promise<any>;
    private sendCmdAsFollower;
    notifyClientId(clientId: string): void;
    stop(): Promise<void>;
}
//# sourceMappingURL=multiplexer.d.ts.map