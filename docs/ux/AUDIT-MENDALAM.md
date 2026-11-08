# Audit mendalam: keamanan, data, jadwal, dan pemulihan

Tanggal: 8 November 2026. Audit ini menggunakan pembacaan kode, unit test, dan pengujian API/browser pada akun sementara. Ini **bukan** pentest independen, audit menyeluruh, maupun jaminan keamanan. Tidak ada pengujian serangan ke akun atau data milik pengguna lain; akun uji dan datanya dihapus setelah pengujian.

## Temuan penting yang diperbaiki

### 1. Kode undangan dapat dipakai bersamaan — tinggi
Sebelum perbaikan, lima pendaftaran paralel terhadap satu kode menghasilkan **tiga akun**. Penyebab: transaksi membaca `usedBy` sebelum penguncian baris. Sekarang kode dikunci sebelum diperiksa dan digunakan. Setelah perbaikan, lima permintaan menghasilkan tepat **satu akun** dan empat penolakan. Registrasi akun pertama juga mengunci proses bootstrap dan memeriksa ulang jumlah akun di dalam transaksi. Kasus bootstrap belum diuji pada database yang benar-benar kosong; tidak mengosongkan database pengguna untuk tes.

### 2. Pemangkasan riwayat dapat membalik status tugas — tinggi
Cron sebelumnya menghapus seluruh log di atas 730 hari, termasuk log terakhir tugas. Akibatnya tugas sekali yang telah selesai dapat terlihat siap lagi. Penghapusan log sekarang **mati secara default**; pengaktifan melalui `TASKLOG_RETENTION_DAYS` bersifat opt-in dan destruktif. Saat diaktifkan, log terakhir setiap tugas dipertahankan. Diuji pada akun uji: tanpa opt-in tidak ada penghapusan; dengan opt-in log lama berlebih terhapus dan log terakhir tetap ada. Ini tidak memulihkan riwayat yang mungkin sudah dihapus sebelum perbaikan.

### 3. Backup dapat kehilangan tugas dan log — tinggi
Impor dulu menyamakan semua tugas dengan nama identik: dalam uji dua tugas dengan nama sama, hanya satu tugas dan satu log yang kembali. Backup baru menyertakan ID proyek pada relasi tugas; impor memetakan proyek dan log berdasarkan identitas, bukan hanya nama. Diuji tiga tugas bernama sama dalam/antar proyek, dua proyek bernama sama, dan empat log; semuanya kembali ke tugas yang tepat dan impor ulang pada skenario tersebut tidak menggandakan data. Impor proyek/share sekarang divalidasi sebelum penulisan dan menggunakan transaksi agar data salah tidak meninggalkan proyek setengah jadi.

### 4. URL berbahaya dan jalur validasi alternatif — tinggi
API tugas/template/proyek menerima link yang tidak divalidasi seperti `javascript:` meskipun formulir membatasi link. API kini menerima URL HTTP(S) absolut saja. Link lama yang tidak aman **tidak dihapus dari database**, tetapi tidak ditampilkan sebagai tautan yang dapat dibuka; pengguna dapat memperbaikinya lewat edit. Validasi jadwal juga diterapkan ke endpoint pembuatan tugas dalam proyek. Impor proyek/share dan backup menolak link yang tidak aman.

### 5. Webhook Telegram tanpa secret — tinggi, memerlukan tindakan operator
Konfigurasi yang diuji memiliki token bot tetapi **tidak memiliki `TELEGRAM_WEBHOOK_SECRET`**. Sebelumnya endpoint menerima update tanpa memverifikasi pengirim. Sekarang webhook menolak update dengan 503 jika secret belum dikonfigurasi, dan menolak token salah. **Akibatnya perintah Telegram masuk sementara tidak berfungsi** hingga operator membuat secret acak, mengaturnya di environment, dan mendaftarkan ulang webhook melalui panel admin. Jangan bagikan secret. Pengiriman notifikasi keluar adalah jalur terpisah; belum diuji secara end-to-end ke Telegram asli.

### 6. Endpoint web push arbitrer — tinggi
Endpoint push yang tersimpan dapat menyebabkan server mencoba menghubungi alamat pilihan pengguna. Registrasi dan pengiriman kini membatasi endpoint HTTPS ke layanan push browser yang dikenal (Google FCM, Mozilla, Apple, Microsoft). Entri lama yang tidak cocok tidak dihapus tetapi tidak dikirim. Provider kustom/self-host di luar daftar tidak didukung. Pengiriman nyata ke penyedia push belum diuji.

### 7. Perlindungan autentikasi dan share
- Cookie production tidak lagi menggunakan secret fallback yang diketahui publik jika `COOKIE_SECRET` kosong; autentikasi gagal tertutup. Secret harus dikonfigurasi.
- Kegagalan penyimpanan rate limit tidak lagi membiarkan permintaan lolos; layanan gagal tertutup.
- Kode undangan dan kode share baru memakai generator acak kriptografis.
- Pratinjau/impor kode share memerlukan login dan dibatasi per akun serta IP. Dialog menyatakan bahwa link, deskripsi, dan catatan dibagikan kepada pemegang kode.
- Reset riwayat dikunci bersama penyelesaian/Undo agar operasi pada tugas yang sama terserialisasi.

### 8. Dependensi dan proses build
`npm audit` pada saat pemeriksaan terakhir melaporkan **0 kerentanan yang diketahui** untuk seluruh dependency yang terpasang; sebelumnya audit production melaporkan empat entri high dan audit lengkap juga menemukan critical pada alat uji. Sharp dan Vitest diperbarui; dua dependensi transitif memakai npm overrides (major version) setelah uji parser, Prisma generate/migration status, build, TypeScript, dan test. Ini hasil pemindaian saat itu, bukan jaminan bebas celah. Lockfile npm diperbarui dan tidak lagi di-ignore; bun.lock lama yang tidak sesuai paket dihapus. Build standalone dan `npm start` telah dicoba. Build standalone dapat menyertakan `.env`; jangan membagikan direktori build.

## Hasil pengujian terakhir

- TypeScript berhasil; **117/117 test** termasuk tes retensi pada database terisolasi berdasarkan akun; production/standalone build dan startup berhasil; status migrasi database up to date.
- Isolasi akun dan autentikasi pada sampel endpoint tugas, proyek, catatan, template, selesai/Undo, ekspor proyek dan share; input URL, jadwal, push, webhook tanpa secret dan impor gagal.
- Penyelesaian: empat putaran masing-masing delapan permintaan bersamaan, setiap putaran tepat satu log baru. Undo tepat log, termasuk penolakan token lama.
- Impor backup nama sama dan impor ulang; impor proyek berhasil/gagal; share berhasil; batas pencarian kode; tugas lama dengan link tidak aman tetap tersimpan dan tidak dapat dibuka.
- Chromium desktop dan viewport HP: akun kosong, tugas, proyek, cari, edit, link, catatan gagal dan coba lagi, penyelesaian/Undo, aksi massal dan error simulasi. Tidak setara pengujian di perangkat fisik.

## Risiko dan batasan yang masih terbuka

1. **Keandalan notifikasi:** penanda pengiriman diklaim sebelum pengiriman eksternal dan `sent` dihitung berdasarkan klaim; jika seluruh kanal gagal, notifikasi dapat tidak dicoba lagi dan angka tersebut tidak membuktikan penerimaan. Menyelesaikannya dengan aman memerlukan desain retry/outbox dan penanda per kanal; belum diperbaiki atau diuji end-to-end.
2. **Backup lama:** file yang dibuat sebelum ID proyek disertakan tidak bisa membedakan proyek-proyek dengan nama identik secara pasti. Impor ke akun yang sudah berisi tugas menggunakan pencocokan proyek/nama dan jumlah, bukan merge isi/log; periksa hasil serta simpan backup asli. Data tidak secara otomatis dipulihkan jika sudah hilang sebelum audit.
3. **Share:** kode yang sudah dibuat belum memiliki fungsi kedaluwarsa/pencabutan. Jangan membagikan data sensitif; siapa pun yang memperoleh kode dan memiliki akun dapat mengimpor snapshot.
4. **Proxy/IP dan CSRF:** rate limit IP bergantung pada header proxy yang harus dikonfigurasi dan dipercaya dengan benar; belum ada audit komprehensif CSRF, konfigurasi proxy, atau seluruh endpoint. SameSite cookie bukan pengganti seluruh kontrol CSRF.
5. **Override dependensi:** override lint dan Prisma memakai versi mayor di luar rentang dependensi upstream; test yang dilakukan terbatas. Pantau pembaruan resmi dan uji deployment yang sesungguhnya. Angka audit dapat berubah.
6. **Catatan gagal:** draf hanya di memori selama sesi, tidak dijamin bertahan saat reload/tutup tab.
7. Belum dilakukan studi pengguna manusia, tes perangkat HP fisik/browser selain Chromium, beban besar, pentest menyeluruh, pengujian webhook Telegram dengan secret yang sebenarnya, pengiriman push nyata, serta pengujian semua kemungkinan konkurensi dan instalasi bootstrap kosong.

Skrip reproducible: `/home/user/tools/audit-invite-race.mjs`, `audit-backup-roundtrip.mjs`, `audit-security-import.mjs`, `audit-concurrency.mjs`, `audit-bulk.mjs`, `audit-browser.mjs`, `audit-notes-failure.mjs`; tes database retensi di `tests/retention-isolated.test.ts`. Hasil `npm audit` tersimpan di `docs/ux/npm-audit-all.json`.
