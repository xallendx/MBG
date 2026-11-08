import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import crypto from 'crypto'
import { handleApiError } from '@/lib/api'
import { parseSettings } from '@/lib/settings'

export async function POST() {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Generate an 8-character hex code
    const code = crypto.randomBytes(4).toString('hex')

    // Store code with expiry (15 minutes)
    const user = await db.user.findUnique({ where: { id: userId } })
    const settings = parseSettings(user?.settings, 'POST /api/generate-code')
    settings.telegramCode = code
    settings.telegramCodeExpiry = Date.now() + 15 * 60 * 1000

    await db.user.update({
      where: { id: userId },
      data: { settings: JSON.stringify(settings) }
    })

    return NextResponse.json({ code, message: 'Kirim kode ini ke bot Telegram MBG' })
  } catch (e) {
    return handleApiError('api/generate-code', e)
  }
}
