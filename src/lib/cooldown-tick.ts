/**
 * Hitung ulang hitung-mundur cooldown tanpa memaksa layar menggambar ulang
 * setiap detik untuk nilai yang tidak terlihat berubah.
 *
 * KENAPA
 * ------
 * Ticker di layar dulu membandingkan `cooldownMs === ms`. Nilai milidetik
 * berubah setiap detik, jadi selama ada SATU tugas cooldown seluruh daftar
 * tugas ikut di-render ulang setiap detik — walau tulisannya tetap "5j 0m".
 * Di HP kelas menengah dengan banyak tugas itu terasa saat mengetik di kolom
 * cari atau menggulir daftar.
 *
 * Sekarang yang dibandingkan hanya teks yang benar-benar ditampilkan. Tugas
 * dengan jeda berjam-jam hanya menyegarkan tampilan sekali per menit; tugas
 * di bawah satu jam memang menampilkan detik, jadi tetap sekali per detik.
 *
 * Kalau tidak ada yang berubah, array yang sama dikembalikan (bukan salinan),
 * sehingga React melewati render sepenuhnya.
 */

export interface CooldownTaskLike {
  status: string
  nextReadyAt: string | null
  cooldownRemaining: string
  cooldownMs: number
}

/** Teks hitung-mundur; tingkat detailnya mengikuti yang ditampilkan di kartu. */
export function cooldownLabel(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  if (h >= 1) return `${h}j ${m}m`
  if (m >= 1) return `${m}m ${s}s`
  return `${s}s`
}

export function tickCooldowns<T extends CooldownTaskLike>(list: T[], now: number): T[] {
  let changed = false
  const next = list.map(t => {
    if (t.status !== 'cooldown') return t
    // Tanpa waktu siap yang sah, tugas tidak boleh terkunci selamanya sebagai
    // cooldown (data lama bisa punya nextReadyAt kosong/rusak).
    const ready = t.nextReadyAt ? new Date(t.nextReadyAt).getTime() : NaN
    if (!isFinite(ready)) {
      changed = true
      return { ...t, status: 'siap', cooldownRemaining: '', cooldownMs: 0 }
    }
    const ms = Math.max(0, ready - now)
    if (ms <= 0) {
      if (t.cooldownMs === 0 && t.cooldownRemaining === '') return t
      changed = true
      return { ...t, status: 'siap', cooldownRemaining: '', cooldownMs: 0 }
    }
    const text = cooldownLabel(ms)
    // Hanya teks yang jadi patokan: milidetik yang berubah tanpa mengubah
    // tulisan tidak perlu memicu render ulang seluruh daftar.
    if (t.cooldownRemaining === text) return t
    changed = true
    return { ...t, cooldownRemaining: text, cooldownMs: ms }
  })
  return changed ? next : list
}
