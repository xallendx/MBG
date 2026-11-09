/**
 * Aturan tampilan kartu tugas.
 *
 * Daftar tugas dulu berupa baris tabel selebar layar: nama di ujung kiri,
 * tombol di ujung kanan, sehingga dengan 1-5 tugas mata harus menyeberang
 * seluruh layar dan sisanya ruang kosong. Sekarang tiap tugas jadi kartu
 * selebar tetap yang mengalir ke samping.
 *
 * Keputusan "tombol mana yang utama" dipindah ke sini supaya bisa diuji tanpa
 * browser — dulu aturan ini tertulis inline di JSX dan sulit dikunci.
 * Perilaku aksi sendiri TIDAK berubah: kartu memakai handler yang sama dengan
 * baris lama (buka link, selesai, detail).
 */
import { isSafeHttpUrl } from './safe-url'

export type TaskCardStatus = 'siap' | 'cooldown' | 'selesai'

export interface TaskCardInput {
  status: TaskCardStatus
  link: string | null
  cooldownRemaining: string
}

export type TaskCardPrimary = 'open-link' | 'complete' | 'detail'

export interface TaskCardActions {
  primary: TaskCardPrimary
  primaryLabel: string
  /** Tombol "✓ Selesai" kecil di bawah tombol utama. */
  showComplete: boolean
  /** Tombol buka link untuk tugas yang belum siap (tidak menyelesaikan). */
  showLink: boolean
}

/**
 * Satu aksi utama per kartu.
 * - Siap + link aman → buka link (label mengikuti setelan auto-selesai).
 * - Siap tanpa link → langsung selesai.
 * - Belum siap / sudah selesai → lihat detail; link tetap bisa dibuka lewat
 *   tombol kecil supaya fungsi lama tidak hilang.
 */
export function taskCardActions(task: TaskCardInput, autoCompleteLink: boolean): TaskCardActions {
  const hasLink = isSafeHttpUrl(task.link)

  if (task.status === 'siap') {
    if (hasLink) {
      return {
        primary: 'open-link',
        primaryLabel: autoCompleteLink ? 'Buka + selesai' : 'Buka link ↗',
        // Kalau link sudah otomatis menyelesaikan, tombol kedua cuma menggoda
        // salah tekan.
        showComplete: !autoCompleteLink,
        showLink: false,
      }
    }
    return { primary: 'complete', primaryLabel: '✓ Selesai', showComplete: false, showLink: false }
  }

  return { primary: 'detail', primaryLabel: 'Lihat detail', showComplete: false, showLink: hasLink }
}

export interface TaskCardStatusText {
  text: string
  tone: 'siap' | 'cd' | 'done'
}

export function taskCardStatusText(task: TaskCardInput): TaskCardStatusText {
  if (task.status === 'siap') return { text: 'Siap sekarang', tone: 'siap' }
  if (task.status === 'cooldown') return { text: task.cooldownRemaining?.trim() || 'Menunggu', tone: 'cd' }
  return { text: 'Selesai', tone: 'done' }
}

/**
 * Chip nama proyek hanya berguna saat melihat gabungan beberapa proyek.
 * Di dalam satu proyek (atau filter "Tanpa proyek") chip itu mengulang
 * informasi yang sudah jelas dan memakan baris kartu.
 */
export function showProjectOnCard(projectFilter: string | null | undefined): boolean {
  return !projectFilter
}
