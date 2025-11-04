# 🚀 Quick Start - Edit UI Tanpa Backend

## 3 Langkah Simple:

### 1️⃣ Aktifkan Mock Data

Buka Browser Console (`F12` atau `Ctrl+Shift+I`), ketik:

```javascript
localStorage.setItem('USE_MOCK_DATA', 'true')
```

Tekan Enter, lalu refresh halaman (`F5`)

### 2️⃣ Jalankan Frontend Saja

```bash
cd client
npm run dev
```

Buka http://localhost:5173

### 3️⃣ Edit UI Sesuka Hati!

Sekarang Anda bisa:
- ✅ Edit styling di `client/src/App.css`
- ✅ Edit components di `client/src/components/`
- ✅ Lihat perubahan langsung (hot reload)
- ✅ Tidak perlu backend running!
- ✅ Tidak perlu database!
- ✅ Tidak perlu Facebook API!

## 🎯 Apa yang Akan Terlihat?

Banner ungu dengan emoji 🎭 akan muncul di atas, menunjukkan Anda dalam **UI Development Mode**.

UI akan menampilkan:
- 3 Demo Ad Accounts
- 5 Demo Campaigns dengan data metrics
- User: `demo_user`
- Facebook Status: Connected

## 🔄 Cara Mematikan Mock Data

**Option 1: Via Banner**
- Klik tombol "Disable Mock Mode" di banner ungu

**Option 2: Via Console**
```javascript
localStorage.removeItem('USE_MOCK_DATA')
```

Lalu refresh halaman.

## 📝 Tambah Data Dummy

Edit file: `client/src/mockData.js`

Contoh menambah campaign baru:

```javascript
{
  id: "camp_new_001",
  account_id: "act_123456789",
  name: "My Test Campaign",
  status: "ACTIVE",
  // ... copy dari campaign yang ada
}
```

## ❓ Troubleshooting

**Mock data tidak muncul?**
- Pastikan localStorage sudah di-set:
  ```javascript
  console.log(localStorage.getItem('USE_MOCK_DATA'))
  ```
- Hard refresh: `Ctrl+Shift+R`

**Masih minta backend?**
- Cek apakah ada emoji 🎭 di console logs
- Pastikan sudah refresh setelah set localStorage

---

**Untuk dokumentasi lengkap:** Baca `MOCK_DATA_GUIDE.md`
