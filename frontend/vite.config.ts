/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      // chartjs-chart-financial@0.2.1's package.json "main" points at a minified UMD bundle
      // that assumes a pre-existing global `Chart` and throws ("Cannot read properties of
      // undefined (reading 'helpers')") the moment it's imported outside that context - found
      // live via a crashing test run. It also ships a working ESM build ("module" field) that
      // default resolution doesn't pick up (no "exports" map in its package.json) - forcing it
      // explicitly here fixes both Vitest and the real Vite dev/build bundle consistently,
      // rather than relying on each tool's own default main-vs-module heuristic to agree.
      'chartjs-chart-financial': 'chartjs-chart-financial/dist/chartjs-chart-financial.esm.js',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
