import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const ALLOWED_SETTINGS = [
  'timezone', 'timeFormat', 'autoExpandSiap', 'autoCompleteLink',
  'telegramNotifEnabled', 'browserNotifEnabled', 'pomodoroDuration',
  'audioAlertEnabled', 'telegramBotUsername'
]

export async function GET() {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const user = await db.user.findUnique({ where: { id: userId } })
    let settings: Record<string, unknown> = {}
    try { settings = user?.settings ? JSON.parse(user.settings) : {} } catch { settings = {} }
    return NextResponse.json(settings)
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const user = await db.user.findUnique({ where: { id: userId } })
    let currentSettings: Record<string, unknown> = {}
    try { currentSettings = user?.settings ? JSON.parse(user.settings) : {} } catch { currentSettings = {} }

    // Whitelist: only allow updating known safe keys
    const sanitized: Record<string, unknown> = {}
    for (const key of ALLOWED_SETTINGS) {
      if (key in body) sanitized[key] = body[key]
    }

    const merged = { ...currentSettings, ...sanitized }
    await db.user.update({
      where: { id: userId },
      data: { settings: JSON.stringify(merged) }
    })

    return NextResponse.json(merged)
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
