# Perombakan alur dan jadwal

## Cara menggunakan

1. Klik **Task Baru**, isi nama tugas dan pilih jadwal. Project dan link opsional; deskripsi dan prioritas berada di “Detail lainnya”.
2. **Sekali**: dikerjakan satu kali.
3. **Harian · jeda setelah selesai**: misalnya 24 jam dari waktu penyelesaian, bukan reset tengah malam. Jeda diatur 1–168 jam.
4. **Hari setiap minggu**: tugas siap sejak pukul 00.00 hari tersebut, tetap siap sampai dikerjakan, dan maksimal sekali tiap siklus mingguan. Data lama dengan cooldown mingguan lebih dari default tetap dihormati.
5. **Jam tertentu setiap hari**: misalnya `00:00` untuk mulai siklus tiap tengah malam atau `09:00, 21:00` untuk dua siklus. Setelah jam mulai berlalu, status tetap siap sampai diselesaikan; setelah selesai, menunggu jam berikutnya. Banyak siklus yang terlewat tidak membuat banyak salinan tugas.
6. **Mulai tanggal tertentu**: tugas satu kali yang mulai siap pada 00.00 tanggal tersebut; bukan deadline. Data lama berisi beberapa tanggal menggunakan tanggal valid pertama. Setelah diselesaikan, tugas selesai.
7. **Interval kustom**: waktu tunggu 1–8760 jam setelah selesai. Ini interval jam, bukan kalender bulanan.

Jadwal mengikuti zona waktu di Pengaturan (WIB/WITA/WIT). Logika baru memperbaiki tugas jam tertentu yang sebelumnya terus cooldown dan tugas tanggal spesifik yang bisa tidak ditandai selesai. **Perubahan ini juga memengaruhi status tugas yang sudah ada** tanpa menghapus riwayatnya; periksa kembali task jam tertentu dan mingguan setelah pembaruan.

## Aksi lebih jelas

- **Buka link** membuka link; secara default tidak menandai selesai. Jika opsi auto-complete link diaktifkan oleh pengguna, tombol menyebut **Buka + selesai**.
- **Selesai** menandai tugas selesai secara eksplisit. Tombol Kerjakan yang diam-diam menyelesaikan setelah 10 detik dihapus dari tampilan utama.
- Reset di baris tugas disembunyikan; melalui detail namanya **Hapus riwayat…**, dengan konfirmasi bahwa semua riwayat dihapus dan tidak dapat di-undo. Aksi massal punya peringatan yang sama.
- Pergantian filter di daftar membersihkan pilihan massal agar pilihan tersembunyi tidak ikut terproses tanpa sengaja. Perpindahan melalui shortcut atau menu juga membersihkan pilihan.
- Kesalahan jadwal dan kegagalan menyimpan ditampilkan di formulir; isian tidak ditutup atau dihapus sebelum server berhasil menyimpan. Validasi jadwal juga ada di API task/template.
- Label dan ukuran sentuh di HP diperbesar. Pilihan menu untuk membuka/menutup folder yang sudah tidak tampil di daftar dihilangkan.

## Verifikasi

- `npx tsc --noEmit`: berhasil.
- `npx vitest run`: **92 tes lulus**, termasuk tes jam tertentu, tanggal, mingguan, zona waktu, dan validasi input.
- `npx next build`: berhasil.
- Browser desktop dan 390×844: tambah tugas sebenarnya, selesai lalu Undo, hapus tugas percobaan, validasi input melalui UI dan API, simulasi gagal simpan yang mempertahankan isian, aksi massal dengan gagal parsial, dan navigasi monitor. Tidak ada page error pada pengujian.

## Batasan

Belum ada deadline sebenarnya atau jadwal kalender bulanan. Impor lama dan data yang sudah tersimpan dapat memiliki konfigurasi tidak valid dan perlu diperiksa. Aksi massal terdiri dari permintaan individual, bukan transaksi atomik. Belum ada studi kegunaan bersama pengguna nyata atau audit aksesibilitas formal; karena itu belum bisa menjamin desain ini yang terbaik untuk semua orang. `preview-mbg.html` adalah snapshot statis dengan navigasi terbatas, bukan aplikasi yang menyimpan data; gunakan live preview untuk mencoba fungsi sebenarnya.

## Penyederhanaan alur lanjutan

- Kotak centang tidak lagi muncul dalam pemakaian biasa. Klik **Pilih beberapa** untuk masuk mode pemilihan; klik tugas untuk memilih, lalu selesaikan pilihan. **Batal memilih** kembali ke daftar biasa. Mengubah filter mengosongkan pilihan; tugas yang tidak terlihat tidak ikut diproses.
- Status utama “Cooldown” diganti “Menunggu” dan label proyek diterjemahkan. Pengguna tetap dapat membuka detail tugas dengan klik baris saat tidak dalam mode pemilihan.
- Pilihan jadwal pada form baru memakai kalimat yang menjawab “Kapan tugas ini dikerjakan?”: sekali, setiap hari pada jam tertentu, setiap minggu, setelah jeda, atau mulai pada tanggal tertentu. Untuk harian, 00:00 menjadi nilai awal yang dapat diubah; beberapa jam disediakan dalam bagian tambahan. Jadwal harian lama tetap bisa dibaca dan diedit tanpa migrasi.
- Setelah berhasil menambahkan tugas, filter dan pencarian direset sehingga tugas baru tidak hilang dari pandangan. Isian yang gagal disimpan tetap ada di formulir.
- Diuji di browser HP dan desktop: mode pemilihan, reset pilihan ketika filter diganti, pilih semua, selesai parsial, jam harian default, beberapa jam, edit kembali, tambah saat filter aktif, penyimpanan gagal, dan buat/selesaikan/Undo/hapus tugas percobaan. TypeScript bersih, build sukses, 92 tes lulus.

**Pembaruan berikutnya:** panduan otomatis dihapus setelah koreksi pengguna; lihat `PANDUAN-PENGGUNA-BARU.md` untuk alur aktual yang disederhanakan.
