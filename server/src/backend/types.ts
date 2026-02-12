/**
 * Shared types for the backend module.
 */

import type { IExtensionTransport } from '../bridge';

export interface BackendConfig {
  debug: boolean;
  port: number;
  server: { name: string; version: string };
  enabledExperiments?: string[];
}

export interface TabInfo {
  id?: number;
  index?: number;
  title?: string;
  url?: string;
  techStack?: any;
}

export type BackendState = 'passive' | 'active' | 'connected';

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/**
 * Public interface of ConnectionManager exposed to handler functions.
 * Handlers need both read and write access to manage state transitions.
 */
export interface ConnectionManagerAPI {
  config: BackendConfig;
  debugMode: boolean;
  state: BackendState;
  bridge: any;
  extensionServer: IExtensionTransport | null;
  server: any;
  clientInfo: Record<string, unknown>;
  clientId: string | null;
  connectedBrowserName: string | null;
  attachedTab: TabInfo | null;
  tipShown: boolean;

  statusHeader(): string;
  notifyToolsListChanged(): Promise<void>;
}
