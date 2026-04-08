// ========== STATE ==========
let running = false;
let startTime = null;
let elapsed = 0;
let distance = 0;
let lastSpeed = 0;
let positions = [];
let watchId = null;
let timerInterval = null;
let history = JSON.parse(localStorage.getItem('runHistory') || '[]');
let currentLang = localStorage.getItem('lang') || 'hi';
let currentTheme = localStorage.getItem('theme') || 'dark';

// ========== WAKE LOCK (Screen बंद होने पर भी काम करेगा) ==========
let wakeLock = null;

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake Lock acquired');
      wakeLock.addEventListener('release', () => {
        console.log('Wake Lock released, reacquiring...');
        setTimeout(() => requestWakeLock(), 1000);
      });
    } catch (err) {
      console.log('Wake Lock error:', err);
    }
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// ========== TRANSLATIONS ==========
const texts = {
  hi: {
    welcomeTitle: "स्वागत है!", welcomeSub: "अग्निवीर फिटनेस के लिए दौड़ ट्रैक करें",
    timerLabel: "समय", distLabel: "दूरी", paceLabel: "पेस", speedLabel: "रफ्तार",
    metersLabel: "मीटर", pointsLabel: "पॉइंट्स", gpsReady: "GPS तैयार",
    gpsLocked: "GPS लॉक", gpsSearching: "GPS खोज रहा...",
    startBtn: "▶ दौड़ शुरू करें", stopBtn: "⏸ रोकें", resumeBtn: "▶ जारी रखें",
    sumTitle: "🏁 दौड़ पूरी!"
  },
  en: {
    welcomeTitle: "Welcome!", welcomeSub: "Track your run for Agniveer fitness",
    timerLabel: "Duration", distLabel: "Distance", paceLabel: "Pace", speedLabel: "Speed",
    metersLabel: "Meters", pointsLabel: "Points", gpsReady: "GPS ready",
    gpsLocked: "GPS locked", gpsSearching: "Searching GPS...",
    startBtn: "▶ START RUN", stopBtn: "⏸ PAUSE", resumeBtn: "▶ RESUME",
    sumTitle: "🏁 Run Complete!"
  }
};

// ========== THEME ==========
function applyTheme() {
  if (currentTheme === 'light') {
    document.body.classList.add('light');
  } else {
    document.body.classList.remove('light');
  }
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', currentTheme);
  applyTheme();
}

// ========== LANGUAGE ==========
function applyLanguage() {
  const t = texts[currentLang];
  document.getElementById('welcomeTitle').innerText = t.welcomeTitle;
  document.getElementById('welcomeSub').innerText = t.welcomeSub;
  if (document.getElementById('timerLabel')) {
    document.getElementById('timerLabel').innerText = t.timerLabel;
    document.getElementById('distLabel').innerText = t.distLabel;
    document.getElementById('paceLabel').innerText = t.paceLabel;
    document.getElementById('speedLabel').innerText = t.speedLabel;
    document.getElementById('metersLabel').innerText = t.metersLabel;
    document.getElementById('pointsLabel').innerText = t.pointsLabel;
    document.getElementById('sumTitle').innerText = t.sumTitle;
    document.getElementById('gpsText').innerText = t.gpsReady;
    if (!running) {
      document.getElementById('runBtn').innerText = t.startBtn;
    }
  }
}

function toggleLang() {
  currentLang = currentLang === 'hi' ? 'en' : 'hi';
  localStorage.setItem('lang', currentLang);
  applyLanguage();
}

// ========== HELPERS ==========
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatTime(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h.toString().padStart(2,'0')}:${(m%60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
  }
  return `${m.toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
}

function formatPace(distM, ms) {
  if (distM < 20) return '--:--';
  const minsPerKm = (ms / 60000) / (distM / 1000);
  if (minsPerKm > 30 || minsPerKm <= 0 || !isFinite(minsPerKm)) return '--:--';
  const mins = Math.floor(minsPerKm);
  const secs = Math.round((minsPerKm - mins) * 60);
  return `${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
}

// ========== UI UPDATE ==========
function updateUI() {
  const now = Date.now();
  const currentElapsed = running ? (now - startTime + elapsed) : elapsed;
  const distKm = distance / 1000;
  
  document.getElementById('timerValue').innerText = formatTime(currentElapsed);
  document.getElementById('distValue').innerText = distKm >= 1 ? distKm.toFixed(2) : distance.toFixed(0);
  document.getElementById('distUnit').innerText = distKm >= 1 ? 'km' : (currentLang === 'hi' ? 'मीटर' : 'm');
  document.getElementById('metersValue').innerText = Math.round(distance);
  document.getElementById('paceValue').innerText = formatPace(distance, currentElapsed);
  document.getElementById('speedValue').innerText = lastSpeed.toFixed(1);
  document.getElementById('pointsValue').innerText = positions.length;
}

// ========== DRAW ROUTE ==========
function drawRoute() {
  const canvas = document.getElementById('routeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w;
  canvas.height = h;
  
  ctx.clearRect(0, 0, w, h);
  
  if (positions.length < 2) {
    ctx.fillStyle = currentTheme === 'light' ? '#e0e0e0' : '#222';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(currentLang === 'hi' ? 'रूट यहाँ दिखेगा...' : 'Route will appear...', w/2, h/2);
    return;
  }
  
  const lats = positions.map(p => p.lat);
  const lons = positions.map(p => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const pad = 15;
  
  const scaleX = (w - pad * 2) / (maxLon - minLon || 0.0001);
  const scaleY = (h - pad * 2) / (maxLat - minLat || 0.0001);
  const scale = Math.min(scaleX, scaleY);
  
  const toX = lon => pad + (lon - minLon) * scale + (w - pad*2 - (maxLon-minLon)*scale)/2;
  const toY = lat => h - pad - (lat - minLat) * scale - (h - pad*2 - (maxLat-minLat)*scale)/2;
  
  ctx.fillStyle = currentTheme === 'light' ? '#e0e0e0' : '#222';
  ctx.fillRect(0, 0, w, h);
  
  for (let i = 1; i < positions.length; i++) {
    ctx.beginPath();
    ctx.moveTo(toX(positions[i-1].lon), toY(positions[i-1].lat));
    ctx.lineTo(toX(positions[i].lon), toY(positions[i].lat));
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  
  ctx.beginPath();
  ctx.arc(toX(positions[0].lon), toY(positions[0].lat), 5, 0, Math.PI*2);
  ctx.fillStyle = '#3b82f6';
  ctx.fill();
  
  const last = positions[positions.length-1];
  ctx.beginPath();
  ctx.arc(toX(last.lon), toY(last.lat), 6, 0, Math.PI*2);
  ctx.fillStyle = '#10b981';
  ctx.fill();
}

// ========== GPS ==========
function onPosition(pos) {
  const { latitude, longitude, accuracy, speed } = pos.coords;
  const gpsDot = document.getElementById('gpsDot');
  const gpsText = document.getElementById('gpsText');
  const t = texts[currentLang];
  
  if (accuracy < 30) {
    gpsDot.className = 'gps-dot locked';
    gpsText.innerText = `${t.gpsLocked} (±${Math.round(accuracy)}m)`;
  } else {
    gpsDot.className = 'gps-dot searching';
    gpsText.innerText = t.gpsSearching;
    return;
  }
  
  if (!running) return;
  if (speed !== null && speed >= 0) lastSpeed = speed * 3.6;
  
  if (positions.length > 0) {
    const prev = positions[positions.length - 1];
    const d = haversine(prev.lat, prev.lon, latitude, longitude);
    if (d < 50 && d > 1) {
      distance += d;
      if (speed === null) {
        const dt = (Date.now() - prev.time) / 1000;
        if (dt > 0) lastSpeed = (d / dt) * 3.6;
      }
    }
  }
  
  positions.push({ lat: latitude, lon: longitude, time: Date.now() });
  drawRoute();
  updateUI();
}

function onGpsError() {
  document.getElementById('gpsDot').className = 'gps-dot';
  document.getElementById('gpsText').innerText = 'GPS error';
}

// ========== RUN CONTROL ==========
function startRun() {
  if (!running) {
    running = true;
    startTime = Date.now();
    requestWakeLock();  // ← Screen ऑन रखने के लिए
    document.getElementById('summaryCard').classList.remove('show');
    const runBtn = document.getElementById('runBtn');
    runBtn.innerText = texts[currentLang].stopBtn;
    runBtn.className = 'run-btn run-stop';
    document.getElementById('gpsDot').className = 'gps-dot searching';
    document.getElementById('gpsText').innerText = texts[currentLang].gpsSearching;
    
    watchId = navigator.geolocation.watchPosition(onPosition, onGpsError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    });
    timerInterval = setInterval(updateUI, 1000);
  } else {
    running = false;
    elapsed += Date.now() - startTime;
    releaseWakeLock();
    clearInterval(timerInterval);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    
    const runBtn = document.getElementById('runBtn');
    runBtn.innerText = texts[currentLang].resumeBtn;
    runBtn.className = 'run-btn run-start';
    
    if (distance > 10) {
      history.unshift({
        dist: distance,
        time: elapsed,
        date: new Date().toLocaleDateString()
      });
      if (history.length > 10) history.pop();
      localStorage.setItem('runHistory', JSON.stringify(history));
      renderHistory();
    }
    
    const distKm = distance / 1000;
    const sumDetails = document.getElementById('sumDetails');
    sumDetails.innerHTML = `
      <div>कुल दूरी: ${distKm >= 1 ? distKm.toFixed(2) + ' km' : Math.round(distance) + ' m'}</div>
      <div>कुल समय: ${formatTime(elapsed)}</div>
      <div>औसत पेस: ${formatPace(distance, elapsed)} min/km</div>
      <div>औसत रफ्तार: ${elapsed > 0 ? (distKm / (elapsed / 3600000)).toFixed(1) : '0.0'} km/h</div>
    `;
    document.getElementById('summaryCard').classList.add('show');
  }
}

function resetRun() {
  if (running) {
    clearInterval(timerInterval);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    releaseWakeLock();
  }
  
  running = false;
  startTime = null;
  elapsed = 0;
  distance = 0;
  lastSpeed = 0;
  positions = [];
  watchId = null;
  timerInterval = null;
  
  updateUI();
  drawRoute();
  document.getElementById('runBtn').innerText = texts[currentLang].startBtn;
  document.getElementById('runBtn').className = 'run-btn run-start';
  document.getElementById('summaryCard').classList.remove('show');
  document.getElementById('gpsDot').className = 'gps-dot';
  document.getElementById('gpsText').innerText = texts[currentLang].gpsReady;
}

function renderHistory() {
  const historyDiv = document.getElementById('historySection');
  if (history.length === 0) {
    historyDiv.innerHTML = '';
    return;
  }
  
  historyDiv.innerHTML = '<h4 style="margin:15px 0 10px">📜 पिछली दौड़ें</h4>';
  history.slice(0, 5).forEach(r => {
    const distKm = r.dist / 1000;
    historyDiv.innerHTML += `
      <div class="history-item">
        <div><strong>${distKm >= 1 ? distKm.toFixed(2) + ' km' : Math.round(r.dist) + ' m'}</strong><br><small>${formatTime(r.time)}</small></div>
        <div><small>${r.date}</small></div>
      </div>
    `;
  });
}

// ========== SCREEN NAVIGATION ==========
function startTracking() {
  document.getElementById('welcomeScreen').style.display = 'none';
  document.getElementById('trackerScreen').classList.add('show');
  renderHistory();
  drawRoute();
  applyLanguage();
}

function goHome() {
  if (running) {
    if (confirm(currentLang === 'hi' ? 'दौड़ जारी है। क्या आप होम पेज पर जाना चाहते हैं?' : 'Run in progress. Go to home?')) {
      running = false;
      clearInterval(timerInterval);
      if (watchId) navigator.geolocation.clearWatch(watchId);
      releaseWakeLock();
    } else {
      return;
    }
  }
  document.getElementById('welcomeScreen').style.display = 'flex';
  document.getElementById('trackerScreen').classList.remove('show');
}

// ========== INITIALIZE ==========
applyTheme();
applyLanguage();
renderHistory();

// Event Listeners
document.getElementById('startTrackingBtn').onclick = startTracking;
document.getElementById('runBtn').onclick = startRun;
document.getElementById('resetBtn').onclick = resetRun;
document.getElementById('backHomeBtn').onclick = goHome;
window.toggleTheme = toggleTheme;
window.toggleLang = toggleLang;
