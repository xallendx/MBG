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

/** Nilai filter sidebar untuk tugas tanpa proyek (bukan id proyek asli). */
export const NO_PROJECT_FILTER = '__no_project__'

/**
 * Proyek awal saat menambah tugas dari filter yang sedang aktif.
 * Sentinel "tanpa proyek", kosong, dan null semuanya berarti tugas mandiri —
 * jangan pernah dikirim ke API sebagai projectId.
 */
export function projectIdForNewTask(filter: string | null | undefined): string | null {
  if (!filter || filter === NO_PROJECT_FILTER) return null
  return filter
}

/**
 * Filter proyek setelah tugas baru disimpan.
 * - Tugas masuk proyek → fokus ke proyek itu (tambah dari menu proyek di HP
 *   tidak melempar pengguna kembali ke "semua tugas").
 * - Tugas mandiri → pertahankan filter HANYA kalau sedang memfilter
 *   "Tanpa proyek"; selain itu bersihkan supaya tugas barunya terlihat.
 */
export function projectFilterAfterAdd(
  filter: string | null | undefined,
  savedProjectId: string | null | undefined,
): string | null {
  const pid = projectIdForNewTask(savedProjectId)
  if (pid) return pid
  return filter === NO_PROJECT_FILTER ? NO_PROJECT_FILTER : null
}
