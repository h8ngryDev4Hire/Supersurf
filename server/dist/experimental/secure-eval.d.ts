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
//# sourceMappingURL=secure-eval.d.ts.map