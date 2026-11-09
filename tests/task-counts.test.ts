import { describe, expect, it } from 'vitest'
import { activeOnly, countDone, countForTab, isArchivedTask, tasksForTab, type CountableTask } from '@/lib/task-counts'

const t = (status: string, scheduleType: string): CountableTask => ({ status, scheduleType })

// Kasus nyata: 1 tugas harian siap, 1 harian menunggu, 1 tugas sekali sudah
// dikerjakan, 1 tugas sekali belum, 1 "mulai tanggal" sudah dikerjakan.
const pool: CountableTask[] = [
  t('siap', 'jam_tertentu'),
  t('cooldown', 'kustom'),
  t('selesai', 'sekali'),
  t('siap', 'sekali'),
  t('selesai', 'tanggal_spesifik'),
]

describe('isArchivedTask', () => {
  it('tugas sekali yang selesai adalah arsip', () => {
    expect(isArchivedTask(t('selesai', 'sekali'))).toBe(true)
  })

  it('tugas mulai-tanggal yang selesai adalah arsip', () => {
    expect(isArchivedTask(t('selesai', 'tanggal_spesifik'))).toBe(true)
  })

  it('tugas sekali yang belum dikerjakan bukan arsip', () => {
    expect(isArchivedTask(t('siap', 'sekali'))).toBe(false)
  })

  it('tugas berulang tidak pernah jadi arsip walau berstatus selesai', () => {
    for (const s of ['harian', 'mingguan', 'jam_tertentu', 'kustom']) {
      expect(isArchivedTask(t('selesai', s))).toBe(false)
    }
  })

  it('tugas menunggu bukan arsip', () => {
    expect(isArchivedTask(t('cooldown', 'sekali'))).toBe(false)
  })
})

describe('activeOnly', () => {
  it('membuang tugas sekali/mulai-tanggal yang sudah selesai', () => {
    expect(activeOnly(pool)).toHaveLength(3)
  })

  it('tidak mengubah array asal', () => {
    expect(pool).toHaveLength(5)
  })

  it('pool kosong tetap kosong', () => {
    expect(activeOnly([])).toEqual([])
  })
})

describe('tasksForTab', () => {
  it('tab Semua hanya berisi tugas aktif — arsip tidak ikut', () => {
    expect(tasksForTab(pool, 'all')).toHaveLength(3)
    expect(tasksForTab(pool, 'all').some(isArchivedTask)).toBe(false)
  })

  it('tab Siap hanya yang siap dan aktif', () => {
    expect(tasksForTab(pool, 'siap').map(x => x.status)).toEqual(['siap', 'siap'])
  })

  it('tab Menunggu hanya yang cooldown', () => {
    expect(tasksForTab(pool, 'cooldown')).toHaveLength(1)
  })

  it('tab Selesai tetap menampilkan arsip supaya riwayat tidak hilang', () => {
    expect(tasksForTab(pool, 'selesai')).toHaveLength(2)
    expect(tasksForTab(pool, 'selesai').every(isArchivedTask)).toBe(true)
  })
})

describe('countForTab', () => {
  it('angka tab Sama dengan jumlah isi tab — inti perbaikan bug "Semua (3)" padahal 2 kartu', () => {
    for (const tab of ['all', 'siap', 'cooldown', 'selesai'] as const) {
      expect(countForTab(pool, tab)).toBe(tasksForTab(pool, tab).length)
    }
  })

  it('hasilnya sama entah sedang di dalam proyek atau di semua proyek', () => {
    // Dulu angka "Semua" dihitung dari pool mentah saat difilter per proyek.
    const satuProyek = pool.filter(x => x.scheduleType === 'sekali' || x.scheduleType === 'jam_tertentu')
    expect(countForTab(satuProyek, 'all')).toBe(2)
    expect(tasksForTab(satuProyek, 'all')).toHaveLength(2)
  })

  it('pencarian diperlakukan sama untuk angka dan daftar', () => {
    const matches = (x: CountableTask) => x.scheduleType === 'sekali'
    expect(countForTab(pool, 'all', matches)).toBe(1)
    expect(countForTab(pool, 'selesai', matches)).toBe(1)
  })

  it('pool kosong menghasilkan nol di semua tab', () => {
    for (const tab of ['all', 'siap', 'cooldown', 'selesai'] as const) {
      expect(countForTab([], tab)).toBe(0)
    }
  })
})

describe('countDone', () => {
  it('menghitung semua yang selesai, termasuk arsip tugas sekali', () => {
    expect(countDone(pool)).toBe(2)
  })

  it('sama dengan isi tab Selesai supaya ringkasan tidak menulis 0', () => {
    expect(countDone(pool)).toBe(countForTab(pool, 'selesai'))
  })

  it('nol bila belum ada yang dikerjakan', () => {
    expect(countDone([t('siap', 'sekali'), t('cooldown', 'harian')])).toBe(0)
  })
})
