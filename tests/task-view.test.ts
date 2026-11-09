import { describe, expect, it } from 'vitest'
import {
  URGENT_COOLDOWN_MS,
  cooldownColor,
  cooldownIcon,
  isUrgentCooldown,
  priorityDot,
  priorityLabel,
  scheduleLabel,
} from '../src/lib/task-view'

/**
 * Aturan tampilan task. Dulu aturan ini ditulis ulang di tiga tempat di
 * `page.tsx` (tree, dashboard, dialog detail) sehingga bisa berbeda diam-diam —
 * sekarang dikunci lewat test supaya ketiga view pasti tampil sama.
 */

describe('scheduleLabel', () => {
  it('menerjemahkan tipe jadwal yang dikenal', () => {
    expect(scheduleLabel('harian')).toBe('Setelah jeda')
    expect(scheduleLabel('tanggal_spesifik')).toBe('Mulai tanggal')
    expect(scheduleLabel('kustom')).toBe('Setelah jeda')
  })

  it('tipe tak dikenal ditampilkan apa adanya (bukan kosong)', () => {
    expect(scheduleLabel('mingguan_baru')).toBe('mingguan_baru')
  })

  it('null → tanda hubung', () => {
    expect(scheduleLabel(null)).toBe('-')
    expect(scheduleLabel(undefined)).toBe('-')
  })
})

describe('priority', () => {
  it('warna & label sesuai prioritas', () => {
    expect(priorityDot('high')).toBe('#CC0000')
    expect(priorityLabel('high')).toContain('Tinggi')
    expect(priorityDot('low')).toBe('#228B22')
  })

  it('prioritas kosong/tak dikenal jatuh ke medium', () => {
    expect(priorityDot(undefined)).toBe(priorityDot('medium'))
    expect(priorityDot('urgent')).toBe(priorityDot('medium'))
    expect(priorityLabel(null)).toBe(priorityLabel('medium'))
  })
})

describe('cooldown', () => {
  it('di bawah 5 menit dianggap mendesak', () => {
    expect(isUrgentCooldown(4 * 60 * 1000)).toBe(true)
    expect(cooldownIcon(4 * 60 * 1000)).toBe('🔴')
    expect(cooldownColor(4 * 60 * 1000)).toBe('#CC0000')
  })

  it('5 menit atau lebih memakai gaya normal', () => {
    expect(isUrgentCooldown(URGENT_COOLDOWN_MS)).toBe(false)
    expect(cooldownIcon(URGENT_COOLDOWN_MS)).toBe('⏳')
    expect(cooldownColor(URGENT_COOLDOWN_MS)).toBe('var(--win95-cd)')
  })

  it('cooldown 0 / negatif / kosong tidak dianggap mendesak', () => {
    expect(isUrgentCooldown(0)).toBe(false)
    expect(isUrgentCooldown(-1)).toBe(false)
    expect(isUrgentCooldown(null)).toBe(false)
    expect(cooldownIcon(undefined)).toBe('⏳')
  })
})

import { NO_PROJECT_FILTER, projectFilterAfterAdd, projectIdForNewTask } from '../src/lib/task-view'

/**
 * "Tambah tugas pada proyek": tombol + Tugas Baru mengikuti filter proyek yang
 * aktif, dan filter tidak boleh membuang tugas yang baru dibuat dari layar.
 * Dulu tambah tugas selalu tanpa proyek dan filter selalu di-reset — pengguna
 * kehilangan konteks proyeknya setiap kali menyimpan.
 */
describe('projectIdForNewTask', () => {
  it('filter proyek asli diteruskan sebagai tujuan tugas', () => {
    expect(projectIdForNewTask('proj-123')).toBe('proj-123')
  })

  it('tanpa filter / filter sentinel / kosong → tugas mandiri (null)', () => {
    expect(projectIdForNewTask(null)).toBeNull()
    expect(projectIdForNewTask(undefined)).toBeNull()
    expect(projectIdForNewTask('')).toBeNull()
    expect(projectIdForNewTask(NO_PROJECT_FILTER)).toBeNull()
  })

  it('sentinel tidak pernah bocor sebagai projectId ke API', () => {
    expect(projectIdForNewTask('__no_project__')).not.toBe('__no_project__')
  })
})

describe('projectFilterAfterAdd', () => {
  it('tugas masuk ke proyek yang sedang difilter → filter dipertahankan', () => {
    expect(projectFilterAfterAdd('proj-1', 'proj-1')).toBe('proj-1')
  })

  it('tugas tanpa proyek saat memfilter "Tanpa proyek" → filter dipertahankan', () => {
    expect(projectFilterAfterAdd(NO_PROJECT_FILTER, null)).toBe(NO_PROJECT_FILTER)
    expect(projectFilterAfterAdd(NO_PROJECT_FILTER, undefined)).toBe(NO_PROJECT_FILTER)
  })

  it('tugas masuk proyek lain → fokus pindah ke proyek tugas itu (tugas tetap terlihat)', () => {
    expect(projectFilterAfterAdd('proj-1', 'proj-2')).toBe('proj-2')
    expect(projectFilterAfterAdd(NO_PROJECT_FILTER, 'proj-1')).toBe('proj-1')
  })

  it('tugas mandiri saat memfilter proyek → filter dibersihkan supaya tugas terlihat', () => {
    expect(projectFilterAfterAdd('proj-1', null)).toBeNull()
    expect(projectFilterAfterAdd('proj-1', NO_PROJECT_FILTER)).toBeNull()
  })

  it('tanpa filter aktif → tugas berproyek memfokuskan proyeknya, tugas mandiri tetap tanpa filter', () => {
    expect(projectFilterAfterAdd(null, 'proj-1')).toBe('proj-1')
    expect(projectFilterAfterAdd(null, null)).toBeNull()
    expect(projectFilterAfterAdd(undefined, 'proj-1')).toBe('proj-1')
  })
})
