import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export async function POST() {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const user = await db.user.findUnique({ where: { id: userId }, select: { settings: true } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    let settings: Record<string, unknown> = {}
    try { settings = JSON.parse(user.settings || '{}') } catch { /* empty */ }

    settings.telegramChatId = null
    settings.telegramName = null
    settings.telegramCode = null
    settings.telegramConnected = false
    settings.telegramNotifEnabled = false

    await db.user.update({
      where: { id: userId },
      data: { settings: JSON.stringify(settings) },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Telegram disconnect error:', error)
    return NextResponse.json({ error: 'Failed to disconnect Telegram account' }, { status: 500 })
  }
}
