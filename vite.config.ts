import { defineConfig } from 'vite';
import builtinModules from 'builtin-modules';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main.ts',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: [
        'obsidian',
        'electron',
        ...builtinModules,
      ],
      output: {
        entryFileNames: 'main.js',
        globals: {
          obsidian: 'obsidian',
          electron: 'electron',
        },
      },
    },
    outDir: './build',
    emptyOutDir: true,
    sourcemap: false,
  },
  css: {
    devSourcemap: false,
  },
});
