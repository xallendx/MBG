/**
 * Konfigurasi "admin pemulihan" dari environment variable.
 *
 * Masalah yang diselesaikan: akun disimpan di database, bukan di kode. Deploy
 * ke Vercel hanya menjalankan `build`, tidak menjalankan seed. Akibatnya pemilik
 * instalasi yang lupa password (atau yang database-nya sudah berisi akun lama)
 * tidak punya jalan masuk lewat UI: pendaftaran butuh kode undangan, dan kode
 * undangan hanya bisa dibuat oleh admin yang sudah bisa masuk. Lingkaran setan.
 *
 * Dengan dua env var ini, pemilik cukup mengisi di dashboard Vercel lalu
 * redeploy — tidak perlu membuka SQL Editor sama sekali.
 *
 * File ini SENGAJA tidak mengimpor `db` supaya bisa diuji tanpa database.
 * Bagian yang menyentuh database ada di `admin-bootstrap.ts`.
 */

export type AdminBootstrapConfig =
  | { status: 'disabled' }
  | { status: 'invalid'; reason: string }
  | { status: 'ok'; username: string; password: string; allowReset: boolean }

// Samakan dengan registerSchema supaya akun yang dibuat di sini pasti valid
// menurut aturan aplikasi (bukan aturan tersendiri yang bisa berbeda).
const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/

/**
 * Baca dan validasi env var. Tidak pernah melempar error dan tidak pernah
 * mencatat password — nilai password hanya diteruskan ke pemanggil.
 *
 * `ADMIN_USERNAME` di-trim karena spasi tidak sengaja sering terbawa saat
 * copy-paste di dashboard. `ADMIN_PASSWORD` TIDAK di-trim: spasi bisa saja
 * bagian sah dari password, dan diam-diam mengubahnya akan membuat pemilik
 * tidak bisa login dengan password yang ia ketik.
 */
export function readAdminBootstrapConfig(
  env: Record<string, string | undefined>
): AdminBootstrapConfig {
  const username = (env.ADMIN_USERNAME ?? '').trim()
  const password = env.ADMIN_PASSWORD ?? ''

  // Tidak diisi sama sekali = fitur mati. Ini kondisi normal sehari-hari.
  if (!username && !password) return { status: 'disabled' }

  if (!username || !password) {
    return {
      status: 'invalid',
      reason: 'ADMIN_USERNAME dan ADMIN_PASSWORD harus diisi bersamaan',
    }
  }
  if (username.length < 3) {
    return { status: 'invalid', reason: 'ADMIN_USERNAME minimal 3 karakter' }
  }
  if (username.length > 50) {
    return { status: 'invalid', reason: 'ADMIN_USERNAME maksimal 50 karakter' }
  }
  if (!USERNAME_PATTERN.test(username)) {
    return {
      status: 'invalid',
      reason: 'ADMIN_USERNAME hanya boleh huruf, angka, dan underscore',
    }
  }
  if (password.length < 6) {
    return { status: 'invalid', reason: 'ADMIN_PASSWORD minimal 6 karakter' }
  }
  if (password.length > 128) {
    return { status: 'invalid', reason: 'ADMIN_PASSWORD maksimal 128 karakter' }
  }

  // Reset password akun yang SUDAH ada harus diminta secara eksplisit.
  // Default mati supaya env var yang lupa dihapus tidak bisa menimpa password
  // akun yang sedang dipakai orang.
  const allowReset = (env.ADMIN_ALLOW_PASSWORD_RESET ?? '').trim().toLowerCase() === 'true'

  return { status: 'ok', username, password, allowReset }
}
