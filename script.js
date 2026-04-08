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
let currentTheme = localStorage.getItem('theme') || 'light';

// ========== DOM ELEMENTS ==========
const mainDistance = document.getElementById('mainDistance');
const timeValue = document.getElementById('timeValue');
const paceValue = document.getElementById('paceValue');
const speedValue = document.getElementById('speedValue');
const caloriesValue = document.getElementById('caloriesValue');
const startBtn = document.getElementById('startBtn');
const gpsDot = document.getElementById('gpsDot');
const gpsText = document.getElementById('gpsText');
const errorMsgDiv = document.getElementById('errorMsgDiv');

// ========== THEME ==========
function setTheme(theme) {
  currentTheme = theme;
  if (theme === 'dark') {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
  localStorage.setItem('theme', theme);
  document.getElementById('lightBtn').classList.toggle('active', theme === 'light');
  document.getElementById('darkBtn').classList.toggle('active', theme === 'dark');
}

function toggleThemeSimple() {
  setTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

// Load saved theme
setTheme(localStorage.getItem('theme') || 'light');

// ========== PANEL NAVIGATION ==========
function showPanel(panel) {
  document.getElementById('homePanel').classList.toggle('hide', panel !== 'home');
  document.getElementById('historyPanel').classList.toggle('show', panel === 'history');
  document.getElementById('settingsPanel').classList.toggle('show', panel === 'settings');
  
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panel);
  });
  
  if (panel === 'history') renderHistory();
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

function calculateCalories(distKm, weightKg = 70) {
  // Average calories burned per km = ~60 calories for 70kg person
  return Math.round(distKm * 60);
}

// ========== UI UPDATE ==========
function updateUI() {
  const now = Date.now();
  const currentElapsed = running ? (now - startTime + elapsed) : elapsed;
  const distKm = distance / 1000;
  const calories = calculateCalories(distKm);
  
  mainDistance.innerText = distKm.toFixed(2);
  timeValue.innerText = formatTime(currentElapsed);
  paceValue.innerText = formatPace(distance, currentElapsed);
  speedValue.innerText = lastSpeed.toFixed(1);
  caloriesValue.innerText = calories;
}

// ========== WAKE LOCK (Screen off par bhi kaam karega) ==========
let wakeLock = null;

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake Lock acquired');
      wakeLock.addEventListener('release', () => {
        console.log('Wake Lock released');
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

// ========== GPS ==========
function onPosition(pos) {
  const { latitude, longitude, accuracy, speed } = pos.coords;
  
  if (accuracy < 30) {
    gpsDot.className = 'gps-dot locked';
    gpsText.innerText = `GPS locked (±${Math.round(accuracy)}m)`;
    document.getElementById('gpsAccuracy').innerText = `±${Math.round(accuracy)}m`;
    errorMsgDiv.classList.remove('show');
  } else {
    gpsDot.className = 'gps-dot searching';
    gpsText.innerText = 'Searching GPS...';
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
  updateUI();
}

function onGpsError(err) {
  gpsDot.className = 'gps-dot';
  gpsText.innerText = 'GPS error - check permissions';
  if (err.code === 1) {
    errorMsgDiv.classList.add('show');
  }
}

// ========== RUN CONTROL ==========
function startRun() {
  if (!running) {
    // Request location permission first
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        if (result.state === 'denied') {
          errorMsgDiv.classList.add('show');
          return;
        }
      });
    }
    
    running = true;
    startTime = Date.now();
    requestWakeLock();
    startBtn.innerText = '⏸ PAUSE';
    startBtn.classList.add('pause');
    gpsDot.className = 'gps-dot searching';
    gpsText.innerText = 'Acquiring GPS...';
    
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
    
    startBtn.innerText = '▶ START';
    startBtn.classList.remove('pause');
    gpsDot.className = 'gps-dot locked';
    
    // Save to history
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
  }
}

function resetRun() {
  if (running) {
    running = false;
    clearInterval(timerInterval);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    releaseWakeLock();
  }
  
  startTime = null;
  elapsed = 0;
  distance = 0;
  lastSpeed = 0;
  positions = [];
  watchId = null;
  timerInterval = null;
  
  updateUI();
  startBtn.innerText = '▶ START';
  startBtn.classList.remove('pause');
  gpsDot.className = 'gps-dot';
  gpsText.innerText = 'GPS ready — tap Start';
}

function renderHistory() {
  const historyList = document.getElementById('historyList');
  if (history.length === 0) {
    historyList.innerHTML = '<p style="color:var(--text-secondary)">No runs yet. Start running!</p>';
    return;
  }
  
  historyList.innerHTML = history.slice(0, 10).map(r => {
    const distKm = r.dist / 1000;
    return `
      <div class="history-item">
        <div><strong>${distKm.toFixed(2)} km</strong><br><small>${formatTime(r.time)}</small></div>
        <div><small>${r.date}</small></div>
      </div>
    `;
  }).join('');
}

// ========== INITIALIZE ==========
startBtn.onclick = startRun;
updateUI();
renderHistory();

// Check if geolocation is available
if (!navigator.geolocation) {
  gpsText.innerText = 'Geolocation not supported';
}

// Request permission on page load
window.addEventListener('load', () => {
  navigator.geolocation.getCurrentPosition(
    () => {},
    () => {}
  );
});
