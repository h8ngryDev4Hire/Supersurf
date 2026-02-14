/**
 * Shared types for modular tool handlers.
 */

import type { IExtensionTransport } from '../bridge';

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/**
 * Context object passed to every tool handler.
 * Exposes the subset of BrowserBridge internals that handlers need.
 */
export interface ToolContext {
  ext: IExtensionTransport;
  connectionManager: any;

  cdp(method: string, params?: any): Promise<any>;
  eval(expression: string, awaitPromise?: boolean): Promise<any>;
  sleep(ms: number): Promise<void>;
  getElementCenter(selector: string): Promise<{ x: number; y: number }>;
  getSelectorExpression(selector: string): string;
  findAlternativeSelectors(selector: string): Promise<any[]>;
  formatResult(name: string, result: any, options: { rawResult?: boolean }): any;
  error(message: string, options: { rawResult?: boolean }): any;
}
