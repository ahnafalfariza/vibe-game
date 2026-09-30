import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works from any static host sub-path.
  base: './',
  server: { host: true },
  // Phaser alone is ~1.2 MB minified; don't warn about it.
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
