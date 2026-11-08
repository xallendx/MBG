# MBG Airdrop Task Manager

Aplikasi pengelola tugas airdrop dengan tema **Windows 95 retro**. Dibangun menggunakan Next.js 16, Prisma ORM, dan PostgreSQL (Neon).

## Fitur

- **Dashboard** — Ringkasan semua task dengan filter tab (Semua, Siap, CD, Done)
- **Monitor** — Tampilan monitor untuk tracking task aktif
- **Tree View** — Tampilan folder per project dengan status group
- **Auto Cooldown** — Timer cooldown otomatis setelah task diselesaikan
- **Undo** — Batalkan aksi "Selesai" (termasuk batch complete) langsung dari notifikasi
- **Template Task** — Simpan template task untuk dipakai ulang
- **Keyboard Shortcuts** — Shortcut keyboard untuk navigasi cepat
- **Import/Export** — Import dan export project via JSON
- **Share Project** — Bagikan project ke user lain via kode
- **Telegram Notification** — Notifikasi Telegram saat task siap dikerjakan
- **Mobile Responsive** — Mendukung smartphone dengan long-press context menu
- **Notes** — Catatan sticky notes

## Tech Stack

- **Framework**: Next.js 16 (App Router, TypeScript)
- **Database**: PostgreSQL (Neon) + Prisma ORM
- **Auth**: Cookie-based + HMAC signature (bcryptjs)
- **Styling**: CSS biasa (`src/app/globals.css`) dengan tema Windows 95 — tanpa Tailwind
- **Security**: Rate limiting, HMAC cookies, CORS headers

## Cara Install

### 1. Install dependencies
Gunakan Node.js 20.19+ dan npm. Lockfile npm menyimpan versi yang telah diuji.
```bash
npm ci
```

### 2. Setup environment
```bash
cp .env.example .env
# Edit .env — isi DATABASE_URL, DIRECT_DATABASE_URL, COOKIE_SECRET, dan variabel opsional
```

### 3. Setup database
```bash
# Terapkan migration (BUKAN db push — lihat catatan di bawah)
npm run db:migrate:deploy

# Opsional: data contoh untuk development
npm run db:seed:demo          # membuat admin1 / admin123 + 11 task demo
```

> **Penting:** jangan pakai `db:push` untuk database produksi. Folder
> `prisma/migrations/` sekarang sudah ada, dan `db:push` bisa mengubah schema
> tanpa jejak sehingga berisiko menghilangkan data.

### 4. Jalankan aplikasi
```bash
npm run dev
```

Aplikasi berjalan di **http://localhost:3000**. Untuk production, jalankan
`npm run build` lalu `PORT=3000 npm start`. Build standalone dapat menyertakan
file `.env`; jangan unggah hasil build atau bagikan isinya karena dapat berisi rahasia.

## Login & akun pertama

Aplikasi memakai sistem **kode undangan**: hanya orang yang punya kode undangan
yang bisa mendaftar. Kode dibuat oleh admin di **Alat → Panel Admin → Kode Undangan**.

**Instalasi baru (database masih kosong):**

1. Buka halaman **Daftar** — akan muncul keterangan "Instalasi baru terdeteksi".
2. Daftar dengan username & password pilihanmu. Kode undangan **tidak diperlukan**.
3. Akun pertama otomatis menjadi **ADMIN**. Setelah itu buat kode undangan untuk
   user lain lewat Panel Admin.

> Kalau kamu melihat kode undangan seperti `MBGADMIN` di dokumentasi lama, itu
> hanya contoh. Kode asli hanya ada di database instalasimu sendiri.

## Deploy ke Vercel

1. Push ke GitHub
2. Import di [vercel.com](https://vercel.com)
3. Set environment variables:
   - `DATABASE_URL` — Neon connection string (pooled + pgbouncer)
   - `DIRECT_DATABASE_URL` — Neon connection string (direct)
   - `COOKIE_SECRET` — Random 64-char hex string
   - `TELEGRAM_BOT_TOKEN` — (opsional) Token bot Telegram
   - `TELEGRAM_WEBHOOK_SECRET` — wajib untuk menerima perintah webhook Telegram; setelah diatur, daftarkan ulang webhook melalui panel admin

4. Deploy

## Notifikasi yang tetap jalan saat aplikasi ditutup

Aplikasi mengirim notifikasi Telegram / Web Push dari **server**, bukan dari
browser. Ada dua pemicu yang memakai logika yang sama
(`src/lib/notify-sweep.ts`), dan keduanya aman berjalan bersamaan karena setiap
notifikasi diklaim secara atomik sebelum dikirim (tidak ada notifikasi ganda):

| Pemicu | Kapan dipakai |
|---|---|
| `GET/POST /api/cron/notify` | Dipanggil penjadwal server: **tetap bekerja walau tidak ada browser yang terbuka** |
| `POST /api/notify/run` | Dipanggil browser sebagai *catch-up* saat aplikasi dibuka |

### Setup cron

1. Tambahkan `CRON_SECRET` (string acak) ke environment:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Vercel**: `vercel.json` sudah berisi jadwal `*/5 * * * *`. Cron Vercel
   otomatis mengirim header `Authorization: Bearer $CRON_SECRET`.
   Catatan: paket Vercel Hobby hanya mengizinkan cron **harian**; untuk interval
   menit pakai GitHub Actions atau cron eksternal.
3. **Cron eksternal / self-host**:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://domain-mu/api/cron/notify
   ```
   Bisa juga lewat query string bila layanan tidak mendukung header:
   `?secret=$CRON_SECRET`

Kalau `CRON_SECRET` kosong, endpoint cron menolak semua permintaan (fail closed)
supaya tidak ada endpoint publik yang bisa dipicu orang lain.

## Retensi data

Cron memangkas baris `RateLimit` yang kedaluwarsa setelah 24 jam. Riwayat
penyelesaian (`TaskLog`) **tidak dipangkas secara default**. Operator bisa
mengaktifkan penghapusan riwayat lama dengan `TASKLOG_RETENTION_DAYS` bernilai
positif; ini tindakan destruktif dan sebaiknya dilakukan setelah backup.
Log terakhir setiap tugas tetap dipertahankan agar status tugas tidak terbalik.
Balasan cron memuat `prunedRateLimits` dan `prunedTaskLogs`.

## Penanganan error & validasi API

Semua route API memakai satu lapisan yang sama:

| Modul | Fungsi |
|---|---|
| `src/lib/schemas.ts` | skema zod untuk setiap body request |
| `src/lib/api.ts` | `parseBody()` (JSON rusak → 400), `handleApiError()` (P2002 → 409, P2025 → 404, DB mati → 503), `requireUserId()` |
| `src/lib/logger.ts` | log terstruktur satu baris JSON: `{"level","ts","ctx","msg",...}` |

Artinya: pesan error ke user selalu berbahasa Indonesia dan menyebut field yang
salah, sedangkan detail teknisnya masuk log dengan konteks route + userId.
Set `LEVEL_LOG=warn` untuk meredam log info di produksi.

## Struktur kode penting

| File | Peran |
|---|---|
| `src/lib/schedule.ts` | perhitungan cooldown & jadwal (inti suite vitest: 117 test di 9 file) |
| `src/lib/settings.ts` | baca/tulis kolom `User.settings` dengan validasi + default |
| `src/lib/task-view.ts` | label jadwal, prioritas, aturan warna cooldown (dipakai semua view) |
| `src/lib/notify-sweep.ts` | satu-satunya logika pengiriman notifikasi |
| `src/lib/retention.ts` | retensi `TaskLog` |
| `src/lib/api.ts`, `schemas.ts`, `logger.ts` | validasi, error handling, log terstruktur |

Catatan UX: tata letak memakai **sidebar project + daftar task dua tingkat**
(lihat `docs/ux/UX-REVIEW.md` untuk alasan & perbandingan sebelum/sesudah).

Tema Win95 ditulis dengan CSS biasa (`src/app/globals.css`) — proyek ini **tidak**
memakai Tailwind, dan dependency-nya sudah dibersihkan (8 dependency produksi).

## Testing

```bash
npm test          # vitest — pengujian unit; uji retensi database memerlukan DATABASE_URL
npx tsc --noEmit  # type check
npm run build     # build produksi
```

CI (`.github/workflows/ci.yml`) menjalankan keempatnya, termasuk
`prisma migrate deploy` ke database Postgres bersih agar migration selalu terbukti
bisa membangun schema dari nol.

## Keyboard Shortcuts

| Key | Aksi |
|-----|------|
| N   | Task Baru (di folder aktif) |
| T   | Task Baru (standalone) |
| P   | Project Baru |
| R   | Refresh |
| D   | Dashboard |
| M   | Monitor |
| 1-4 | Tab filter (Semua/Siap/CD/Done) |
| /   | Focus search |
| Esc | Tutup dialog |

## License

Private project — MBG Team
