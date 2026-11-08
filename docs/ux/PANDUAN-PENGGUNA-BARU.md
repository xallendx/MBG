# Alur pengguna baru

## Keputusan desain terbaru

Atas koreksi pengguna, panduan otomatis dan petunjuk tambahan pada formulir **dihapus**. Penyederhanaan dilakukan pada alur dan pilihan di layar, bukan dengan meminta pengguna membaca instruksi.

- Layar akun kosong menampilkan satu tujuan utama: **Tambah tugas**. Filter, pencarian, kotak pilihan massal, dan sidebar proyek tidak muncul sebelum ada data yang relevan.
- Form tugas mengutamakan nama, pilihan kapan tugas dikerjakan, dan link opsional. Proyek, deskripsi, prioritas, dan template tetap ada di **Pengaturan tambahan**. Pilihan jadwal memakai keterangan tindakan yang jelas; pilihan waktu dan tanggal baru muncul bila dibutuhkan.
- Daftar menampilkan tugas siap dengan aksi **Buka link** (jika tersedia) dan **Selesai**. Fitur pemilihan banyak tugas tetap tersedia setelah memilih **Pilih beberapa**.
- Toolbar hanya menampilkan Tambah Tugas, Daftar, Monitor, dan **Lainnya**; proyek, muat ulang, template, dan Telegram tetap dapat diakses melalui Lainnya atau menu aplikasi. Proyek muncul di sidebar setelah pengguna membuatnya.
- Pengguna dapat memilih **Lihat tugas selesai** bila tugas satu kali selesai dan daftar aktif kosong. Jika filter membuat daftar kosong, tersedia **Lihat semua tugas**.
- Bantuan tetap tersedia jika dipilih sendiri, tetapi tidak muncul otomatis. Nama tugas dan menu Bantuan bisa dijangkau lewat keyboard.

## Pengujian

- Alur browser diuji menggunakan akun kosong sementara yang terpisah dari akun demo, kemudian akun dan datanya dihapus. Pengujian mencakup layar awal, membuat tugas harian, selesai dan Undo, menemukan tugas satu kali yang selesai, membuka detail dengan keyboard, dan menu Lainnya, pada ukuran HP serta desktop.
- Pengujian terpisah membuat proyek melalui Lainnya, memilihnya dari Pengaturan tambahan, dan memeriksa tugas tersimpan di proyek yang benar. Juga diuji mode pilihan, filter, beberapa jam per hari, edit, dan kegagalan penyimpanan.
- `npx tsc --noEmit`, `npx vitest run` (92 tes lulus), dan `npx next build` berhasil.
- Screenshot: `/home/user/shots/v9-user-baru-mobile.png`, `/home/user/shots/v9-user-baru-desktop.png`, dan `/home/user/shots/v9-tambah-mobile.png`.

## Batasan

Pengujian ini dilakukan dengan browser otomatis, bukan pengguna manusia. Belum dapat disimpulkan bahwa setiap pengguna baru memahami alur tanpa kesulitan; itu memerlukan pengujian kegunaan dengan orang yang belum mengenal aplikasi. Pratinjau HTML adalah snapshot statis. Untuk menyimpan data, gunakan aplikasi live.
