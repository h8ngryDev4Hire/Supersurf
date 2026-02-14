/**
 * Debug logging utility for the extension
 * Adapted from Blueprint MCP (Apache 2.0)
 */

export class Logger {
  private prefix: string;
  private debugMode: boolean = false;
  private browser: typeof chrome | null = null;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  async init(browserAPI: typeof chrome): Promise<void> {
    this.browser = browserAPI;
    const result = await browserAPI.storage.local.get(['debugMode']);
    this.debugMode = result.debugMode === true;

    browserAPI.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.debugMode) {
        this.debugMode = changes.debugMode.newValue === true;
      }
    });
  }

  private timestamp(): string {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  }

  log(...args: unknown[]): void {
    if (this.debugMode) {
      console.log(`[${this.prefix}] ${this.timestamp()}`, ...args);
    }
  }

  logAlways(...args: unknown[]): void {
    console.log(`[${this.prefix}] ${this.timestamp()}`, ...args);
  }

  error(...args: unknown[]): void {
    console.error(`[${this.prefix}] ${this.timestamp()}`, ...args);
  }

  warn(...args: unknown[]): void {
    console.warn(`[${this.prefix}] ${this.timestamp()}`, ...args);
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }
}
