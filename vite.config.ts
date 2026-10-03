import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works from any static host sub-path.
  base: './',
  server: { host: true },
  build: {
    // Phaser alone is ~1.2 MB minified; don't warn about it.
    chunkSizeWarningLimit: 1600,
    // The landing page at /, the game at /play/.
    rolldownOptions: { input: { main: 'index.html', play: 'play/index.html' } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
  plugins: [],
});
