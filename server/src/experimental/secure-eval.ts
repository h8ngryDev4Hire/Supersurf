/**
 * Secure Eval — AST-based analysis for browser_evaluate code.
 * Blocks dangerous patterns (network calls, storage access, code injection,
 * obfuscation) before code reaches the extension.
 */

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

export interface AnalysisResult {
  safe: boolean;
  reason?: string;
}

interface BlockedPattern {
  nodeType: string;
  matcher: (node: any, ancestors: any[]) => boolean;
  reason: string;
}

// ── Helpers ──────────────────────────────────────────────────

function isIdentifier(node: any, name: string): boolean {
  return node?.type === 'Identifier' && node.name === name;
}

function isMemberCall(callee: any, obj: string, prop: string): boolean {
  return (
    callee?.type === 'MemberExpression' &&
    isIdentifier(callee.object, obj) &&
    isIdentifier(callee.property, prop) &&
    !callee.computed
  );
}

// ── Blocked patterns ─────────────────────────────────────────

const BLOCKED_PATTERNS: BlockedPattern[] = [
  // Blocked API calls
  {
    nodeType: 'CallExpression',
    matcher: (node) => {
      const callee = node.callee;
      if (callee?.type === 'Identifier') {
        return ['fetch', 'eval', 'atob', 'btoa'].includes(callee.name);
      }
      return false;
    },
    reason: 'Direct call to blocked API',
  },

  // Obfuscation primitives
  {
    nodeType: 'CallExpression',
    matcher: (node) =>
      isMemberCall(node.callee, 'String', 'fromCharCode') ||
      isMemberCall(node.callee, 'String', 'raw'),
    reason: 'String obfuscation primitive (String.fromCharCode / String.raw)',
  },

  // Timer string execution
  {
    nodeType: 'CallExpression',
    matcher: (node) => {
      const callee = node.callee;
      if (
        callee?.type === 'Identifier' &&
        ['setTimeout', 'setInterval'].includes(callee.name)
      ) {
        const firstArg = node.arguments?.[0];
        return firstArg?.type === 'Literal' && typeof firstArg.value === 'string';
      }
      return false;
    },
    reason: 'setTimeout/setInterval with string argument (implicit eval)',
  },

  // Reflection
  {
    nodeType: 'CallExpression',
    matcher: (node) =>
      isMemberCall(node.callee, 'Reflect', 'get') ||
      isMemberCall(node.callee, 'Reflect', 'apply'),
    reason: 'Reflection API (Reflect.get / Reflect.apply)',
  },

  // Network beacon
  {
    nodeType: 'CallExpression',
    matcher: (node) => isMemberCall(node.callee, 'navigator', 'sendBeacon'),
    reason: 'Network exfiltration via navigator.sendBeacon',
  },

  // Storage access
  {
    nodeType: 'MemberExpression',
    matcher: (node, ancestors) => {
      if (
        node.object?.type === 'Identifier' &&
        ['localStorage', 'sessionStorage'].includes(node.object.name)
      ) {
        return true;
      }
      return false;
    },
    reason: 'Direct storage access (use the browser_storage tool instead)',
  },

  // Dynamic global access
  {
    nodeType: 'MemberExpression',
    matcher: (node) => {
      if (
        node.computed &&
        node.object?.type === 'Identifier' &&
        ['window', 'globalThis', 'self'].includes(node.object.name)
      ) {
        return true;
      }
      return false;
    },
    reason: 'Computed property access on global object (potential obfuscation)',
  },

  // Prototype walking
  {
    nodeType: 'MemberExpression',
    matcher: (node) => {
      if (node.property?.type === 'Identifier') {
        return ['__proto__', 'constructor'].includes(node.property.name);
      }
      if (
        node.property?.type === 'Literal' &&
        typeof node.property.value === 'string'
      ) {
        return ['__proto__', 'constructor'].includes(node.property.value);
      }
      return false;
    },
    reason: 'Prototype chain walking (__proto__ / constructor)',
  },

  // Dangerous constructors
  {
    nodeType: 'NewExpression',
    matcher: (node) => {
      if (node.callee?.type === 'Identifier') {
        return ['Function', 'WebSocket', 'XMLHttpRequest', 'EventSource'].includes(
          node.callee.name
        );
      }
      return false;
    },
    reason: 'Dangerous constructor (Function / WebSocket / XMLHttpRequest / EventSource)',
  },

  // Import expressions
  {
    nodeType: 'ImportExpression',
    matcher: () => true,
    reason: 'Dynamic import() expression',
  },

  // Tagged template obfuscation (e.g. String.raw`...`)
  {
    nodeType: 'TaggedTemplateExpression',
    matcher: (node) => isMemberCall(node.tag, 'String', 'raw'),
    reason: 'String obfuscation primitive (String.fromCharCode / String.raw)',
  },
];

// ── Analyzer ─────────────────────────────────────────────────

export function analyzeCode(code: string): AnalysisResult {
  if (!code || !code.trim()) {
    return { safe: true };
  }

  let ast: acorn.Node;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    });
  } catch {
    // Syntax errors → let Runtime.evaluate return its own error
    return { safe: true };
  }

  let violation: AnalysisResult | null = null;

  walk.ancestor(ast, {
    CallExpression(node: any, _state: any, ancestors: any[]) {
      if (violation) return;
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.nodeType === 'CallExpression' && pattern.matcher(node, ancestors)) {
          violation = { safe: false, reason: pattern.reason };
          return;
        }
      }
    },
    MemberExpression(node: any, _state: any, ancestors: any[]) {
      if (violation) return;
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.nodeType === 'MemberExpression' && pattern.matcher(node, ancestors)) {
          violation = { safe: false, reason: pattern.reason };
          return;
        }
      }
    },
    NewExpression(node: any, _state: any, ancestors: any[]) {
      if (violation) return;
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.nodeType === 'NewExpression' && pattern.matcher(node, ancestors)) {
          violation = { safe: false, reason: pattern.reason };
          return;
        }
      }
    },
    ImportExpression(node: any, _state: any, ancestors: any[]) {
      if (violation) return;
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.nodeType === 'ImportExpression' && pattern.matcher(node, ancestors)) {
          violation = { safe: false, reason: pattern.reason };
          return;
        }
      }
    },
    TaggedTemplateExpression(node: any, _state: any, ancestors: any[]) {
      if (violation) return;
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.nodeType === 'TaggedTemplateExpression' && pattern.matcher(node, ancestors)) {
          violation = { safe: false, reason: pattern.reason };
          return;
        }
      }
    },
  });

  return violation ?? { safe: true };
}
