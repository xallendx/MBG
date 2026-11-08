/**
 * Aturan tampilan task — satu sumber untuk semua view.
 *
 * Dulu label jadwal, warna prioritas, dan aturan "cooldown tinggal < 5 menit"
 * ditulis ulang di dalam `page.tsx` pada tiga tempat berbeda (baris tree,
 * dashboard, dialog detail). Akibatnya setiap perubahan harus dikerjakan tiga
 * kali, dan sempat ada perbedaan: satu view memakai ikon 🔴, view lain tetap ⏳.
 *
 * Semua aturan sekarang ada di sini dan dipakai ulang, plus bisa diuji.
 */

export const SCHEDULE_LABELS: Record<string, string> = {
  sekali: 'Sekali',
  harian: 'Setelah jeda',
  mingguan: 'Mingguan',
  jam_tertentu: 'Setiap hari',
  tanggal_spesifik: 'Mulai tanggal',
  kustom: 'Setelah jeda',
}

export const PRIORITY_DOT: Record<string, string> = {
  high: '#CC0000',
  medium: '#DAA520',
  low: '#228B22',
}

export const PRIORITY_LABEL: Record<string, string> = {
  high: '🔴 Tinggi',
  medium: '🟡 Sedang',
  low: '🟢 Rendah',
}

/** Cooldown di bawah 5 menit dianggap mendesak (merah). */
export const URGENT_COOLDOWN_MS = 5 * 60 * 1000

export function scheduleLabel(type: string | null | undefined): string {
  if (!type) return '-'
  return SCHEDULE_LABELS[type] ?? type
}

export function priorityDot(priority: string | null | undefined): string {
  return PRIORITY_DOT[priority ?? 'medium'] ?? PRIORITY_DOT.medium
}

export function priorityLabel(priority: string | null | undefined): string {
  return PRIORITY_LABEL[priority ?? 'medium'] ?? PRIORITY_LABEL.medium
}

export function isUrgentCooldown(ms: number | null | undefined): boolean {
  return typeof ms === 'number' && ms > 0 && ms < URGENT_COOLDOWN_MS
}

/** Ikon status cooldown: 🔴 kalau tinggal < 5 menit, selain itu ⏳. */
export function cooldownIcon(ms: number | null | undefined): string {
  return isUrgentCooldown(ms) ? '🔴' : '⏳'
}

/** Warna teks cooldown yang konsisten di semua view. */
export function cooldownColor(ms: number | null | undefined): string {
  return isUrgentCooldown(ms) ? '#CC0000' : 'var(--win95-cd)'
}
