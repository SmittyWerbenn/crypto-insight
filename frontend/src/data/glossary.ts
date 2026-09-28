/**
 * Kamus istilah (glossary) dalam Bahasa Indonesia.
 * `aliases` dipakai untuk mencocokkan label di UI secara otomatis (tanpa beda huruf besar/kecil)
 * sehingga tooltip penjelasan muncul di mana pun istilah itu tampil.
 */
export type GlossaryCategory = 'Dasar' | 'Indikator' | 'Harga & Level' | 'Sinyal & Skor' | 'Risiko & Performa' | 'Backtest' | 'Derivatif & Sentimen';

export interface GlossaryTerm {
  id: string;
  term: string;
  category: GlossaryCategory;
  /** Satu kalimat — dipakai di tooltip. */
  short: string;
  /** Penjelasan lengkap untuk halaman kamus. */
  long: string;
  /** Contoh konkret. */
  example?: string;
  /** Cara membacanya di aplikasi ini. */
  inApp?: string;
  aliases?: string[];
}

export const GLOSSARY: GlossaryTerm[] = [
  // ─── Dasar ──────────────────────────────────────────────
  {
    id: 'candle',
    term: 'Candle (Candlestick)',
    category: 'Dasar',
    short: 'Satu "batang" harga untuk satu periode waktu: harga buka, tertinggi, terendah, dan tutup.',
    long: 'Candle merangkum pergerakan harga dalam satu periode (mis. 4 jam). Badan candle menunjukkan harga buka (open) dan tutup (close); sumbu atas/bawah menunjukkan harga tertinggi (high) dan terendah (low). Candle hijau berarti harga tutup lebih tinggi dari harga buka, merah sebaliknya.',
    example: 'Candle 4J pukul 07:00–10:59 WIB: buka Rp 1,35 M, tertinggi Rp 1,37 M, terendah Rp 1,34 M, tutup Rp 1,36 M → candle hijau.',
    inApp: 'Semua analisa memakai candle yang sudah close (selesai), sehingga sinyal tidak berubah-ubah di tengah candle.',
    aliases: ['candle'],
  },
  {
    id: 'timeframe',
    term: 'Timeframe',
    category: 'Dasar',
    short: 'Panjang periode setiap candle, mis. 1 jam (1J), 4 jam (4J), atau 1 hari (1H).',
    long: 'Timeframe menentukan "zoom" analisa. Timeframe kecil (1J) cocok untuk trading harian dengan pergerakan cepat; timeframe besar (1H/1 hari) untuk posisi berhari-hari hingga berminggu-minggu. Sinyal di timeframe berbeda bisa berbeda arah.',
    inApp: 'Di Rencana Trading, "Harian" memakai 1J, "Swing" 4J, dan "Posisi" 1 hari.',
    aliases: ['timeframe', 'timeframes'],
  },
  {
    id: 'usdt',
    term: 'USDT & Kurs Rupiah',
    category: 'Dasar',
    short: 'USDT adalah stablecoin yang nilainya mengikuti dolar AS; harga Binance dalam USDT dikonversi ke Rupiah untuk tampilan.',
    long: 'Hampir semua pasangan di Binance diperdagangkan terhadap USDT (Tether). Aplikasi mengambil kurs USDT→IDR terkini lalu mengonversi semua harga dan nominal ke Rupiah. Perhitungan internal tetap dalam USDT, sehingga persentase (naik/turun, ROI) tidak terpengaruh kurs.',
    example: 'BTC Rp 1,36 M = 84.800 USDT × kurs Rp 16.050.',
    inApp: 'Kurs tampil di header. Mata uang bisa diganti di Pengaturan.',
    aliases: ['kurs', 'usdt'],
  },
  {
    id: 'market-cap',
    term: 'Kapitalisasi Pasar (Market Cap)',
    category: 'Dasar',
    short: 'Nilai total seluruh koin yang beredar = harga × jumlah koin beredar.',
    long: 'Kapitalisasi pasar menunjukkan "ukuran" sebuah aset atau seluruh pasar kripto. Total market cap naik berarti secara umum uang masuk ke pasar kripto.',
    aliases: ['kapitalisasi pasar', 'total kapitalisasi pasar', 'market cap'],
  },
  {
    id: 'btc-dominance',
    term: 'Dominasi BTC',
    category: 'Dasar',
    short: 'Porsi kapitalisasi Bitcoin dibanding seluruh pasar kripto.',
    long: 'Dominasi BTC naik biasanya berarti dana berpindah ke Bitcoin (altcoin cenderung tertinggal); dominasi turun sering terjadi saat altcoin menguat ("altseason").',
    aliases: ['dominasi btc', 'btc dominance'],
  },
  {
    id: 'volume',
    term: 'Volume',
    category: 'Dasar',
    short: 'Jumlah koin (atau nilai) yang diperdagangkan dalam satu periode.',
    long: 'Volume mengukur seberapa aktif sebuah pasar. Kenaikan harga dengan volume tinggi dianggap lebih "meyakinkan" dibanding kenaikan dengan volume tipis.',
    inApp: '"Volume vs MA20" membandingkan volume candle terakhir dengan rata-rata 20 candle; 1,5x berarti 50% di atas rata-rata.',
    aliases: ['volume', 'volume 24j', 'volume vs ma20', 'volume usdt binance', 'volume global 24j'],
  },
  {
    id: 'breadth',
    term: 'Market Breadth',
    category: 'Dasar',
    short: 'Perbandingan jumlah koin yang naik vs turun — mengukur seberapa merata kenaikan/penurunan pasar.',
    long: 'Jika hanya BTC yang naik tetapi mayoritas koin turun, breadth negatif: kenaikan tidak merata. Breadth positif berarti mayoritas koin ikut naik.',
    aliases: ['breadth pasar', 'market breadth', 'pasar keseluruhan'],
  },
  {
    id: 'bull-bear',
    term: 'Bullish, Bearish & Sideways',
    category: 'Dasar',
    short: 'Bullish = cenderung naik, Bearish = cenderung turun, Sideways = bergerak mendatar.',
    long: 'Di aplikasi ini kondisi "Bull Market" berarti harga di atas MA200 dan MA50 di atas MA200; "Bear Market" kebalikannya; selain itu dianggap sideways.',
    aliases: ['kondisi pasar', 'bullish', 'bearish'],
  },

  // ─── Indikator ──────────────────────────────────────────
  {
    id: 'ma',
    term: 'Moving Average (MA / SMA)',
    category: 'Indikator',
    short: 'Rata-rata harga penutupan N candle terakhir; dipakai untuk melihat arah tren.',
    long: 'MA20 = rata-rata 20 candle (tren pendek), MA50 (menengah), MA200 (panjang). Harga di atas MA menandakan tren naik pada periode tersebut. MA20 di atas MA50 dan MA50 di atas MA200 adalah struktur tren naik yang sehat.',
    example: 'Jika harga BTC Rp 1,36 M dan MA50 Rp 1,33 M, harga berada di atas MA50 (positif).',
    inApp: 'Garis biru (MA20), oranye (MA50), dan ungu (MA200) di grafik.',
    aliases: ['sma 20 / 50 / 200', 'ma20', 'ma50', 'ma200', 'moving average'],
  },
  {
    id: 'ema',
    term: 'EMA (Exponential Moving Average)',
    category: 'Indikator',
    short: 'Moving average yang memberi bobot lebih besar pada harga terbaru sehingga lebih cepat bereaksi.',
    long: 'EMA bereaksi lebih cepat dari SMA terhadap perubahan harga. Strategi Trend Following memakai EMA20 dan EMA50.',
    aliases: ['ema 20 / 50', 'ema'],
  },
  {
    id: 'rsi',
    term: 'RSI (Relative Strength Index)',
    category: 'Indikator',
    short: 'Indikator momentum 0–100: di atas 70 = overbought (sudah naik tinggi), di bawah 30 = oversold.',
    long: 'RSI membandingkan besarnya kenaikan dan penurunan dalam 14 candle terakhir. RSI 50–70 umumnya menunjukkan momentum naik yang sehat; di atas 70 harga sudah naik kencang sehingga rawan koreksi; di bawah 30 harga sudah turun dalam.',
    example: 'RSI 62 → momentum naik, belum overbought.',
    inApp: 'Panel RSI di bawah grafik, garis putus-putus di 30 dan 70.',
    aliases: ['rsi', 'rsi (14)', 'rsi min', 'rsi max'],
  },
  {
    id: 'macd',
    term: 'MACD',
    category: 'Indikator',
    short: 'Selisih EMA12 dan EMA26; persilangan dengan garis sinyal menandai perubahan momentum.',
    long: 'MACD di atas garis sinyal (histogram positif) = momentum bullish. "Bullish crossover" terjadi saat MACD memotong ke atas garis sinyal; "bearish crossover" saat memotong ke bawah — sering dipakai sebagai tanda keluar.',
    inApp: 'Panel paling bawah di grafik: histogram hijau/merah, garis biru (MACD) dan oranye (sinyal).',
    aliases: ['macd', 'macd / signal / hist'],
  },
  {
    id: 'bollinger',
    term: 'Bollinger Bands',
    category: 'Indikator',
    short: 'Pita di atas dan bawah MA20 selebar 2 standar deviasi; mengukur apakah harga "terlalu jauh".',
    long: 'Harga di dekat pita atas berarti relatif tinggi dibanding biasanya; di dekat pita bawah relatif rendah. %B = posisi harga di dalam pita (0 = pita bawah, 1 = pita atas). Pita menyempit menandakan volatilitas rendah, sering mendahului pergerakan besar.',
    aliases: ['bollinger', 'bollinger %b', 'bollinger bands'],
  },
  {
    id: 'atr',
    term: 'ATR (Average True Range)',
    category: 'Indikator',
    short: 'Rata-rata jarak pergerakan harga per candle — ukuran volatilitas dalam satuan harga.',
    long: 'ATR dipakai untuk menentukan stop loss dan target yang wajar: stop yang lebih sempit dari 1 ATR mudah tersentuh oleh "noise" biasa.',
    example: 'ATR BTC 4J Rp 11 juta → dalam satu candle 4 jam, harga rata-rata bergerak sekitar Rp 11 juta.',
    aliases: ['atr', 'atr (14)'],
  },
  {
    id: 'adx',
    term: 'ADX',
    category: 'Indikator',
    short: 'Mengukur kekuatan tren (bukan arahnya): di atas 25 = sedang trending, di bawah 20 = sideways.',
    long: 'ADX tinggi berarti harga bergerak searah dengan kuat. Strategi mengikuti tren lebih cocok saat ADX tinggi.',
    aliases: ['adx'],
  },
  {
    id: 'stochrsi',
    term: 'Stochastic RSI',
    category: 'Indikator',
    short: 'Posisi RSI dibanding rentangnya sendiri; garis K di atas D menandakan momentum naik jangka pendek.',
    long: 'Stoch RSI lebih sensitif dari RSI dan sering dipakai untuk konfirmasi momentum jangka pendek.',
    aliases: ['stoch rsi k / d', 'stochastic rsi'],
  },
  {
    id: 'roc',
    term: 'ROC (Rate of Change)',
    category: 'Indikator',
    short: 'Persentase perubahan harga dibanding N candle yang lalu.',
    long: 'ROC(10) +3% berarti harga 3% lebih tinggi dibanding 10 candle sebelumnya.',
    aliases: ['roc (10)', 'roc'],
  },
  {
    id: 'obv',
    term: 'OBV (On-Balance Volume)',
    category: 'Indikator',
    short: 'Akumulasi volume: bertambah saat candle naik, berkurang saat candle turun.',
    long: 'OBV yang naik menandakan volume lebih banyak di candle naik (akumulasi/pembelian).',
    aliases: ['obv slope (10)', 'obv'],
  },
  {
    id: 'volatility',
    term: 'Volatilitas',
    category: 'Indikator',
    short: 'Seberapa besar dan cepat harga naik-turun. Volatilitas tinggi = potensi untung & rugi lebih besar.',
    long: 'Volatilitas historis tahunan dihitung dari fluktuasi return 20 candle terakhir. Kripto umumnya 40–100%/tahun.',
    aliases: ['volatilitas', 'volatilitas historis (tahunan)'],
  },

  // ─── Harga & Level ─────────────────────────────────────
  {
    id: 'support',
    term: 'Support',
    category: 'Harga & Level',
    short: 'Area harga di bawah harga saat ini yang sebelumnya menahan penurunan.',
    long: 'Support diambil dari titik terendah (swing low) yang sudah terkonfirmasi. Jika harga menembus support ke bawah (breakdown), penurunan bisa berlanjut.',
    aliases: ['support'],
  },
  {
    id: 'resistance',
    term: 'Resistance',
    category: 'Harga & Level',
    short: 'Area harga di atas harga saat ini yang sebelumnya menahan kenaikan.',
    long: 'Resistance diambil dari titik tertinggi (swing high) yang terkonfirmasi. Harga yang menembus resistance dengan volume besar (breakout) sering melanjutkan kenaikan.',
    aliases: ['resistance'],
  },
  {
    id: 'breakout',
    term: 'Breakout & Breakdown',
    category: 'Harga & Level',
    short: 'Breakout = harga tutup di atas rentang 20 candle; breakdown = tutup di bawahnya.',
    long: 'Breakout menandakan kekuatan pembeli, breakdown kekuatan penjual. Breakout dengan volume rendah lebih mudah gagal.',
    aliases: ['breakout', 'breakdown'],
  },
  {
    id: 'structure',
    term: 'Struktur Harga (HH/HL, LH/LL)',
    category: 'Harga & Level',
    short: 'Higher high & higher low = tren naik; lower high & lower low = tren turun.',
    long: 'Setiap puncak dan lembah dibandingkan dengan sebelumnya. Puncak dan lembah yang makin tinggi adalah definisi klasik tren naik.',
    aliases: ['struktur'],
  },
  {
    id: 'entry',
    term: 'Harga Beli (Entry)',
    category: 'Harga & Level',
    short: 'Harga acuan untuk membeli, yaitu harga penutupan candle terakhir.',
    long: 'Karena harga terus bergerak, beli "di sekitar" harga ini. Jika harga sudah jauh di atas entry, rasio untung:rugi rencana menjadi lebih buruk.',
    aliases: ['harga acuan masuk', 'beli di sekitar', 'masuk', 'entry'],
  },
  {
    id: 'take-profit',
    term: 'Target / Take Profit',
    category: 'Harga & Level',
    short: 'Harga untuk menjual dan mengambil keuntungan.',
    long: 'Target dihitung dari resistance, swing high, atau Bollinger atas terdekat yang memberi rasio untung:rugi minimal 1,5. Jika tidak ada, dipakai proyeksi 3×ATR.',
    aliases: ['target', 'take profit', 'take profit (%)', 'jual (ambil untung) di'],
  },
  {
    id: 'stop-loss',
    term: 'Stop Loss / Cut Loss',
    category: 'Harga & Level',
    short: 'Harga untuk menjual dan membatasi kerugian jika analisa salah.',
    long: 'Stop ditempatkan sedikit di bawah support terdekat (atau 1,5×ATR di bawah harga). Disiplin cut loss adalah kunci agar satu kerugian tidak menghapus banyak keuntungan.',
    example: 'Beli Rp 1.000, stop Rp 950 → jika kena, rugi 5% dari posisi.',
    aliases: ['stop', 'stop loss', 'stop loss (%)', 'cut loss di', 'invalidasi'],
  },
  {
    id: 'risk-reward',
    term: 'Risk / Reward (Rasio Untung:Rugi)',
    category: 'Harga & Level',
    short: 'Perbandingan potensi untung (ke target) dengan potensi rugi (ke stop).',
    long: 'R:R 2 berarti potensi untung dua kali potensi rugi. Dengan R:R 2, win rate 34% saja sudah bisa impas sebelum biaya.',
    aliases: ['risiko / imbalan', 'risk / reward', 'rasio untung/rugi terealisasi'],
  },
  {
    id: 'upside-downside',
    term: 'Potensi Naik / Turun',
    category: 'Harga & Level',
    short: 'Jarak persentase dari harga sekarang ke target (naik) dan ke stop (turun).',
    long: 'Upside = (target − harga) / harga; downside = (stop − harga) / harga. Ini adalah skenario berdasarkan level teknikal, bukan prediksi.',
    aliases: ['potensi naik', 'potensi turun', 'naik / turun'],
  },
  {
    id: 'scenario',
    term: 'Skenario Bullish / Dasar / Bearish',
    category: 'Harga & Level',
    short: 'Tiga kemungkinan jalur harga beserta pemicunya, dihitung dari level support/resistance.',
    long: 'Bullish: jika harga menembus resistance → menuju resistance berikutnya. Dasar: bergerak di antara support dan resistance. Bearish: jika support jebol → menuju support berikutnya.',
    aliases: ['skenario'],
  },

  // ─── Sinyal & Skor ──────────────────────────────────────
  {
    id: 'signal',
    term: 'Sinyal (Beli Kuat … Jual Kuat)',
    category: 'Sinyal & Skor',
    short: 'Kategori dari skor teknikal: 80–100 Beli Kuat, 65–79 Beli, 45–64 Tahan, 30–44 Jual/Kurangi, 0–29 Jual Kuat.',
    long: 'Sinyal adalah ringkasan analitis, bukan perintah trading. Aplikasi tidak pernah membeli atau menjual otomatis.',
    aliases: ['sinyal'],
  },
  {
    id: 'technical-score',
    term: 'Skor Teknikal',
    category: 'Sinyal & Skor',
    short: 'Checklist berbobot 0–100 dari RSI, MACD, moving average, volume, Bollinger, momentum, dan struktur harga.',
    long: 'Setiap komponen memberi poin sesuai bobotnya (lihat "Rincian Skor"). Skor BUKAN probabilitas: skor 80 tidak berarti peluang naik 80%.',
    aliases: ['skor teknikal', 'skor'],
  },
  {
    id: 'ai-confidence',
    term: 'Keyakinan AI',
    category: 'Sinyal & Skor',
    short: 'Seberapa konsisten dan lengkap data pendukung analisa — BUKAN peluang untung.',
    long: 'Keyakinan diturunkan otomatis jika data tidak lengkap atau sampel historis sedikit; "N/A" jika data tidak cukup untuk menilai.',
    aliases: ['keyakinan ai'],
  },
  {
    id: 'similar-setups',
    term: 'Setup Serupa & Tingkat Positif Historis',
    category: 'Sinyal & Skor',
    short: 'Berapa kali kondisi teknikal yang mirip terjadi di masa lalu, dan berapa persen yang kemudian naik.',
    long: 'Setup serupa dicari dari RSI (±7,5), arah MACD, posisi harga terhadap MA20/MA50, dan volume. Tingkat positif historis = persentase kasus dengan return positif setelah 6 candle. Ini perilaku masa lalu, bukan ramalan.',
    aliases: ['setup serupa', 'tingkat positif historis', 'win rate hist.', 'win hist.'],
  },
  {
    id: 'sample-size',
    term: 'Jumlah Sampel (n)',
    category: 'Sinyal & Skor',
    short: 'Banyaknya kasus historis yang mendasari sebuah statistik. Makin banyak, makin andal.',
    long: 'Di bawah 10 kasus: kurang; 10–29: terbatas; 30–99: cukup; 100+: andal. Statistik dari sampel kecil bisa sangat menyesatkan.',
    aliases: ['jumlah sampel', 'n'],
  },

  // ─── Risiko & Performa ─────────────────────────────────
  {
    id: 'win-rate',
    term: 'Win Rate',
    category: 'Risiko & Performa',
    short: 'Persentase trade yang untung.',
    long: 'Win rate tinggi belum tentu menguntungkan: jika kerugian jauh lebih besar dari keuntungan, hasil akhir tetap rugi. Lihat bersama Profit Factor dan Expectancy.',
    aliases: ['win rate', 'target tercapai (historis)'],
  },
  {
    id: 'roi',
    term: 'ROI (Return on Investment)',
    category: 'Risiko & Performa',
    short: 'Persentase keuntungan atau kerugian terhadap modal awal.',
    long: 'ROI = (modal akhir − modal awal) / modal awal × 100%.',
    aliases: ['roi', 'roi beli & tahan'],
  },
  {
    id: 'drawdown',
    term: 'Drawdown & Max Drawdown',
    category: 'Risiko & Performa',
    short: 'Penurunan nilai modal dari titik tertinggi sebelumnya; max drawdown = penurunan terdalam.',
    long: 'Max drawdown −20% berarti pada suatu saat modal pernah turun 20% dari puncaknya. Ini ukuran "sakitnya" sebuah strategi.',
    aliases: ['drawdown', 'max drawdown', 'max drawdown (dalam trade)', 'median max drawdown'],
  },
  {
    id: 'profit-factor',
    term: 'Profit Factor',
    category: 'Risiko & Performa',
    short: 'Total untung dibagi total rugi. Di atas 1 = menguntungkan secara keseluruhan.',
    long: 'Profit factor 1,5 berarti setiap Rp 1 kerugian dibalas Rp 1,5 keuntungan.',
    aliases: ['profit factor'],
  },
  {
    id: 'expectancy',
    term: 'Expectancy / Rata-rata Hasil per Trade',
    category: 'Risiko & Performa',
    short: 'Rata-rata untung atau rugi per trade setelah biaya — angka paling penting untuk menilai strategi.',
    long: 'Expectancy positif berarti, rata-rata, setiap trade menghasilkan untung. Di Rencana Trading, angka ini diambil dari simulasi rencana yang sama pada semua sinyal beli historis.',
    aliases: ['ekspektansi', 'rata-rata hasil / trade', 'estimasi nilai harapan'],
  },
  {
    id: 'sharpe',
    term: 'Sharpe, Sortino & Calmar Ratio',
    category: 'Risiko & Performa',
    short: 'Ukuran return dibanding risiko. Makin tinggi makin baik; di atas 1 dianggap bagus.',
    long: 'Sharpe membandingkan return dengan seluruh fluktuasi; Sortino hanya dengan fluktuasi turun; Calmar membandingkan return tahunan dengan max drawdown.',
    aliases: ['sharpe', 'rasio sharpe', 'sortino', 'calmar'],
  },
  {
    id: 'var',
    term: 'Value at Risk (VaR 95%)',
    category: 'Risiko & Performa',
    short: 'Kerugian per candle yang hanya terlampaui pada 5% candle terburuk secara historis.',
    long: 'VaR 2% berarti pada 95% candle, kerugian portofolio tidak melebihi 2%.',
    aliases: ['value at risk 95%'],
  },
  {
    id: 'mfe-mae',
    term: 'MFE & MAE',
    category: 'Risiko & Performa',
    short: 'MFE = untung terbesar yang sempat dicapai selama trade; MAE = rugi terdalam yang sempat dialami.',
    long: 'Jika MFE sering jauh di atas hasil akhir, target mungkin terlalu jauh atau exit terlambat. Jika MAE sering mendekati stop, stop mungkin terlalu sempit.',
    aliases: ['rata-rata mfe', 'rata-rata mae', 'mfe / mae', 'mfe', 'mae'],
  },
  {
    id: 'position-size',
    term: 'Ukuran Posisi & Risiko per Posisi',
    category: 'Risiko & Performa',
    short: 'Berapa banyak modal yang dipakai untuk satu koin, dihitung agar kerugian saat stop tetap kecil.',
    long: 'Profil moderat membatasi kerugian ±1% modal per posisi. Contoh: modal Rp 10 juta, stop −5% → posisi maksimal Rp 2 juta (rugi Rp 100 ribu jika stop kena).',
    aliases: ['ukuran posisi (% ekuitas)', 'risiko per posisi', 'modal dipakai', 'profil risiko'],
  },
  {
    id: 'hold-time',
    term: 'Lama Tahan',
    category: 'Risiko & Performa',
    short: 'Estimasi berapa lama posisi ditahan sampai target, berdasarkan median kasus historis yang berhasil.',
    long: 'Jika target belum tercapai sampai batas waktu (24 candle), rencana menyarankan menjual untuk membebaskan modal.',
    aliases: ['estimasi lama tahan', 'rata-rata lama tahan', 'lama tahan (candle)'],
  },
  {
    id: 'unrealized',
    term: 'Untung/Rugi Belum Terealisasi',
    category: 'Risiko & Performa',
    short: 'Selisih nilai aset sekarang dengan modal belinya, selama aset belum dijual.',
    long: 'Setelah dijual, keuntungan atau kerugian menjadi "terealisasi".',
    aliases: ['untung/rugi belum terealisasi', 'untung/rugi terealisasi', 'untung/rugi harian'],
  },

  // ─── Backtest ───────────────────────────────────────────
  {
    id: 'backtest',
    term: 'Backtest',
    category: 'Backtest',
    short: 'Menguji aturan strategi pada data harga masa lalu untuk melihat hasilnya.',
    long: 'Backtest menjawab: "Jika aturan ini dipakai 6 bulan terakhir, apa hasilnya?" Hasil masa lalu tidak menjamin hasil masa depan.',
    aliases: ['backtest'],
  },
  {
    id: 'fee-slippage',
    term: 'Biaya (Fee) & Slippage',
    category: 'Backtest',
    short: 'Fee = biaya transaksi exchange; slippage = selisih harga eksekusi dengan harga yang diharapkan.',
    long: 'Keduanya dihitung di setiap beli dan jual. Mengabaikannya membuat hasil backtest terlalu optimis.',
    aliases: ['biaya trading (% per sisi)', 'slippage (% per sisi)', 'biaya dibayar', 'biaya slippage'],
  },
  {
    id: 'look-ahead',
    term: 'Look-ahead Bias',
    category: 'Backtest',
    short: 'Kesalahan backtest yang tanpa sengaja memakai data masa depan.',
    long: 'Aplikasi ini mengeksekusi sinyal candle T di harga open candle T+1, dan engine menolak akses ke data setelah T. Ini diuji otomatis.',
  },
  {
    id: 'in-out-sample',
    term: 'In-Sample & Out-of-Sample',
    category: 'Backtest',
    short: 'In-sample = data untuk menyusun/mengoptimasi strategi; out-of-sample = data terpisah untuk mengujinya.',
    long: 'Strategi yang bagus di in-sample tetapi buruk di out-of-sample kemungkinan overfit.',
    aliases: ['in-sample vs out-of-sample'],
  },
  {
    id: 'walk-forward',
    term: 'Walk-Forward',
    category: 'Backtest',
    short: 'Optimasi di jendela training, uji di jendela berikutnya, lalu geser — diulang sepanjang data.',
    long: 'Meniru kondisi nyata: parameter hanya dipilih dari data yang "sudah lewat", lalu diuji pada data yang belum pernah dilihat.',
    aliases: ['analisa walk-forward', 'walk-forward'],
  },
  {
    id: 'overfitting',
    term: 'Overfitting',
    category: 'Backtest',
    short: 'Strategi terlalu "dihafalkan" pada data lama sehingga gagal di data baru.',
    long: 'Tanda umum: hasil training sangat bagus, tetapi hasil out-of-sample jauh lebih buruk.',
  },
  {
    id: 'monte-carlo',
    term: 'Simulasi Monte Carlo',
    category: 'Backtest',
    short: 'Mengacak ulang hasil trade ribuan kali untuk melihat rentang hasil yang mungkin.',
    long: 'Memberi gambaran skenario terburuk 5% dan terbaik 5% jika urutan untung/rugi berbeda. Tetap berdasarkan distribusi masa lalu.',
    aliases: ['simulasi monte carlo'],
  },
  {
    id: 'buy-hold',
    term: 'Beli & Tahan (Buy & Hold)',
    category: 'Backtest',
    short: 'Pembanding: hasil jika membeli di awal periode dan menahan sampai akhir.',
    long: 'Strategi aktif sebaiknya dibandingkan dengan Beli & Tahan, termasuk risikonya (drawdown).',
    aliases: ['roi beli & tahan'],
  },
  {
    id: 'exposure',
    term: 'Eksposur',
    category: 'Backtest',
    short: 'Persentase waktu modal berada di pasar (memegang posisi).',
    long: 'Eksposur rendah berarti modal lebih sering di kas sehingga risiko pasar lebih kecil.',
    aliases: ['eksposur'],
  },

  // ─── Derivatif & Sentimen ──────────────────────────────
  {
    id: 'funding',
    term: 'Funding Rate',
    category: 'Derivatif & Sentimen',
    short: 'Biaya berkala antara trader long dan short di pasar futures; positif = mayoritas posisi long.',
    long: 'Funding sangat positif menandakan pasar terlalu optimis dan rawan koreksi tajam (long squeeze).',
    aliases: ['funding rate'],
  },
  {
    id: 'open-interest',
    term: 'Open Interest',
    category: 'Derivatif & Sentimen',
    short: 'Total nilai kontrak futures yang masih terbuka.',
    long: 'Harga naik bersama open interest naik = uang baru masuk mendukung kenaikan. Harga naik tetapi OI turun = kenaikan karena penutupan posisi short.',
    aliases: ['open interest', 'perubahan oi (24j)'],
  },
  {
    id: 'long-short',
    term: 'Rasio Long/Short',
    category: 'Derivatif & Sentimen',
    short: 'Perbandingan jumlah akun yang long (bertaruh naik) dengan yang short (bertaruh turun).',
    long: 'Rasio yang ekstrem bisa menjadi sinyal kontrarian.',
    aliases: ['rasio long/short'],
  },
  {
    id: 'liquidation',
    term: 'Likuidasi',
    category: 'Derivatif & Sentimen',
    short: 'Penutupan paksa posisi futures karena margin tidak cukup.',
    long: 'Likuidasi besar sering memperbesar pergerakan harga sesaat.',
    aliases: ['likuidasi'],
  },
  {
    id: 'fear-greed',
    term: 'Indeks Fear & Greed',
    category: 'Derivatif & Sentimen',
    short: 'Indeks sentimen pasar 0–100: 0 = ketakutan ekstrem, 100 = keserakahan ekstrem.',
    long: 'Keserakahan ekstrem sering muncul menjelang puncak, ketakutan ekstrem menjelang dasar — tetapi bukan sinyal timing yang pasti.',
    aliases: ['indeks fear & greed'],
  },
];

const byAlias = new Map<string, GlossaryTerm>();
for (const t of GLOSSARY) {
  byAlias.set(t.term.toLowerCase(), t);
  for (const a of t.aliases ?? []) if (!byAlias.has(a.toLowerCase())) byAlias.set(a.toLowerCase(), t);
}

/** Temukan istilah dari label UI (tanpa beda huruf besar/kecil). */
export function findTerm(label: string): GlossaryTerm | undefined {
  return byAlias.get(label.trim().toLowerCase());
}

export const getTerm = (id: string) => GLOSSARY.find((t) => t.id === id);
