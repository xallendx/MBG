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
