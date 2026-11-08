import { describe, it, expect } from 'vitest'
import { scheduleInputError } from '../src/lib/schedule-input'
describe('scheduleInputError', () => {
  it('menerima jam valid dan menolak jam kosong atau tidak valid', () => {
    expect(scheduleInputError('jam_tertentu', {times:['09:00',' 21:00']})).toBeNull()
    expect(scheduleInputError('jam_tertentu', {})).toBeTruthy()
    expect(scheduleInputError('jam_tertentu', {times:['24:01']})).toBeTruthy()
  })
  it('memvalidasi tanggal kalender termasuk tanggal kabisat', () => {
    expect(scheduleInputError('tanggal_spesifik',{dates:['2028-02-29']})).toBeNull()
    expect(scheduleInputError('tanggal_spesifik',{dates:['2026-02-29']})).toBeTruthy()
    expect(scheduleInputError('tanggal_spesifik',{})).toBeTruthy()
  })
  it('memvalidasi jeda dan hari', () => {
    expect(scheduleInputError('harian',{})).toBeNull()
    expect(scheduleInputError('harian',{cooldownHours:0})).toBeTruthy()
    expect(scheduleInputError('kustom',{cooldownHours:48})).toBeNull()
    expect(scheduleInputError('mingguan',{dayOfWeek:8})).toBeTruthy()
  })
})
