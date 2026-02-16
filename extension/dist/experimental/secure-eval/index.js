/**
 * Secure eval Layer 2 — Service Worker membrane validation.
 * Registers the `validateEval` command handler on the WebSocket connection.
 *
 * Executes agent code against a deep Proxy membrane (no real DOM/APIs).
 * If code reaches a blocked terminal, it's caught before page execution.
 */
import { buildMembrane } from './membrane.js';
/**
 * Register the `validateEval` command handler.
 */
export function registerSecureEvalHandlers(wsConnection) {
    const membrane = buildMembrane();
    wsConnection.registerCommandHandler('validateEval', async (params) => {
        const code = params?.code;
        if (!code || !code.trim()) {
            return { safe: true };
        }
        try {
            // Sloppy outer for `with`, strict inner for agent code.
            // No `return` — we don't care about the value, just whether blocked APIs are reached.
            const wrapper = new Function('membrane', `with(membrane) { (function() { "use strict";\n${code}\n})(); }`);
            wrapper(membrane);
            // Code completed without hitting blocked terminals
            return { safe: true };
        }
        catch (err) {
            const message = err?.message || '';
            if (message.startsWith('[secure_eval:membrane]')) {
                // Code tried to access a blocked API
                return { safe: false, reason: message };
            }
            // SyntaxError or other runtime error — code can't reach dangerous APIs
            // through this path, so it's safe to let page execution handle it
            return { safe: true };
        }
    });
}
