import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import crypto from 'crypto'

export async function POST() {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Generate a 6-digit code
  const code = crypto.randomInt(100000, 999999).toString()

  // Store code with expiry (15 minutes)
  const user = await db.user.findUnique({ where: { id: userId } })
  const settings = user?.settings ? JSON.parse(user.settings) : {}
  settings.telegramCode = code
  settings.telegramCodeExpiry = Date.now() + 15 * 60 * 1000

  await db.user.update({
    where: { id: userId },
    data: { settings: JSON.stringify(settings) }
  })

  return NextResponse.json({ code, message: 'Kirim kode ini ke bot Telegram MBG' })
}
