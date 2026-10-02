# Paper Trading V2: riset & konfigurasi

Paper Trading V2 menggantikan menu **Skenario Otomatis**. Ini adalah simulasi portofolio intraday dengan modal virtual **Rp1.000.000**, tanpa fee dan tanpa compounding. Semua angka di dokumen ini berasal dari data, bukan asumsi.

- **Data lama:** 21 scan produksi, 127 trade yang sudah selesai.
- **Data riset:** 13+8 bulan candle 1h dan 5m Binance untuk 21 koin.
- **Kode riset:** `backend/scripts/paper-research/` (bisa diulang).
- **Kode produksi:** `backend/src/services/paper/`. Research dan live memakai modul yang sama: `features.ts`, `strategy.ts`, `portfolio.ts`.

**Pembagian data (anti-overfitting):**

| Set | Periode | Dipakai untuk |
|---|---|---|
| Training | 1 Jan – 31 Des 2025 | mencari pola & memilih parameter |
| Validasi | 1 Jan – 30 Jun 2026 | menolak kandidat yang overfit |
| Test | 1 Jul – 2 Okt 2026 | hanya pengecekan akhir |
| Paper Trading V2 | mulai deploy | data baru sungguhan |

Exit disimulasikan per **candle 5 menit**. Jika TP dan SL tersentuh dalam candle yang sama, hasilnya dihitung sebagai **cut loss** (konservatif).

---

## A. Masalah strategi lama

Data: Paper Trading produksi 28 Sep – 2 Okt 2026, 127 trade selesai.

| Metrik | Nilai |
|---|---|
| TARGET / CUTLOSS / TIMEOUT | 27 (21%) / 87 (69%) / 13 (10%) |
| Win rate P&L > 0 | 24% |
| Rata-rata TARGET / CUTLOSS | +12,7% / −6,2% |
| Median jarak target | +10,5% |
| Median ATR 1h koin yang dibeli | 2,9% (normalnya ±1%) |
| Total | −21,2 USDT |

Penyebab CUTLOSS (87 kasus, satu trade bisa punya beberapa label):

| Kategori | Kasus | % | Bukti |
|---|---|---|---|
| MARKET REGIME | 75 | 86% | BTC turun >1% selama trade, atau BTC sedang BEAR |
| OVEREXPOSURE | 56 | 64% | Koin dibeli lagi saat posisi lama masih terbuka. Sampai **20 posisi bersamaan di NEAR**, dan total investasi mencapai **21× modal**. |
| NO FOLLOW THROUGH | 45 | 52% | Sempat naik, tapi tidak sampai separuh jalan ke target |
| FALSE BREAKOUT | 37 | 43% | Entry di breakout/dekat resistance, lalu harga balik turun |
| REVERSAL | 36 | 41% | Skor koin turun ke SELL saat posisi kena stop |
| BAD ENTRY | 30 | 34% | Harga langsung melawan (MFE < 0,5 ATR) |
| GOOD ENTRY / BAD EXIT | 12 | 14% | Sempat menempuh ≥ 50% jalan ke target, lalu berbalik |

Validasi ulang kesimpulan sebelumnya dengan data:

1. **Re-entry: terbukti.** Posisi ulang menghasilkan 14% TARGET / 75% CUTLOSS dan −22,8 USDT. Posisi unik menghasilkan 30% / 58% dan +1,6 USDT.
2. **Target terlalu jauh: terbukti.** MFE median trade CUTLOSS +2,5%, sedangkan target median +10,5%. Planner sendiri sudah memperkirakan target hanya kena sekitar 25% kali.
3. **"Entry saat harga live < close sinyal": tidak terbukti.** Di backtest 21 bulan filter ini tidak pernah konsisten membantu. Di test malah merugikan (PF 0,92). Temuan lama berasal dari candle 4h/1d yang sudah basi saat scan.
4. **Kondisi BTC: terbukti, tapi dalam bentuk yang berbeda.** Regime 1h (SMA50/200) lemah. Yang robust adalah **tren BTC 30 hari**.
5. **Koin HIGH-risk: sebagian.** Volatilitas tinggi saja bukan masalah (ATR 2–3% justru PF 1,7 di V2). Masalahnya adalah membeli koin yang sedang pump tanpa filter volume/tren.
6. **Swing/Posisi tidak cocok intraday: terbukti.** Swing menyumbang −16 USDT. Gaya Posisi menahan sampai 24 hari.

## B. Entry vs exit vs money management

1. **ENTRY adalah akar masalah.** Sinyal BUY/STRONG BUY dari mesin skor **tidak punya edge intraday**. Dengan TP = SL = 1,5 ATR, hasilnya 45,5% TARGET, sama persis dengan entry di jam acak (45,5%). Ini diuji di 32.000 sinyal BUY selama 2025.
2. **EXIT memperparah.** Target 3 ATR / resistance jauh (median +10,5%) jarang tercapai dalam 1 hari. 61% trade CUTLOSS sempat naik ≥ 2% sebelum berbalik.
3. **MONEY MANAGEMENT mengubah kerugian kecil menjadi besar.** Tidak ada batas eksposur. Setiap scan membuka posisi baru di koin yang sama, sehingga satu pergerakan turun memukul banyak posisi sekaligus.

## C. ATR

Diukur dari trade V2 selama 21 bulan, memakai ATR 1h (% dari harga):

| Zona ATR | n | TARGET | CUTLOSS | PF |
|---|---|---|---|---|
| < 0,5% | 41 | 71% | 17% | 0,90 |
| 0,5–1% | 209 | 75% | 16% | 1,17 |
| 1–1,3% | 163 | 74% | 9% | 1,47 |
| 1,3–2% | 233 | 76% | 13% | 1,38 |
| 2–3% | 103 | 80% | 11% | **1,70** |
| > 3% | 28 | 79% | 14% | 1,49 |

- **Zona terbaik:** ATR 1–3%.
- **Zona terlemah:** ATR < 1%. Pergerakan 0,75 ATR terlalu kecil dibanding noise.
- **ATR percentile tidak monotonik:** P0–20 PF 2,85, P20–40 PF 0,84, P40–100 PF 1,4–1,5. Karena polanya tidak konsisten, ini tidak dijadikan filter. Kalau dipaksakan, hasilnya overfit.
- **Filter ATR minimum tidak dipasang.** Sampel ATR < 0,5% terlalu kecil (41 trade). Ini kandidat yang akan dicek ulang dengan data Paper Trading V2.

## D. TP / SL

- **TP 0,75 × ATR(1h)** dari harga fill. Dengan ATR 1h median sekitar 1,2%, target berkisar +0,9%.
- **SL 2,5 × ATR(1h)** dari harga fill.
- **Timeout 8 jam.**

Kenapa TP kecil dan SL lebar:

- **MFE/MAE.** Trade TARGET punya MFE median 0,75 ATR dan MAE median 0,35 ATR. Trade CUTLOSS punya MFE median hanya 0,19 ATR, jadi umumnya entry yang salah sejak awal, bukan stop yang terlalu ketat.
- **Stop ketat tidak menyelamatkan apa pun.** Breakout volume sering retest dulu sebelum lanjut. Di grid exit, expectancy **tidak turun** saat SL dilebarkan dari 1,5 ke 2,5 ATR (validasi: PF 1,18 → 1,28). Jadi SL lebar dipilih karena expectancy, bukan sekadar supaya CUTLOSS% terlihat kecil.
- **Robustness.** Seluruh 30 kombinasi TP 0,6–0,9 × SL 1,5–2,75 punya PF > 1 di training, validasi, dan test (minimum 1,04). Tidak ada titik "beruntung" tunggal.

**CUTLOSS ≤ 10%.** Bisa dicapai dengan TP 0,5 ATR atau SL 2,75 ATR, tetapi di validasi PF-nya turun ke 0,98–1,21. Dipilih CUTLOSS sekitar **11–15%** karena expectancy-nya positif di ketiga periode. Trade-off-nya: satu cut loss (rata-rata −Rp6.200) menghapus sekitar 3 target (rata-rata +Rp1.950).

## E. BTC regime

- **Rule:** return BTC 30 hari (720 candle 1h) > 0%. Jika tidak terpenuhi, **HOLD CASH** dan tidak ada entry.
- **Bukti:** strategi dip-buying yang paling bagus di training (PF 1,30) runtuh di validasi (PF 0,72). H1 2026 adalah tren turun BTC (−10%, −15%, −20% per bulan). Dari semua filter BTC yang diuji, hanya filter 30 hari yang menjaga breakout tetap positif di ketiga periode.
- **Filter yang ditolak:** regime 1h SMA50/200, EMA20 > EMA50, return 1h/4h/24h > 0, RSI BTC > 50, ATR BTC < 1%. Semuanya tidak konsisten antar periode.

## F. Diversifikasi

- **Korelasi:** korelasi rata-rata antar-altcoin 0,67, dan beta altcoin terhadap BTC 1,4–2,0. Memegang beberapa altcoin sekaligus pada dasarnya adalah **satu taruhan arah BTC**.
- **Tiga klaster** (`strategy.ts`), masing-masing maksimal **50% base**:
  - **MAJOR:** BTC, ETH, BNB.
  - **ALT_BETA:** SOL, AVAX, ADA, NEAR, SUI, LINK, AAVE, UNI, DOGE, XRP, XLM, HBAR. Korelasi ke BTC ≥ 0,66.
  - **IDIOSYNCRATIC:** ZEC, QNT, PUMP, ENA, WLD, MOVR. Korelasi < 0,65.
- **Jumlah aset ideal: 1–3 posisi bersamaan** dari universe 21 koin. Dalam praktik, batas eksposur 70% membuat maksimal 3 posisi penuh. Selama backtest, posisi bersamaan juga tidak pernah lebih dari 3.

## G. Allocation

Alokasi **dinamis per sinyal**, bukan persentase tetap per koin. Contoh saat portofolio penuh:

```text
Total Budget = Rp1.000.000
ZEC  (IDIOSYNCRATIC) 20% = Rp200.000
SOL  (ALT_BETA)      20% = Rp200.000
ETH  (MAJOR)         20% = Rp200.000
CASH                 40% = Rp400.000   (30% cadangan wajib + sisa)
```

Saat tidak ada setup: **CASH 100% = Rp1.000.000**. Selama backtest, rata-rata hanya 2,9% modal yang terinvestasi. Strategi ini sebagian besar waktunya memegang cash, dan itu memang disengaja.

## H. Entry sizing

```text
Entry 1 = 100% (full entry)
```

Varian yang diuji: 50/50, 40/30/30, 50/30/20, dan dinamis. Pada varian-varian itu, layer berikutnya hanya ditambah jika harga ≥ entry terakhir, koin masih BULL, BTC lolos filter, MACD > 0, dan (untuk varian dinamis) volume > 1,5x. **Averaging down tidak pernah diizinkan.**

Hasilnya, PF tidak membaik: training 1,40–1,45 vs 1,41 full, validasi 1,25–1,31 vs 1,29. Layer kedua jarang terisi karena target sudah kena duluan, sehingga efeknya hanya memperkecil posisi. Return turun 30–45% tanpa tambahan edge.

## I. Risk

```text
Risk / Trade                 1% base = Rp10.000 maksimum jika kena SL
                             Ukuran = Rp10.000 / (2,5 × ATR%), dibatasi 20% = Rp200.000
                             (83% trade kena batas ini; rugi CUTLOSS rata-rata ≈ Rp6.200)
Risk / Coin                  = risk / trade (1 posisi per koin, tanpa re-entry selama terbuka)
Maximum Portfolio Risk       3 posisi × ≤ Rp10.000 = ≤ 3% base
Maximum Exposure             70% base (cadangan cash 30%)
Maximum Correlated Exposure  50% base per klaster (maks. 2 posisi penuh di satu klaster)
Maks posisi bersamaan        4 (efektif 3 karena batas eksposur)
```

Hasil grid cash reserve 0–50%: PF hampir sama di semua level (training 1,37–1,43, validasi 1,23–1,38). Cadangan 30% dipilih karena mengerem eksposur saat banyak koin breakout bersamaan, yang biasanya terjadi saat seluruh pasar bergerak serentak, tanpa mengurangi expectancy.

## J–K. Backtest & validasi (portofolio Rp1.000.000)

Kondisi: tanpa fee, tanpa compounding.

| Periode | Strategi | Trade | TARGET | CUTLOSS | TIMEOUT | Expectancy | PF | Return | Max DD | Avg hold |
|---|---|---|---|---|---|---|---|---|---|---|
| Training 2025 | Lama | 1.641 | 31% | 60% | 9% | +0,08% | 1,06 | +26,8% | **−32,1%** | 8,6 j |
| Training 2025 | **V2** | 353 | **75%** | **11%** | 13% | +0,24% | **1,40** | +14,2% | **−4,3%** | 2,6 j |
| Validasi 2026-H1 | Lama | 844 | 33% | 59% | 8% | +0,13% | 1,10 | +21,9% | −12,0% | 7,5 j |
| Validasi 2026-H1 | **V2** | 201 | **74%** | **15%** | 11% | +0,08% | **1,28** | +5,8% | **−3,3%** | 2,4 j |
| Test 2026-Q3 | Lama | 689 | 37% | 53% | 10% | +0,58% | 1,47 | +79,7% | −9,2% | 7,4 j |
| Test 2026-Q3 | **V2** | 223 | **77%** | **13,5%** | 9% | +0,34% | **1,53** | +13,3% | **−3,2%** | 2,3 j |

Detail V2 untuk periode penuh: rata-rata P&L +Rp428/trade, median +Rp1.538, avg win +Rp1.927, avg loss −Rp4.506. Losing streak terpanjang 4 trade (strategi lama: 29).

**Catatan jujur:**

- **Return absolut strategi lama lebih besar dalam backtest tanpa fee.** Penyebabnya: risk 2%, eksposur rata-rata 33%, dan 4× lebih banyak trade. Bayarannya drawdown −32% dan losing streak 29. Di produksi, strategi lama bahkan kehilangan sekitar 35% modal hanya dalam 4 hari.
- **Edge V2 per trade tipis: +0,23%.** Dengan fee realistis, hasilnya jadi:
  - 0,1% pulang-pergi: +0,13% per trade.
  - 0,2%: +0,03%.
  - 0,3%: −0,07%.

  Untuk trading sungguhan, dibutuhkan fee rendah (maker/diskon) dan validasi lebih lanjut.

## L. Robustness

| Variasi | Hasil PF di training / validasi / test |
|---|---|
| TP 0,6–0,9 × SL 1,5–2,75 (30 kombinasi) | Semua > 1. Minimum validasi 1,04 (TP 0,9 / SL 2,75). Sel terpilih: 1,40 / 1,28 / 1,53 |
| Volume ≥ 2 / 2,5 / 3 / 3,5 / 4× | Semua > 1. Hubungannya monotonik: makin besar lonjakan volume, makin baik |
| Hold 2 / 4 / 6 / 8 / 12 / 24 jam | Semua > 1. Validasi tertinggi di 8 jam (1,28) |
| Risk 0,5–1,25% | Semua > 1 (1,21–1,57) |
| Cash reserve 0–50% | Semua > 1 (1,23–1,53) |

Kesimpulan: **parameter stabil, tidak bergantung pada satu titik.**

## M–N. Modal Rp1.000.000 (backtest 1 Jan 2025 – 2 Okt 2026)

```text
Base Capital      Rp1.000.000
Current Equity    Rp1.332.820
Total P&L         +Rp332.820
Return            +33,28%  (21 bulan, tanpa fee, tanpa compounding)
Peak Equity       Rp1.345.980
Maximum Drawdown  −4,31%   (Rp1.156.911 → Rp1.107.054)
Cash              Rp1.332.820 (semua posisi tertutup di akhir periode)
Invested          Rp0
```

**Equity curve:**

- Tab **Riset & Backtest** menampilkan kurva harian beserta penanda awal validasi dan awal test.
- **P&L bulanan:** 3 bulan rugi (Agu 2025, Jan 2026, Agu 2026), masing-masing sekitar −Rp14–15 ribu. Bulan terbaik Sep 2026 (+Rp97.555).
- **Hari tanpa trade:** ada 4 bulan tanpa trade sama sekali (Mar, Nov 2025; Feb, Jun 2026). Itu periode BTC turun 30 hari, dan sistem otomatis menahan cash.

## O. Performa per aset (backtest)

- **Terbaik:** ZEC +Rp104.351 (62 trade), UNI +Rp47.723, ENA +Rp31.388, WLD +Rp27.297, NEAR +Rp26.224.
- **Negatif:** MOVR −Rp35.619, BNB −Rp18.774, XLM −Rp11.034, AAVE −Rp9.197, DOGE −Rp1.161.

Koin negatif **tidak dikeluarkan**. Mengeluarkan aset berdasarkan hasil backtest adalah overfitting. Ini akan dicek ulang dengan data Paper Trading V2.

## P. Konfigurasi final Paper Trading V2

```text
PAPER TRADING V2
Base Capital   Rp1.000.000      Fee 0,1%/sisi (bisa diubah)      Compounding ON (bisa dimatikan)      Top-up manual
Universe       BTC ETH BNB SOL XRP DOGE ADA AVAX LINK NEAR SUI HBAR ENA WLD QNT MOVR AAVE UNI XLM ZEC PUMP (USDT)
Scan           setiap jam, 45 detik setelah candle 1h tutup; exit dicek setiap candle 5 menit
Entry          close 1h > high 20 jam sebelumnya
               volume candle ≥ 3× rata-rata 20 jam
               regime koin BULL (harga > SMA200 1h dan SMA50 > SMA200)
               BTC return 30 hari > 0  (jika tidak → HOLD CASH)
               urutan prioritas: lonjakan volume terbesar
Fill           harga live saat scan
TP / SL        +0,75 × ATR(1h) / −2,5 × ATR(1h)
Timeout        8 jam (jual di harga pasar)
Sizing         Rp10.000 risk / jarak SL, maks Rp200.000 per koin, full entry
Batas          1 posisi per koin · maks 4 posisi · eksposur ≤ 70% · klaster ≤ 50% · cash cadangan 30%
Skip           jika cash tidak cukup, batas eksposur/klaster tercapai, atau koin sudah dipegang
```

Setiap transaksi menyimpan seluruh field pada poin 39 brief:

- **Waktu & sinyal:** timestamp, koin, sinyal, skor.
- **Kondisi pasar:** regime BTC & koin, ATR & percentile, RSI, MACD, volume, momentum 4h.
- **Alokasi:** % dan nominal, layer, entry, TP/SL, timeout.
- **Hasil:** MFE/MAE, exit & alasan, P&L, holding.
- **Portofolio:** eksposur portofolio & klaster, sisa cash, equity.

Capital ledger mencatat setiap BUY/SELL plus titik per jam (cash, invested, realized, unrealized, equity, posisi terbuka, high-water mark, drawdown).

## Fee, compounding & top-up (aktif di Paper Trading V2)

Riset di atas memakai fee 0 dan basis modal tetap, supaya yang terukur adalah edge murni strategi. Di aplikasi ketiganya bisa diatur dari kartu **Biaya, compounding & top-up**:

- **Fee per sisi:** default 0,1% (Binance spot). Dibayar dari cash saat beli dan saat jual. P&L trade selalu bersih dari fee.
- **Compounding:** default ON. Saat ON, risk, batas per koin, cadangan cash, dan batas eksposur dihitung dari equity saat ini. Saat OFF, semuanya dihitung dari modal disetor.
- **Top-up:** menambah cash dan modal disetor, dicatat sebagai `TOPUP` di ledger. Top-up tidak dihitung sebagai profit dan tidak dianggap peak baru di drawdown.

Backtest V2 dengan biaya nyata (21 bulan, `scripts/paper-research/fees.ts`):

| Fee per sisi | Compounding | Expectancy/trade | PF | Return | Max DD |
|---|---|---|---|---|---|
| 0% | OFF | +0,23% | 1,41 | +33,3% | −4,3% |
| 0% | ON | +0,23% | 1,40 | +38,8% | −4,9% |
| 0,075% | OFF | +0,08% | 1,12 | +10,8% | −8,0% |
| 0,075% | ON | +0,08% | 1,12 | +10,9% | −8,4% |
| 0,1% | OFF | +0,03% | 1,04 | +3,3% | −10,1% |
| 0,1% | ON | +0,03% | 1,03 | +2,9% | −10,5% |

Dengan fee 0,1% per sisi, strategi ini hampir impas. Di periode validasi hasilnya negatif (PF 0,91). Compounding hampir tidak berpengaruh karena rata-rata hanya sekitar 3% modal yang terpakai.

## Langkah berikutnya

Sesuai brief poin 34:

1. Jalankan Paper Trading V2 minimal 4–8 minggu, atau sekitar 50–100 trade.
2. Bandingkan dengan ekspektasi backtest: TARGET sekitar 75%, CUTLOSS 11–15%, PF 1,3–1,5, DD < 5%.
3. Jika V2 di paper buruk padahal backtest dan validasi bagus, cek dulu penyebabnya sebelum mengubah parameter:
   - selisih fill harga live,
   - celah data,
   - regime pasar baru.
