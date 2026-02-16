"use strict";
/**
 * Miscellaneous tool handlers — window, dialog, evaluate, verify, extensions, performance.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onWindow = onWindow;
exports.onDialog = onDialog;
exports.onEvaluate = onEvaluate;
exports.onVerifyTextVisible = onVerifyTextVisible;
exports.onVerifyElementVisible = onVerifyElementVisible;
exports.onListExtensions = onListExtensions;
exports.onReloadExtensions = onReloadExtensions;
exports.onPerformanceMetrics = onPerformanceMetrics;
const index_1 = require("../experimental/index");
async function onWindow(ctx, args, options) {
    const result = await ctx.ext.sendCmd('window', {
        action: args.action,
        width: args.width,
        height: args.height,
    });
    return ctx.formatResult('browser_window', result, options);
}
async function onDialog(ctx, args, options) {
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
async function onEvaluate(ctx, args, options) {
    const code = args.function || args.expression;
    if (code && index_1.experimentRegistry.isEnabled('secure_eval')) {
        // Layer 1: Static AST analysis (~1ms)
        const analysis = (0, index_1.analyzeCode)(code);
        if (!analysis.safe) {
            return ctx.error(`Code blocked by \`secure_eval\` experiment.\n\n` +
                `**Reason:** ${analysis.reason}\n\n` +
                `Disable the experiment or refactor to use dedicated MCP tools.`, options);
        }
        // Layer 2: SW Proxy membrane (~10-20ms)
        try {
            const validation = await ctx.ext.sendCmd('validateEval', { code });
            if (validation && validation.safe === false) {
                return ctx.error(`Code blocked by \`secure_eval\` experiment (membrane).\n\n` +
                    `**Reason:** ${validation.reason}\n\n` +
                    `Disable the experiment or refactor to use dedicated MCP tools.`, options);
            }
        }
        catch {
            // Extension doesn't support validateEval — Layer 1+3 still cover
        }
        // Layer 3: Page-context Proxy wrapper
        const wrapped = (0, index_1.wrapWithPageProxy)(code);
        try {
            const result = await ctx.ext.sendCmd('evaluate', {
                expression: wrapped,
                prewrapped: true,
            });
            if (options.rawResult)
                return result;
            const text = result === undefined ? 'undefined'
                : result === null ? 'null'
                    : typeof result === 'string' ? result
                        : JSON.stringify(result, null, 2);
            return { content: [{ type: 'text', text }] };
        }
        catch (err) {
            const message = err?.message || '';
            if (message.includes('[secure_eval]')) {
                return ctx.error(`Code blocked by \`secure_eval\` experiment (page proxy).\n\n` +
                    `**Reason:** ${message}\n\n` +
                    `Disable the experiment or refactor to use dedicated MCP tools.`, options);
            }
            throw err;
        }
    }
    const result = await ctx.ext.sendCmd('evaluate', {
        function: args.function,
        expression: args.expression,
    });
    if (options.rawResult)
        return result;
    const text = result === undefined ? 'undefined'
        : result === null ? 'null'
            : typeof result === 'string' ? result
                : JSON.stringify(result, null, 2);
    return {
        content: [{ type: 'text', text }],
    };
}
async function onVerifyTextVisible(ctx, args, options) {
    const text = args.text;
    const found = await ctx.eval(`document.body.innerText.includes(${JSON.stringify(text)})`);
    if (options.rawResult)
        return { visible: found, text };
    return {
        content: [{
                type: 'text',
                text: found ? `✓ Text visible: "${text}"` : `✗ Text not found: "${text}"`,
            }],
        isError: !found,
    };
}
async function onVerifyElementVisible(ctx, args, options) {
    const selector = args.selector;
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
    if (options.rawResult)
        return result;
    const visible = result?.visible;
    return {
        content: [{
                type: 'text',
                text: visible ? `✓ Element visible: ${selector}` : `✗ Element not visible: ${selector}`,
            }],
        isError: !visible,
    };
}
async function onListExtensions(ctx, options) {
    const result = await ctx.ext.sendCmd('listExtensions', {});
    return ctx.formatResult('browser_list_extensions', result, options);
}
async function onReloadExtensions(ctx, args, options) {
    const result = await ctx.ext.sendCmd('reloadExtension', {
        extensionName: args.extensionName,
    });
    return ctx.formatResult('browser_reload_extensions', result, options);
}
async function onPerformanceMetrics(ctx, options) {
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
    if (options.rawResult)
        return { metrics, vitals };
    let text = '### Performance Metrics\n\n';
    if (vitals) {
        if (vitals.ttfb != null)
            text += `TTFB: ${vitals.ttfb}ms\n`;
        if (vitals.fcp != null)
            text += `FCP: ${vitals.fcp}ms\n`;
        if (vitals.domContentLoaded != null)
            text += `DOM Content Loaded: ${vitals.domContentLoaded}ms\n`;
        if (vitals.load != null)
            text += `Load: ${vitals.load}ms\n`;
    }
    if (metrics.length > 0) {
        text += '\n**CDP Metrics:**\n';
        for (const m of metrics) {
            text += `${m.name}: ${m.value}\n`;
        }
    }
    return { content: [{ type: 'text', text }] };
}
//# sourceMappingURL=misc.js.map