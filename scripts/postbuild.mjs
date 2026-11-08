#!/usr/bin/env node
/**
 * Salin aset statis ke bundel standalone — HANYA kalau bundelnya ada.
 *
 * Kenapa perlu skrip, bukan `cp` langsung di skrip build:
 *
 *   build lama: "... && cp -r .next/static .next/standalone/.next/ && cp -r public ..."
 *
 * Di Vercel, output standalone tidak dipakai (Vercel punya builder Next.js
 * sendiri), jadi folder `.next/standalone` bisa tidak ada. `cp` lalu gagal dan
 * SELURUH build dinyatakan gagal walaupun `next build`-nya sendiri sukses.
 *
 * Sekarang: kalau bundel standalone ada (self-host), aset disalin seperti biasa.
 * Kalau tidak ada (Vercel), langkah ini dilewati dengan pesan, bukan error.
 */
import { existsSync, cpSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const standalone = join(root, '.next', 'standalone')

if (!existsSync(standalone)) {
  console.log('[postbuild] Tidak ada .next/standalone (normal di Vercel) — penyalinan aset dilewati.')
  process.exit(0)
}

const jobs = [
  { from: join(root, '.next', 'static'), to: join(standalone, '.next', 'static') },
  { from: join(root, 'public'), to: join(standalone, 'public') },
]

let ok = true
for (const { from, to } of jobs) {
  if (!existsSync(from)) { console.log(`[postbuild] sumber tidak ada, dilewati: ${from}`); continue }
  try {
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to, { recursive: true })
    console.log(`[postbuild] disalin: ${from.replace(root + '/', '')} -> ${to.replace(root + '/', '')}`)
  } catch (err) {
    console.error(`[postbuild] GAGAL menyalin ${from}: ${err.message}`)
    ok = false
  }
}
process.exit(ok ? 0 : 1)
