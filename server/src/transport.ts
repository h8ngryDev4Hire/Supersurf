/**
 * Transport Layer — DirectTransport only (no proxy mode)
 * Adapted from Blueprint MCP (Apache 2.0)
 */

import type { ExtensionServer } from './extensionServer';

export abstract class Transport {
  abstract sendCommand(method: string, params: Record<string, unknown>, timeout?: number): Promise<any>;
  abstract close(): Promise<void>;
}

export class DirectTransport extends Transport {
  private _server: ExtensionServer;

  constructor(extensionServer: ExtensionServer) {
    super();
    this._server = extensionServer;
  }

  async sendCommand(method: string, params: Record<string, unknown>, timeout?: number): Promise<any> {
    return await this._server.sendCommand(method, params, timeout);
  }

  async close(): Promise<void> {
    // Server cleanup handled by Backend
  }
}
