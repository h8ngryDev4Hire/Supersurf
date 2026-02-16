/**
 * Secure Eval — AST-based analysis for browser_evaluate code.
 * Blocks dangerous patterns (network calls, storage access, code injection,
 * obfuscation) before code reaches the extension.
 */
export interface AnalysisResult {
    safe: boolean;
    reason?: string;
}
export declare function analyzeCode(code: string): AnalysisResult;
/**
 * Wrap user code in a page-context Proxy that intercepts blocked API access.
 * Sloppy-mode outer for `with`, strict-mode inner for the user code.
 * Returns a self-contained IIFE string ready for Runtime.evaluate.
 */
export declare function wrapWithPageProxy(code: string): string;
//# sourceMappingURL=secure-eval.d.ts.map