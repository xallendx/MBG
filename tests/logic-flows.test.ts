import { describe, expect, it } from 'vitest'
import { scheduleActuallyChanged } from '@/lib/schedule-change'
import { isNotificationCandidate } from '@/lib/notify-eligible'
import { refreshCachedTask, refreshCachedTasks } from '@/lib/task-cache'

describe('scheduleActuallyChanged — ganti nama tidak boleh mengirim ulang pengingat', () => {
  const existing = { scheduleType: 'jam_tertentu', scheduleConfig: '{"times":["09:00","21:00"]}' }

  it('body edit tanpa key jadwal dianggap tidak mengubah jadwal', () => {
    expect(scheduleActuallyChanged(existing, {})).toBe(false)
  })

  it('form edit mengirim jadwal yang sama persis → bukan perubahan', () => {
    expect(scheduleActuallyChanged(existing, {
      scheduleType: 'jam_tertentu', scheduleConfig: { times: ['09:00', '21:00'] },
    })).toBe(false)
  })

  it('urutan key berbeda tetap dianggap sama', () => {
    const lama = { scheduleType: 'mingguan', scheduleConfig: '{"dayOfWeek":1,"cooldownHours":168}' }
    expect(scheduleActuallyChanged(lama, {
      scheduleType: 'mingguan', scheduleConfig: { cooldownHours: 168, dayOfWeek: 1 },
    })).toBe(false)
  })

  it('jam diubah → perubahan nyata', () => {
    expect(scheduleActuallyChanged(existing, {
      scheduleType: 'jam_tertentu', scheduleConfig: { times: ['10:00'] },
    })).toBe(true)
  })

  it('tipe jadwal diubah → perubahan nyata', () => {
    expect(scheduleActuallyChanged(existing, { scheduleType: 'sekali', scheduleConfig: {} })).toBe(true)
  })

  it('config lama rusak tidak membuat setiap edit dianggap berubah', () => {
    expect(scheduleActuallyChanged({ scheduleType: 'sekali', scheduleConfig: 'bukan json' }, {
      scheduleType: 'sekali', scheduleConfig: {},
    })).toBe(false)
  })

  it('cooldown dipendekkan → perubahan nyata walau tipe sama', () => {
    expect(scheduleActuallyChanged({ scheduleType: 'kustom', scheduleConfig: '{"cooldownHours":24}' }, {
      scheduleConfig: { cooldownHours: 6 },
    })).toBe(true)
  })
})

describe('isNotificationCandidate — tugas terjadwal baru harus tetap diingatkan', () => {
  it('tugas sekali tidak perlu pengingat', () => {
    expect(isNotificationCandidate({ scheduleType: 'sekali', hasLogs: false }, false, 0)).toBe(false)
  })

  it('tugas harian baru yang masih menunggu jamnya ikut diperiksa', () => {
    expect(isNotificationCandidate({ scheduleType: 'jam_tertentu', hasLogs: false }, true, 55 * 60000)).toBe(true)
  })

  it('tugas mulai-tanggal yang belum pernah dikerjakan ikut diperiksa', () => {
    expect(isNotificationCandidate({ scheduleType: 'tanggal_spesifik', hasLogs: false }, true, 3 * 86400000)).toBe(true)
  })

  it('tugas baru yang sudah siap sejak awal dilewati supaya tidak memborbardir', () => {
    expect(isNotificationCandidate({ scheduleType: 'harian', hasLogs: false }, true, 0)).toBe(false)
    expect(isNotificationCandidate({ scheduleType: 'jam_tertentu', hasLogs: false }, true, -1000)).toBe(false)
  })

  it('tugas berpengalaman tetap diperiksa baik menunggu maupun sudah siap', () => {
    expect(isNotificationCandidate({ scheduleType: 'kustom', hasLogs: true }, true, 60000)).toBe(true)
    expect(isNotificationCandidate({ scheduleType: 'kustom', hasLogs: true }, true, 0)).toBe(true)
  })

  it('tanpa waktu siap berikutnya tidak ada yang diingatkan', () => {
    expect(isNotificationCandidate({ scheduleType: 'tanggal_spesifik', hasLogs: true }, false, 0)).toBe(false)
  })
})

describe('refreshCachedTask — cache tidak boleh menyuruh menunggu tugas yang sudah siap', () => {
  const now = Date.UTC(2026, 10, 9, 16, 0, 0)
  const base = { id: 't1', name: 'Klaim faucet' }

  it('cooldown yang waktunya sudah lewat menjadi siap', () => {
    const t = refreshCachedTask({
      ...base, status: 'cooldown', cooldownRemaining: '5j 0m', cooldownMs: 18000000,
      nextReadyAt: new Date(now - 3600000).toISOString(),
    }, now)
    expect(t.status).toBe('siap')
    expect(t.cooldownRemaining).toBe('')
    expect(t.cooldownMs).toBe(0)
  })

  it('cooldown yang masih lama tetap menunggu dengan sisa waktu yang benar', () => {
    const t = refreshCachedTask({
      ...base, status: 'cooldown', cooldownRemaining: '5j 0m', cooldownMs: 18000000,
      nextReadyAt: new Date(now + 2 * 3600000 + 15 * 60000).toISOString(),
    }, now)
    expect(t.status).toBe('cooldown')
    expect(t.cooldownRemaining).toBe('2j 15m')
    expect(t.cooldownMs).toBe(2 * 3600000 + 15 * 60000)
  })

  it('sisa di bawah satu menit tidak menampilkan teks kosong', () => {
    const t = refreshCachedTask({
      ...base, status: 'cooldown', cooldownRemaining: '1j 0m',
      nextReadyAt: new Date(now + 30000).toISOString(),
    }, now)
    expect(t.cooldownRemaining).toBe('kurang dari 1m')
    expect(t.status).toBe('cooldown')
  })

  it('cooldown tanpa waktu siap yang sah tidak bikin tugas terkunci', () => {
    for (const nextReadyAt of [null, 'bukan-tanggal']) {
      const t = refreshCachedTask({ ...base, status: 'cooldown', cooldownRemaining: '9j 9m', nextReadyAt }, now)
      expect(t.status).toBe('siap')
      expect(t.cooldownRemaining).toBe('')
    }
  })

  it('tugas siap tidak diturunkan jadi menunggu oleh cache', () => {
    const t = refreshCachedTask({
      ...base, status: 'siap', cooldownRemaining: '',
      nextReadyAt: new Date(now + 3600000).toISOString(),
    }, now)
    expect(t.status).toBe('siap')
  })

  it('tugas sekali yang sudah selesai tetap selesai', () => {
    const t = refreshCachedTask({ ...base, status: 'selesai', cooldownRemaining: '', nextReadyAt: null }, now)
    expect(t.status).toBe('selesai')
  })

  it('tidak mengubah objek asal dan memproses seluruh daftar', () => {
    const asal = [{ ...base, status: 'cooldown', cooldownRemaining: '5j 0m', nextReadyAt: new Date(now - 1).toISOString() }]
    const hasil = refreshCachedTasks(asal, now)
    expect(hasil[0].status).toBe('siap')
    expect(asal[0].status).toBe('cooldown')
  })
})
