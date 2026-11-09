import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_TASK_DEFAULTS,
  canonicalJson,
  cloneTaskDefaults,
  emptyTaskForm,
  isTaskFormDirty,
  newTaskRequestId,
  readTaskDefaults,
  rememberTaskDefaults,
  taskDefaultsKey,
  taskFormSnapshot,
  type TaskFormDefaults,
  type TaskFormSnapshot,
} from '../src/lib/task-form'
import { NO_PROJECT_FILTER } from '../src/lib/task-view'

const daily: TaskFormDefaults = {
  scheduleType: 'jam_tertentu',
  scheduleConfig: { times: ['09:00', '21:00'] },
  priority: 'high',
}

function form(overrides: Partial<TaskFormSnapshot> = {}): TaskFormSnapshot {
  return { ...emptyTaskForm('proj-a', daily), ...overrides }
}

afterEach(() => vi.unstubAllGlobals())

describe('canonicalJson', () => {
  it('urutan key objek tidak dianggap berbeda', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
  })

  it('urutan array tetap bermakna', () => {
    expect(canonicalJson(['09:00', '21:00'])).not.toBe(canonicalJson(['21:00', '09:00']))
  })

  it('undefined di objek hilang seperti JSON.stringify; di array menjadi null', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}')
    expect(canonicalJson([undefined, 1])).toBe('[null,1]')
  })
})

describe('defaults per akun/proyek', () => {
  it('proyek berbeda tidak saling meminjam jadwal', () => {
    const store = new Map<string, TaskFormDefaults>()
    rememberTaskDefaults(store, 'u1', 'proj-a', daily)
    expect(readTaskDefaults(store, 'u1', 'proj-a')).toEqual(daily)
    expect(readTaskDefaults(store, 'u1', 'proj-b')).toEqual(EMPTY_TASK_DEFAULTS)
  })

  it('akun berbeda pada perangkat yang sama tidak saling meminjam jadwal', () => {
    const store = new Map<string, TaskFormDefaults>()
    rememberTaskDefaults(store, 'u1', 'proj-a', daily)
    expect(readTaskDefaults(store, 'u2', 'proj-a')).toEqual(EMPTY_TASK_DEFAULTS)
  })

  it('tugas mandiri (null/sentinel/kosong) memakai satu kunci yang sama', () => {
    const store = new Map<string, TaskFormDefaults>()
    rememberTaskDefaults(store, 'u1', NO_PROJECT_FILTER, daily)
    expect(taskDefaultsKey('u1', null)).toBe(taskDefaultsKey('u1', NO_PROJECT_FILTER))
    expect(readTaskDefaults(store, 'u1', null)).toEqual(daily)
    expect(readTaskDefaults(store, 'u1', '')).toEqual(daily)
  })

  it('kunci tidak bertabrakan walau id mengandung pemisah', () => {
    expect(taskDefaultsKey('a|b', 'c')).not.toBe(taskDefaultsKey('a', 'b|c'))
  })

  it('defaults yang dibaca/diingat adalah salinan, bukan objek bersama', () => {
    const store = new Map<string, TaskFormDefaults>()
    rememberTaskDefaults(store, 'u1', 'proj-a', daily)
    const read = readTaskDefaults(store, 'u1', 'proj-a')
    ;(read.scheduleConfig.times as string[]).push('23:00')
    expect(readTaskDefaults(store, 'u1', 'proj-a')).toEqual(daily)

    const source = cloneTaskDefaults(daily)
    rememberTaskDefaults(store, 'u1', 'proj-a', source)
    ;(source.scheduleConfig.times as string[]).push('23:00')
    expect(readTaskDefaults(store, 'u1', 'proj-a')).toEqual(daily)
  })

  it('menyimpan hanya jadwal/prioritas, bukan nama/link/deskripsi tugas', () => {
    const store = new Map<string, TaskFormDefaults>()
    rememberTaskDefaults(store, 'u1', 'proj-a', daily)
    expect(JSON.stringify([...store.values()])).not.toContain('name')
    expect(JSON.stringify([...store.values()])).not.toContain('link')
    expect(JSON.stringify([...store.values()])).not.toContain('description')
  })
})

describe('emptyTaskForm (simpan & tambah lagi)', () => {
  it('mengosongkan nama/link/deskripsi tetapi mempertahankan proyek/jadwal/prioritas', () => {
    const next = emptyTaskForm('proj-a', daily)
    expect(next.name).toBe('')
    expect(next.link).toBe('')
    expect(next.description).toBe('')
    expect(next.projectId).toBe('proj-a')
    expect(next.scheduleType).toBe(daily.scheduleType)
    expect(next.scheduleConfig).toEqual(daily.scheduleConfig)
    expect(next.priority).toBe('high')
  })

  it('sentinel tanpa proyek tidak pernah menjadi projectId', () => {
    expect(emptyTaskForm(NO_PROJECT_FILTER, daily).projectId).toBeNull()
  })

  it('config tugas berikutnya tidak berbagi referensi dengan defaults', () => {
    const next = emptyTaskForm('proj-a', daily)
    ;(next.scheduleConfig.times as string[]).push('23:00')
    expect(daily.scheduleConfig.times).toEqual(['09:00', '21:00'])
  })
})

describe('deteksi draft kotor', () => {
  it('form kosong sesuai baseline tidak minta konfirmasi buang', () => {
    const baseline = taskFormSnapshot(form())
    expect(isTaskFormDirty(form(), baseline)).toBe(false)
  })

  it('nama/link/deskripsi/jadwal/proyek/prioritas yang berubah dianggap kotor', () => {
    const baseline = taskFormSnapshot(form())
    expect(isTaskFormDirty(form({ name: 'Klaim' }), baseline)).toBe(true)
    expect(isTaskFormDirty(form({ link: 'https://example.com' }), baseline)).toBe(true)
    expect(isTaskFormDirty(form({ description: 'catatan' }), baseline)).toBe(true)
    expect(isTaskFormDirty(form({ scheduleType: 'sekali' }), baseline)).toBe(true)
    expect(isTaskFormDirty(form({ projectId: 'proj-b' }), baseline)).toBe(true)
    expect(isTaskFormDirty(form({ priority: 'low' }), baseline)).toBe(true)
  })

  it('urutan key config dan sentinel proyek tidak memicu konfirmasi palsu', () => {
    const baseline = taskFormSnapshot(form({ scheduleConfig: { a: 1, b: 2 }, projectId: null }))
    expect(isTaskFormDirty(form({ scheduleConfig: { b: 2, a: 1 }, projectId: NO_PROJECT_FILTER }), baseline)).toBe(false)
  })

  it('kembali persis ke isi semula bersih lagi', () => {
    const original = form({ name: 'Klaim' })
    const baseline = taskFormSnapshot(original)
    const edited = { ...original, name: 'Klaim lain' }
    expect(isTaskFormDirty(edited, baseline)).toBe(true)
    expect(isTaskFormDirty(original, baseline)).toBe(false)
  })
})

describe('newTaskRequestId', () => {
  it('memakai randomUUID bila tersedia dan unik antar tugas', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-4111-8111-111111111111' })
    expect(newTaskRequestId()).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('fallback getRandomValues menghasilkan UUID v4 yang valid', () => {
    let n = 0
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => { for (let i = 0; i < bytes.length; i++) bytes[i] = (n++ * 37) % 256; return bytes },
    })
    const a = newTaskRequestId()
    const b = newTaskRequestId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(b).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
})
