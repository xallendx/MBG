import { describe, expect, it } from 'vitest'
import { matchesCreatedTask, taskRequestId, type TaskCreatePayload } from '../src/lib/task-create-request'

const payload: TaskCreatePayload = {
  name: 'Klaim faucet',
  description: null,
  link: 'https://example.com',
  notes: null,
  scheduleType: 'jam_tertentu',
  scheduleConfig: { times: ['09:00', '21:00'] },
  projectId: 'proj-a',
  pinned: false,
  priority: 'high',
}

function stored(overrides: Partial<Omit<TaskCreatePayload, 'scheduleConfig'> & { scheduleConfig: string }> = {}) {
  return { ...payload, scheduleConfig: JSON.stringify(payload.scheduleConfig), ...overrides }
}

describe('taskRequestId', () => {
  it('deterministik untuk user + kunci yang sama', () => {
    const key = '11111111-1111-4111-8111-111111111111'
    expect(taskRequestId('u1', key)).toBe(taskRequestId('u1', key))
  })

  it('terikat pada user: kunci sama milik user lain tidak menghasilkan id sama', () => {
    const key = '11111111-1111-4111-8111-111111111111'
    expect(taskRequestId('u1', key)).not.toBe(taskRequestId('u2', key))
  })

  it('kunci berbeda menghasilkan id berbeda', () => {
    expect(taskRequestId('u1', '11111111-1111-4111-8111-111111111111'))
      .not.toBe(taskRequestId('u1', '22222222-2222-4222-8222-222222222222'))
  })

  it('panjang id aman untuk kolom String tanpa migration', () => {
    const id = taskRequestId('u1', '11111111-1111-4111-8111-111111111111')
    expect(id).toMatch(/^req_[0-9a-f]{40}$/)
    expect(id.length).toBeLessThanOrEqual(64)
  })
})

describe('matchesCreatedTask', () => {
  it('retry dengan isi identik dianggap tugas yang sama', () => {
    expect(matchesCreatedTask(stored(), payload)).toBe(true)
  })

  it('urutan key scheduleConfig tidak dianggap perubahan', () => {
    expect(matchesCreatedTask(stored({ scheduleConfig: '{"b":2,"a":1}' }), { ...payload, scheduleConfig: { a: 1, b: 2 } })).toBe(true)
  })

  it('urutan jam tetap bermakna', () => {
    expect(matchesCreatedTask(stored(), { ...payload, scheduleConfig: { times: ['21:00', '09:00'] } })).toBe(false)
  })

  it.each([
    ['name', { name: 'Nama lain' }],
    ['description', { description: 'catatan' }],
    ['link', { link: 'https://example.org' }],
    ['notes', { notes: 'notes' }],
    ['scheduleType', { scheduleType: 'sekali' }],
    ['projectId', { projectId: 'proj-b' }],
    ['pinned', { pinned: true }],
    ['priority', { priority: 'low' }],
  ] as const)('perubahan %s membuat kunci yang sama konflik, bukan menimpa', (_field, override) => {
    expect(matchesCreatedTask(stored(), { ...payload, ...override })).toBe(false)
  })

  it('config tersimpan yang rusak tidak dianggap cocok', () => {
    expect(matchesCreatedTask(stored({ scheduleConfig: '{rusak' }), payload)).toBe(false)
  })
})
