/**
 * Unit tests for UnifiedBackend - Selector Escaping
 *
 * These tests verify that selectors with special characters are properly
 * escaped when embedded in JavaScript code, preventing syntax errors.
 */

describe('UnifiedBackend - Selector Escaping', () => {
  describe('JSON.stringify escaping', () => {
    // These tests verify that our fix (using JSON.stringify) properly
    // escapes selectors that would otherwise cause JavaScript syntax errors

    test('escapes single quotes correctly', () => {
      const selector = "span:has-text('Все отзывы')";
      const escaped = JSON.stringify(selector);

      // Should be wrapped in double quotes and single quotes preserved
      expect(escaped).toBe('"span:has-text(\'Все отзывы\')"');

      // Should be valid when evaluated as JavaScript
      expect(() => {
        eval(`const x = ${escaped}`);
      }).not.toThrow();
    });

    test('escapes double quotes correctly', () => {
      const selector = 'button:has-text("Click me")';
      const escaped = JSON.stringify(selector);

      // Double quotes should be escaped
      expect(escaped).toContain('\\"');

      // Should be valid JavaScript
      expect(() => {
        eval(`const x = ${escaped}`);
      }).not.toThrow();
    });

    test('escapes mixed quotes correctly', () => {
      const selector = `div:has-text('He said "hello"')`;
      const escaped = JSON.stringify(selector);

      // Should be valid JavaScript
      expect(() => {
        eval(`const x = ${escaped}`);
      }).not.toThrow();
    });

    test('handles Unicode characters (Cyrillic)', () => {
      const selector = "button:has-text('Кнопка')";
      const escaped = JSON.stringify(selector);

      // Should preserve Unicode
      expect(escaped).toContain('Кнопка');

      // Should be valid JavaScript
      expect(() => {
        eval(`const x = ${escaped}`);
      }).not.toThrow();
    });

    test('handles special characters in selectors', () => {
      const selector = "a.link:has-text('Price: $99.99')";
      const escaped = JSON.stringify(selector);

      // Should be valid JavaScript
      expect(() => {
        eval(`const x = ${escaped}`);
      }).not.toThrow();
    });

    test('handles newlines in selectors', () => {
      const selector = "div:has-text('Line 1\nLine 2')";
      const escaped = JSON.stringify(selector);

      // Newlines should be escaped
      expect(escaped).toContain('\\n');

      // Should be valid JavaScript
      expect(() => {
        eval(`const x = ${escaped}`);
      }).not.toThrow();
    });

    test('handles backslashes in selectors', () => {
      const selector = "div:has-text('Path: C:\\Users\\Name')";
      const escaped = JSON.stringify(selector);

      // Backslashes should be escaped
      expect(escaped).toContain('\\\\');

      // Should be valid JavaScript
      expect(() => {
        eval(`const x = ${escaped}`);
      }).not.toThrow();
    });
  });

  describe('Real-world selector examples', () => {
    test('Chrome Web Store selector from bug report', () => {
      // This was the actual selector that caused the bug
      const selector = "span.mUIrbf-vQzf8d:has-text('Все отзывы')";
      const escaped = JSON.stringify(selector);

      // Verify it creates valid JavaScript code
      const code = `
        (() => {
          return {
            selector: ${escaped},
            found: true
          };
        })()
      `;

      expect(() => {
        eval(code);
      }).not.toThrow();
    });

    test('Complex selector with multiple special characters', () => {
      const selector = `button[data-action="submit"]:has-text('Click "here" to continue')`;
      const escaped = JSON.stringify(selector);

      const code = `
        (() => {
          return {
            selector: ${escaped}
          };
        })()
      `;

      expect(() => {
        eval(code);
      }).not.toThrow();
    });
  });
});
