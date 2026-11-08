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

## Kalau tidak bisa masuk setelah deploy

Tidak ada password admin bawaan. `admin1`/`admin123` di README hanya muncul bila
`npm run db:seed:demo` dijalankan manual terhadap database tersebut; deploy
Vercel tidak menjalankannya.

Jika database sudah berisi akun yang tidak diketahui kredensialnya, pakai **admin
pemulihan**. Di Vercel → Settings → Environment Variables, isi untuk environment
yang dipakai:

| Variabel | Contoh | Catatan |
|---|---|---|
| `ADMIN_USERNAME` | `pemilik` | username **baru**; yang sudah ada tidak disentuh |
| `ADMIN_PASSWORD` | pilihan sendiri | 6–128 karakter, di-hash bcrypt |

Redeploy, lalu login di aplikasi dengan nilai itu. Akun dibuat sebagai ADMIN pada
percobaan login pertama. **Hapus kedua variabel setelah berhasil masuk.**

Untuk menimpa password akun yang sudah ada (benar-benar terkunci), tambahkan
`ADMIN_ALLOW_PASSWORD_RESET="true"` sementara, lalu hapus lagi setelah login.
Tanpa flag itu password akun aktif tidak pernah ditimpa.

Pesan error login/daftar sekarang menampilkan penyebab asli dari server. Kalau
yang muncul `Pembatas keamanan sementara tidak tersedia`, berarti tabel
`RateLimit` belum ada — jalankan SQL di langkah 2 di atas. Kode `401` tetap
dijawab generik agar tidak membocorkan username mana yang terdaftar.

## Deployment

- Pilih commit di branch `main` dari repository yang benar, lalu deploy atau redeploy di Vercel. Pastikan Vercel memakai Node.js 22.x (dikunci lewat `engines.node` di `package.json`) dan npm lockfile. Rentang terbuka seperti `>=20.19.0` membuat Vercel mengabaikan setelan versi di dashboard dan otomatis naik ke major terbaru, jadi jangan dikembalikan ke bentuk itu. Deployment Git yang terhubung mungkin berjalan otomatis setelah push; siapkan database dan environment sebelum push jika demikian.
- File `vercel.json` menjadwalkan cron **harian** (`0 1 * * *`) karena Vercel Hobby menolak jadwal lebih rapat — konfigurasi cron tiap lima menit membuat seluruh deployment gagal saat validasi. Untuk pengingat tiap lima menit tanpa biaya tambahan, pakai workflow `.github/workflows/reminder-sweep.yml` dan isi secret repo `APP_URL` serta `CRON_SECRET` (nilainya sama dengan di Vercel). Tanpa secret itu workflow berhenti tanpa error dan pengingat tetap harian.
- Setelah deploy, periksa log build dan fungsi; coba login, membuat tugas uji, menyelesaikan/Undo, dan ekspor backup. Cek Telegram dan notifikasi hanya jika memang dipakai. Jangan uji dengan menghapus riwayat pengguna.

Catatan: mengunggah kode ke GitHub **tidak otomatis mengubah schema database** dan tidak menjamin deployment Vercel berhasil. Simpan backup asli sebelum migrasi atau impor data.
