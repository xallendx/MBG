import { NextResponse } from 'next/server'

// GET /api/push/vapid-key — return public VAPID key for push subscription
//
// Tidak adanya kunci adalah soal konfigurasi, bukan kerusakan server. Versi
// sebelumnya membalas 500, sehingga setiap kunjungan pengguna mencatat error
// 5xx di log hosting padahal aplikasinya sehat. Sekarang dibalas 200 dengan
// tanda `configured` supaya klien bisa membedakan "belum dikonfigurasi" dari
// "jaringan gagal", dan bisa memberi tahu pengguna sebelum meminta izin.
export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
  return NextResponse.json({ publicKey, configured: Boolean(publicKey) })
}
