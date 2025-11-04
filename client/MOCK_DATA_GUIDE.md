# 🎭 Mock Data Guide - UI Development Mode

## Overview

Sistem ini memungkinkan Anda untuk mengembangkan dan mengedit UI **tanpa perlu backend yang berjalan**. Semua data akan menggunakan mock data (data palsu) yang sudah disediakan.

## 🚀 Cara Mengaktifkan Mock Data

Ada **2 cara** untuk mengaktifkan mock data:

### Cara 1: Menggunakan Browser Console (Recommended)

1. Buka browser Anda (Chrome/Firefox/Edge)
2. Tekan `F12` atau `Ctrl+Shift+I` untuk membuka Developer Tools
3. Pilih tab **Console**
4. Ketik command berikut dan tekan Enter:

```javascript
localStorage.setItem('USE_MOCK_DATA', 'true')
```

5. Refresh halaman dengan `Ctrl+R` atau `F5`

**Untuk Mematikan Mock Data:**

```javascript
localStorage.removeItem('USE_MOCK_DATA')
```

Lalu refresh halaman.

### Cara 2: Environment Variable (untuk Development)

Buat file `.env.local` di folder `client/`:

```bash
VITE_USE_MOCK_DATA=true
```

Lalu restart development server.

## ✅ Cara Mengecek Mock Data Aktif

Setelah mengaktifkan mock data dan refresh halaman, buka Console (F12) dan Anda akan melihat pesan:

```
🎭 Using mock auth data
🎭 Using mock Facebook connection data
🎭 Using mock ad accounts data
🎭 Using mock campaigns data
```

Jika Anda melihat emoji 🎭 (topeng teater) di console, berarti mock data sudah aktif!

## 📦 Mock Data yang Tersedia

### 1. **User Authentication**
- Username: `demo_user`
- Email: `demo@example.com`
- Status: Authenticated ✅

### 2. **Facebook Connection**
- Status: Connected ✅
- 2 Business Accounts
- 4 Facebook Pages

### 3. **Ad Accounts**
- **Demo Ad Account 1** (act_123456789)
- **Demo Ad Account 2** (act_987654321)
- **Test Account - Marketing** (act_555444333)

### 4. **Campaigns**
Account 1 memiliki 3 campaigns:
- ✅ Summer Sale Campaign (ACTIVE)
- ✅ Brand Awareness Q1 (ACTIVE)
- ⏸️ Product Launch - Old (PAUSED)

Account 2 memiliki 2 campaigns:
- ✅ Holiday Special Offers (ACTIVE)
- ✅ Retargeting Campaign (ACTIVE)

## 🎨 Keuntungan Menggunakan Mock Data

1. ✅ **Tidak perlu backend running** - Fokus pada UI development
2. ✅ **Tidak perlu database** - Data sudah tersedia di frontend
3. ✅ **Tidak perlu Facebook API** - Tidak perlu setup OAuth dan tokens
4. ✅ **Fast development** - Instant reload tanpa network delay
5. ✅ **Safe testing** - Tidak akan merusak data production

## 🛠️ Cara Menambah Mock Data

Edit file `client/src/mockData.js` untuk menambah:

### Menambah Ad Account:

```javascript
export const mockAdAccounts = [
  {
    account_id: "act_111222333",
    name: "My New Account",
    currency: "USD",
    account_status: 1,
  },
  // ... existing accounts
];
```

### Menambah Campaign:

```javascript
export const mockCampaigns = [
  {
    id: "camp_999",
    account_id: "act_123456789", // Link ke account
    name: "My New Campaign",
    status: "ACTIVE",
    objective: "CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    daily_budget: "10000",
    created_time: "2024-02-01T10:00:00",
    insights: {
      data: [
        {
          spend: "5000.00",
          clicks: "1500",
          impressions: "50000",
        },
      ],
    },
  },
  // ... existing campaigns
];
```

## 🔄 Switch Antara Mock dan Real API

### Development Workflow:

```bash
# 1. UI Development dengan Mock Data
localStorage.setItem('USE_MOCK_DATA', 'true')
# Edit UI components...

# 2. Testing dengan Real Backend
localStorage.removeItem('USE_MOCK_DATA')
# Pastikan backend running: npm run s
```

## ⚠️ Catatan Penting

1. **Mock data hanya untuk frontend development**
   - Tidak ada data yang tersimpan ke database
   - Logout akan me-refresh page, bukan redirect ke login

2. **Fitur yang tidak berfungsi dengan mock data:**
   - Upload creatives (memerlukan backend)
   - Facebook OAuth connection (memerlukan Facebook API)
   - Data persistence (semua changes hilang saat refresh)

3. **Best Practice:**
   - Gunakan mock data untuk UI styling dan layout
   - Gunakan real backend untuk testing functional features
   - Selalu test dengan real API sebelum commit

## 🐛 Troubleshooting

### Mock data tidak muncul?

1. Cek console apakah ada emoji 🎭
2. Pastikan localStorage sudah di-set dengan benar:
   ```javascript
   console.log(localStorage.getItem('USE_MOCK_DATA')) // should return "true"
   ```
3. Hard refresh: `Ctrl+Shift+R` (Windows) atau `Cmd+Shift+R` (Mac)

### Data masih loading dari API?

- Pastikan tidak ada service worker yang cache API calls
- Clear browser cache dan reload

### Ingin tambah mock data baru tapi tidak muncul?

- Check syntax di `mockData.js`
- Pastikan import statement di component sudah benar
- Check console untuk error messages

## 📞 Support

Jika ada pertanyaan atau issues:
1. Check console logs untuk error messages
2. Lihat `client/src/mockData.js` untuk reference
3. Pastikan semua imports sudah benar

---

**Happy UI Development! 🎨**
