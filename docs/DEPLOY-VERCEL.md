# Pembaruan MBG di Vercel

## Sebelum deploy ke database yang sudah berisi data

1. Buat dan uji backup database. Jangan hapus atau reset database.
2. Pastikan database PostgreSQL memiliki tabel `RateLimit`. Aplikasi baru bergantung pada tabel ini untuk login dan registrasi. Untuk database lama yang sudah memiliki tabel aplikasi lain, administrator database dapat memeriksa terlebih dahulu lalu menjalankan SQL tambahan berikut jika tabel belum ada:

```sql
CREATE TABLE IF NOT EXISTS "RateLimit" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL DEFAULT 0,
  "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "RateLimit_windowStart_idx" ON "RateLimit"("windowStart");
```

SQL ini tidak menghapus data yang ada, tetapi tidak memperbaiki tabel yang sudah ada dengan struktur berbeda. Pastikan struktur cocok. Migration `20260101000000_init` dibuat untuk database baru; **jangan jalankan langsung terhadap database lama tanpa memeriksa schema dan menyiapkan baseline Prisma yang benar**. `prisma migrate reset` dan `prisma db push --force-reset` tidak boleh digunakan pada produksi.
3. Di Vercel pastikan `DATABASE_URL`, `DIRECT_DATABASE_URL`, dan `COOKIE_SECRET` sudah diatur untuk environment yang akan dipakai. **Pertahankan `COOKIE_SECRET` yang sudah dipakai** agar sesi pengguna tidak tiba-tiba batal. Jangan menaruh nilainya di Git atau membagikannya.
4. Jika memakai perintah Telegram, atur `TELEGRAM_WEBHOOK_SECRET` acak serta `TELEGRAM_BOT_TOKEN` dan daftarkan ulang webhook setelah deploy. Tanpa secret, webhook akan menolak update. `CRON_SECRET` diperlukan untuk endpoint cron.

## Deployment

- Pilih commit di branch `main` dari repository yang benar, lalu deploy atau redeploy di Vercel. Pastikan Vercel memakai Node.js 20.19+ dan npm lockfile. Deployment Git yang terhubung mungkin berjalan otomatis setelah push; siapkan database dan environment sebelum push jika demikian.
- File `vercel.json` saat ini menjadwalkan cron setiap lima menit. Vercel Hobby memiliki batas cron harian sehingga konfigurasi ini dapat ditolak; gunakan jadwal harian yang didukung atau scheduler eksternal yang aman jika memakai Hobby. Frekuensi notifikasi latar belakang akan mengikuti scheduler tersebut.
- Setelah deploy, periksa log build dan fungsi; coba login, membuat tugas uji, menyelesaikan/Undo, dan ekspor backup. Cek Telegram dan notifikasi hanya jika memang dipakai. Jangan uji dengan menghapus riwayat pengguna.

Catatan: mengunggah kode ke GitHub **tidak otomatis mengubah schema database** dan tidak menjamin deployment Vercel berhasil. Simpan backup asli sebelum migrasi atau impor data.
