import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireCurrentUser } from '@/lib/auth'
import { handleApiError, parseBody } from '@/lib/api'
import { pushSubscribeSchema } from '@/lib/schemas'
import { z } from 'zod'

// POST /api/push/subscribe — save push subscription
export async function POST(req: Request) {
  try {
    const user = await requireCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { endpoint, keys } = await parseBody(req, pushSubscribeSchema)

    // Security: prevent subscription hijacking — check ownership before upsert
    const existing = await db.pushSubscription.findUnique({ where: { endpoint } })
    if (existing && existing.userId !== user.id) {
      // Another user owns this endpoint — reject
      return NextResponse.json({ error: 'Subscription belongs to another user' }, { status: 403 })
    }

    if (existing) {
      // Update existing subscription for this user
      await db.pushSubscription.update({
        where: { endpoint },
        data: { keys: JSON.stringify(keys) }
      })
    } else {
      // Create new subscription
      await db.pushSubscription.create({
        data: {
          userId: user.id,
          endpoint,
          keys: JSON.stringify(keys),
        }
      })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    return handleApiError('api/push/subscribe', e)
  }
}

// DELETE /api/push/subscribe — remove push subscription
export async function DELETE(req: Request) {
  try {
    const user = await requireCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { endpoint } = await parseBody(req, z.object({ endpoint: z.string().min(1).max(2000) }))

    await db.pushSubscription.deleteMany({
      where: { userId: user.id, endpoint }
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    return handleApiError('api/push/subscribe', e)
  }
}
