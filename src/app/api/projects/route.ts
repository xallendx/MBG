import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { handleApiError, parseBody, requireUserId } from '@/lib/api'
import { projectCreateSchema } from '@/lib/schemas'

export async function GET() {
  try {
    const userId = await requireUserId()
    const projects = await db.project.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
      include: { _count: { select: { tasks: true } } },
    })
    return NextResponse.json(projects)
  } catch (e) {
    return handleApiError('GET /api/projects', e)
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId()
    const input = await parseBody(req, projectCreateSchema)

    // Transaksi: posisi terakhir + create, supaya dua request bersamaan tidak
    // mendapat posisi yang sama.
    const project = await db.$transaction(async (tx) => {
      const maxPos = await tx.project.findFirst({
        where: { userId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })

      return tx.project.create({
        data: {
          userId,
          name: input.name,
          color: input.color || '#000080',
          position: (maxPos?.position || 0) + 1,
        },
      })
    })

    return NextResponse.json(project, { status: 201 })
  } catch (e) {
    return handleApiError('POST /api/projects', e)
  }
}
