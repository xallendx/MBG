#!/usr/bin/env node
/**
 * Penjaga utang lint.
 *
 * Repo ini punya 30 error `react-hooks/*` yang sudah ada sebelum pekerjaan UX
 * dimulai. Semuanya berada di satu komponen besar (src/app/page.tsx) dan
 * memperbaikinya berarti membongkar pola ref/state yang berisiko menimbulkan
 * regresi — jadi tidak dikerjakan sekalian.
 *
 * Masalah sebenarnya: CI sama sekali tidak menjalankan lint, sehingga utang itu
 * bisa bertambah tanpa ada yang tahu. Skrip ini menutup celah tersebut:
 *
 *   - error BARU (aturan baru, atau jumlah naik)  -> gagal
 *   - jumlah turun                               -> lulus, dan meminta baseline diperbarui
 *
 * Jalankan `npm run lint:baseline -- --update` setelah sengaja memperbaiki
 * error, supaya angka penjaganya ikut turun dan tidak bisa naik lagi.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(root, 'eslint-baseline.json')
const update = process.argv.includes('--update')

let results
try {
  const out = execFileSync('npx', ['eslint', '.', '-f', 'json'], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  })
  results = JSON.parse(out)
} catch (err) {
  // eslint keluar dengan kode 1 kalau ada error — outputnya tetap valid.
  const out = err.stdout
  if (!out) { console.error('Tidak bisa menjalankan eslint:', err.message); process.exit(2) }
  try { results = JSON.parse(out) } catch { console.error('Output eslint bukan JSON. Jalankan `npm run lint` untuk melihat.'); process.exit(2) }
}

const counts = {}
let warnings = 0
const locations = {}
for (const file of results) {
  for (const msg of file.messages) {
    if (msg.severity !== 2) { warnings++; continue }
    const rule = msg.ruleId || '(tanpa aturan)'
    counts[rule] = (counts[rule] || 0) + 1
    ;(locations[rule] ||= []).push(`${file.filePath.replace(root + '/', '')}:${msg.line}`)
  }
}
const total = Object.values(counts).reduce((a, b) => a + b, 0)

if (update || !existsSync(baselinePath)) {
  writeFileSync(baselinePath, JSON.stringify({
    _catatan: 'Jumlah error lint yang sudah ada. Dilarang naik. Perbarui dengan: npm run lint:baseline -- --update',
    totalError: total, perRule: counts,
  }, null, 2) + '\n')
  console.log(`Baseline disimpan: ${total} error, ${warnings} warning.`)
  for (const [r, n] of Object.entries(counts).sort()) console.log(`  ${r}: ${n}`)
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const baseRules = baseline.perRule || {}
const problems = []

for (const [rule, n] of Object.entries(counts)) {
  const allowed = baseRules[rule] || 0
  if (n > allowed) {
    problems.push(`${rule}: ${n} error (baseline ${allowed}) — lebih ${n - allowed}`)
    for (const loc of (locations[rule] || []).slice(0, 12)) problems.push(`    ${loc}`)
  }
}

if (problems.length) {
  console.error('\nLint menambahkan utang baru:\n')
  console.error(problems.join('\n'))
  console.error(`\nTotal sekarang ${total}, baseline ${baseline.totalError}.`)
  console.error('Perbaiki error di atas. Jangan menaikkan baseline untuk mengakali pemeriksaan ini.\n')
  process.exit(1)
}

const fixed = Object.entries(baseRules).filter(([r, n]) => (counts[r] || 0) < n)
console.log(`Lint OK: ${total} error (baseline ${baseline.totalError}), ${warnings} warning. Tidak ada utang baru.`)
if (fixed.length) {
  console.log('\nKamu memperbaiki sebagian utang lama:')
  for (const [r, n] of fixed) console.log(`  ${r}: ${n} -> ${counts[r] || 0}`)
  console.log('Jalankan `npm run lint:baseline -- --update` supaya perbaikan ini terkunci.')
}
