import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Override konfigurasi PostCSS: postcss.config.mjs proyek ini memakai plugin
  // Tailwind v4 (objek, bukan plugin PostCSS klasik) yang tidak dipahami Vite.
  // Test di sini murni logika Node, jadi PostCSS tidak dibutuhkan sama sekali.
  css: { postcss: { plugins: [] } },
  // Samakan alias `@/` dengan tsconfig supaya modul src/lib/* bisa diuji.
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Log warn dari modul settings/logger tidak perlu memenuhi output test.
    env: { LEVEL_LOG: 'error' },
  },
})
