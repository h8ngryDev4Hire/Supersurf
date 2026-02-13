#!/usr/bin/env node

/**
 * Compatibility wrapper for @railsblueprint/chrome-mcp
 * Forwards all commands to @railsblueprint/blueprint-mcp
 */

console.warn('⚠️  Warning: @railsblueprint/chrome-mcp is deprecated.');
console.warn('📦 Please migrate to @railsblueprint/blueprint-mcp');
console.warn('ℹ️  See: https://www.npmjs.com/package/@railsblueprint/chrome-mcp\n');

// Forward to the new package
require('@railsblueprint/blueprint-mcp/cli.js');
