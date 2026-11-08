/** Validasi konfigurasi jadwal saat dibuat atau diubah. */
export function scheduleInputError(type: string, config: Record<string, unknown>): string | null {
  if (type === 'jam_tertentu') {
    const times = Array.isArray(config.times) ? config.times.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean) : []
    if (!times.length || times.some(t => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))) return 'Masukkan minimal satu jam valid (contoh 09:00, 21:00).'
  }
  if (type === 'tanggal_spesifik') {
    const dates = Array.isArray(config.dates) ? config.dates.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean) : []
    const valid = (s: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
      const [y,m,d] = s.split('-').map(Number); const date = new Date(Date.UTC(y,m-1,d))
      return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d
    }
    if (!dates.length || dates.some(d => !valid(d))) return 'Masukkan tanggal mulai yang valid (contoh 2026-12-15).'
  }
  if (type === 'harian' || type === 'kustom' || type === 'mingguan') {
    const h = config.cooldownHours === undefined ? 24 : Number(config.cooldownHours)
    const max = type === 'kustom' ? 8760 : 168
    if (!Number.isInteger(h) || h < 1 || h > max) return `Waktu tunggu harus antara 1 dan ${max} jam.`
    if (type === 'mingguan' && config.dayOfWeek !== undefined && (!Number.isInteger(config.dayOfWeek) || Number(config.dayOfWeek) < 0 || Number(config.dayOfWeek) > 6)) return 'Pilih hari yang valid.'
  }
  return null
}
