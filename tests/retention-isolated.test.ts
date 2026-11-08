import { describe, it, expect, afterAll, vi } from 'vitest'
import { db } from '../src/lib/db'
import { pruneTaskLogs } from '../src/lib/retention'

// Uji nyata tetapi hanya mengubah data akun sementara milik tes ini.
describe.skipIf(!process.env.DATABASE_URL)('retensi terisolasi', () => {
  let userId: string | undefined
  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } })
    await db.$disconnect()
    vi.unstubAllEnvs()
  })
  it('default tidak menghapus, opt-in menjaga log terakhir tiap tugas', async () => {
    const u = await db.user.create({ data: { username: `test_retention_${Date.now()}_${Math.random().toString(16).slice(2)}`, passwordHash: 'not-a-real-login' } })
    userId = u.id
    const once = await db.task.create({ data: { userId, name: 'Sekali lama', scheduleType: 'sekali' } })
    const repeat = await db.task.create({ data: { userId, name: 'Riwayat lama', scheduleType: 'kustom' } })
    const old = new Date(Date.now() - 1000 * 86400000)
    const old2 = new Date(old.getTime() + 86400000)
    await db.taskLog.createMany({ data: [{ taskId: once.id, completedAt: old }, { taskId: repeat.id, completedAt: old }, { taskId: repeat.id, completedAt: old2 }] })
    vi.stubEnv('TASKLOG_RETENTION_DAYS', '')
    expect(await pruneTaskLogs(undefined, userId)).toBe(0)
    expect(await db.taskLog.count({ where: { taskId: { in: [once.id, repeat.id] } } })).toBe(3)
    expect(await pruneTaskLogs(730, userId)).toBe(1)
    expect(await db.taskLog.count({ where: { taskId: once.id } })).toBe(1)
    const remaining = await db.taskLog.findMany({ where: { taskId: repeat.id } })
    expect(remaining).toHaveLength(1)
    expect(remaining[0].completedAt.toISOString()).toBe(old2.toISOString())
  })
})
