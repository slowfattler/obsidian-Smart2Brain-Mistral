// vite.config.ts
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import builtinModules from "builtin-modules";

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === "development";

  return {
    plugins: [
      svelte({
        preprocess: vitePreprocess(),
        onwarn: (warning, handler) => {
          if (warning.code && warning.code.startsWith("a11y")) return;
          handler(warning);
        },
      }),
    ],
    build: {
      lib: {
        entry: "src/main.ts",
        formats: ["cjs"],
        fileName: () => "main.js",
      },
      rollupOptions: {
        plugins: [],
        output: {
          entryFileNames: "main.js",
          assetFileNames: "styles.css",  // CSS-Datei immer als styles.css ausgeben
          sourcemapBaseUrl: new URL("./build/smart-second-brain/", import.meta.url).toString(),
          manualChunks: undefined,
          inlineDynamicImports: true,
        },
        external: [
          "obsidian",
          "electron",
          "@codemirror/autocomplete",
          "@codemirror/collab",
          "@codemirror/commands",
          "@codemirror/language",
          "@codemirror/lint",
          "@codemirror/search",
          "@codemirror/state",
          "@codemirror/view",
          "@lezer/common",
          "@lezer/highlight",
          "@lezer/lr",
          "@sap-ai-sdk/langchain",
          "@internationalized/date",
          ...builtinModules,
        ],
      },
      outDir: "./build/smart-second-brain/",  // Immer in smart-second-brain/ ausgeben
      emptyOutDir: true,  // Vorhandene Dateien immer löschen
      sourcemap: isDevelopment,
    },
    css: {
      devSourcemap: isDevelopment,
    },
  };
});