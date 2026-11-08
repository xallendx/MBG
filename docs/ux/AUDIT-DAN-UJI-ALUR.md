# Audit dan uji alur MBG

Tanggal: 8 November 2026. Audit ini mencakup alur utama dan beberapa kondisi gagal, bukan sertifikasi keamanan atau studi pengguna. Pengujian menggunakan Chromium otomatis dan akun sementara yang dihapus beserta datanya setelah uji.

## Temuan dan perbaikan

1. **Penyelesaian ganda.** Sebelum perbaikan, delapan permintaan bersamaan menghasilkan tiga penyelesaian dan tiga catatan riwayat. Penyelesaian sekarang mengunci baris tugas sebelum membaca status dan membuat riwayat. Setelah perbaikan, empat putaran masing-masing delapan permintaan menghasilkan tepat satu respons berhasil dan satu riwayat baru per putaran.
2. **Undo bisa membatalkan catatan yang salah.** Undo antarmuka sekarang membawa ID catatan yang dihasilkan oleh tindakan terkait, termasuk tindakan massal. Server memastikan catatan tersebut milik tugas yang diminta; token yang sudah dibatalkan tidak menghapus catatan baru. Kompatibilitas API lama tanpa token masih membatalkan catatan terbaru, sehingga jaminan token ini berlaku untuk antarmuka baru dan klien yang mengirim token.
3. **Hitungan riwayat.** Respons penyelesaian menggunakan jumlah seluruh riwayat, bukan panjang daftar satu riwayat terakhir.
4. **Penyelesaian gagal.** Status optimistis segera dikembalikan ketika permintaan gagal; pesan kesalahan ditampilkan.
5. **Catatan gagal disimpan.** Draf disimpan sementara selama sesi aplikasi, tetap tersedia setelah detail ditutup dan dibuka lagi, ditandai belum tersimpan, dan dapat dicoba lagi. Draf ini belum disimpan di database dan tidak dijamin bertahan setelah halaman dimuat ulang, tab ditutup, atau sesi hilang.
6. **Aksesibilitas.** Pencarian dan dialog detail diberi nama yang dapat dikenali teknologi bantu.

## Pengujian yang berhasil

- TypeScript tanpa error; 92/92 unit test; production build berhasil.
- Akun kosong: tambah tugas harian, selesai, status menunggu, Undo kembali siap; tugas sekali masuk selesai; buat proyek dan pilih saat membuat tugas.
- Chromium desktop dan viewport HP 390×844: cari, edit, muat ulang, catatan, akses detail dengan keyboard, Escape, dan pemeriksaan tidak ada overflow horizontal pada daftar/detail. Tidak ada page error dalam skenario browser tersebut.
- Tombol link membuka URL yang benar dan tidak menyelesaikan tugas pada pengaturan default. Tujuan eksternal dicegat dengan respons lokal dalam pengujian, jadi ketersediaan situs eksternal tidak diuji.
- Simulasi error penyelesaian memulihkan status; simulasi error catatan mempertahankan draf dalam sesi dan tombol simpan ulang menyimpannya.
- Dua tugas diselesaikan dan dibatalkan secara massal menggunakan database sebenarnya. Pada simulasi kegagalan satu tugas, jumlah berhasil/gagal benar, pilihan yang gagal tetap dipilih, dan hasil sukses dapat dibatalkan.
- Akses tanpa autentikasi dan akses tugas pengguna lain diuji untuk endpoint selesai dan Undo. Ini bukan audit keamanan menyeluruh.

## Batasan dan tindak lanjut

- Belum ada uji oleh pengguna manusia, di perangkat HP fisik, atau di browser selain Chromium; pengujian viewport bukan pengujian perangkat nyata.
- Belum mengaudit seluruh aplikasi, seluruh kemungkinan operasi bersamaan, performa beban besar, keamanan komprehensif, Telegram/cron, template, atau integrasi eksternal.
- Tindakan massal berupa beberapa permintaan terpisah, bukan transaksi tunggal; kegagalan parsial ditampilkan. Reset menghapus seluruh riwayat dan tidak dapat dibatalkan.
- Draf catatan gagal hanya tersimpan dalam memori sesi: jangan muat ulang atau tutup tab sebelum berhasil disimpan. Penyimpanan draf persisten membutuhkan perbaikan terpisah.
- Pratinjau statis `preview-mbg.html` memperlihatkan tampilan, tetapi tidak menyimpan tindakan. Untuk mencoba fungsinya, gunakan live preview aplikasi.

Skrip uji terisolasi: `/home/user/tools/audit-concurrency.mjs`, `audit-bulk.mjs`, `audit-browser.mjs`, `audit-notes-failure.mjs`, `verify-new-user.mjs`, dan `verify-project-flow.mjs`.
