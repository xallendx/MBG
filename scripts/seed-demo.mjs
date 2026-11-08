/**
 * Seed data demo untuk pengembangan lokal.
 *
 *   node --env-file=.env scripts/seed-demo.mjs
 *   # atau: npm run db:seed:demo
 *
 * Idempoten: aman dijalankan berulang. User dibuat lewat upsert, dan seed data
 * hanya dibuat kalau user tersebut belum punya project.
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

const USERNAME = process.env.SEED_USERNAME || 'admin1'
const PASSWORD = process.env.SEED_PASSWORD || 'admin123'

const hoursAgo = (h) => new Date(Date.now() - h * 3600000)
const daysFromNow = (d) => {
  const dt = new Date()
  dt.setDate(dt.getDate() + d)
  return dt.toISOString().slice(0, 10)
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10)

  const user = await db.user.upsert({
    where: { username: USERNAME },
    update: { role: 'ADMIN' },
    create: {
      username: USERNAME,
      passwordHash,
      displayName: 'Admin MBG',
      role: 'ADMIN',
      settings: JSON.stringify({ timezone: 'WITA', notifyBeforeCooldownMin: 5 }),
    },
  })

  // Kode undangan contoh (kalau belum ada)
  for (const [code, role] of [['MBGUSER01', 'USER'], ['MBGUSER02', 'USER'], ['MBGUSER03', 'USER']]) {
    await db.inviteCode.upsert({
      where: { code },
      update: {},
      create: { code, role },
    })
  }

  if (await db.project.count({ where: { userId: user.id } }) > 0) {
    console.log(`Seed dilewati — ${USERNAME} sudah punya project.`)
    return
  }

  const projectDefs = [
    { name: 'GenLayer Mainnet', color: '#000080' },
    { name: 'Monad Testnet', color: '#800080' },
    { name: 'MegaETH', color: '#008080' },
    { name: 'Personal', color: '#808000' },
  ]
  const projectIds = {}
  for (const [i, p] of projectDefs.entries()) {
    const created = await db.project.create({ data: { ...p, userId: user.id, position: i } })
    projectIds[p.name] = created.id
  }

  // [nama, project, scheduleType, config, prioritas, logTerakhirJamLalu]
  const taskDefs = [
    ['Claim faucet harian', 'GenLayer Mainnet', 'harian', { cooldownHours: 24 }, 'high', 2],
    ['Bridge 0.01 ETH ke testnet', 'Monad Testnet', 'harian', { cooldownHours: 24 }, 'high', 5],
    ['Daily check-in dashboard', 'MegaETH', 'jam_tertentu', { times: ['09:00', '21:00'] }, 'medium', null],
    ['Vote proposal snapshot', 'GenLayer Mainnet', 'mingguan', { dayOfWeek: 4, cooldownHours: 24 }, 'medium', null],
    ['Mint NFT genesis', 'MegaETH', 'sekali', {}, 'low', null],
    ['Ikuti akun X project', 'Personal', 'sekali', {}, 'low', null],
    ['Submit tugas bounty', 'GenLayer Mainnet', 'sekali', {}, 'high', null],
    ['Test fitur baru dApp', 'Monad Testnet', 'harian', { cooldownHours: 24 }, 'low', 30],
    ['Swap di DEX testnet', 'Monad Testnet', 'harian', { cooldownHours: 24 }, 'medium', 26],
    ['Baca docs + catat', 'Personal', 'kustom', { cooldownHours: 48 }, 'low', null],
    ['Klaim role Discord', 'Personal', 'tanggal_spesifik', { dates: [daysFromNow(2)] }, 'medium', null],
  ]

  for (const [i, [name, project, scheduleType, cfg, priority, lastLogHours]] of taskDefs.entries()) {
    const task = await db.task.create({
      data: {
        userId: user.id,
        projectId: projectIds[project],
        name,
        scheduleType,
        scheduleConfig: JSON.stringify(cfg),
        priority,
        position: i,
        link: priority === 'high' ? 'https://example.com/task' : null,
        description: i === 1 ? 'Gunakan bridge resmi, jangan skip verifikasi.' : null,
      },
    })
    if (lastLogHours !== null) {
      await db.taskLog.create({ data: { taskId: task.id, completedAt: hoursAgo(lastLogHours) } })
    }
  }

  await db.note.createMany({
    data: [
      { userId: user.id, content: 'Jangan lupa cek snapshot tiap Kamis 20:00 WITA', color: '#FFFF99', pinned: true },
      { userId: user.id, content: 'Wallet testnet #3 masih kosong', color: '#99CCFF' },
    ],
  })

  console.log(`Seed selesai — ${await db.task.count({ where: { userId: user.id } })} task untuk @${USERNAME}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
