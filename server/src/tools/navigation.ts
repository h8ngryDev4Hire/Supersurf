/**
 * Navigation and tab management tool handlers.
 */

import type { ToolContext } from './types';
import { experimentRegistry } from '../experimental/index';

export async function onBrowserTabs(ctx: ToolContext, args: any, options: any): Promise<any> {
  const action = args.action as string;
  let result: any;

  switch (action) {
    case 'list':
      result = await ctx.ext.sendCmd('getTabs', {});
      break;
    case 'new':
      result = await ctx.ext.sendCmd('createTab', {
        url: args.url,
        activate: args.activate !== false,
      });
      break;
    case 'attach':
      result = await ctx.ext.sendCmd('selectTab', {
        index: args.index,
        stealth: args.stealth,
      });
      break;
    case 'close':
      result = await ctx.ext.sendCmd('closeTab', args.index);
      break;
    default:
      return ctx.error(`Unknown tab action: ${action}`, options);
  }

  if (result && ctx.connectionManager) {
    if (action === 'new' || action === 'attach') {
      ctx.connectionManager.setAttachedTab(result);
      if (args.stealth) ctx.connectionManager.setStealthMode(true);
    } else if (action === 'close') {
      ctx.connectionManager.clearAttachedTab();
    }
  }

  return ctx.formatResult('browser_tabs', result, options);
}

export async function onNavigate(ctx: ToolContext, args: any, options: any): Promise<any> {
  const action = args.action as string;
  let result: any;

  switch (action) {
    case 'url':
      result = await ctx.ext.sendCmd('navigate', { action: 'url', url: args.url });
      if (ctx.connectionManager?.attachedTab) {
        ctx.connectionManager.attachedTab.url = args.url;
      }
      // === EXPERIMENTAL: smart waiting ===
      if (experimentRegistry.isEnabled('smart_waiting')) {
        try { await ctx.ext.sendCmd('waitForReady', { timeout: 10000 }); }
        catch { /* fall through — page may already be ready */ }
      } else {
        await ctx.sleep(1500);
      }
      break;
    case 'back':
      await ctx.eval('window.history.back()');
      // === EXPERIMENTAL: smart waiting ===
      if (experimentRegistry.isEnabled('smart_waiting')) {
        try { await ctx.ext.sendCmd('waitForReady', { timeout: 10000 }); }
        catch { await ctx.sleep(1500); }
      } else {
        await ctx.sleep(1500);
      }
      result = { success: true, action: 'back', url: await ctx.eval('window.location.href') };
      break;
    case 'forward':
      await ctx.eval('window.history.forward()');
      // === EXPERIMENTAL: smart waiting ===
      if (experimentRegistry.isEnabled('smart_waiting')) {
        try { await ctx.ext.sendCmd('waitForReady', { timeout: 10000 }); }
        catch { await ctx.sleep(1500); }
      } else {
        await ctx.sleep(1500);
      }
      result = { success: true, action: 'forward', url: await ctx.eval('window.location.href') };
      break;
    case 'reload':
      result = await ctx.ext.sendCmd('navigate', { action: 'reload' });
      // === EXPERIMENTAL: smart waiting ===
      if (experimentRegistry.isEnabled('smart_waiting')) {
        try { await ctx.ext.sendCmd('waitForReady', { timeout: 10000 }); }
        catch { /* fall through */ }
      } else {
        await ctx.sleep(1500);
      }
      break;
    default:
      return ctx.error(`Unknown navigate action: ${action}`, options);
  }

  return ctx.formatResult('browser_navigate', result, options);
}
