import { describe, expect, it } from 'vitest'
import { cooldownText, taskFromApi, upsertTask, type ViewTaskLike } from '../src/lib/task-from-api'

/** Balasan POST /api/tasks: bentuk Prisma, belum ada status/cooldown. */
const rawCreated = (over: Record<string, unknown> = {}) => ({
  id: 't-new',
  name: 'Tugas baru',
  description: null,
  link: 'https://example.com',
  scheduleType: 'sekali',
  scheduleConfig: '{}',
  notes: null,
  pinned: false,
  priority: 'medium',
  position: 9,
  projectId: null,
  project: null,
  createdAt: '2026-11-08T02:00:00.000Z',
  updatedAt: '2026-11-08T02:00:00.000Z',
  ...over,
})

const previous = (over: Partial<ViewTaskLike> = {}): ViewTaskLike => ({
  id: 't-new', name: 'Nama lama', description: 'deskripsi lama', link: null,
  scheduleType: 'sekali', scheduleConfig: '{}', notes: 'catatan lama', pinned: true,
  priority: 'high', status: 'siap', nextReadyAt: null, lastCompletedAt: null,
  cooldownRemaining: '', cooldownMs: 0, project: null,
  createdAt: '2026-11-01T00:00:00.000Z', logCount: 0, ...over,
})

describe('taskFromApi — hasil simpan langsung dipakai tanpa menunggu /api/init', () => {
  it('tugas sekali yang baru dibuat langsung siap, tanpa cooldown dan tanpa log', () => {
    const t = taskFromApi(rawCreated(), { now: Date.parse('2026-11-08T03:00:00Z') })
    expect(t).not.toBeNull()
    expect(t!.id).toBe('t-new')
    expect(t!.status).toBe('siap')
    expect(t!.cooldownMs).toBe(0)
    expect(t!.cooldownRemaining).toBe('')
    expect(t!.logCount).toBe(0)
    expect(t!.nextReadyAt).toBeNull()
  })

  it('link dan proyek dari balasan dipakai apa adanya', () => {
    const t = taskFromApi(rawCreated({ project: { id: 'p1', name: 'Harian', color: '#000080' } }))
    expect(t!.link).toBe('https://example.com')
    expect(t!.project).toEqual({ id: 'p1', name: 'Harian', color: '#000080' })
  })

  it('scheduleConfig objek diubah jadi string seperti kolom database', () => {
    const t = taskFromApi(rawCreated({ scheduleType: 'kustom', scheduleConfig: { cooldownHours: 6 } }))
    expect(t!.scheduleConfig).toBe('{"cooldownHours":6}')
  })

  it('jam_tertentu yang slotnya sudah lewat hari ini tetap siap (sama seperti server)', () => {
    // 2026-11-08 03:00 UTC = 10:00 WIB; slot 09:00 WIB sudah lewat.
    const t = taskFromApi(
      rawCreated({ scheduleType: 'jam_tertentu', scheduleConfig: '{"times":["09:00"]}', createdAt: '2026-11-07T00:00:00.000Z' }),
      { timezone: 'WIB', now: Date.parse('2026-11-08T03:00:00Z') },
    )
    expect(t!.status).toBe('siap')
  })

  it('tanggal_spesifik yang belum tiba dihitung cooldown, bukan siap', () => {
    const t = taskFromApi(
      rawCreated({ scheduleType: 'tanggal_spesifik', scheduleConfig: '{"dates":["2026-12-01"]}' }),
      { timezone: 'WIB', now: Date.parse('2026-11-08T03:00:00Z') },
    )
    expect(t!.status).toBe('cooldown')
    expect(t!.cooldownMs).toBeGreaterThan(0)
    expect(t!.cooldownRemaining).not.toBe('')
  })

  it('saat edit: kolom yang tidak dikirim server diambil dari tugas lama', () => {
    const prev = previous({ lastCompletedAt: '2026-11-07T00:00:00.000Z', logCount: 4, notes: 'catatan lama' })
    const t = taskFromApi(rawCreated({ name: 'Nama baru', notes: undefined }), { previous: prev })
    expect(t!.name).toBe('Nama baru')
    expect(t!.notes).toBe('catatan lama')
    expect(t!.logCount).toBe(4)
    expect(t!.lastCompletedAt).toBe('2026-11-07T00:00:00.000Z')
  })

  it('pindah ke tanpa proyek dihormati, bukan memakai proyek lama', () => {
    const prev = previous({ project: { id: 'p1', name: 'Harian', color: '#000080' } })
    const t = taskFromApi(rawCreated({ project: null }), { previous: prev })
    expect(t!.project).toBeNull()
  })

  it('balasan yang sudah punya status (complete/undo/reset) dipercaya bulat-bulat', () => {
    const next = new Date(Date.now() + 3600_000).toISOString()
    const t = taskFromApi(rawCreated({ status: 'cooldown', nextReadyAt: next, logCount: 2 }))
    expect(t!.status).toBe('cooldown')
    expect(t!.nextReadyAt).toBe(next)
    expect(t!.logCount).toBe(2)
    expect(t!.cooldownMs).toBeGreaterThan(3500_000)
  })

  it('status tak dikenal tidak dipercaya; dihitung ulang dari jadwal', () => {
    const t = taskFromApi(rawCreated({ status: 'ngawur' }))
    expect(t!.status).toBe('siap')
  })

  it('balasan rusak/ kosong menghasilkan null supaya pemanggil tetap sinkron biasa', () => {
    expect(taskFromApi(null)).toBeNull()
    expect(taskFromApi(undefined)).toBeNull()
    expect(taskFromApi({ name: 'tanpa id' })).toBeNull()
    expect(taskFromApi({ id: 'x', name: 42 })).toBeNull()
  })

  it('createdAt rusak diganti waktu sekarang, bukan string_INVALID', () => {
    const now = Date.parse('2026-11-08T03:00:00Z')
    const t = taskFromApi(rawCreated({ createdAt: 'bukan-tanggal' }), { now })
    expect(t!.createdAt).toBe(new Date(now).toISOString())
  })
})

describe('upsertTask — retry idempoten tidak menggandakan kartu', () => {
  const a = { id: 'a', name: 'A' }
  const b = { id: 'b', name: 'B' }

  it('tugas baru ditaruh di atas supaya langsung terlihat', () => {
    expect(upsertTask([a], b, true)).toEqual([b, a])
  })

  it('id yang sama diperbarui di tempat, bukan ditambah', () => {
    const hasil = upsertTask([a, b], { id: 'a', name: 'A baru' }, true)
    expect(hasil).toHaveLength(2)
    expect(hasil[0]).toEqual({ id: 'a', name: 'A baru' })
  })

  it('balasan 200 untuk tugas yang sudah tampil tidak membuat duplikat', () => {
    const list = upsertTask([a], a, true)
    expect(upsertTask(list, a, true)).toHaveLength(1)
  })

  it('tanpa atTop, tugas baru masuk di akhir (urutan posisi server)', () => {
    expect(upsertTask([a], b)).toEqual([a, b])
  })
})

describe('cooldownText — sama dengan ticker di layar supaya tidak berkedip', () => {
  it('di atas satu jam memakai jam+menit', () => { expect(cooldownText(5 * 3600_000 + 12 * 60_000)).toBe('5j 12m') })
  it('di bawah satu jam memakai menit+detik', () => { expect(cooldownText(70_000)).toBe('1m 10s') })
  it('di bawah satu menit memakai detik', () => { expect(cooldownText(9_000)).toBe('9s') })
  it('nol atau negatif berarti tidak ada cooldown', () => { expect(cooldownText(0)).toBe(''); expect(cooldownText(-5)).toBe('') })
})
