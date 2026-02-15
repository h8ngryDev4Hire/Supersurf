/**
 * Miscellaneous tool handlers — window, dialog, evaluate, verify, extensions, performance.
 */

import type { ToolContext } from './types';
import { experimentRegistry, analyzeCode } from '../experimental/index';

export async function onWindow(ctx: ToolContext, args: any, options: any): Promise<any> {
  const result = await ctx.ext.sendCmd('window', {
    action: args.action,
    width: args.width,
    height: args.height,
  });
  return ctx.formatResult('browser_window', result, options);
}

export async function onDialog(ctx: ToolContext, args: any, options: any): Promise<any> {
  if (args.accept !== undefined) {
    const result = await ctx.ext.sendCmd('dialog', {
      accept: args.accept,
      text: args.text,
    });
    return ctx.formatResult('browser_handle_dialog', result, options);
  }

  const result = await ctx.ext.sendCmd('dialog', {});
  return ctx.formatResult('browser_handle_dialog', result, options);
}

export async function onEvaluate(ctx: ToolContext, args: any, options: any): Promise<any> {
  const code = args.function || args.expression;

  if (code && experimentRegistry.isEnabled('secure_eval')) {
    const analysis = analyzeCode(code);
    if (!analysis.safe) {
      return ctx.error(
        `Code blocked by \`secure_eval\` experiment.\n\n` +
        `**Reason:** ${analysis.reason}\n\n` +
        `Disable the experiment or refactor to use dedicated MCP tools.`,
        options
      );
    }
  }

  const result = await ctx.ext.sendCmd('evaluate', {
    function: args.function,
    expression: args.expression,
  });

  if (options.rawResult) return result;
  const text = result === undefined ? 'undefined'
    : result === null ? 'null'
    : typeof result === 'string' ? result
    : JSON.stringify(result, null, 2);
  return {
    content: [{ type: 'text', text }],
  };
}

export async function onVerifyTextVisible(ctx: ToolContext, args: any, options: any): Promise<any> {
  const text = args.text as string;
  const found = await ctx.eval(`document.body.innerText.includes(${JSON.stringify(text)})`);

  if (options.rawResult) return { visible: found, text };
  return {
    content: [{
      type: 'text',
      text: found ? `✓ Text visible: "${text}"` : `✗ Text not found: "${text}"`,
    }],
    isError: !found,
  };
}

export async function onVerifyElementVisible(ctx: ToolContext, args: any, options: any): Promise<any> {
  const selector = args.selector as string;
  const result = await ctx.eval(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { exists: false, visible: false };
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible = style.display !== 'none' && style.visibility !== 'hidden' &&
                      rect.width > 0 && rect.height > 0;
      return { exists: true, visible };
    })()
  `);

  if (options.rawResult) return result;
  const visible = result?.visible;
  return {
    content: [{
      type: 'text',
      text: visible ? `✓ Element visible: ${selector}` : `✗ Element not visible: ${selector}`,
    }],
    isError: !visible,
  };
}

export async function onListExtensions(ctx: ToolContext, options: any): Promise<any> {
  const result = await ctx.ext.sendCmd('listExtensions', {});
  return ctx.formatResult('browser_list_extensions', result, options);
}

export async function onReloadExtensions(ctx: ToolContext, args: any, options: any): Promise<any> {
  const result = await ctx.ext.sendCmd('reloadExtension', {
    extensionName: args.extensionName,
  });
  return ctx.formatResult('browser_reload_extensions', result, options);
}

export async function onPerformanceMetrics(ctx: ToolContext, options: any): Promise<any> {
  const cdpResult = await ctx.ext.sendCmd('performanceMetrics', {});
  const metrics = cdpResult?.metrics || [];

  const vitals = await ctx.eval(`
    (() => {
      const perf = performance.getEntriesByType('navigation')[0] || {};
      const paint = performance.getEntriesByType('paint') || [];
      const fcp = paint.find(e => e.name === 'first-contentful-paint');

      return {
        ttfb: perf.responseStart ? Math.round(perf.responseStart) : null,
        fcp: fcp ? Math.round(fcp.startTime) : null,
        domContentLoaded: perf.domContentLoadedEventEnd ? Math.round(perf.domContentLoadedEventEnd) : null,
        load: perf.loadEventEnd ? Math.round(perf.loadEventEnd) : null,
      };
    })()
  `).catch(() => null);

  if (options.rawResult) return { metrics, vitals };

  let text = '### Performance Metrics\n\n';

  if (vitals) {
    if (vitals.ttfb != null) text += `TTFB: ${vitals.ttfb}ms\n`;
    if (vitals.fcp != null) text += `FCP: ${vitals.fcp}ms\n`;
    if (vitals.domContentLoaded != null) text += `DOM Content Loaded: ${vitals.domContentLoaded}ms\n`;
    if (vitals.load != null) text += `Load: ${vitals.load}ms\n`;
  }

  if (metrics.length > 0) {
    text += '\n**CDP Metrics:**\n';
    for (const m of metrics) {
      text += `${m.name}: ${m.value}\n`;
    }
  }

  return { content: [{ type: 'text', text }] };
}
