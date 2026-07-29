/* =============================================
   GreenNode — app.js
   Fetch data dari ESP32, update UI, kontrol relay
   ============================================= */

// ── History data untuk chart (max 20 titik)
const MAX_HISTORY = 20;
const history = { labels: [], temp: [], hum: [], soil: [] };

let chartInstance = null;
let fetchInterval = null;

// ── Fetch data sensor dari endpoint /data
async function fetchData() {
  try {
    const res = await fetch('/data');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    updateSensors(data);
    pushHistory(data);
    setStatus(true);
  } catch (err) {
    console.warn('Fetch gagal:', err);
    setStatus(false);
  }
}

// ── Update kartu sensor
function updateSensors({ temperature, humidity, soil }) {
  // Suhu
  setText('tempVal', temperature.toFixed(1));
  setBar('tempBar', clamp((temperature - 10) / 50 * 100, 0, 100)); // range 10–60°C

  // Kelembaban udara
  setText('humVal', humidity.toFixed(1));
  setBar('humBar', clamp(humidity, 0, 100));

  // Kelembaban tanah
  setText('soilVal', soil);
  setBar('soilBar', clamp(soil, 0, 100));
}

// ── Simpan data ke history & update chart
function pushHistory({ temperature, humidity, soil }) {
  const now = new Date();
  const label = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  history.labels.push(label);
  history.temp.push(temperature);
  history.hum.push(humidity);
  history.soil.push(soil);

  // Batasi ke MAX_HISTORY
  if (history.labels.length > MAX_HISTORY) {
    history.labels.shift();
    history.temp.shift();
    history.hum.shift();
    history.soil.shift();
  }

  if (chartInstance) {
    chartInstance.data.labels = [...history.labels];
    chartInstance.data.datasets[0].data = [...history.temp];
    chartInstance.data.datasets[1].data = [...history.hum];
    chartInstance.data.datasets[2].data = [...history.soil];
    chartInstance.update('none'); // no animation saat update live
  }
}

// ── Kontrol relay pompa / fan
async function controlRelay(device, state) {
  const val = state ? '1' : '0';
  try {
    const res = await fetch(`/${device}?state=${val}`);
    const text = await res.text();
    console.log(`[${device}] →`, text);
  } catch (err) {
    console.error(`Gagal kontrol ${device}:`, err);
    // Rollback toggle jika gagal
    const toggle = document.getElementById(device + 'Toggle');
    if (toggle) toggle.checked = !state;
    return;
  }

  // Update UI card
  const card  = document.getElementById(device + 'Card');
  const label = document.getElementById(device + 'Label');
  if (card)  card.classList.toggle('active', state);
  if (label) label.textContent = state ? 'ON' : 'OFF';
}

// ── Update status bar
function setStatus(online) {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const ts   = document.getElementById('lastUpdate');

  dot.className = 'dot ' + (online ? 'online' : 'offline');
  text.textContent = online ? 'Terhubung' : 'Offline';

  if (online) {
    const now = new Date();
    ts.textContent = 'Update: ' + now.toLocaleTimeString('id-ID');
  }
}

// ── Inisialisasi chart menggunakan Canvas API (tanpa library eksternal)
function initChart() {
  const canvas = document.getElementById('historyChart');
  if (!canvas) return;

  // Gunakan Chart.js via CDN inline — tapi karena LittleFS tidak ada CDN,
  // kita buat chart sederhana dengan Canvas API murni.
  chartInstance = new SimpleLineChart(canvas, {
    colors: {
      temp: getComputedStyle(document.documentElement).getPropertyValue('--c-temp').trim(),
      hum:  getComputedStyle(document.documentElement).getPropertyValue('--c-hum').trim(),
      soil: getComputedStyle(document.documentElement).getPropertyValue('--c-soil').trim(),
    }
  });
}

// ── Simple Line Chart (Canvas API — tidak butuh CDN)
class SimpleLineChart {
  constructor(canvas, opts = {}) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.colors  = opts.colors || {};
    this.data    = { labels: [], datasets: [
      { data: [], color: this.colors.temp  || '#ff6b35', label: 'Suhu' },
      { data: [], color: this.colors.hum   || '#4ecdc4', label: 'Kelembaban Udara' },
      { data: [], color: this.colors.soil  || '#a8e063', label: 'Kelembaban Tanah' },
    ]};
    this._resizeObserver = new ResizeObserver(() => this._draw());
    this._resizeObserver.observe(canvas.parentElement);
    this._draw();
  }

  update(mode) {
    this._draw();
  }

  _draw() {
    const canvas = this.canvas;
    const parent = canvas.parentElement;
    canvas.width  = parent.clientWidth  - 40; // padding 20px kiri kanan
    canvas.height = parent.clientHeight - 40;

    const ctx = this.ctx;
    const W = canvas.width, H = canvas.height;
    const PAD = { top: 16, right: 12, bottom: 40, left: 40 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top  - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    const allVals = this.data.datasets.flatMap(d => d.data);
    if (allVals.length === 0) {
      ctx.fillStyle = '#3a4a3a';
      ctx.font = '12px "Space Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Menunggu data...', W / 2, H / 2);
      return;
    }

    const maxV = Math.ceil(Math.max(...allVals, 100) / 10) * 10;
    const minV = Math.floor(Math.min(...allVals, 0)  / 10) * 10;
    const range = maxV - minV || 1;

    const n = this.data.labels.length;

    const xPos = i => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const yPos = v => PAD.top  + plotH - ((v - minV) / range) * plotH;

    // Grid
    ctx.strokeStyle = '#2a2f2a';
    ctx.lineWidth = 1;
    const gridLines = 5;
    for (let g = 0; g <= gridLines; g++) {
      const y = PAD.top + (g / gridLines) * plotH;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + plotW, y);
      ctx.stroke();

      const val = Math.round(maxV - (g / gridLines) * range);
      ctx.fillStyle = '#4a5a4a';
      ctx.font = '9px "Space Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val, PAD.left - 6, y + 3);
    }

    // X labels (tampilkan setiap beberapa titik agar tidak penuh)
    ctx.fillStyle = '#4a5a4a';
    ctx.font = '8px "Space Mono", monospace';
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.ceil(n / 6));
    for (let i = 0; i < n; i += step) {
      ctx.fillText(this.data.labels[i], xPos(i), H - PAD.bottom + 14);
    }

    // Lines + dots
    this.data.datasets.forEach(ds => {
      if (ds.data.length < 1) return;

      ctx.strokeStyle = ds.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';

      // Gradient fill di bawah garis
      const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
      grad.addColorStop(0, ds.color + '33');
      grad.addColorStop(1, ds.color + '00');

      ctx.beginPath();
      ds.data.forEach((v, i) => {
        const x = xPos(i), y = yPos(v);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = ds.color;
      ctx.stroke();

      // Fill area
      ctx.lineTo(xPos(ds.data.length - 1), PAD.top + plotH);
      ctx.lineTo(xPos(0), PAD.top + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Dots pada titik terakhir
      const lastI = ds.data.length - 1;
      const lx = xPos(lastI), ly = yPos(ds.data[lastI]);
      ctx.beginPath();
      ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fillStyle = ds.color;
      ctx.fill();
    });
  }
}

// ── Helper
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = clamp(pct, 0, 100) + '%';
}
function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

// ── Init
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  fetchData();                          // fetch pertama langsung
  fetchInterval = setInterval(fetchData, 20000); // setiap 20 detik (sama dengan loop ESP)
});
