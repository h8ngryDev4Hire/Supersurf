import { describe, it, expect } from 'vitest';
import { shouldUnwrap, wrapWithUnwrap } from '../../src/utils/unwrap';

/**
 * The WRAPPED_METHODS list from the source — used to validate detection coverage.
 */
const WRAPPED_METHODS = [
  'document.querySelector',
  'document.querySelectorAll',
  'document.getElementById',
  'document.getElementsByClassName',
  'document.getElementsByTagName',
  'Element.prototype.querySelector',
  'Element.prototype.querySelectorAll',
  'Element.prototype.getAttribute',
  'Element.prototype.setAttribute',
  'Element.prototype.getBoundingClientRect',
  'window.getComputedStyle',
];

describe('shouldUnwrap', () => {
  it('returns true for code containing querySelector', () => {
    expect(shouldUnwrap('document.querySelector(".btn")')).toBe(true);
  });

  it('returns true for code containing querySelectorAll', () => {
    expect(shouldUnwrap('document.querySelectorAll("div")')).toBe(true);
  });

  it('returns true for code containing getElementById', () => {
    expect(shouldUnwrap('document.getElementById("app")')).toBe(true);
  });

  it('returns true for code containing getElementsByClassName', () => {
    expect(shouldUnwrap('document.getElementsByClassName("item")')).toBe(true);
  });

  it('returns true for code containing getElementsByTagName', () => {
    expect(shouldUnwrap('document.getElementsByTagName("p")')).toBe(true);
  });

  it('returns true for code containing getAttribute', () => {
    expect(shouldUnwrap('el.getAttribute("data-id")')).toBe(true);
  });

  it('returns true for code containing setAttribute', () => {
    expect(shouldUnwrap('el.setAttribute("class", "active")')).toBe(true);
  });

  it('returns true for code containing getBoundingClientRect', () => {
    expect(shouldUnwrap('el.getBoundingClientRect()')).toBe(true);
  });

  it('returns true for code containing getComputedStyle', () => {
    expect(shouldUnwrap('window.getComputedStyle(el)')).toBe(true);
  });

  it('detects the short name regardless of the object prefix', () => {
    // shouldUnwrap checks the short name (after the last dot), so
    // "querySelector" matches even without the "document." prefix.
    expect(shouldUnwrap('myEl.querySelector("span")')).toBe(true);
  });

  it('returns true when multiple DOM methods are present', () => {
    const code = `
      const el = document.querySelector('.main');
      const style = window.getComputedStyle(el);
    `;
    expect(shouldUnwrap(code)).toBe(true);
  });

  it('returns false for code without any DOM methods', () => {
    expect(shouldUnwrap('1 + 2')).toBe(false);
  });

  it('returns false for simple variable assignments', () => {
    expect(shouldUnwrap('const x = "hello"')).toBe(false);
  });

  it('returns false for console logging', () => {
    expect(shouldUnwrap('console.log("test")')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(shouldUnwrap('')).toBe(false);
  });

  it('returns false for code with partial method name matches that are not actual methods', () => {
    // "query" alone should not trigger — it must contain the full short name
    expect(shouldUnwrap('const query = "select * from users"')).toBe(false);
  });

  it('covers every method in the WRAPPED_METHODS list', () => {
    for (const method of WRAPPED_METHODS) {
      const shortName = method.split('.').pop()!;
      expect(shouldUnwrap(shortName)).toBe(true);
    }
  });
});

describe('wrapWithUnwrap', () => {
  it('returns unchanged code when shouldUnwrap is false', () => {
    const code = 'return 42';
    expect(wrapWithUnwrap(code)).toBe(code);
  });

  it('returns unchanged code for simple arithmetic', () => {
    const code = '1 + 2';
    expect(wrapWithUnwrap(code)).toBe(code);
  });

  it('wraps code that contains DOM methods', () => {
    const code = 'document.querySelector(".test")';
    const result = wrapWithUnwrap(code);
    expect(result).not.toBe(code);
    expect(result).toContain('eval(');
    expect(result).toContain(JSON.stringify(code));
  });

  it('wrapped code contains iframe creation for native method restoration', () => {
    const code = 'document.querySelector(".app")';
    const result = wrapWithUnwrap(code);
    expect(result).toContain("document.createElement('iframe')");
    expect(result).toContain("_iframe.style.display = 'none'");
    expect(result).toContain('document.body.appendChild(_iframe)');
  });

  it('wrapped code contains native document reference', () => {
    const code = 'document.querySelectorAll("div")';
    const result = wrapWithUnwrap(code);
    expect(result).toContain('_iframe.contentDocument');
    expect(result).toContain('_iframe.contentWindow');
  });

  it('wrapped code restores querySelector from the native document', () => {
    const code = 'document.querySelector("p")';
    const result = wrapWithUnwrap(code);
    expect(result).toContain('_saved.querySelector = document.querySelector');
    expect(result).toContain('document.querySelector = _nativeDoc.querySelector.bind(document)');
  });

  it('wrapped code restores querySelectorAll from the native document', () => {
    const code = 'document.querySelectorAll("p")';
    const result = wrapWithUnwrap(code);
    expect(result).toContain('_saved.querySelectorAll = document.querySelectorAll');
    expect(result).toContain('document.querySelectorAll = _nativeDoc.querySelectorAll.bind(document)');
  });

  it('wrapped code restores getComputedStyle from the native window', () => {
    const code = 'window.getComputedStyle(el)';
    const result = wrapWithUnwrap(code);
    expect(result).toContain('_saved.getComputedStyle = window.getComputedStyle');
    expect(result).toContain('window.getComputedStyle = _nativeWin.getComputedStyle.bind(window)');
  });

  it('wrapped code contains cleanup in a finally block', () => {
    const code = 'document.querySelector("div")';
    const result = wrapWithUnwrap(code);
    expect(result).toContain('} finally {');
    expect(result).toContain('_iframe.remove()');
  });

  it('wrapped code restores saved methods in the finally block', () => {
    const code = 'document.querySelector("h1")';
    const result = wrapWithUnwrap(code);
    expect(result).toContain('if (_saved.querySelector) document.querySelector = _saved.querySelector');
    expect(result).toContain('if (_saved.querySelectorAll) document.querySelectorAll = _saved.querySelectorAll');
    expect(result).toContain('if (_saved.getComputedStyle) window.getComputedStyle = _saved.getComputedStyle');
  });

  it('wrapped code is an IIFE', () => {
    const code = 'document.getElementById("root")';
    const result = wrapWithUnwrap(code);
    expect(result).toMatch(/^\(function\(\)\s*\{/);
    expect(result).toMatch(/\}\)\(\)$/);
  });

  it('wrapped code embeds the user code via eval()', () => {
    const userCode = 'document.querySelector(".item").textContent';
    const result = wrapWithUnwrap(userCode);
    expect(result).toContain('eval(');
    expect(result).toContain(JSON.stringify(userCode));
  });

  it('handles multi-statement code without syntax errors', () => {
    const userCode = 'const x = document.querySelector(".a"); x.textContent';
    const result = wrapWithUnwrap(userCode);
    // Should NOT produce "return const x = ..." which is a syntax error
    expect(result).not.toContain(`return ${userCode}`);
    expect(result).toContain('eval(');
  });

  it('handles single expression through eval', () => {
    const userCode = 'document.querySelector(".btn").innerText';
    const result = wrapWithUnwrap(userCode);
    expect(result).toContain('eval(');
    expect(result).toContain(JSON.stringify(userCode));
  });
});
