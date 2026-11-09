import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeStatus, getNextReadyAt, canReset, type ScheduleTask } from '../src/lib/schedule'

/**
 * Test untuk inti domain aplikasi: kapan sebuah task dianggap "siap".
 *
 * File ini adalah jaring pengaman untuk `src/lib/schedule.ts` — 194 baris logika
 * yang sebelumnya tidak punya satu pun test, padahal berisi komentar "BUG FIX"
 * berulang. Semua waktu dipalsukan dengan vi.setSystemTime supaya hasilnya
 * deterministik.
 */

const task = (
  scheduleType: string,
  config: Record<string, unknown> = {},
  logHoursAgo: number[] = []
): ScheduleTask => ({
  scheduleType,
  scheduleConfig: JSON.stringify(config),
  logs: logHoursAgo.map(h => ({ completedAt: new Date(Date.now() - h * 3600000) })),
})

// 2026-03-10 10:00 WITA (UTC+8) = 02:00 UTC
const NOW_WITA_MORNING = new Date('2026-03-10T02:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_WITA_MORNING)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sekali', () => {
  it('belum dikerjakan → siap', () => {
    expect(computeStatus(task('sekali'), 'WITA')).toBe('siap')
  })

  it('sudah dikerjakan → selesai (tidak pernah cooldown lagi)', () => {
    const t = task('sekali', {}, [1])
    expect(computeStatus(t, 'WITA')).toBe('selesai')
    expect(getNextReadyAt(t, 'WITA')).toBeNull()
  })
})

describe('harian / kustom (cooldown berbasis jam)', () => {
  it('tanpa log → siap sekarang', () => {
    expect(getNextReadyAt(task('harian', { cooldownHours: 24 }), 'WITA')?.getTime())
      .toBe(NOW_WITA_MORNING.getTime())
  })

  it('log 2 jam lalu dengan cooldown 24 jam → masih cooldown 22 jam', () => {
    const t = task('harian', { cooldownHours: 24 }, [2])
    expect(computeStatus(t, 'WITA')).toBe('cooldown')
    const ready = getNextReadyAt(t, 'WITA')!
    expect(ready.getTime() - Date.now()).toBe(22 * 3600000)
  })

  it('log 30 jam lalu dengan cooldown 24 jam → sudah siap', () => {
    expect(computeStatus(task('harian', { cooldownHours: 24 }, [30]), 'WITA')).toBe('siap')
  })

  it('cooldown default 24 jam kalau config kosong', () => {
    const ready = getNextReadyAt(task('harian', {}, [1]), 'WITA')!
    expect(ready.getTime() - Date.now()).toBe(23 * 3600000)
  })

  it('kustom memakai cooldownHours sendiri (48 jam)', () => {
    const ready = getNextReadyAt(task('kustom', { cooldownHours: 48 }, [1]), 'WITA')!
    expect(ready.getTime() - Date.now()).toBe(47 * 3600000)
  })

  it('config rusak (bukan JSON) tidak melempar error', () => {
    const broken: ScheduleTask = { scheduleType: 'harian', scheduleConfig: '{bukan json', logs: [] }
    expect(() => getNextReadyAt(broken, 'WITA')).not.toThrow()
    expect(getNextReadyAt(broken, 'WITA')).not.toBeNull()
  })
})

describe('jam_tertentu: siap sejak jam berjalan hingga dikerjakan', () => {
  it('10:00 WITA, belum selesai sejak 09:00 → siap', () => {
    expect(computeStatus(task('jam_tertentu', { times: ['09:00', '21:00'] }), 'WITA')).toBe('siap')
  })
  it('10:00 WITA, sudah selesai pada 09:30 → menunggu 21:00', () => {
    const t = task('jam_tertentu', { times: ['09:00', '21:00'] }, [0.5])
    expect(computeStatus(t, 'WITA')).toBe('cooldown')
    expect(getNextReadyAt(t, 'WITA')?.toISOString()).toBe('2026-03-10T13:00:00.000Z')
  })
  it('sesudah 21:00 belum selesai pada interval itu → siap', () => {
    vi.setSystemTime(new Date('2026-03-10T14:00:00.000Z'))
    expect(computeStatus(task('jam_tertentu', { times: ['09:00', '21:00'] }, [12]), 'WITA')).toBe('siap')
  })
  it('pukul 22:00 selesai pukul 21:30 → menunggu 09:00 besok', () => {
    vi.setSystemTime(new Date('2026-03-10T14:00:00.000Z'))
    expect(getNextReadyAt(task('jam_tertentu', { times: ['09:00', '21:00'] }, [0.5]), 'WITA')?.toISOString()).toBe('2026-03-11T01:00:00.000Z')
  })
  it('spasi pada daftar jam tidak mengubah hasil', () => {
    expect(getNextReadyAt(task('jam_tertentu', { times: ['09:00', ' 21:00'] }, [0.5]), 'WITA')?.toISOString()).toBe('2026-03-10T13:00:00.000Z')
  })
  it('tepat jam mulai → siap dan setelah selesai → cooldown', () => {
    vi.setSystemTime(new Date('2026-03-10T01:00:00.000Z'))
    const t = task('jam_tertentu', { times: ['09:00'] })
    expect(computeStatus(t, 'WITA')).toBe('siap')
    expect(computeStatus(task('jam_tertentu', { times: ['09:00'] }, [0]), 'WITA')).toBe('cooldown')
  })
  it('sebelum jam pertama, tugas belum pernah selesai → tunggu jam itu', () => {
    vi.setSystemTime(new Date('2026-03-10T00:00:00.000Z'))
    const t = task('jam_tertentu', { times: ['09:00'] })
    expect(getNextReadyAt(t, 'WIB')?.toISOString()).toBe('2026-03-10T02:00:00.000Z')
    expect(getNextReadyAt(t, 'WITA')?.toISOString()).toBe('2026-03-10T01:00:00.000Z')
  })
  it('sebelum jam pertama, jadwal kemarin yang terlewat tetap siap', () => {
    vi.setSystemTime(new Date('2026-03-10T00:00:00.000Z'))
    const t = { ...task('jam_tertentu', { times: ['09:00'] }), createdAt: new Date('2026-03-08T00:00:00.000Z') }
    expect(computeStatus(t, 'WITA')).toBe('siap')
  })
  it('jam kosong atau tidak valid tidak merusak aplikasi', () => {
    expect(computeStatus(task('jam_tertentu', { times: ['33:70'] }), 'WITA')).toBe('siap')
  })
})

describe('mingguan', () => {
  // 2026-03-10 adalah hari Selasa
  it('target hari ini (Selasa=2), belum dikerjakan → siap sekarang', () => {
    expect(computeStatus(task('mingguan', { dayOfWeek: 2, cooldownHours: 24 }), 'WITA')).toBe('siap')
  })

  it('target besok (Rabu=3) → cooldown sampai tengah malam berikutnya', () => {
    const ready = getNextReadyAt(task('mingguan', { dayOfWeek: 3, cooldownHours: 24 }), 'WITA')!
    // tengah malam Rabu WITA = 2026-03-10T16:00:00Z
    expect(ready.toISOString()).toBe('2026-03-10T16:00:00.000Z')
    expect(computeStatus(task('mingguan', { dayOfWeek: 3, cooldownHours: 24 }), 'WITA')).toBe('cooldown')
  })

  it('tetap siap jika jadwal minggu lalu belum pernah dikerjakan', () => {
    const t = { ...task('mingguan', { dayOfWeek: 3 }), createdAt: new Date('2026-03-01T00:00:00Z') }
    expect(computeStatus(t, 'WITA')).toBe('siap')
  })
  it('tetap siap setelah hari target berlalu sampai dikerjakan', () => {
    expect(computeStatus(task('mingguan', { dayOfWeek: 1 }), 'WITA')).toBe('siap')
  })

  it('tidak muncul ulang pada hari yang sama meski cooldown telah lewat', () => {
    expect(computeStatus(task('mingguan', { dayOfWeek: 2, cooldownHours: 1 }, [2]), 'WITA')).toBe('cooldown')
  })

  it('sudah dikerjakan < cooldown pada hari target → mundur seminggu', () => {
    const t = task('mingguan', { dayOfWeek: 2, cooldownHours: 24 }, [1])
    const ready = getNextReadyAt(t, 'WITA')!
    expect(ready.getTime()).toBeGreaterThan(Date.now() + 6 * 86400000)
  })

  // Regresi: dikerjakan tepat sebelum hari target tidak boleh kehilangan satu
  // minggu. Dulu hasilnya ditambah 7 hari penuh, bukan sekadar sisa jeda.
  it('dikerjakan Minggu 23:00 untuk target Senin → siap Senin 23:00, bukan dua minggu kemudian', () => {
    const sunday2300Wib = new Date('2026-03-15T16:00:00.000Z') // Minggu 23:00 WIB
    vi.setSystemTime(sunday2300Wib)
    const t: ScheduleTask = {
      scheduleType: 'mingguan',
      scheduleConfig: JSON.stringify({ dayOfWeek: 1, cooldownHours: 24 }),
      logs: [{ completedAt: sunday2300Wib }],
    }
    const ready = getNextReadyAt(t, 'WIB')!
    // Senin 23:00 WIB = 2026-03-16T16:00:00Z, tepat 24 jam kemudian.
    expect(ready.toISOString()).toBe('2026-03-16T16:00:00.000Z')
  })

  it('jeda mingguan maksimum (168 jam) tidak melompat dua minggu', () => {
    // Selasa 10:00 WITA adalah hari target; jeda 168 jam berakhir Selasa 10:00
    // pekan depan, sedangkan hari target berikutnya Selasa 00:00.
    const t = task('mingguan', { dayOfWeek: 2, cooldownHours: 168 }, [0])
    const ready = getNextReadyAt(t, 'WITA')!
    const jarakJam = (ready.getTime() - Date.now()) / 3600000
    expect(jarakJam).toBeCloseTo(168, 5)
  })

  it('jeda pendek tetap menunggu hari target, bukan tengah malam berikutnya saja', () => {
    const t = task('mingguan', { dayOfWeek: 2, cooldownHours: 2 }, [1])
    const ready = getNextReadyAt(t, 'WITA')!
    // Jeda sudah lewat, tapi hari target berikutnya masih pekan depan.
    expect(ready.getTime()).toBeGreaterThan(Date.now() + 6 * 86400000)
  })
})

describe('tanggal_spesifik', () => {
  it('tanggal di masa depan → cooldown sampai tanggal itu (00:00 waktu user)', () => {
    const t = task('tanggal_spesifik', { dates: ['2026-03-12'] })
    const ready = getNextReadyAt(t, 'WITA')!
    expect(ready.toISOString()).toBe('2026-03-11T16:00:00.000Z') // 00:00 WITA 12 Mar
    expect(computeStatus(t, 'WITA')).toBe('cooldown')
  })

  it('tanggal sudah lewat dan belum dikerjakan → siap sekarang', () => {
    expect(computeStatus(task('tanggal_spesifik', { dates: ['2026-03-01'] }), 'WITA')).toBe('siap')
  })

  it('tanggal lewat dan sudah dikerjakan → selesai', () => {
    expect(computeStatus(task('tanggal_spesifik', { dates: ['2026-03-01'] }, [1]), 'WITA')).toBe('selesai')
  })

  it('tetap selesai setelah dikerjakan meski ada tanggal lain di masa depan', () => {
    expect(computeStatus(task('tanggal_spesifik', { dates: ['2026-03-01', '2026-03-12'] }, [1]), 'WITA')).toBe('selesai')
  })

  it('siap sejak tanggal pertama walau ada tanggal lain di masa depan', () => {
    expect(computeStatus(task('tanggal_spesifik', { dates: ['2026-03-01', '2026-03-12'] }), 'WITA')).toBe('siap')
  })

  it('tidak bergantung pada timezone proses server (Date.UTC)', () => {
    // kalau implementasi memakai new Date(y,m,d), hasil ini bergeser 8 jam
    const ready = getNextReadyAt(task('tanggal_spesifik', { dates: ['2026-03-12'] }), 'WIB')!
    expect(ready.toISOString()).toBe('2026-03-11T17:00:00.000Z') // 00:00 WIB
  })
})

describe('timezone default & input kotor', () => {
  it('konversi timezone tetap benar saat pergantian bulan dan tahun', () => {
    vi.setSystemTime(new Date('2026-12-31T18:00:00.000Z')) // 1 Jan 02.00 WITA
    const t = task('jam_tertentu', { times: ['09:00'] })
    expect(getNextReadyAt(t, 'WITA')?.toISOString()).toBe('2027-01-01T01:00:00.000Z')
    const dateTask = task('tanggal_spesifik', { dates: ['2027-01-02'] })
    expect(getNextReadyAt(dateTask, 'WITA')?.toISOString()).toBe('2027-01-01T16:00:00.000Z')
  })
  it('timezone tidak dikenal jatuh ke Asia/Jakarta (WIB)', () => {
    vi.setSystemTime(new Date('2026-03-10T00:00:00.000Z'))
    const a = getNextReadyAt(task('jam_tertentu', { times: ['09:00'] }), 'XX')!
    const b = getNextReadyAt(task('jam_tertentu', { times: ['09:00'] }), 'WIB')!
    expect(a.toISOString()).toBe(b.toISOString())
  })

  it('log dengan tanggal rusak diabaikan', () => {
    const t: ScheduleTask = {
      scheduleType: 'harian',
      scheduleConfig: JSON.stringify({ cooldownHours: 24 }),
      logs: [{ completedAt: new Date('invalid') }],
    }
    expect(getNextReadyAt(t, 'WITA')?.getTime()).toBe(NOW_WITA_MORNING.getTime())
  })
})

describe('canReset', () => {
  it('task berulang boleh direset', () => {
    expect(canReset('harian')).toBe(true)
    expect(canReset('mingguan')).toBe(true)
    expect(canReset('kustom')).toBe(true)
  })

  it('task sekali & tanggal spesifik tidak boleh direset', () => {
    expect(canReset('sekali')).toBe(false)
    expect(canReset('tanggal_spesifik')).toBe(false)
  })
})
