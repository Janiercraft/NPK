const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const CHIGORODO = {
  name: 'Chigorodó, Antioquia',
  lat: 7.66638,
  lng: -76.68106,
  timezone: 'America/Bogota'
};

const DEFAULT_BACKEND_URL = 'https://npk-yvtg.onrender.com/api';

const SENSOR_ENDPOINT_FALLBACKS = [
  // Backend actual: app.use('/api/sensor', sensorRoutes) + router.get('/latest')
  // Si baseUrl termina en /api, este endpoint genera /api/sensor/latest
  '/sensor/latest',
  // Si alguna vez configuras baseUrl sin /api, este endpoint también funcionará
  '/api/sensor/latest',
  '/api/sensores',
  '/api/sensors',
  '/sensores',
  '/sensors',
  '/api/lecturas',
  '/lecturas',
  '/data'
];

const SENSOR_CREATE_ENDPOINT_FALLBACKS = [
  '/api/sensores',
  '/api/sensors',
  '/sensores',
  '/sensors',
  '/api/dispositivos'
];

const PARCEL_CREATE_ENDPOINT_FALLBACKS = [
  '/api/parcelas',
  '/api/parcels',
  '/parcelas',
  '/parcels',
  '/api/lotes',
  '/lotes'
];

const REPORT_ENDPOINT_FALLBACKS = [
  '/api/reportes',
  '/api/reports',
  '/api/lecturas',
  '/lecturas',
  '/api/sensores'
];


const DEFAULT_CONFIG = {
  baseUrl: window.NPK_BACKEND_URL || localStorage.getItem('npk-backend-url') || DEFAULT_BACKEND_URL,
  sensorsEndpoint: localStorage.getItem('npk-sensors-endpoint') || '/sensor/latest',
  streamEndpoint: localStorage.getItem('npk-stream-endpoint') || '/api/sensores/stream',
  pollIntervalMs: Number(localStorage.getItem('npk-poll-interval') || 10000),
  timeoutMs: 7000
};

let API_CONFIG = { ...DEFAULT_CONFIG };

const statusLabels = {
  conectado: 'Conectado',
  activo: 'Conectado',
  critico: 'Crítico',
  inactivo: 'Inactivo',
  desconectado: 'Desconectado',
  no_conectado: 'No conectado',
  mantenimiento: 'Mantenimiento'
};

const thresholds = {
  nLow: 30,
  pLow: 12,
  kLow: 35,
  humidityLow: 30,
  humidityHigh: 85,
  tempLow: 18,
  tempHigh: 34,
  staleMinutes: 10
};

const alertRules = {
  nitrogen: { warningLow: 30, criticalLow: 20, unit: 'ppm', label: 'Nitrógeno' },
  phosphorus: { warningLow: 12, criticalLow: 8, unit: 'ppm', label: 'Fósforo' },
  potassium: { warningLow: 35, criticalLow: 25, unit: 'ppm', label: 'Potasio' },
  humidity: { warningLow: 30, criticalLow: 20, warningHigh: 85, criticalHigh: 90, unit: '%', label: 'Humedad del suelo' },
  airTemp: { warningLow: 18, criticalLow: 15, warningHigh: 34, criticalHigh: 38, unit: '°C', label: 'Temperatura del aire' }
};


let state = {
  currentView: 'inicio',
  currentSlide: 0,
  backendOnline: false,
  lastSync: null,
  weather: null,
  currentMapFilter: 'all'
};

let registeredSensors = loadJSON('npk-registered-sensors', []);
let registeredParcels = loadJSON('npk-registered-parcels', []);
let sensorReadings = [];
let generatedReports = loadJSON('npk-generated-reports', []);
let sensorMap;
let weatherMap;
let weatherRadarLayer;
let markerLayer;
let heatLayers = {};
let chartInstances = [];
let pollTimer;

function showModal(content = '') {
  const modal = $('#mainModal');
  const body = $('#modalBody');
  if (!modal || !body) {
    alert(String(content).replace(/<[^>]*>/g, ' '));
    return;
  }
  body.innerHTML = content;
  try {
    if (typeof modal.showModal === 'function') {
      if (!modal.open) modal.showModal();
    } else {
      modal.setAttribute('open', 'open');
      modal.classList.add('open');
    }
  } catch (error) {
    modal.setAttribute('open', 'open');
    modal.classList.add('open');
  }
}

function closeModal() {
  const modal = $('#mainModal');
  if (!modal) return;
  if (typeof modal.close === 'function' && modal.open) modal.close();
  modal.removeAttribute('open');
  modal.classList.remove('open');
}

function toast(title = 'Aviso', message = '') {
  const zone = $('#toastZone');
  if (!zone) {
    console.info(`${title}: ${message}`);
    return;
  }
  const item = document.createElement('article');
  item.className = 'toast';
  item.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>`;
  zone.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateX(18px)';
    setTimeout(() => item.remove(), 260);
  }, 4200);
}

function init() {
  setTimeout(() => $('#loadingScreen')?.classList.add('done'), 600);
  initTheme();
  initLanding();
  initReveal();
  initNavigation();
  initInteractions();
  initMap();
  initWeatherMap();
  hydrateConfigInputs();
  renderAll();
  loadWeather();
  loadSensorsFromBackend({ silent: true });
  startPolling();
  startRealtimeStream();
  toast('Sistema cargado', 'Frontend listo. Los datos aparecerán cuando el backend entregue lecturas reales.');
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeBaseUrl(url = '') {
  const clean = String(url || '').trim();
  return clean.endsWith('/') ? clean.slice(0, -1) : clean;
}

function buildUrl(endpoint) {
  const base = normalizeBaseUrl(API_CONFIG.baseUrl);
  const path = String(endpoint || '').startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${path}`;
}

function fetchWithTimeout(url, options = {}, timeoutMs = API_CONFIG.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function initTheme() {
  const saved = localStorage.getItem('npk-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  const toggle = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('npk-theme', next);
    drawAllCharts();
    toast('Tema actualizado', `Modo ${next === 'dark' ? 'oscuro' : 'claro'} activado.`);
  };
  $('#themeToggle')?.addEventListener('click', toggle);
  $('#landingThemeToggle')?.addEventListener('click', toggle);
  $('#settingsThemeToggle')?.addEventListener('click', toggle);
}

function initLanding() {
  $$('[data-open-app]').forEach(btn => btn.addEventListener('click', event => {
    event.preventDefault();
    openApp(btn.dataset.openApp);
  }));
  $$('[data-open-landing]').forEach(btn => btn.addEventListener('click', event => {
    event.preventDefault();
    openLanding();
  }));
  $('#mobileLandingMenu')?.addEventListener('click', () => $('.landing-links')?.classList.toggle('mobile-open'));
  initSlider();
}

function openApp(target = 'dashboard') {
  $('#landingPage')?.classList.add('hidden');
  $('#landingNav')?.classList.add('hidden');
  $('#appShell')?.classList.remove('hidden');
  setView(target === 'mapa' ? 'mapa' : target);
}

function openLanding() {
  $('#appShell')?.classList.add('hidden');
  $('#landingPage')?.classList.remove('hidden');
  $('#landingNav')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initSlider() {
  const slides = $$('.slide');
  if (!slides.length) return;
  const update = () => slides.forEach((slide, i) => slide.classList.toggle('active', i === state.currentSlide));
  $$('[data-slider]').forEach(btn => btn.addEventListener('click', () => {
    state.currentSlide = btn.dataset.slider === 'next'
      ? (state.currentSlide + 1) % slides.length
      : (state.currentSlide - 1 + slides.length) % slides.length;
    update();
  }));
  setInterval(() => {
    if ($('#landingPage')?.classList.contains('hidden')) return;
    state.currentSlide = (state.currentSlide + 1) % slides.length;
    update();
  }, 5000);
}

function initReveal() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: .14 });
  $$('.reveal').forEach(el => observer.observe(el));
}

function initNavigation() {
  $('#sidebarToggle')?.addEventListener('click', () => $('#sidebar')?.classList.toggle('collapsed'));
  $('#mobileSidebarBtn')?.addEventListener('click', () => $('#sidebar')?.classList.toggle('open'));
  $$('.side-item').forEach(item => item.addEventListener('click', () => {
    setView(item.dataset.view);
    $('#sidebar')?.classList.remove('open');
  }));
  $$('[data-view-link]').forEach(item => item.addEventListener('click', () => setView(item.dataset.viewLink)));
  $('#globalSearch')?.addEventListener('input', renderAllTablesAndSelections);
}

function setView(viewName = 'dashboard') {
  const normalized = viewName === 'map' ? 'mapa' : viewName;
  const view = document.getElementById(`view-${normalized}`) || document.getElementById('view-dashboard');
  $$('.view').forEach(v => v.classList.toggle('active', v === view));
  $$('.side-item').forEach(item => item.classList.toggle('active', item.dataset.view === normalized));
  state.currentView = normalized;
  const title = view?.querySelector('h1, h2')?.textContent || 'Dashboard principal';
  const breadcrumb = $('#breadcrumb');
  if (breadcrumb) breadcrumb.textContent = `Inicio / ${title}`;
  if (normalized === 'mapa') setTimeout(() => sensorMap?.invalidateSize(), 350);
  if (normalized === 'meteorologia') setTimeout(() => weatherMap?.invalidateSize(), 350);
  if (['dashboard', 'meteorologia', 'estadisticas'].includes(normalized)) setTimeout(drawAllCharts, 80);
}

function initInteractions() {
  ['sensorSearch', 'statusFilter', 'lotFilter', 'dateFilter'].forEach(id => $(`#${id}`)?.addEventListener('input', renderSensorsTable));
  $('#clearFilters')?.addEventListener('click', () => {
    ['sensorSearch', 'dateFilter', 'globalSearch'].forEach(id => { const el = $(`#${id}`); if (el) el.value = ''; });
    const status = $('#statusFilter'); if (status) status.value = 'todos';
    const lot = $('#lotFilter'); if (lot) lot.value = 'todos';
    renderSensorsTable();
  });
  $('#refreshDataBtn')?.addEventListener('click', () => loadSensorsFromBackend());
  $('#refreshWeatherBtn')?.addEventListener('click', () => loadWeather());
  $('#refreshAnalyticsBtn')?.addEventListener('click', () => { loadSensorsFromBackend(); drawAllCharts(); });
  $('#exportSensorsBtn')?.addEventListener('click', exportSensorsCSV);
  $('#addSensorBtn')?.addEventListener('click', openAddSensorModal);
  $('#addParcelBtn')?.addEventListener('click', openAddParcelModal);
  $('#previewReportBtn')?.addEventListener('click', previewReport);
  $('#generateReportBtn')?.addEventListener('click', generateReportBySelectedFormat);
  $('#htmlReportBtn')?.addEventListener('click', () => downloadReportHTML());
  $('#csvReportBtn')?.addEventListener('click', downloadReportCSV);
  $('#printReportBtn')?.addEventListener('click', printReport);
  $('#notificationBtn')?.addEventListener('click', showNotifications);
  $('#quickSettings')?.addEventListener('click', () => setView('configuracion'));
  $('#modalClose')?.addEventListener('click', closeModal);
  $('#mainModal')?.addEventListener('click', event => { if (event.target?.id === 'mainModal') closeModal(); });
  $('#saveApiConfigBtn')?.addEventListener('click', saveApiConfig);
  $('#testBackendBtn')?.addEventListener('click', () => loadSensorsFromBackend());
  $('#clearApiConfigBtn')?.addEventListener('click', clearApiConfig);
  $('#showContractBtn')?.addEventListener('click', showBackendContract);
  $('#copyContractBtn')?.addEventListener('click', copyBackendContract);
  $('#configureAlertsBtn')?.addEventListener('click', showAlertRules);
  ['dashboardScope', 'dashboardSensorSelect', 'dashboardParcelSelect'].forEach(id => $(`#${id}`)?.addEventListener('change', () => { renderDashboard(); drawAllCharts(); }));
  $$('[data-map-filter]').forEach(btn => btn.addEventListener('click', () => {
    state.currentMapFilter = btn.dataset.mapFilter;
    renderMapMarkers(state.currentMapFilter);
  }));
  $$('[data-heat]').forEach(input => input.addEventListener('change', updateHeatLayerVisibility));
  $('#mapFullscreen')?.addEventListener('click', () => $('#sensorMap')?.requestFullscreen?.());
  $$('.accordion button').forEach(btn => btn.addEventListener('click', () => btn.classList.toggle('open')));
}

function renderAll() {
  renderConnectionState();
  renderLandingStats();
  renderSelections();
  renderDashboard();
  renderSensorsTable();
  renderParcels();
  renderAlerts();
  renderReportsList();
  renderMapMarkers(state.currentMapFilter);
  renderHeatmapGrid();
  drawAllCharts();
}

function renderAllTablesAndSelections() {
  renderSelections();
  renderSensorsTable();
  renderParcels();
  renderReportsList();
}

function getAllSensors() {
  const map = new Map();
  registeredSensors.forEach(reg => {
    if (!reg.id) return;
    map.set(reg.id, normalizeRegisteredSensor(reg));
  });
  sensorReadings.forEach(reading => {
    if (!reading.id) return;
    const existing = map.get(reading.id) || {};
    map.set(reading.id, { ...existing, ...reading, realData: true, status: normalizeStatus(reading.status, reading) });
  });
  return [...map.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function normalizeRegisteredSensor(reg) {
  return {
    id: String(reg.id || '').trim(),
    name: reg.name || `ESP32 ${reg.id}`,
    parcelId: reg.parcelId || reg.lot || '',
    location: reg.location || 'Ubicación pendiente',
    lat: toNumberOrNull(reg.lat),
    lng: toNumberOrNull(reg.lng),
    n: null,
    p: null,
    k: null,
    humidity: null,
    soilHumidity: null,
    airTemp: null,
    temp: null,
    timestamp: null,
    status: 'no_conectado',
    realData: false
  };
}

function normalizeStatus(status, sensor) {
  const raw = String(status || '').toLowerCase().trim();
  if (['activo', 'active', 'online', 'ok', 'conectado'].includes(raw)) return hasCriticalValues(sensor) ? 'critico' : 'conectado';
  if (['critical', 'critico', 'crítico', 'alerta'].includes(raw)) return 'critico';
  if (['maintenance', 'mantenimiento'].includes(raw)) return 'mantenimiento';
  if (['inactive', 'inactivo', 'offline', 'desconectado', 'no_conectado'].includes(raw)) return 'no_conectado';
  if (isStale(sensor.timestamp)) return 'no_conectado';
  return hasCriticalValues(sensor) ? 'critico' : 'conectado';
}

function hasCriticalValues(sensor) {
  return isLow(sensor.n, thresholds.nLow)
    || isLow(sensor.p, thresholds.pLow)
    || isLow(sensor.k, thresholds.kLow)
    || isLow(sensor.humidity, thresholds.humidityLow)
    || isHigh(sensor.humidity, thresholds.humidityHigh)
    || isLow(sensor.temp, thresholds.tempLow)
    || isHigh(sensor.temp, thresholds.tempHigh);
}

function isLow(value, limit) { return value !== null && value !== undefined && Number(value) < limit; }
function isHigh(value, limit) { return value !== null && value !== undefined && Number(value) > limit; }

function isStale(timestamp) {
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time > thresholds.staleMinutes * 60 * 1000;
}

function getRealSensors() {
  return getAllSensors().filter(sensor => sensor.realData && sensor.status !== 'no_conectado' && hasAnyReading(sensor));
}

function hasAnyReading(sensor) {
  return [sensor.n, sensor.p, sensor.k, sensor.humidity, sensor.soilHumidity, sensor.airTemp, sensor.temp].some(value => value !== null && value !== undefined && value !== '');
}

function getScopedSensors({ realOnly = true } = {}) {
  const base = realOnly ? getRealSensors() : getAllSensors();
  const scope = $('#dashboardScope')?.value || 'general';
  const sensorId = $('#dashboardSensorSelect')?.value || '';
  const parcelId = $('#dashboardParcelSelect')?.value || '';
  if (scope === 'sensor' && sensorId) return base.filter(sensor => sensor.id === sensorId);
  if (scope === 'parcela' && parcelId) return base.filter(sensor => sensor.parcelId === parcelId);
  return base;
}

function avgSensors(rows, key) {
  const values = rows.map(row => Number(row[key])).filter(value => Number.isFinite(value));
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getParcelIds() {
  const ids = new Set();
  registeredParcels.forEach(p => p.id && ids.add(String(p.id)));
  getAllSensors().forEach(s => s.parcelId && ids.add(String(s.parcelId)));
  return [...ids].sort();
}

function renderConnectionState() {
  const sensors = getAllSensors();
  const connected = getRealSensors();
  const alerts = generateAlerts();
  const text = connected.length ? `${connected.length} sensor(es) en tiempo real` : 'Sensores no conectados';
  const pill = $('#connectionPill');
  if (pill) {
    pill.textContent = text;
    pill.classList.toggle('online', connected.length > 0);
  }
  const banner = $('#sensorConnectionBanner');
  if (banner) {
    banner.className = `connection-banner panel ${connected.length ? 'connected' : ''}`;
    banner.innerHTML = connected.length
      ? `<strong>Datos en tiempo real activos</strong><p>Última sincronización: ${state.lastSync ? formatDateTime(state.lastSync) : 'reciente'}. Backend: ${state.backendOnline ? 'conectado' : 'sin confirmar'}.</p>`
      : `<strong>Sensores no conectados</strong><p>${sensors.length ? 'Hay IDs registrados, pero aún no existen lecturas reales desde el backend.' : 'Agrega un ID ESP32 o configura el backend para recibir lecturas reales.'}</p>`;
  }
  const sensorsBanner = $('#sensorsStatusBanner');
  if (sensorsBanner) {
    sensorsBanner.className = `connection-banner panel ${connected.length ? 'connected' : ''}`;
    sensorsBanner.innerHTML = connected.length
      ? `<strong>${connected.length} sensor(es) con datos reales</strong><p>Total registrados/listados: ${sensors.length}. Última actualización: ${state.lastSync ? formatDateTime(state.lastSync) : '--'}.</p>`
      : `<strong>Sensores no conectados</strong><p>Registra un ID ESP32 y espera a que el backend publique datos para ese ID.</p>`;
  }
  $('#healthScore') && ($('#healthScore').textContent = connected.length ? `${Math.round((connected.length / Math.max(sensors.length, connected.length)) * 100)}%` : '--');
  $('#healthLabel') && ($('#healthLabel').textContent = connected.length ? 'Sensores conectados' : 'Sensores no conectados');
  $('#notificationCount') && ($('#notificationCount').textContent = String(alerts.length));
  $('#heroConnectionState') && ($('#heroConnectionState').textContent = connected.length ? 'Datos en tiempo real' : 'Sensores no conectados');
  $('#heroAnalyticsState') && ($('#heroAnalyticsState').textContent = connected.length ? 'Activas con datos reales' : 'Sin datos reales');
  $('#heroAlertBubble') && ($('#heroAlertBubble').textContent = alerts.length ? `${alerts.length} alerta(s) reales` : 'Sin alertas reales recibidas');
  $('#heroSensorBubble') && ($('#heroSensorBubble').textContent = sensors.length ? `${sensors.length} ID(s) ESP32 registrados/listados` : 'Registra el ID del ESP32');
  const nAvg = avgSensors(connected, 'n');
  const pAvg = avgSensors(connected, 'p');
  const kAvg = avgSensors(connected, 'k');
  $('#heroNpkAverage') && ($('#heroNpkAverage').textContent = connected.length ? `${dash(nAvg)} · ${dash(pAvg)} · ${dash(kAvg)}` : '-- · -- · --');
  $('#heroNpkMeta') && ($('#heroNpkMeta').textContent = connected.length ? 'Promedio de sensores reales' : 'Esperando sensores conectados');
}

function renderLandingStats() {
  const connected = getRealSensors();
  const all = getAllSensors();
  const parcels = getParcelIds();
  const alerts = generateAlerts();
  setText('#landingConnectedSensors', connected.length);
  setText('#landingRegisteredSensors', all.length);
  setText('#landingParcelCount', parcels.length);
  setText('#landingAlertCount', alerts.length);
}

function renderDashboard() {
  const rows = getScopedSensors({ realOnly: true });
  const all = getAllSensors();
  const alerts = generateAlerts(rows.length ? rows : getAllSensors());
  const grid = $('#kpiGrid');
  if (grid) {
    const kpis = [
      ['Sensores conectados', rows.length, 'Con lectura real disponible', '📡'],
      ['N promedio', rows.length ? `${dash(avgSensors(rows, 'n'))} ppm` : '--', 'Nitrógeno real', '🌱'],
      ['Humedad suelo', rows.length ? `${dash(avgSensors(rows, 'humidity'))}%` : '--', 'Promedio real', '💧'],
      ['Alertas detectadas', alerts.length, 'Según umbrales reales', '🚨']
    ];
    grid.innerHTML = kpis.map(([title, value, meta, icon]) => `<article class="kpi-card"><span>${title}</span><strong>${value}</strong><small>${icon} ${meta}</small></article>`).join('');
  }
  const chip = $('#realtimeChip');
  if (chip) chip.textContent = rows.length ? 'Tiempo real' : 'Sin conexión';
  const statusChip = $('#statusChip');
  if (statusChip) statusChip.textContent = rows.length ? `${rows.length}/${all.length || rows.length}` : 'Sin datos';
  renderConnectionState();
  const compact = $('#compactAlerts');
  if (compact) compact.innerHTML = alerts.length ? alerts.slice(0, 4).map(alertTemplate).join('') : emptyState('No hay alertas reales para mostrar.');
}

function renderSelections() {
  const sensors = getAllSensors();
  const parcelIds = getParcelIds();
  fillSelect('#dashboardSensorSelect', sensors.map(s => [s.id, `${s.id}${s.name ? ' · ' + s.name : ''}`]), 'Seleccionar sensor');
  fillSelect('#reportSensorId', [['todos', 'Todos'], ...sensors.map(s => [s.id, `${s.id}${s.name ? ' · ' + s.name : ''}`])]);
  fillSelect('#dashboardParcelSelect', parcelIds.map(id => [id, id]), 'Seleccionar parcela');
  fillSelect('#reportParcelId', [['todos', 'Todas'], ...parcelIds.map(id => [id, id])]);
  fillSelect('#lotFilter', [['todos', 'Todas las parcelas'], ...parcelIds.map(id => [id, id])]);
}

function fillSelect(selector, options, placeholder) {
  const select = $(selector);
  if (!select) return;
  const current = select.value;
  const html = placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : '';
  select.innerHTML = html + options.map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`).join('');
  if ([...select.options].some(opt => opt.value === current)) select.value = current;
}

function renderSensorsTable() {
  const tbody = $('#sensorsTable tbody');
  if (!tbody) return;
  const search = [$('#sensorSearch')?.value, $('#globalSearch')?.value].filter(Boolean).join(' ').toLowerCase().trim();
  const status = $('#statusFilter')?.value || 'todos';
  const lot = $('#lotFilter')?.value || 'todos';
  const date = $('#dateFilter')?.value || '';
  const filtered = getAllSensors().filter(s => {
    const haystack = `${s.id} ${s.name || ''} ${s.parcelId || ''} ${s.location || ''}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesStatus = status === 'todos' || normalizeUiStatus(s.status) === status || s.status === status;
    const matchesLot = lot === 'todos' || s.parcelId === lot;
    const matchesDate = !date || (s.timestamp && String(s.timestamp).startsWith(date));
    return matchesSearch && matchesStatus && matchesLot && matchesDate;
  });
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="12">${emptyState(getAllSensors().length ? 'No hay sensores con ese filtro.' : 'Sensores no conectados. Agrega un ID ESP32 o conecta el backend.')}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(sensor => `
    <tr>
      <td><strong>${escapeHtml(sensor.id)}</strong></td>
      <td>${escapeHtml(sensor.name || '--')}</td>
      <td><span class="status-badge status-${normalizeUiStatus(sensor.status)}">${statusLabels[sensor.status] || statusLabels[normalizeUiStatus(sensor.status)] || sensor.status}</span></td>
      <td>${escapeHtml(sensor.parcelId || '--')}</td>
      <td>${escapeHtml(sensor.location || '--')}</td>
      <td>${dash(sensor.n)}</td>
      <td>${dash(sensor.p)}</td>
      <td>${dash(sensor.k)}</td>
      <td>${dash(sensor.humidity)}${sensor.humidity != null ? '%' : ''}</td>
      <td>${dash(sensor.temp)}${sensor.temp != null ? '°C' : ''}</td>
      <td>${sensor.timestamp ? formatDateTime(sensor.timestamp) : 'Sin lectura'}</td>
      <td><button class="btn btn-small btn-outline" onclick="window.openSensorHistory('${escapeAttr(sensor.id)}')">Ver</button><button class="btn btn-small btn-secondary" onclick="window.exportOneSensor('${escapeAttr(sensor.id)}')">CSV</button></td>
    </tr>
  `).join('');
}

function normalizeUiStatus(status) {
  if (status === 'activo') return 'conectado';
  if (status === 'desconectado' || status === 'inactivo') return 'no_conectado';
  return status || 'no_conectado';
}

async function loadSensorsFromBackend({ silent = false } = {}) {
  const endpoints = [...new Set([API_CONFIG.sensorsEndpoint, ...SENSOR_ENDPOINT_FALLBACKS].filter(Boolean))];
  const attempts = [];

  for (const endpointPath of endpoints) {
    const endpoint = buildUrl(endpointPath);
    try {
      const response = await fetchWithTimeout(endpoint, { headers: { Accept: 'application/json' } });
      attempts.push(`${endpoint} → HTTP ${response.status}`);
      if (!response.ok) continue;

      const payload = await response.json();
      const rows = extractSensorRows(payload);
      sensorReadings = rows.map(normalizeSensorReading).filter(Boolean);
      API_CONFIG.sensorsEndpoint = endpointPath;
      localStorage.setItem('npk-sensors-endpoint', API_CONFIG.sensorsEndpoint);
      state.backendOnline = true;
      state.lastSync = new Date().toISOString();
      hydrateConfigInputs();
      renderAll();
      if (!silent) toast('Backend conectado', `${sensorReadings.length} lectura(s) reales recibidas desde ${endpointPath}.`);
      return;
    } catch (error) {
      attempts.push(`${endpoint} → ${error.message}`);
    }
  }

  state.backendOnline = false;
  sensorReadings = [];
  renderAll();
  if (!silent) toast('Backend no disponible', 'No se recibieron sensores reales. Verifica que Render esté activo, el endpoint exista y CORS permita el frontend.');
  console.info('No se pudo consultar backend de sensores. Intentos:', attempts);
}

function extractSensorRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.sensores)) return payload.sensores;
  if (Array.isArray(payload?.sensors)) return payload.sensors;
  if (Array.isArray(payload?.results)) return payload.results;
  if (payload && typeof payload === 'object' && (payload.sensorId || payload.id || payload.sensor_id)) return [payload];
  return [];
}

function sensorIdFromTopic(topic) {
  if (!topic) return '';
  const parts = String(topic).split('/').map(part => part.trim()).filter(Boolean);
  // Ejemplos aceptados: npk/001/data, sensores/ESP32-NPK-001/lecturas
  if (parts.length >= 2) return parts[1];
  return '';
}

function normalizeSensorReading(raw, index) {
  const id = String(raw.sensorId ?? raw.sensor_id ?? raw.id ?? raw.codigo ?? raw.esp32Id ?? raw.deviceId ?? raw.device_id ?? raw?.device?.id ?? sensorIdFromTopic(raw.topic ?? raw.mqttTopic) ?? '').trim();
  if (!id) return null;
  const timestamp = raw.timestamp ?? raw.created_at ?? raw.fechaHora ?? raw.fecha_hora ?? mergeDateTime(raw.date ?? raw.fecha, raw.time ?? raw.hora) ?? new Date().toISOString();
  const sensor = {
    id,
    name: raw.name ?? raw.nombre ?? `ESP32 ${id}`,
    parcelId: String(raw.parcelId ?? raw.parcelaId ?? raw.parcela_id ?? raw.loteId ?? raw.lote_id ?? raw.lot ?? raw.lote ?? '').trim(),
    location: raw.location ?? raw.ubicacion ?? raw.sector ?? raw.descripcion ?? 'Ubicación recibida del backend',
    lat: toNumberOrNull(raw.lat ?? raw.latitude ?? raw.latitud),
    lng: toNumberOrNull(raw.lng ?? raw.lon ?? raw.long ?? raw.longitude ?? raw.longitud),
    n: toNumberOrNull(raw.n ?? raw.N ?? raw.nitrogeno ?? raw.nitrogen ?? raw.n_ppm),
    p: toNumberOrNull(raw.p ?? raw.P ?? raw.fosforo ?? raw.phosphorus ?? raw.p_ppm),
    k: toNumberOrNull(raw.k ?? raw.K ?? raw.potasio ?? raw.potassium ?? raw.k_ppm),
    // Humedad del suelo. Acepta el nombre nuevo del backend: humedad_suelo
    humidity: toNumberOrNull(raw.humidity ?? raw.humedad_suelo ?? raw.humedadSuelo ?? raw.soilHumidity ?? raw.humedad ?? raw.soil_humidity),
    soilHumidity: toNumberOrNull(raw.soilHumidity ?? raw.humedad_suelo ?? raw.humedadSuelo ?? raw.soil_humidity ?? raw.humidity ?? raw.humedad),
    // Temperatura del ambiente/aire. Acepta el nombre nuevo del backend: temperatura_ambiente
    airTemp: toNumberOrNull(raw.airTemp ?? raw.temperatura_ambiente ?? raw.temperaturaAmbiente ?? raw.temperaturaAire ?? raw.temperatura_aire ?? raw.air_temperature ?? raw.temperatureAir ?? raw.tempAire ?? raw.temperatura ?? raw.temp ?? raw.temperature),
    temp: toNumberOrNull(raw.airTemp ?? raw.temperatura_ambiente ?? raw.temperaturaAmbiente ?? raw.temperaturaAire ?? raw.temperatura_aire ?? raw.air_temperature ?? raw.temperatureAir ?? raw.tempAire ?? raw.temp ?? raw.temperature ?? raw.temperatura),
    timestamp,
    raw,
    realData: true
  };
  sensor.status = normalizeStatus(raw.status ?? raw.estado, sensor);
  return sensor;
}

function mergeDateTime(date, time) {
  if (!date && !time) return null;
  if (date && time) return `${date}T${time}`;
  return date || time;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => loadSensorsFromBackend({ silent: true }), API_CONFIG.pollIntervalMs);
}

function initMap() {
  if (!window.L || !$('#sensorMap')) return;
  sensorMap = L.map('sensorMap', { zoomControl: true, scrollWheelZoom: true }).setView([CHIGORODO.lat, CHIGORODO.lng], 14);
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri' }).addTo(sensorMap);
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' });
  L.control.layers({ Satelital: satellite, Calles: streets }, {}, { collapsed: true }).addTo(sensorMap);
  markerLayer = L.layerGroup().addTo(sensorMap);
  heatLayers = {
    nitrogen: L.layerGroup(),
    phosphorus: L.layerGroup(),
    potassium: L.layerGroup(),
    humidity: L.layerGroup()
  };
  heatLayers.nitrogen.addTo(sensorMap);
}

function renderMapMarkers(filter = 'all') {
  if (!markerLayer || !window.L) return;
  markerLayer.clearLayers();
  Object.values(heatLayers).forEach(layer => layer.clearLayers?.());
  const sensors = getAllSensors().filter(sensor => sensor.lat !== null && sensor.lng !== null);
  const filtered = sensors.filter(sensor => filter === 'all' || normalizeUiStatus(sensor.status) === filter || sensor.status === filter);
  if (!filtered.length) {
    const info = $('#mapInfo');
    if (info) info.innerHTML = `<h3>Mapa sin sensores ubicados</h3><p>${getAllSensors().length ? 'Existen sensores registrados, pero ninguno tiene coordenadas lat/lng.' : 'Sensores no conectados. Agrega sensores con coordenadas o espera datos del backend.'}</p>`;
    return;
  }
  filtered.forEach(sensor => {
    const uiStatus = normalizeUiStatus(sensor.status);
    const icon = L.divIcon({ className: `marker-pin marker-${uiStatus}`, iconSize: [22, 22] });
    const marker = L.marker([sensor.lat, sensor.lng], { icon }).addTo(markerLayer);
    marker.bindPopup(`
      <strong>${escapeHtml(sensor.name || sensor.id)}</strong><br>
      ID: ${escapeHtml(sensor.id)}<br>
      Parcela: ${escapeHtml(sensor.parcelId || '--')}<br>
      Lat: ${Number(sensor.lat).toFixed(5)} · Lng: ${Number(sensor.lng).toFixed(5)}<br>
      N: ${dash(sensor.n)} ppm · P: ${dash(sensor.p)} ppm · K: ${dash(sensor.k)} ppm<br>
      Humedad: ${dash(sensor.humidity)}% · Temp: ${dash(sensor.temp)}°C<br>
      Estado: ${statusLabels[sensor.status] || statusLabels[uiStatus] || sensor.status}<br>
      <button onclick="window.openSensorHistory('${escapeAttr(sensor.id)}')">Ver historial</button>
    `);
    marker.on('click', () => updateMapInfo(sensor));
    addHeatCircle('nitrogen', sensor, sensor.n, '#1ecb86');
    addHeatCircle('phosphorus', sensor, sensor.p, '#4ba3c7');
    addHeatCircle('potassium', sensor, sensor.k, '#c59642');
    addHeatCircle('humidity', sensor, sensor.humidity, '#d6a852');
  });
  updateHeatLayerVisibility();
}

function addHeatCircle(layerName, sensor, value, color) {
  if (!sensor.realData || value === null || !heatLayers[layerName] || !window.L) return;
  const intensity = Math.max(0.18, Math.min(Number(value) / 100, 0.82));
  L.circle([sensor.lat, sensor.lng], {
    radius: 210 + intensity * 360,
    color,
    fillColor: color,
    fillOpacity: intensity * 0.28,
    weight: 1
  }).addTo(heatLayers[layerName]);
}

function updateHeatLayerVisibility() {
  if (!sensorMap) return;
  $$('[data-heat]').forEach(input => {
    const layer = heatLayers[input.dataset.heat];
    if (!layer) return;
    if (input.checked && !sensorMap.hasLayer(layer)) layer.addTo(sensorMap);
    if (!input.checked && sensorMap.hasLayer(layer)) sensorMap.removeLayer(layer);
  });
}

function updateMapInfo(sensor) {
  const panel = $('#mapInfo');
  if (!panel) return;
  const uiStatus = normalizeUiStatus(sensor.status);
  panel.innerHTML = `
    <h3>${escapeHtml(sensor.name || sensor.id)}</h3>
    <p><strong>ID ESP32:</strong> ${escapeHtml(sensor.id)}</p>
    <div class="map-detail-list">
      <span><i class="dot ${uiStatus === 'conectado' ? 'active-dot' : uiStatus === 'critico' ? 'warning-dot' : uiStatus === 'no_conectado' ? 'off-dot' : 'maintenance-dot'}"></i>Estado: ${statusLabels[sensor.status] || statusLabels[uiStatus]}</span>
      <span>Parcela ID: ${escapeHtml(sensor.parcelId || '--')}</span>
      <span>Latitud: ${sensor.lat !== null ? Number(sensor.lat).toFixed(6) : '--'}</span>
      <span>Longitud: ${sensor.lng !== null ? Number(sensor.lng).toFixed(6) : '--'}</span>
      <span>Nitrógeno: ${dash(sensor.n)} ppm</span>
      <span>Fósforo: ${dash(sensor.p)} ppm</span>
      <span>Potasio: ${dash(sensor.k)} ppm</span>
      <span>Humedad: ${dash(sensor.humidity)}%</span>
      <span>Temperatura: ${dash(sensor.temp)}°C</span>
      <span>Última lectura: ${sensor.timestamp ? formatDateTime(sensor.timestamp) : 'Sin lectura'}</span>
    </div>
    <button class="btn btn-primary" style="margin-top:1rem" onclick="window.openSensorHistory('${escapeAttr(sensor.id)}')">Ver historial</button>
  `;
}

async function loadWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${CHIGORODO.lat}&longitude=${CHIGORODO.lng}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=${encodeURIComponent(CHIGORODO.timezone)}`;
  try {
    const response = await fetchWithTimeout(url, {}, 8000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.weather = await response.json();
    renderWeather();
    drawAllCharts();
    toast('Meteorología actualizada', 'Datos reales de Chigorodó cargados.');
  } catch (error) {
    state.weather = null;
    renderWeatherUnavailable();
    drawAllCharts();
    console.info('No se pudo consultar Open-Meteo:', error.message);
  }
}

function renderWeather() {
  const current = state.weather?.current || {};
  setText('#weatherTemp', `${dash(current.temperature_2m)}°C`);
  setText('#weatherHumidity', `${dash(current.relative_humidity_2m)}%`);
  setText('#weatherRain', `${dash(current.precipitation ?? current.rain)} mm`);
  setText('#weatherWind', `${dash(current.wind_speed_10m)} km/h`);
  setText('#weatherSource', 'Open-Meteo');
  setText('#weatherUpdated', current.time ? `Actualizado: ${formatDateTime(current.time)}` : 'Dato real recibido');
  setText('#miniWeatherTemp', `${dash(current.temperature_2m)}°C`);
  setText('#miniWeatherMeta', `Humedad ${dash(current.relative_humidity_2m)}% · Viento ${dash(current.wind_speed_10m)} km/h`);
  setText('#heroWeatherBubble', current.temperature_2m != null ? `Chigorodó: ${current.temperature_2m}°C` : 'Clima real disponible');
  const list = $('#forecastContent');
  const daily = state.weather?.daily;
  if (list && daily?.time?.length) {
    list.innerHTML = daily.time.map((date, i) => `
      <div class="forecast-row"><strong>${dayLabel(date)}</strong><span>${dash(daily.temperature_2m_min?.[i])}°C / ${dash(daily.temperature_2m_max?.[i])}°C</span><small>Lluvia: ${dash(daily.precipitation_sum?.[i])} mm</small></div>
    `).join('');
  }
}

function renderWeatherUnavailable() {
  ['#weatherTemp', '#weatherHumidity', '#weatherRain', '#weatherWind', '#miniWeatherTemp'].forEach(sel => setText(sel, '--'));
  setText('#weatherSource', 'No disponible');
  setText('#weatherUpdated', 'No se pudo consultar Open-Meteo');
  setText('#miniWeatherMeta', 'Clima real no disponible');
  const list = $('#forecastContent');
  if (list) list.innerHTML = emptyState('No se pudo cargar el pronóstico real. Revisa conexión a internet.');
}

function renderParcels() {
  const grid = $('#parcelGrid');
  if (!grid) return;
  const parcelIds = getParcelIds();
  if (!parcelIds.length) {
    grid.innerHTML = emptyState('No hay parcelas registradas. Agrega el ID de lote/parcela que usará el ESP32.');
    return;
  }
  const all = getAllSensors();
  grid.innerHTML = parcelIds.map(id => {
    const sensors = all.filter(s => s.parcelId === id);
    const real = sensors.filter(s => s.realData);
    const reg = registeredParcels.find(p => p.id === id) || {};
    const n = avgSensors(real, 'n');
    const p = avgSensors(real, 'p');
    const k = avgSensors(real, 'k');
    return `<article class="parcel-card panel"><h3>${escapeHtml(id)}</h3><p>${escapeHtml(reg.name || 'Parcela/lote registrado')}</p><div class="parcel-meta"><span>Sensores <strong>${sensors.length}</strong></span><span>Con datos <strong>${real.length}</strong></span><span>NPK <strong>${real.length ? `${dash(n)} · ${dash(p)} · ${dash(k)}` : '--'}</strong></span></div><button class="btn btn-small btn-outline" onclick="window.filterParcel('${escapeAttr(id)}')">Ver parcela</button></article>`;
  }).join('');
}

function renderAlerts() {
  const alerts = generateAlerts();
  const list = $('#alertList');
  if (list) list.innerHTML = alerts.length ? alerts.map(alertTemplate).join('') : emptyState('No hay alertas reales. Aparecerán cuando existan sensores conectados o IDs sin lectura.');
  const summary = $('#alertSummaryGrid');
  if (summary) {
    const critical = alerts.filter(a => a.severity === 'critical').length;
    const warning = alerts.filter(a => a.severity === 'warning').length;
    const info = alerts.filter(a => a.severity === 'info').length;
    summary.innerHTML = `<div class="metric-card critical"><strong>${critical}</strong><span>Críticas</span></div><div class="metric-card warning"><strong>${warning}</strong><span>Advertencias</span></div><div class="metric-card"><strong>${info}</strong><span>Informativas</span></div>`;
  }
}

function generateAlerts(sourceRows = getAllSensors()) {
  const alerts = [];
  sourceRows.forEach(sensor => {
    const label = sensor.id || 'Sensor sin ID';
    if (!sensor.realData) {
      alerts.push({ type: 'Sensor no conectado', severity: 'warning', source: label, detail: `El ID ${label} está registrado, pero no tiene lectura real del backend.` });
      return;
    }
    if (sensor.status === 'no_conectado' || isStale(sensor.timestamp)) alerts.push({ type: 'Conectividad', severity: 'critical', source: label, detail: `El sensor ${label} no reporta lectura reciente.` });
    if (isLow(sensor.n, thresholds.nLow)) alerts.push({ type: 'Bajo nitrógeno', severity: 'critical', source: label, detail: `N = ${sensor.n} ppm. Umbral mínimo: ${thresholds.nLow} ppm.` });
    if (isLow(sensor.p, thresholds.pLow)) alerts.push({ type: 'Bajo fósforo', severity: 'warning', source: label, detail: `P = ${sensor.p} ppm. Umbral mínimo: ${thresholds.pLow} ppm.` });
    if (isLow(sensor.k, thresholds.kLow)) alerts.push({ type: 'Bajo potasio', severity: 'warning', source: label, detail: `K = ${sensor.k} ppm. Umbral mínimo: ${thresholds.kLow} ppm.` });
    if (isLow(sensor.humidity, thresholds.humidityLow)) alerts.push({ type: 'Humedad baja', severity: 'warning', source: label, detail: `Humedad = ${sensor.humidity}%. Umbral mínimo: ${thresholds.humidityLow}%.` });
    if (isHigh(sensor.humidity, thresholds.humidityHigh)) alerts.push({ type: 'Humedad alta', severity: 'warning', source: label, detail: `Humedad = ${sensor.humidity}%. Umbral máximo: ${thresholds.humidityHigh}%.` });
    if (isHigh(sensor.temp, thresholds.tempHigh)) alerts.push({ type: 'Temperatura alta', severity: 'warning', source: label, detail: `Temperatura = ${sensor.temp}°C. Umbral máximo: ${thresholds.tempHigh}°C.` });
    if (isLow(sensor.temp, thresholds.tempLow)) alerts.push({ type: 'Temperatura baja', severity: 'warning', source: label, detail: `Temperatura = ${sensor.temp}°C. Umbral mínimo: ${thresholds.tempLow}°C.` });
  });
  return alerts;
}

function alertTemplate(alert) {
  const icon = alert.severity === 'critical' ? '⚠️' : alert.severity === 'warning' ? '🔔' : 'ℹ️';
  return `<article class="alert-item ${alert.severity}"><span>${icon}</span><div><strong>${escapeHtml(alert.type)}</strong><p>${escapeHtml(alert.detail)}</p><small>${escapeHtml(alert.source)}</small></div></article>`;
}

function renderHeatmapGrid() {
  const grid = $('#heatmapGrid');
  if (!grid) return;
  const rows = getScopedSensors({ realOnly: true });
  if (!rows.length) {
    grid.innerHTML = emptyState('Sin lecturas reales para matriz nutricional.');
    return;
  }
  const cells = rows.flatMap(sensor => [
    ['N', sensor.n, sensor.id],
    ['P', sensor.p, sensor.id],
    ['K', sensor.k, sensor.id],
    ['H', sensor.humidity, sensor.id]
  ]).filter(([, value]) => value !== null);
  grid.innerHTML = cells.map(([key, value, id]) => `<span class="heat-cell" title="${key} ${id}: ${value}" style="--intensity:${Math.max(8, Math.min(100, Number(value)))}"><b>${key}</b><small>${escapeHtml(id)}</small></span>`).join('');
}

function drawAllCharts() {
  if (!window.Chart) return;
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  chartInstances.forEach(chart => chart.destroy());
  chartInstances = [];
  createDashboardCharts();
  createWeatherChart();
  createAnalyticsCharts();
}

function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8 } } },
    scales: {
      x: { grid: { color: 'rgba(160, 178, 171, .12)' } },
      y: { grid: { color: 'rgba(160, 178, 171, .12)' }, beginAtZero: true }
    },
    ...extra
  };
}

function createDashboardCharts() {
  const rows = getScopedSensors({ realOnly: true });
  const line = $('#npkLineChart');
  if (line) {
    if (!rows.length) return setChartEmpty(line, 'Sin datos reales de sensores.');
    clearChartEmpty(line);
    chartInstances.push(new Chart(line, {
      type: 'line',
      data: {
        labels: rows.map(s => s.id),
        datasets: [
          { label: 'Nitrógeno', data: rows.map(s => s.n), borderColor: '#1ecb86', backgroundColor: 'rgba(30,203,134,.12)', tension: .35, fill: true },
          { label: 'Fósforo', data: rows.map(s => s.p), borderColor: '#c59642', backgroundColor: 'rgba(197,150,66,.12)', tension: .35, fill: true },
          { label: 'Potasio', data: rows.map(s => s.k), borderColor: '#4ba3c7', backgroundColor: 'rgba(75,163,199,.12)', tension: .35, fill: true }
        ]
      },
      options: baseOptions()
    }));
  }
  const donut = $('#cropDonutChart');
  if (donut) {
    const all = getAllSensors();
    if (!all.length) return setChartEmpty(donut, 'Sin sensores registrados.');
    clearChartEmpty(donut);
    chartInstances.push(new Chart(donut, {
      type: 'doughnut',
      data: { labels: ['Conectado', 'Crítico', 'No conectado', 'Mantenimiento'], datasets: [{ data: countStatuses(all), backgroundColor: ['#1ecb86', '#d6a852', '#db6c66', '#4ba3c7'], borderWidth: 0 }] },
      options: { responsive: true, cutout: '68%', plugins: { legend: { position: 'bottom' } } }
    }));
  }
}

function countStatuses(rows = getAllSensors()) {
  return ['conectado', 'critico', 'no_conectado', 'mantenimiento'].map(status => rows.filter(s => normalizeUiStatus(s.status) === status).length);
}

function createWeatherChart() {
  const ctx = $('#weatherChart');
  if (!ctx) return;
  const daily = state.weather?.daily;
  if (!daily?.time?.length) return setChartEmpty(ctx, 'Clima real no disponible.');
  clearChartEmpty(ctx);
  chartInstances.push(new Chart(ctx, {
    type: 'line',
    data: { labels: daily.time.map(dayLabel), datasets: [
      { label: 'Temp máx °C', data: daily.temperature_2m_max || [], borderColor: '#c59642', backgroundColor: 'rgba(197,150,66,.12)', fill: true, tension: .42 },
      { label: 'Temp mín °C', data: daily.temperature_2m_min || [], borderColor: '#1ecb86', backgroundColor: 'rgba(30,203,134,.10)', fill: true, tension: .42 },
      { label: 'Lluvia mm', data: daily.precipitation_sum || [], borderColor: '#4ba3c7', backgroundColor: 'rgba(75,163,199,.12)', fill: true, tension: .42 }
    ] },
    options: baseOptions()
  }));
}

function createAnalyticsCharts() {
  const rows = getScopedSensors({ realOnly: true });
  const bar = $('#barChart');
  const area = $('#areaChart');
  const alertDonut = $('#alertDonutChart');
  if (!rows.length) {
    [bar, area, alertDonut].forEach(ctx => ctx && setChartEmpty(ctx, 'Sin datos reales para analítica.'));
    return;
  }
  const lots = [...new Set(rows.map(s => s.parcelId || 'Sin parcela'))];
  const byLot = key => lots.map(lot => avgSensors(rows.filter(s => (s.parcelId || 'Sin parcela') === lot), key));
  if (bar) {
    clearChartEmpty(bar);
    chartInstances.push(new Chart(bar, { type: 'bar', data: { labels: lots, datasets: [
      { label: 'N', data: byLot('n'), backgroundColor: '#1ecb86' },
      { label: 'P', data: byLot('p'), backgroundColor: '#4ba3c7' },
      { label: 'K', data: byLot('k'), backgroundColor: '#c59642' }
    ] }, options: baseOptions() }));
  }
  if (area) {
    clearChartEmpty(area);
    chartInstances.push(new Chart(area, { type: 'line', data: { labels: rows.map(s => s.id), datasets: [{ label: 'Humedad %', data: rows.map(s => s.humidity), borderColor: '#4ba3c7', backgroundColor: 'rgba(75,163,199,.16)', fill: true, tension: .45 }] }, options: baseOptions() }));
  }
  if (alertDonut) {
    clearChartEmpty(alertDonut);
    const alerts = generateAlerts(rows);
    const counts = ['Bajo nitrógeno', 'Bajo fósforo', 'Bajo potasio', 'Humedad baja', 'Humedad alta', 'Temperatura alta', 'Conectividad'].map(type => alerts.filter(a => a.type === type || (type === 'Conectividad' && a.type.includes('Conectividad'))).length);
    chartInstances.push(new Chart(alertDonut, { type: 'doughnut', data: { labels: ['Bajo N', 'Bajo P', 'Bajo K', 'Hum. baja', 'Hum. alta', 'Temp. alta', 'Conexión'], datasets: [{ data: counts, backgroundColor: ['#1ecb86', '#4ba3c7', '#c59642', '#d6a852', '#db6c66', '#f1d17a', '#8ea8ff'], borderWidth: 0 }] }, options: { responsive: true, cutout: '64%', plugins: { legend: { position: 'bottom' } } } }));
  }
}

function setChartEmpty(canvas, message) {
  canvas.style.display = 'none';
  let note = canvas.parentElement?.querySelector('.chart-empty');
  if (!note) {
    note = document.createElement('div');
    note.className = 'chart-empty';
    canvas.parentElement?.appendChild(note);
  }
  note.textContent = message;
}

function clearChartEmpty(canvas) {
  canvas.style.display = '';
  canvas.parentElement?.querySelector('.chart-empty')?.remove();
}

function openAddSensorModal() {
  showModal(`
    <h2>Agregar sensor ESP32 por ID</h2>
    <p class="muted">Este registro no inventa lecturas. El sensor quedará como “no conectado” hasta que el backend entregue datos con el mismo ID.</p>
    <div class="form-grid" style="margin-top:16px;">
      <label>ID del ESP32<input id="newSensorId" placeholder="Ej: ESP32-NPK-001"></label>
      <label>ID parcela/lote<input id="newSensorParcel" placeholder="Ej: LOTE-CHIG-001"></label>
      <label>Nombre opcional<input id="newSensorName" placeholder="Ej: Sensor entrada cacao"></label>
      <label>Ubicación opcional<input id="newSensorLocation" placeholder="Ej: Sector norte"></label>
      <label>Latitud opcional<input id="newSensorLat" placeholder="7.66638"></label>
      <label>Longitud opcional<input id="newSensorLng" placeholder="-76.68106"></label>
    </div>
    <button class="btn btn-primary full" style="margin-top:14px" onclick="window.saveSensorRegistration()">Guardar ID</button>
  `);
}

window.saveSensorRegistration = function() {
  const id = $('#newSensorId')?.value.trim();
  if (!id) return toast('Falta ID', 'Escribe el ID único del ESP32.');
  const sensor = {
    id,
    parcelId: $('#newSensorParcel')?.value.trim() || '',
    name: $('#newSensorName')?.value.trim() || `ESP32 ${id}`,
    location: $('#newSensorLocation')?.value.trim() || 'Ubicación pendiente',
    lat: toNumberOrNull($('#newSensorLat')?.value),
    lng: toNumberOrNull($('#newSensorLng')?.value)
  };
  const exists = registeredSensors.some(s => s.id === id);
  registeredSensors = exists ? registeredSensors.map(s => s.id === id ? sensor : s) : [...registeredSensors, sensor];
  if (sensor.parcelId && !registeredParcels.some(p => p.id === sensor.parcelId)) registeredParcels.push({ id: sensor.parcelId, name: `Parcela ${sensor.parcelId}` });
  saveJSON('npk-registered-sensors', registeredSensors);
  saveJSON('npk-registered-parcels', registeredParcels);
  $('#mainModal')?.close();
  renderAll();
  toast('Sensor registrado', `${id} quedó pendiente de conexión real.`);
};

function openAddParcelModal() {
  showModal(`
    <h2>Agregar parcela/lote por ID</h2>
    <p class="muted">Usa el mismo ID que enviará el ESP32 o el backend para relacionar sensores con lote.</p>
    <div class="form-grid" style="margin-top:16px;">
      <label>ID parcela/lote<input id="newParcelId" placeholder="Ej: LOTE-CHIG-001"></label>
      <label>Nombre opcional<input id="newParcelName" placeholder="Ej: Parcela cacao norte"></label>
      <label>Área opcional<input id="newParcelArea" placeholder="Ej: 2 ha"></label>
      <label>Subcelda/sector opcional<input id="newParcelSubcell" placeholder="Ej: Bloque A"></label>
    </div>
    <button class="btn btn-primary full" style="margin-top:14px" onclick="window.saveParcelRegistration()">Guardar parcela</button>
  `);
}

window.saveParcelRegistration = function() {
  const id = $('#newParcelId')?.value.trim();
  if (!id) return toast('Falta ID', 'Escribe el ID de parcela o lote.');
  const parcel = { id, name: $('#newParcelName')?.value.trim() || `Parcela ${id}`, area: $('#newParcelArea')?.value.trim() || '', subcell: $('#newParcelSubcell')?.value.trim() || '' };
  const exists = registeredParcels.some(p => p.id === id);
  registeredParcels = exists ? registeredParcels.map(p => p.id === id ? parcel : p) : [...registeredParcels, parcel];
  saveJSON('npk-registered-parcels', registeredParcels);
  $('#mainModal')?.close();
  renderAll();
  toast('Parcela registrada', `${id} quedó disponible para sensores e informes.`);
};

window.filterParcel = function(id) {
  setView('dashboard');
  const scope = $('#dashboardScope');
  const parcel = $('#dashboardParcelSelect');
  if (scope) scope.value = 'parcela';
  if (parcel) parcel.value = id;
  renderDashboard();
  drawAllCharts();
};

function hydrateConfigInputs() {
  $('#backendUrlInput') && ($('#backendUrlInput').value = API_CONFIG.baseUrl);
  $('#sensorsEndpointInput') && ($('#sensorsEndpointInput').value = API_CONFIG.sensorsEndpoint);
  $('#streamEndpointInput') && ($('#streamEndpointInput').value = API_CONFIG.streamEndpoint);
  $('#pollIntervalInput') && ($('#pollIntervalInput').value = String(API_CONFIG.pollIntervalMs));
}

function saveApiConfig() {
  API_CONFIG.baseUrl = normalizeBaseUrl($('#backendUrlInput')?.value || '');
  API_CONFIG.sensorsEndpoint = $('#sensorsEndpointInput')?.value || '/sensor/latest';
  API_CONFIG.streamEndpoint = $('#streamEndpointInput')?.value || '/api/sensores/stream';
  API_CONFIG.pollIntervalMs = Number($('#pollIntervalInput')?.value || 10000);
  localStorage.setItem('npk-backend-url', API_CONFIG.baseUrl);
  localStorage.setItem('npk-sensors-endpoint', API_CONFIG.sensorsEndpoint);
  localStorage.setItem('npk-stream-endpoint', API_CONFIG.streamEndpoint);
  localStorage.setItem('npk-poll-interval', String(API_CONFIG.pollIntervalMs));
  startPolling();
  startRealtimeStream();
  loadSensorsFromBackend();
  toast('Configuración guardada', 'El frontend consultará la URL configurada.');
}

function clearApiConfig() {
  ['npk-backend-url', 'npk-sensors-endpoint', 'npk-stream-endpoint', 'npk-poll-interval'].forEach(key => localStorage.removeItem(key));
  API_CONFIG = { ...DEFAULT_CONFIG, baseUrl: DEFAULT_BACKEND_URL, sensorsEndpoint: '/sensor/latest', streamEndpoint: '/api/sensores/stream', pollIntervalMs: 10000 };
  hydrateConfigInputs();
  toast('Configuración restablecida', `Se usará ${DEFAULT_BACKEND_URL} como backend principal.`);
}

function showBackendContract() {
  showModal(`<h2>Ejemplo JSON para el backend</h2><pre class="code-block">${escapeHtml(backendContractText())}</pre>`);
}

function copyBackendContract() {
  navigator.clipboard?.writeText(backendContractText());
  toast('Contrato copiado', 'Pega este ejemplo en el chat con tu compañero de backend.');
}

function backendContractText() {
  return `URL base configurada en frontend:
https://npk-yvtg.onrender.com/api

1) Lectura real para el dashboard
GET /api/sensor/latest
{
  "sensor_id": "001",
  "nitrogeno": 42,
  "fosforo": 18,
  "potasio": 51,
  "humedad_suelo": 68,
  "temperatura_ambiente": 27.2,
  "timestamp": "2026-06-10T09:12:00.000Z"
}

2) Payload que debe publicar el ESP32 o MQTT Explorer
Topic: npk/001/data
{
  "nitrogeno": 42,
  "fosforo": 18,
  "potasio": 51,
  "humedad_suelo": 68,
  "temperatura_ambiente": 27.2
}

3) Alias que también acepta este frontend
id, sensorId, sensor_id, esp32Id, loteId, lote_id, parcela_id,
n, nitrogeno, fosforo, potasio,
humedad_suelo, humedadSuelo, humedad, humidity, soilHumidity,
temperatura_ambiente, temperaturaAmbiente, temperaturaAire, temp, temperature,
latitud, longitud, lat, lng, status, estado.`;
}

function showAlertRules() {
  showModal(`<h2>Reglas de alertas</h2><div class="settings-list"><label><span>N bajo menor a ${thresholds.nLow} ppm</span></label><label><span>P bajo menor a ${thresholds.pLow} ppm</span></label><label><span>K bajo menor a ${thresholds.kLow} ppm</span></label><label><span>Humedad fuera de ${thresholds.humidityLow}% - ${thresholds.humidityHigh}%</span></label><label><span>Temperatura fuera de ${thresholds.tempLow}°C - ${thresholds.tempHigh}°C</span></label><label><span>Sensor sin lectura reciente: ${thresholds.staleMinutes} minutos</span></label></div>`);
}

function filterReportRows() {
  const sensorId = $('#reportSensorId')?.value || 'todos';
  const parcelId = $('#reportParcelId')?.value || 'todos';
  const start = $('#reportStartDate')?.value || '';
  const end = $('#reportEndDate')?.value || '';
  return getAllSensors().filter(sensor => {
    const bySensor = sensorId === 'todos' || sensor.id === sensorId;
    const byParcel = parcelId === 'todos' || sensor.parcelId === parcelId;
    const date = sensor.timestamp ? String(sensor.timestamp).slice(0, 10) : '';
    const byStart = !start || (date && date >= start);
    const byEnd = !end || (date && date <= end);
    return bySensor && byParcel && byStart && byEnd;
  });
}

function buildReportHTML() {
  const type = $('#reportType')?.value || 'general';
  const sensorId = $('#reportSensorId')?.value || 'todos';
  const parcelId = $('#reportParcelId')?.value || 'todos';
  const subcell = $('#reportSubcellId')?.value.trim() || 'No especificada';
  const rows = filterReportRows();
  const alerts = generateAlerts(rows);
  const current = state.weather?.current || {};
  const htmlRows = rows.map(s => `<tr><td>${escapeHtml(s.id)}</td><td>${escapeHtml(s.parcelId || '--')}</td><td>${statusLabels[s.status] || s.status}</td><td>${dash(s.n)}</td><td>${dash(s.p)}</td><td>${dash(s.k)}</td><td>${dash(s.humidity)}</td><td>${dash(s.temp)}</td><td>${s.timestamp ? formatDateTime(s.timestamp) : 'Sin lectura'}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe NPK</title><style>body{font-family:Arial,sans-serif;line-height:1.45;padding:28px;color:#10231f}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #d8e4dd;padding:8px;text-align:left}th{background:#edf7f1}.muted{color:#5f7269}.box{background:#f5faf7;border:1px solid #d8e4dd;border-radius:12px;padding:14px;margin:12px 0}</style></head><body><h1>Informe técnico NPK Smart Cacao</h1><p class="muted">Generado: ${formatDateTime(new Date().toISOString())}</p><div class="box"><strong>Tipo:</strong> ${escapeHtml(type)}<br><strong>ID sensor:</strong> ${escapeHtml(sensorId)}<br><strong>ID parcela/lote:</strong> ${escapeHtml(parcelId)}<br><strong>Subcelda/sector:</strong> ${escapeHtml(subcell)}<br><strong>Ubicación climática:</strong> Chigorodó, Antioquia</div><h2>Resumen</h2><p>Sensores incluidos: ${rows.length}. Alertas detectadas: ${alerts.length}. Temperatura actual externa: ${dash(current.temperature_2m)}°C. Humedad relativa externa: ${dash(current.relative_humidity_2m)}%.</p>${rows.length ? `<h2>Lecturas</h2><table><thead><tr><th>ID sensor</th><th>ID parcela</th><th>Estado</th><th>N</th><th>P</th><th>K</th><th>Humedad</th><th>Temperatura</th><th>Última lectura</th></tr></thead><tbody>${htmlRows}</tbody></table>` : '<p><strong>No hay lecturas reales para los filtros seleccionados.</strong></p>'}<h2>Alertas</h2>${alerts.length ? `<ul>${alerts.map(a => `<li><strong>${escapeHtml(a.type)}:</strong> ${escapeHtml(a.detail)} (${escapeHtml(a.source)})</li>`).join('')}</ul>` : '<p>No hay alertas para los filtros seleccionados.</p>'}</body></html>`;
}

function previewReport() {
  const html = buildReportHTML();
  showModal(`<h2>Vista previa del informe</h2><iframe class="report-preview" srcdoc="${escapeAttr(html)}"></iframe>`);
}

function downloadReportHTML() {
  const rows = filterReportRows();
  if (!rows.length) toast('Informe sin lecturas', 'Se generará con el mensaje de no datos reales para los filtros seleccionados.');
  const name = `informe-npk-${Date.now()}.html`;
  downloadText(name, buildReportHTML(), 'text/html;charset=utf-8;');
  generatedReports.unshift({ name, date: new Date().toISOString(), rows: rows.length });
  generatedReports = generatedReports.slice(0, 8);
  saveJSON('npk-generated-reports', generatedReports);
  renderReportsList();
}

function downloadReportCSV() {
  const rows = filterReportRows();
  if (!rows.length) return toast('Sin datos', 'No hay lecturas reales para exportar con esos filtros.');
  const headers = ['sensorId', 'parcelaId', 'estado', 'n', 'p', 'k', 'humedad', 'temperatura', 'lat', 'lng', 'timestamp'];
  const csv = [headers, ...rows.map(s => [s.id, s.parcelId, s.status, s.n, s.p, s.k, s.humidity, s.temp, s.lat, s.lng, s.timestamp])].map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  downloadText(`informe-npk-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8;');
}

function printReport() {
  const win = window.open('', '_blank');
  if (!win) return toast('Ventana bloqueada', 'Permite ventanas emergentes para imprimir o guardar en PDF.');
  win.document.write(buildReportHTML());
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}

function renderReportsList() {
  const list = $('#reportList');
  if (!list) return;
  list.innerHTML = generatedReports.length ? generatedReports.map(r => `<article class="report-row"><strong>${escapeHtml(r.name)}</strong><small>${formatDateTime(r.date)} · ${r.rows} lectura(s)</small></article>`).join('') : emptyState('Aún no se han generado informes.');
}

function exportSensorsCSV() {
  const rows = getAllSensors();
  const headers = ['ID ESP32', 'Nombre', 'Estado', 'Parcela ID', 'Ubicación', 'N', 'P', 'K', 'Humedad suelo', 'Temperatura aire', 'Latitud', 'Longitud', 'Última lectura', 'Dato real'];
  const dataRows = rows.map(s => [s.id, s.name, statusLabels[s.status] || statusLabels[normalizeUiStatus(s.status)] || s.status, s.parcelId, s.location, s.n, s.p, s.k, s.soilHumidity ?? s.humidity, s.airTemp ?? s.temp, s.lat, s.lng, s.timestamp, s.realData ? 'sí' : 'no']);
  const csv = [headers, ...dataRows].map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  downloadText('sensores-npk-smart-cacao-chigorodo.csv', csv, 'text/csv;charset=utf-8;');
  if (!rows.length) toast('CSV generado', 'Se descargó una plantilla vacía porque todavía no hay sensores registrados ni lecturas reales.');
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('Archivo generado', filename);
}

function showNotifications() {
  const alerts = generateAlerts();
  showModal(`<h2>Notificaciones</h2>${alerts.length ? alerts.map(alertTemplate).join('') : emptyState('No hay notificaciones reales por ahora.')}`);
}

window.openSensorHistory = function(id) {
  const sensor = getAllSensors().find(s => s.id === id);
  if (!sensor) return;
  const real = sensor.realData ? 'Lectura real recibida del backend.' : 'Sensor registrado, pero no conectado al backend.';
  showModal(`
    <h2>Sensor ${escapeHtml(sensor.id)}</h2>
    <p class="muted">${real}</p>
    <div class="kpi-grid modal-kpis">
      <div class="kpi-card"><span>Nitrógeno</span><strong>${dash(sensor.n)} ppm</strong><small>N</small></div>
      <div class="kpi-card"><span>Fósforo</span><strong>${dash(sensor.p)} ppm</strong><small>P</small></div>
      <div class="kpi-card"><span>Potasio</span><strong>${dash(sensor.k)} ppm</strong><small>K</small></div>
      <div class="kpi-card"><span>Humedad</span><strong>${dash(sensor.humidity)}%</strong><small>Suelo</small></div>
    </div>
    <div class="settings-list" style="margin-top:16px;"><label><span>Parcela ID</span><strong>${escapeHtml(sensor.parcelId || '--')}</strong></label><label><span>Estado</span><strong>${statusLabels[sensor.status] || sensor.status}</strong></label><label><span>Última lectura</span><strong>${sensor.timestamp ? formatDateTime(sensor.timestamp) : 'Sin lectura'}</strong></label></div>
  `);
};

window.exportOneSensor = function(id) {
  const sensor = getAllSensors().find(s => s.id === id);
  if (!sensor) return;
  const csv = Object.entries(sensor).filter(([key]) => key !== 'raw').map(([k, v]) => `"${k}","${String(v ?? '').replaceAll('"', '""')}"`).join('\n');
  downloadText(`${id}.csv`, csv, 'text/csv;charset=utf-8;');
};

function setText(selector, value) {
  const el = $(selector);
  if (el) el.textContent = value;
}

function dash(value) {
  return value === null || value === undefined || value === '' || Number.isNaN(value) ? '--' : value;
}

function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: CHIGORODO.timezone }).format(new Date(value));
  } catch {
    return String(value || '--');
  }
}

function dayLabel(date) {
  try {
    return new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: CHIGORODO.timezone }).format(new Date(`${date}T12:00:00`));
  } catch {
    return date;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

window.addEventListener('resize', () => setTimeout(() => { drawAllCharts(); sensorMap?.invalidateSize?.(); }, 150));
document.addEventListener('DOMContentLoaded', init);

/* =========================================================
   Ajustes finales solicitados: todo funcional desde frontend
   ========================================================= */
let streamSource = null;

function buildUrlWithParams(endpoint, params = {}) {
  const url = new URL(buildUrl(endpoint), window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '' && value !== 'todos') url.searchParams.set(key, value);
  });
  return url.toString();
}

async function fetchJsonCandidate(endpoints, { method = 'GET', body = null, params = {}, silent = true, timeoutMs = API_CONFIG.timeoutMs } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  const errors = [];
  for (const endpoint of [...new Set(endpoints.filter(Boolean))]) {
    const url = method === 'GET' ? buildUrlWithParams(endpoint, params) : buildUrl(endpoint);
    try {
      const response = await fetchWithTimeout(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      }, timeoutMs);
      if (!response.ok) {
        errors.push(`${endpoint}: HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      const data = text ? JSON.parse(text) : { ok: true };
      return { ok: true, endpoint, data };
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }
  if (!silent) console.info('Sin respuesta de endpoints candidatos:', errors);
  return { ok: false, errors };
}

function startRealtimeStream() {
  if (streamSource) {
    streamSource.close();
    streamSource = null;
  }
  if (!window.EventSource || !API_CONFIG.streamEndpoint) return;
  try {
    streamSource = new EventSource(buildUrl(API_CONFIG.streamEndpoint));
    streamSource.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        const rows = extractSensorRows(payload).map(normalizeSensorReading).filter(Boolean);
        if (!rows.length) return;
        sensorReadings = mergeReadings(sensorReadings, rows);
        state.backendOnline = true;
        state.lastSync = new Date().toISOString();
        renderAll();
      } catch (error) {
        console.info('Evento SSE ignorado:', error.message);
      }
    };
    streamSource.onerror = () => {
      streamSource?.close();
      streamSource = null;
    };
  } catch (error) {
    console.info('Streaming SSE no disponible:', error.message);
  }
}

function mergeReadings(currentRows, newRows) {
  const map = new Map(currentRows.map(row => [row.id, row]));
  newRows.forEach(row => map.set(row.id, { ...(map.get(row.id) || {}), ...row, realData: true }));
  return [...map.values()];
}

function initWeatherMap() {
  if (!window.L || !$('#weatherMap')) return;
  weatherMap = L.map('weatherMap', { zoomControl: true, scrollWheelZoom: true }).setView([CHIGORODO.lat, CHIGORODO.lng], 10);
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri',
    maxZoom: 18
  }).addTo(weatherMap);
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
  });
  L.control.layers({ Satelital: satellite, Calles: streets }, {}, { collapsed: true }).addTo(weatherMap);
  L.marker([CHIGORODO.lat, CHIGORODO.lng]).addTo(weatherMap).bindPopup('Chigorodó · Antioquia');
  loadRainViewerRadar();
}

async function loadRainViewerRadar() {
  if (!weatherMap || !window.L) return;
  const chip = $('#radarStatusChip');
  try {
    const response = await fetchWithTimeout('https://api.rainviewer.com/public/weather-maps.json', { headers: { Accept: 'application/json' } }, 8000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const frames = [...(data?.radar?.nowcast || []), ...(data?.radar?.past || [])];
    const frame = frames[frames.length - 1];
    if (!frame?.path || !data?.host) throw new Error('Sin frame de radar');
    if (weatherRadarLayer) weatherMap.removeLayer(weatherRadarLayer);
    weatherRadarLayer = L.tileLayer(`${data.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      tileSize: 256,
      opacity: 0.58,
      maxNativeZoom: 7,
      maxZoom: 18,
      attribution: 'Radar © RainViewer'
    }).addTo(weatherMap);
    if (chip) {
      chip.textContent = `Radar ${formatDateTime(new Date(frame.time * 1000).toISOString())}`;
      chip.classList.add('success');
    }
  } catch (error) {
    if (chip) {
      chip.textContent = 'Radar no disponible';
      chip.classList.add('warning');
    }
    console.info('No se pudo cargar radar RainViewer:', error.message);
  }
}

function classifyLow(value, rule) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number < rule.criticalLow) return 'critical';
  if (number < rule.warningLow) return 'warning';
  return null;
}

function classifyRange(value, rule) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number < rule.criticalLow || number > rule.criticalHigh) return 'critical';
  if (number < rule.warningLow || number > rule.warningHigh) return 'warning';
  return null;
}

function hasCriticalValues(sensor) {
  return classifyLow(sensor.n, alertRules.nitrogen) === 'critical'
    || classifyLow(sensor.p, alertRules.phosphorus) === 'critical'
    || classifyLow(sensor.k, alertRules.potassium) === 'critical'
    || classifyRange(sensor.humidity ?? sensor.soilHumidity, alertRules.humidity) === 'critical'
    || classifyRange(sensor.airTemp ?? sensor.temp, alertRules.airTemp) === 'critical';
}

function renderDashboard() {
  const rows = getScopedSensors({ realOnly: true });
  const all = getAllSensors();
  const alerts = generateAlerts(rows.length ? rows : all);
  const grid = $('#kpiGrid');
  if (grid) {
    const nAvg = avgSensors(rows, 'n');
    const pAvg = avgSensors(rows, 'p');
    const kAvg = avgSensors(rows, 'k');
    const hAvg = avgSensors(rows.map(row => ({ ...row, soil: row.soilHumidity ?? row.humidity })), 'soil');
    const tAvg = avgSensors(rows.map(row => ({ ...row, air: row.airTemp ?? row.temp })), 'air');
    const kpis = [
      ['Nitrógeno', rows.length ? `${dash(nAvg)} ppm` : '--', 'Lectura N promedio real', '🌱'],
      ['Fósforo', rows.length ? `${dash(pAvg)} ppm` : '--', 'Lectura P promedio real', '🧪'],
      ['Potasio', rows.length ? `${dash(kAvg)} ppm` : '--', 'Lectura K promedio real', '⚡'],
      ['Humedad del suelo', rows.length ? `${dash(hAvg)}%` : '--', 'Promedio desde sensores', '💧'],
      ['Temperatura del aire', rows.length ? `${dash(tAvg)}°C` : '--', 'Promedio desde sensores', '🌡️'],
      ['Sensores conectados', rows.length, `Total registrados/listados: ${all.length}`, '📡'],
      ['Alertas reales', alerts.length, 'Críticas, advertencias e informativas', '🚨']
    ];
    grid.innerHTML = kpis.map(([title, value, meta, icon], index) => `<article class="kpi-card realtime-main ${alerts.length && index === 6 ? 'warning-card' : ''}"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}</strong><small>${icon} ${escapeHtml(meta)}</small></article>`).join('');
  }
  const chip = $('#realtimeChip');
  if (chip) chip.textContent = rows.length ? 'Tiempo real' : 'Sin conexión';
  const statusChip = $('#statusChip');
  if (statusChip) statusChip.textContent = rows.length ? `${rows.length}/${all.length || rows.length}` : 'Sin datos';
  renderConnectionState();
  const compact = $('#compactAlerts');
  if (compact) compact.innerHTML = alerts.length ? alerts.slice(0, 5).map(alertTemplate).join('') : emptyState('No hay alertas reales para mostrar.');
}

function generateAlerts(sourceRows = getAllSensors()) {
  const alerts = [];
  sourceRows.forEach(sensor => {
    const label = sensor.id || 'Sensor sin ID';
    const parcel = sensor.parcelId ? ` · Parcela ${sensor.parcelId}` : '';
    if (!sensor.realData) {
      alerts.push({ type: 'Sensor no conectado', severity: 'info', source: label, detail: `El ID ${label}${parcel} está registrado, pero todavía no tiene lectura real del backend.` });
      return;
    }
    if (sensor.status === 'no_conectado' || isStale(sensor.timestamp)) {
      alerts.push({ type: 'Conectividad', severity: 'critical', source: label, detail: `El sensor ${label}${parcel} no reporta lectura reciente. Revisa alimentación, WiFi o backend.` });
    }
    const nutrientChecks = [
      ['Nitrógeno bajo', sensor.n, alertRules.nitrogen, 'nitrógeno'],
      ['Fósforo bajo', sensor.p, alertRules.phosphorus, 'fósforo'],
      ['Potasio bajo', sensor.k, alertRules.potassium, 'potasio']
    ];
    nutrientChecks.forEach(([type, value, rule, name]) => {
      const severity = classifyLow(value, rule);
      if (!severity) return;
      alerts.push({
        type,
        severity,
        source: label,
        detail: `${rule.label} = ${value} ${rule.unit}. ${severity === 'critical' ? 'Nivel crítico' : 'Advertencia'}: posible deficiencia de ${name}. Umbral advertencia < ${rule.warningLow}${rule.unit}, crítico < ${rule.criticalLow}${rule.unit}.`
      });
    });
    const humidityValue = sensor.soilHumidity ?? sensor.humidity;
    const humiditySeverity = classifyRange(humidityValue, alertRules.humidity);
    if (humiditySeverity) {
      alerts.push({
        type: humidityValue < alertRules.humidity.warningLow ? 'Humedad baja' : 'Humedad alta',
        severity: humiditySeverity,
        source: label,
        detail: `Humedad del suelo = ${humidityValue}%. Rango recomendado ${alertRules.humidity.warningLow}% - ${alertRules.humidity.warningHigh}%.`
      });
    }
    const airTempValue = sensor.airTemp ?? sensor.temp;
    const tempSeverity = classifyRange(airTempValue, alertRules.airTemp);
    if (tempSeverity) {
      alerts.push({
        type: airTempValue < alertRules.airTemp.warningLow ? 'Temperatura baja' : 'Temperatura alta',
        severity: tempSeverity,
        source: label,
        detail: `Temperatura del aire = ${airTempValue}°C. Rango recomendado ${alertRules.airTemp.warningLow}°C - ${alertRules.airTemp.warningHigh}°C.`
      });
    }
  });
  return alerts;
}

function showAlertRules() {
  showModal(`<h2>Reglas de alertas y notificaciones</h2>
    <p class="muted">Estas reglas se aplican únicamente a datos reales recibidos desde el backend. Los valores son umbrales configurables para el prototipo.</p>
    <div class="settings-list">
      <label><span>Nitrógeno</span><strong>Advertencia &lt; ${alertRules.nitrogen.warningLow} ppm · Crítica &lt; ${alertRules.nitrogen.criticalLow} ppm</strong></label>
      <label><span>Fósforo</span><strong>Advertencia &lt; ${alertRules.phosphorus.warningLow} ppm · Crítica &lt; ${alertRules.phosphorus.criticalLow} ppm</strong></label>
      <label><span>Potasio</span><strong>Advertencia &lt; ${alertRules.potassium.warningLow} ppm · Crítica &lt; ${alertRules.potassium.criticalLow} ppm</strong></label>
      <label><span>Humedad del suelo</span><strong>Advertencia fuera de ${alertRules.humidity.warningLow}% - ${alertRules.humidity.warningHigh}% · Crítica fuera de ${alertRules.humidity.criticalLow}% - ${alertRules.humidity.criticalHigh}%</strong></label>
      <label><span>Temperatura del aire</span><strong>Advertencia fuera de ${alertRules.airTemp.warningLow}°C - ${alertRules.airTemp.warningHigh}°C · Crítica fuera de ${alertRules.airTemp.criticalLow}°C - ${alertRules.airTemp.criticalHigh}°C</strong></label>
      <label><span>Conectividad</span><strong>Crítica si supera ${thresholds.staleMinutes} minutos sin lectura</strong></label>
    </div>`);
}

window.saveSensorRegistration = function() {
  const id = $('#newSensorId')?.value.trim();
  if (!id) return toast('Falta ID', 'Escribe el ID único del ESP32.');
  const sensor = {
    id,
    sensorId: id,
    parcelId: $('#newSensorParcel')?.value.trim() || '',
    parcelaId: $('#newSensorParcel')?.value.trim() || '',
    name: $('#newSensorName')?.value.trim() || `ESP32 ${id}`,
    nombre: $('#newSensorName')?.value.trim() || `ESP32 ${id}`,
    location: $('#newSensorLocation')?.value.trim() || 'Ubicación pendiente',
    ubicacion: $('#newSensorLocation')?.value.trim() || 'Ubicación pendiente',
    lat: toNumberOrNull($('#newSensorLat')?.value),
    lng: toNumberOrNull($('#newSensorLng')?.value),
    createdAt: new Date().toISOString()
  };
  const localSensor = { id: sensor.id, parcelId: sensor.parcelId, name: sensor.name, location: sensor.location, lat: sensor.lat, lng: sensor.lng };
  const exists = registeredSensors.some(s => s.id === id);
  registeredSensors = exists ? registeredSensors.map(s => s.id === id ? localSensor : s) : [...registeredSensors, localSensor];
  if (localSensor.parcelId && !registeredParcels.some(p => p.id === localSensor.parcelId)) registeredParcels.push({ id: localSensor.parcelId, name: `Parcela ${localSensor.parcelId}` });
  saveJSON('npk-registered-sensors', registeredSensors);
  saveJSON('npk-registered-parcels', registeredParcels);
  closeModal();
  renderAll();
  toast('Sensor registrado localmente', `${id} quedó listo. Cuando el backend/MongoDB acepte POST se sincronizará automáticamente.`);
  fetchJsonCandidate(SENSOR_CREATE_ENDPOINT_FALLBACKS, { method: 'POST', body: sensor, silent: true, timeoutMs: 2500 })
    .then(backend => { if (backend.ok) toast('Sensor sincronizado', `${id} fue enviado al backend en ${backend.endpoint}.`); })
    .catch(() => {});
};

window.saveParcelRegistration = function() {
  const id = $('#newParcelId')?.value.trim();
  if (!id) return toast('Falta ID', 'Escribe el ID de parcela o lote.');
  const parcel = {
    id,
    parcelaId: id,
    loteId: id,
    name: $('#newParcelName')?.value.trim() || `Parcela ${id}`,
    nombre: $('#newParcelName')?.value.trim() || `Parcela ${id}`,
    area: $('#newParcelArea')?.value.trim() || '',
    subcell: $('#newParcelSubcell')?.value.trim() || '',
    subceldaId: $('#newParcelSubcell')?.value.trim() || '',
    createdAt: new Date().toISOString()
  };
  const localParcel = { id: parcel.id, name: parcel.name, area: parcel.area, subcell: parcel.subcell };
  const exists = registeredParcels.some(p => p.id === id);
  registeredParcels = exists ? registeredParcels.map(p => p.id === id ? localParcel : p) : [...registeredParcels, localParcel];
  saveJSON('npk-registered-parcels', registeredParcels);
  closeModal();
  renderAll();
  toast('Parcela registrada localmente', `${id} quedó disponible. Cuando el backend/MongoDB acepte POST se sincronizará automáticamente.`);
  fetchJsonCandidate(PARCEL_CREATE_ENDPOINT_FALLBACKS, { method: 'POST', body: parcel, silent: true, timeoutMs: 2500 })
    .then(backend => { if (backend.ok) toast('Parcela sincronizada', `${id} fue enviada al backend en ${backend.endpoint}.`); })
    .catch(() => {});
};

function getReportFilters() {
  return {
    type: $('#reportType')?.value || 'general',
    sensorId: $('#reportSensorId')?.value || 'todos',
    parcelId: $('#reportParcelId')?.value || 'todos',
    parcelaId: $('#reportParcelId')?.value || 'todos',
    subcellId: $('#reportSubcellId')?.value.trim() || '',
    start: $('#reportStartDate')?.value || '',
    end: $('#reportEndDate')?.value || ''
  };
}

async function fetchReportRowsFromBackend() {
  const filters = getReportFilters();
  const result = await fetchJsonCandidate(REPORT_ENDPOINT_FALLBACKS, { method: 'GET', params: filters });
  if (!result.ok) return null;
  const rows = extractSensorRows(result.data).map(normalizeSensorReading).filter(Boolean);
  return rows;
}

function filterRowsLocally(rows, allowRegistered = false) {
  const sensorId = $('#reportSensorId')?.value || 'todos';
  const parcelId = $('#reportParcelId')?.value || 'todos';
  const start = $('#reportStartDate')?.value || '';
  const end = $('#reportEndDate')?.value || '';
  return rows.filter(sensor => {
    if (!allowRegistered && (!sensor.realData || !hasAnyReading(sensor))) return false;
    const bySensor = sensorId === 'todos' || sensor.id === sensorId;
    const byParcel = parcelId === 'todos' || sensor.parcelId === parcelId;
    const date = sensor.timestamp ? String(sensor.timestamp).slice(0, 10) : '';
    const byStart = !start || (date && date >= start);
    const byEnd = !end || (date && date <= end);
    return bySensor && byParcel && byStart && byEnd;
  });
}

async function getReportRows() {
  const backendRows = await fetchReportRowsFromBackend();
  if (backendRows?.length) return filterRowsLocally(backendRows);
  return filterRowsLocally(getAllSensors());
}

function buildReportHTMLFromRows(rows) {
  const type = $('#reportType')?.value || 'general';
  const sensorId = $('#reportSensorId')?.value || 'todos';
  const parcelId = $('#reportParcelId')?.value || 'todos';
  const subcell = $('#reportSubcellId')?.value.trim() || 'No especificada';
  const alerts = generateAlerts(rows);
  const current = state.weather?.current || {};
  const htmlRows = rows.map(s => `<tr><td>${escapeHtml(s.id)}</td><td>${escapeHtml(s.parcelId || '--')}</td><td>${escapeHtml(statusLabels[s.status] || s.status)}</td><td>${dash(s.n)}</td><td>${dash(s.p)}</td><td>${dash(s.k)}</td><td>${dash(s.soilHumidity ?? s.humidity)}</td><td>${dash(s.airTemp ?? s.temp)}</td><td>${s.timestamp ? formatDateTime(s.timestamp) : 'Sin lectura'}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe NPK</title><style>body{font-family:Arial,sans-serif;line-height:1.45;padding:28px;color:#10231f}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #d8e4dd;padding:8px;text-align:left}th{background:#edf7f1}.muted{color:#5f7269}.box{background:#f5faf7;border:1px solid #d8e4dd;border-radius:12px;padding:14px;margin:12px 0}h1{color:#0f3b2d}</style></head><body><h1>Informe técnico NPK Smart Cacao</h1><p class="muted">Generado: ${formatDateTime(new Date().toISOString())}</p><div class="box"><strong>Tipo:</strong> ${escapeHtml(type)}<br><strong>ID sensor:</strong> ${escapeHtml(sensorId)}<br><strong>ID parcela/lote:</strong> ${escapeHtml(parcelId)}<br><strong>Subcelda/sector:</strong> ${escapeHtml(subcell)}<br><strong>Ubicación climática:</strong> Chigorodó, Antioquia</div><h2>Resumen</h2><p>Sensores incluidos: ${rows.length}. Alertas detectadas: ${alerts.length}. Temperatura externa actual: ${dash(current.temperature_2m)}°C. Humedad relativa externa: ${dash(current.relative_humidity_2m)}%.</p>${rows.length ? `<h2>Lecturas reales</h2><table><thead><tr><th>ID sensor</th><th>ID parcela</th><th>Estado</th><th>N</th><th>P</th><th>K</th><th>Humedad suelo</th><th>Temperatura aire</th><th>Última lectura</th></tr></thead><tbody>${htmlRows}</tbody></table>` : '<p><strong>No hay lecturas reales para los filtros seleccionados.</strong></p>'}<h2>Alertas</h2>${alerts.length ? `<ul>${alerts.map(a => `<li><strong>${escapeHtml(a.type)}:</strong> ${escapeHtml(a.detail)} (${escapeHtml(a.source)})</li>`).join('')}</ul>` : '<p>No hay alertas para los filtros seleccionados.</p>'}</body></html>`;
}

async function previewReport() {
  const rows = await getReportRows();
  const html = buildReportHTMLFromRows(rows);
  showModal(`<h2>Vista previa del informe</h2><iframe class="report-preview" srcdoc="${escapeAttr(html)}"></iframe>`);
}

async function downloadReportHTML() {
  const rows = await getReportRows();
  if (!rows.length) toast('Informe sin lecturas', 'Se generará con el mensaje de no datos reales para los filtros seleccionados.');
  const name = `informe-npk-${Date.now()}.html`;
  downloadText(name, buildReportHTMLFromRows(rows), 'text/html;charset=utf-8;');
  generatedReports.unshift({ name, date: new Date().toISOString(), rows: rows.length, format: 'HTML' });
  generatedReports = generatedReports.slice(0, 8);
  saveJSON('npk-generated-reports', generatedReports);
  renderReportsList();
}

async function downloadReportCSV() {
  const rows = await getReportRows();
  if (!rows.length) return toast('Sin datos', 'No hay lecturas reales para exportar con esos filtros.');
  const headers = ['sensorId', 'parcelaId', 'estado', 'n', 'p', 'k', 'humedadSuelo', 'temperaturaAire', 'lat', 'lng', 'timestamp'];
  const csv = [headers, ...rows.map(s => [s.id, s.parcelId, s.status, s.n, s.p, s.k, s.soilHumidity ?? s.humidity, s.airTemp ?? s.temp, s.lat, s.lng, s.timestamp])].map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const name = `informe-npk-${Date.now()}.csv`;
  downloadText(name, csv, 'text/csv;charset=utf-8;');
  generatedReports.unshift({ name, date: new Date().toISOString(), rows: rows.length, format: 'CSV' });
  generatedReports = generatedReports.slice(0, 8);
  saveJSON('npk-generated-reports', generatedReports);
  renderReportsList();
}

async function printReport() {
  const rows = await getReportRows();
  if (window.jspdf?.jsPDF) {
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const filters = getReportFilters();
    let y = 42;
    doc.setFontSize(18);
    doc.text('Informe técnico NPK Smart Cacao', 40, y);
    y += 24;
    doc.setFontSize(10);
    doc.text(`Generado: ${formatDateTime(new Date().toISOString())}`, 40, y);
    y += 18;
    doc.text(`Sensor: ${filters.sensorId || 'todos'} | Parcela: ${filters.parcelaId || 'todas'} | Subcelda: ${filters.subcellId || 'No especificada'}`, 40, y);
    y += 26;
    doc.setFontSize(11);
    doc.text('ID sensor', 40, y); doc.text('Parcela', 132, y); doc.text('N', 220, y); doc.text('P', 260, y); doc.text('K', 300, y); doc.text('Hum. suelo', 340, y); doc.text('Temp. aire', 430, y); doc.text('Última lectura', 520, y);
    y += 12;
    doc.line(40, y, 800, y);
    y += 18;
    if (!rows.length) {
      doc.text('No hay lecturas reales para los filtros seleccionados.', 40, y);
    } else {
      rows.slice(0, 28).forEach(s => {
        doc.text(String(s.id || '--').slice(0, 16), 40, y);
        doc.text(String(s.parcelId || '--').slice(0, 14), 132, y);
        doc.text(String(dash(s.n)), 220, y);
        doc.text(String(dash(s.p)), 260, y);
        doc.text(String(dash(s.k)), 300, y);
        doc.text(String(dash(s.soilHumidity ?? s.humidity)), 340, y);
        doc.text(String(dash(s.airTemp ?? s.temp)), 430, y);
        doc.text(String(s.timestamp ? formatDateTime(s.timestamp) : 'Sin lectura').slice(0, 32), 520, y);
        y += 18;
        if (y > 540) { doc.addPage(); y = 42; }
      });
    }
    const name = `informe-npk-${Date.now()}.pdf`;
    doc.save(name);
    generatedReports.unshift({ name, date: new Date().toISOString(), rows: rows.length, format: 'PDF' });
    generatedReports = generatedReports.slice(0, 8);
    saveJSON('npk-generated-reports', generatedReports);
    renderReportsList();
    toast('PDF generado', name);
    return;
  }
  const win = window.open('', '_blank');
  if (!win) return toast('Ventana bloqueada', 'Permite ventanas emergentes para imprimir o guardar en PDF.');
  win.document.write(buildReportHTMLFromRows(rows));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}

async function generateReportBySelectedFormat() {
  const format = $('#reportFormat')?.value || 'pdf';
  if (format === 'csv') return downloadReportCSV();
  if (format === 'html') return downloadReportHTML();
  return printReport();
}

function renderReportsList() {
  const list = $('#reportList');
  if (!list) return;
  list.innerHTML = generatedReports.length ? generatedReports.map(r => `<article class="report-row"><strong>${escapeHtml(r.name)}</strong><small>${formatDateTime(r.date)} · ${r.rows} lectura(s) · ${escapeHtml(r.format || 'HTML')}</small></article>`).join('') : emptyState('Aún no se han generado informes.');
}

function renderSensorsTable() {
  const tbody = $('#sensorsTable tbody');
  if (!tbody) return;
  const search = [$('#sensorSearch')?.value, $('#globalSearch')?.value].filter(Boolean).join(' ').toLowerCase().trim();
  const status = $('#statusFilter')?.value || 'todos';
  const lot = $('#lotFilter')?.value || 'todos';
  const date = $('#dateFilter')?.value || '';
  const filtered = getAllSensors().filter(s => {
    const haystack = `${s.id} ${s.name || ''} ${s.parcelId || ''} ${s.location || ''}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesStatus = status === 'todos' || normalizeUiStatus(s.status) === status || s.status === status;
    const matchesLot = lot === 'todos' || s.parcelId === lot;
    const matchesDate = !date || (s.timestamp && String(s.timestamp).startsWith(date));
    return matchesSearch && matchesStatus && matchesLot && matchesDate;
  });
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="12">${emptyState(getAllSensors().length ? 'No hay sensores con ese filtro.' : 'Sensores no conectados. Agrega un ID ESP32 o conecta el backend.')}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(sensor => `
    <tr>
      <td><strong>${escapeHtml(sensor.id)}</strong></td>
      <td>${escapeHtml(sensor.name || '--')}</td>
      <td><span class="status-badge status-${normalizeUiStatus(sensor.status)}">${statusLabels[sensor.status] || statusLabels[normalizeUiStatus(sensor.status)] || sensor.status}</span></td>
      <td>${escapeHtml(sensor.parcelId || '--')}</td>
      <td>${escapeHtml(sensor.location || '--')}</td>
      <td>${dash(sensor.n)}</td>
      <td>${dash(sensor.p)}</td>
      <td>${dash(sensor.k)}</td>
      <td>${dash(sensor.soilHumidity ?? sensor.humidity)}${(sensor.soilHumidity ?? sensor.humidity) != null ? '%' : ''}</td>
      <td>${dash(sensor.airTemp ?? sensor.temp)}${(sensor.airTemp ?? sensor.temp) != null ? '°C' : ''}</td>
      <td>${sensor.timestamp ? formatDateTime(sensor.timestamp) : 'Sin lectura'}</td>
      <td><button class="btn btn-small btn-outline" onclick="window.openSensorHistory('${escapeAttr(sensor.id)}')">Ver</button><button class="btn btn-small btn-secondary" onclick="window.exportOneSensor('${escapeAttr(sensor.id)}')">CSV</button></td>
    </tr>
  `).join('');
}

window.openSensorHistory = function(id) {
  const sensor = getAllSensors().find(s => s.id === id);
  if (!sensor) return;
  const real = sensor.realData ? 'Lectura real recibida del backend.' : 'Sensor registrado, pero no conectado al backend.';
  showModal(`
    <h2>Sensor ${escapeHtml(sensor.id)}</h2>
    <p class="muted">${real}</p>
    <div class="kpi-grid modal-kpis">
      <div class="kpi-card"><span>Nitrógeno</span><strong>${dash(sensor.n)} ppm</strong><small>N</small></div>
      <div class="kpi-card"><span>Fósforo</span><strong>${dash(sensor.p)} ppm</strong><small>P</small></div>
      <div class="kpi-card"><span>Potasio</span><strong>${dash(sensor.k)} ppm</strong><small>K</small></div>
      <div class="kpi-card"><span>Humedad suelo</span><strong>${dash(sensor.soilHumidity ?? sensor.humidity)}%</strong><small>Suelo</small></div>
      <div class="kpi-card"><span>Temperatura aire</span><strong>${dash(sensor.airTemp ?? sensor.temp)}°C</strong><small>Aire</small></div>
    </div>
    <div class="settings-list" style="margin-top:16px;"><label><span>Parcela ID</span><strong>${escapeHtml(sensor.parcelId || '--')}</strong></label><label><span>Estado</span><strong>${statusLabels[sensor.status] || sensor.status}</strong></label><label><span>Última lectura</span><strong>${sensor.timestamp ? formatDateTime(sensor.timestamp) : 'Sin lectura'}</strong></label></div>
  `);
};

function createDashboardCharts() {
  const rows = getScopedSensors({ realOnly: true });
  const line = $('#npkLineChart');
  if (line) {
    if (!rows.length) return setChartEmpty(line, 'Sin datos reales de sensores.');
    clearChartEmpty(line);
    chartInstances.push(new Chart(line, {
      type: 'line',
      data: {
        labels: rows.map(s => s.id),
        datasets: [
          { label: 'Nitrógeno', data: rows.map(s => s.n), tension: .35, fill: false },
          { label: 'Fósforo', data: rows.map(s => s.p), tension: .35, fill: false },
          { label: 'Potasio', data: rows.map(s => s.k), tension: .35, fill: false },
          { label: 'Humedad suelo %', data: rows.map(s => s.soilHumidity ?? s.humidity), tension: .35, fill: false },
          { label: 'Temp. aire °C', data: rows.map(s => s.airTemp ?? s.temp), tension: .35, fill: false }
        ]
      },
      options: baseOptions()
    }));
  }
  const donut = $('#cropDonutChart');
  if (donut) {
    const all = getAllSensors();
    if (!all.length) return setChartEmpty(donut, 'Sin sensores registrados.');
    clearChartEmpty(donut);
    chartInstances.push(new Chart(donut, {
      type: 'doughnut',
      data: { labels: ['Conectado', 'Crítico', 'No conectado', 'Mantenimiento'], datasets: [{ data: countStatuses(all), borderWidth: 0 }] },
      options: { responsive: true, cutout: '68%', plugins: { legend: { position: 'bottom' } } }
    }));
  }
}
