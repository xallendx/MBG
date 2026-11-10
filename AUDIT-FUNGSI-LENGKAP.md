# Audit seluruh fungsi MBG

Tanggal: 10 November 2026  
Cabang: `arena/a76183ff-mbg`  

## Ringkasan

Audit mencakup seluruh alur yang dapat dipicu dari UI desktop/HP, alur simpan/edit,
serta inventaris 41 file route API yang mengekspor total 54 handler HTTP. Ditemukan
satu celah konkurensi pada pengelolaan admin: dua request bersamaan dapat menonaktifkan
admin aktif terakhir. Perbaikan sudah dibuat dengan transaksi + advisory lock PostgreSQL,
dan dikunci oleh tujuh tes baru.

### Hasil browser (dijalankan berurutan pada build terbaru)

| Sapu | Cakupan | Hasil |
|---|---|---:|
| Desktop | 43 cek fungsi: form, validasi, simpan, kartu/detail, catatan, proyek, template, admin, pengaturan, ekspor/impor, keyboard, error JS | **43/43** |
| HP 390×844 | 4 tab, ukuran target sentuh, tambah/simpan, menu, catatan, pengaturan, aksi massal, overflow, error JS | **9/9** |
| Simpan/edit | Cepat, latensi 1,2 detik, `/api/init` gagal, klik berulang, filter proyek, edit, error JS | **7/7** |
| **Total** | Tiga rangkaian serial (mock API; tanpa database produksi) | **59/59** |

Tes dijalankan serial karena semua skrip memakai satu server mock dan satu state bersama;
menjalankannya paralel menghasilkan gangguan antartes, jadi hasil paralel tidak dihitung.

Hasil utama yang terukur ulang: jeda dialog tutup → kartu muncul saat latensi 1,2 detik
**1 ms**; saat `/api/init` sengaja digagalkan, kartu tetap muncul dalam **248 ms**.

## Temuan dan perbaikan

### P1 — Dua tindakan admin serentak dapat menghilangkan semua admin aktif — diperbaiki

Sebelumnya rute `PUT /api/admin/users/[id]` menghitung jumlah admin lalu mengubah role/
status di luar transaksi. Jika ada dua admin aktif dan dua request hampir bersamaan
men-demote atau memblokir admin yang berbeda, keduanya dapat membaca hitungan `2`, lalu
keduanya lolos dan membuat jumlah admin aktif menjadi `0`.

Perbaikan: request yang akan menonaktifkan admin aktif kini memperoleh advisory lock
transaksional bersama, membaca ulang target dan jumlah admin setelah lock, kemudian
menulis dalam transaksi yang sama. Aturan juga mencakup blokir admin terakhir, bukan
hanya demote. Perlindungan terhadap admin yang mencoba memblokir/demote dirinya sendiri
tetap ada. Tes baru: `tests/admin-user-update-route.test.ts` (**7** kasus).

### P2 — Mengosongkan deskripsi saat edit — diperbaiki

Balasan `description: null` sebelumnya bisa diperlakukan sebagai kolom yang tidak ada,
sehingga nilai lama muncul lagi secara optimistis. Pemetaan API sekarang membedakan
`undefined` (kolom tidak dikirim) dari `null`/string kosong (hapus). Dua tes regresi
baru ada di `tests/task-from-api.test.ts`; pengujian browser edit-deskripsi membuktikan
nilai server `null` dan form edit berikutnya tetap kosong.

## Pemeriksaan API dan server

Inventaris seluruh route: **41 file / 54 handler** (18 GET, 24 POST, 6 PUT, 6 DELETE).
Pemeriksaan kode mencakup batas autentikasi/ownership, validasi payload, rute admin,
transaksi task selesai, impor/ekspor, share, pengaturan, webhook, cron, push, dan
integrasi Telegram. Pemeriksaan otomatis yang relevan ada pada:

- Auth/bootstrap/admin dan rate limit.
- Skema input, jadwal, import/security, dan helper alur UI.
- Create/update/complete task, idempotensi save, status/cooldown, dan jumlah tab.
- Admin: bootstrap + update user/pertahanan admin aktif terakhir.

CI GitHub memeriksa migration, TypeScript, lint baseline, tes unit, dan production build.
Hasil CI untuk commit audit ini dicatat setelah push (lihat status PR #6).

## Batas cakupan yang perlu dibedakan

59 cek browser menguji UI dengan server mock. Bukan 59 uji terhadap setiap handler API,
dan bukan pengujian database produksi. Integrasi berikut tidak dapat diverifikasi
end-to-end dari sandbox:

- Telegram Bot API/webhook sungguhan dan notifikasi push di perangkat.
- Cron pada jadwal produksi dan kredensial/region deployment Vercel.
- PostgreSQL produksi untuk konflik serentak; advisory lock diuji pada kontrak rute,
  sementara perilaku lock aktual bergantung pada PostgreSQL.
- Safari iOS/Firefox dan latensi pengguna sesungguhnya.

CI adalah sumber hasil gerbang penuh; seluruh pemeriksaan lokal khusus yang dapat
dijalankan pada preview/mock dilaporkan terpisah di atas. Temuan security/production
yang masih membutuhkan tindakan operator tetap tercantum pada laporan
`AUDIT-SIMPAN-DAN-KECEPATAN.md` (rotasi `COOKIE_SECRET` dan kredensial Neon, redeploy,
serta verifikasi login admin/region fungsi).
