# Analisis Aturan dan Filter Facebook Ads pada Proyek

Dokumen ini merangkum hasil analisis antara aturan Facebook Ads yang diberikan dengan implementasi yang ada di dalam proyek ini. Tujuannya adalah untuk mendokumentasikan area mana yang sudah sesuai dan area mana yang memerlukan perubahan untuk pengembangan di masa depan.

## Ringkasan Status Implementasi

Berdasarkan tabel aturan yang diberikan, implementasi filter di dalam proyek saat ini bersifat **parsial**.

### ✓ Sudah Sesuai

*   **Pemetaan Objektif ke Goal (Dasar):** Sistem sudah bisa mengubah Objektif Kampanye menjadi `Optimization Goal` secara otomatis, meskipun masih terbatas pada satu pilihan yang sudah ditentukan.
*   **Validasi `promoted_object` (Backend):** Server sudah memiliki beberapa validasi dasar untuk `promoted_object` (misalnya, mewajibkan `page_id` untuk `LEAD_GENERATION`).
*   **Penanganan Awal Special Ad Category:** Antarmuka pengguna (UI) sudah mencoba menangani *Special Ad Category* dengan menyembunyikan beberapa opsi targeting.

### ✗ Belum Sesuai / Belum Lengkap

*   **Aturan Special Ad Category:** Logika untuk membatasi objektif kampanye dan mengunci opsi targeting (usia, lokasi, dll) sesuai aturan belum diimplementasikan dengan benar.
*   **Fleksibilitas Optimization Goal:** Pengguna tidak bisa memilih `Optimization Goal` alternatif yang valid untuk sebuah objektif kampanye (misalnya, memilih antara `LEAD_GENERATION` atau `OFFSITE_CONVERSIONS` untuk objektif `OUTCOME_LEADS`).
*   **Detail `promoted_object`:** UI tidak sepenuhnya dinamis dalam menampilkan input yang wajib (seperti `page_id` atau `application_id`), dan backend tidak memvalidasi `custom_event_type` secara spesifik (misal, `PURCHASE` atau `LEAD`).

---

## Rincian Perubahan yang Diperlukan

Untuk menyelaraskan proyek dengan aturan yang ada, diperlukan perubahan yang cukup signifikan di dua area utama:

### 1. Frontend (Tampilan Pengguna - `public/script.js`)

*   **Membuat Dropdown Menjadi Dinamis:**
    *   Saat *Special Ad Category* dipilih, dropdown "Objektif Kampanye" harus memfilter isinya untuk hanya menampilkan objektif yang diizinkan.
    *   Saat "Objektif Kampanye" dipilih, dropdown "Optimization Goal" harus menampilkan **semua** pilihan yang valid sesuai tabel, dan membiarkan pengguna memilih.

*   **Membuat Form Menjadi Lebih Adaptif:**
    *   Form pembuatan Ad Set harus secara dinamis menampilkan/menyembunyikan dan mewajibkan input seperti `Pixel`, `Facebook Page`, atau `Application ID` berdasarkan `Optimization Goal` yang dipilih.

*   **Mengunci Opsi Targeting (Bukan Menyembunyikan):**
    *   Untuk kampanye dengan *Special Ad Category*, form targeting (usia, gender, lokasi) seharusnya tidak disembunyikan, melainkan **dikunci** ke nilai yang diwajibkan oleh Facebook (misal: Usia diatur ke 18-65 dan tidak bisa diubah).

### 2. Backend (Logika Server - `server.js`)

*   **Validasi Endpoint `create-campaign`:**
    *   Menambahkan logika untuk memvalidasi bahwa `objective` yang dipilih memang diizinkan untuk `special_ad_categories` yang diberikan.

*   **Validasi Endpoint `create-ad-set`:**
    *   **Validasi Targeting:** Menambahkan pemeriksaan baru. Jika sebuah Ad Set terhubung ke kampanye dengan *Special Ad Category*, server harus memvalidasi bahwa data `targeting` yang masuk sudah sesuai dengan batasan (usia, lokasi, dll).
    *   **Validasi `custom_event_type`:** Memperketat logika untuk `OFFSITE_CONVERSIONS`. Server harus memeriksa objektif kampanyenya (`OUTCOME_LEADS` atau `OUTCOME_SALES`) dan memastikan `custom_event_type` yang dikirim sesuai (misalnya, `LEAD` atau `PURCHASE`).

## Kesimpulan

Perubahan yang dibutuhkan bersifat mendasar dan akan menyentuh alur utama aplikasi. Ini bukan perbaikan sederhana, melainkan penambahan logika bisnis yang penting untuk memastikan semua iklan yang dibuat melalui aplikasi ini patuh pada aturan Facebook.
