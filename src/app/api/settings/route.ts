import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const ALLOWED_SETTINGS = [
  'timezone', 'timeFormat', 'autoExpandSiap', 'autoCompleteLink',
  'telegramNotifEnabled', 'browserNotifEnabled', 'pomodoroDuration',
  'audioAlertEnabled', 'telegramBotUsername', 'notifyBeforeCooldownMin'
]

// Type validators for each setting key
const SETTINGS_VALIDATORS: Record<string, (v: unknown) => boolean> = {
  timezone: (v) => typeof v === 'string' && ['WIB', 'WITA', 'WIT'].includes(v),
  timeFormat: (v) => v === '12' || v === '24',
  autoExpandSiap: (v) => typeof v === 'boolean',
  autoCompleteLink: (v) => typeof v === 'boolean',
  telegramNotifEnabled: (v) => typeof v === 'boolean',
  browserNotifEnabled: (v) => typeof v === 'boolean',
  pomodoroDuration: (v) => typeof v === 'number' && v >= 1 && v <= 120,
  audioAlertEnabled: (v) => typeof v === 'boolean',
  telegramBotUsername: (v) => typeof v === 'string' && v.length <= 100,
  notifyBeforeCooldownMin: (v) => typeof v === 'number' && v >= 1 && v <= 60,
}

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

    // Whitelist + type validation: only allow known keys with valid types
    const sanitized: Record<string, unknown> = {}
    for (const key of ALLOWED_SETTINGS) {
      if (key in body) {
        const validator = SETTINGS_VALIDATORS[key]
        if (validator && validator(body[key])) {
          sanitized[key] = body[key]
        }
        // Silently skip invalid values — don't store malformed data
      }
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
