import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    alias: {
      // Resolve .js extensions in imports to .ts source files
      '(.+)\\.js': '$1.ts',
    },
  },
});
