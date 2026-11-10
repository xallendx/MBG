import { describe, expect, it } from 'vitest'
import { cooldownLabel, tickCooldowns, type CooldownTaskLike } from '../src/lib/cooldown-tick'

const NOW = Date.parse('2026-11-08T10:00:00.000Z')
const task = (over: Partial<CooldownTaskLike> = {}): CooldownTaskLike => ({
  status: 'cooldown',
  // Sengaja di tengah menit: beberapa detik berlalu tidak mengubah tulisan
  // "5j 0m", jadi tidak boleh ada render ulang.
  nextReadyAt: new Date(NOW + 5 * 3600_000 + 30_000).toISOString(),
  cooldownRemaining: '5j 0m',
  cooldownMs: 5 * 3600_000 + 30_000,
  ...over,
})

describe('tickCooldowns — jangan gambar ulang daftar kalau tulisannya tetap', () => {
  it('jeda berjam-jam: satu detik berlalu tidak mengubah array sama sekali', () => {
    const list = [task()]
    // Tulisan masih "5j 0m" beberapa detik kemudian → tidak ada render ulang.
    expect(tickCooldowns(list, NOW + 1000)).toBe(list)
    expect(tickCooldowns(list, NOW + 20_000)).toBe(list)
  })

  it('jeda berjam-jam: begitu menitnya berubah, teks dan milidetik ikut baru', () => {
    const list = [task()]
    const next = tickCooldowns(list, NOW + 60_000)
    expect(next).not.toBe(list)
    expect(next[0].cooldownRemaining).toBe('4j 59m')
    expect(next[0].cooldownMs).toBe(4 * 3600_000 + 59 * 60_000 + 30_000)
  })

  it('di bawah satu jam detik memang ditampilkan, jadi diperbarui tiap detik', () => {
    const list = [task({ nextReadyAt: new Date(NOW + 70_000).toISOString(), cooldownRemaining: '1m 10s', cooldownMs: 70_000 })]
    const next = tickCooldowns(list, NOW + 1000)
    expect(next).not.toBe(list)
    expect(next[0].cooldownRemaining).toBe('1m 9s')
  })

  it('tugas siap dan selesai tidak disentuh (objek yang sama)', () => {
    const siap = task({ status: 'siap', nextReadyAt: null, cooldownRemaining: '', cooldownMs: 0 })
    const selesai = task({ status: 'selesai', nextReadyAt: null, cooldownRemaining: '', cooldownMs: 0 })
    const list = [siap, selesai]
    expect(tickCooldowns(list, NOW)).toBe(list)
    expect(tickCooldowns(list, NOW)[0]).toBe(siap)
  })

  it('hanya tugas yang berubah mendapat objek baru; yang lain tetap sama', () => {
    const tetap = task()
    const berubah = task({ nextReadyAt: new Date(NOW + 70_000).toISOString(), cooldownRemaining: '1m 10s', cooldownMs: 70_000 })
    const next = tickCooldowns([tetap, berubah], NOW + 1000)
    expect(next[0]).toBe(tetap)
    expect(next[1]).not.toBe(berubah)
  })

  it('jeda habis → tugas menjadi siap dan hitung-mundur dikosongkan', () => {
    const list = [task({ nextReadyAt: new Date(NOW - 1000).toISOString() })]
    const next = tickCooldowns(list, NOW)
    expect(next[0].status).toBe('siap')
    expect(next[0].cooldownRemaining).toBe('')
    expect(next[0].cooldownMs).toBe(0)
  })

  it('waktu siap rusak/kosong tidak mengunci tugas sebagai cooldown selamanya', () => {
    for (const nextReadyAt of [null, '', 'bukan-tanggal']) {
      const next = tickCooldowns([task({ nextReadyAt })], NOW)
      expect(next[0].status).toBe('siap')
      expect(next[0].cooldownMs).toBe(0)
    }
  })

  it('daftar kosong tetap daftar kosong yang sama', () => {
    const list: CooldownTaskLike[] = []
    expect(tickCooldowns(list, NOW)).toBe(list)
  })
})

describe('cooldownLabel — bentuk teks yang dipakai kartu', () => {
  it('jam + menit di atas satu jam', () => { expect(cooldownLabel(5 * 3600_000 + 12 * 60_000)).toBe('5j 12m') })
  it('menit + detik di bawah satu jam', () => { expect(cooldownLabel(61_000)).toBe('1m 1s') })
  it('detik saja di bawah satu menit', () => { expect(cooldownLabel(5_000)).toBe('5s') })
})
