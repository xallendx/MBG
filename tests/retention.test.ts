import { describe, expect, it } from 'vitest'
import { DEFAULT_TASKLOG_RETENTION_DAYS, taskLogCutoff } from '../src/lib/retention'

/**
 * Retensi TaskLog: dulu tabel ini tumbuh tanpa batas karena tidak ada satu pun
 * kode yang menghapus riwayat penyelesaian. Fungsi cutoff dibuat murni supaya
 * batas waktunya bisa diuji tanpa menyentuh database.
 */

describe('taskLogCutoff', () => {
  it('memakai default 2 tahun', () => {
    expect(DEFAULT_TASKLOG_RETENTION_DAYS).toBe(730)
  })

  it('menghitung cutoff mundur sesuai jumlah hari', () => {
    const now = new Date('2026-11-08T00:00:00.000Z')
    const cutoff = taskLogCutoff(30, now)
    expect(cutoff.toISOString()).toBe('2026-10-09T00:00:00.000Z')
  })

  it('cutoff default = 730 hari ke belakang', () => {
    const now = new Date('2026-11-08T00:00:00.000Z')
    const cutoff = taskLogCutoff(undefined, now)
    expect(cutoff.getTime()).toBe(now.getTime() - 730 * 86400000)
  })

  it('nilai tidak masuk akal jatuh ke default, bukan menghapus semua data', () => {
    const now = new Date('2026-11-08T00:00:00.000Z')
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const cutoff = taskLogCutoff(bad as number, now)
      expect(cutoff.getTime()).toBe(now.getTime() - DEFAULT_TASKLOG_RETENTION_DAYS * 86400000)
    }
  })

  it('membulatkan pecahan hari ke bawah', () => {
    const now = new Date('2026-11-08T00:00:00.000Z')
    expect(taskLogCutoff(1.9, now).getTime()).toBe(now.getTime() - 1 * 86400000)
  })
})
