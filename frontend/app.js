const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const CHIGORODO = {
  name: 'Chigorodó, Antioquia',
  lat: 7.66638,
  lng: -76.68106,
  timezone: 'America/Bogota'
};

const API_CONFIG = {
  baseUrl: 'http://localhost:3000',

  // Primero se consultan las rutas reales del backend actual.
  // /api/sensor/all debe devolver todos los sensores de MongoDB.
  // /api/sensor/latest sirve como respaldo y solo devuelve el último dato global.
  endpoints: [
    '/api/sensor/all',
    '/api/sensor',
    '/api/sensor/latest',
    '/api/sensores',
    '/api/sensors',
    '/sensores',
    '/sensors',
    '/api/lecturas',
    '/lecturas',
    '/data'
  ],

  reportEndpoints: [
  '/api/sensor/history',
  ],

  streamEndpoint: '/api/sensor/stream',
  logsEndpoint: '/api/logs',
  latestLogsEndpoint: '/api/logs/latest',
  pollIntervalMs: 10000,
  timeoutMs: 7000
};

const statusLabels = {
  conectado: 'Conectado',
  critico: 'Crítico',
  no_conectado: 'Sin lectura',
  mantenimiento: 'Mantenimiento'
};

const alertRules = {
  nitrogen: { warningLow: 30, criticalLow: 20, unit: 'ppm', label: 'Nitrógeno' },
  phosphorus: { warningLow: 12, criticalLow: 8, unit: 'ppm', label: 'Fósforo' },
  potassium: { warningLow: 35, criticalLow: 25, unit: 'ppm', label: 'Potasio' },
  humidity: { warningLow: 30, criticalLow: 20, warningHigh: 85, criticalHigh: 90, unit: '%', label: 'Humedad del suelo' },
  airTemp: { warningLow: 18, criticalLow: 15, warningHigh: 34, criticalHigh: 38, unit: '°C', label: 'Temperatura del aire' },
  staleMinutes: 10
};

let state = {
  currentView: 'inicio',
  backendOnline: false,
  lastSync: null,
  weather: null,
  currentMapFilter: 'all'
};

let sensorReadings = [];
let localSensors = loadJSON('npk-local-sensor-placeholders', []);
let hiddenSensorIds = loadJSON('npk-hidden-sensors', []);
let sensorAliases = loadJSON('npk-sensor-aliases', {});
let generatedReports = loadJSON('npk-generated-reports', []);
let dismissedNotificationIds = loadJSON('npk-dismissed-notifications', []);
let previousActiveAlertIds = loadJSON('npk-active-alert-ids', []);
let previousAlertDetails = loadJSON('npk-alert-details', {});
let resolvedNotifications = loadJSON('npk-resolved-notifications', []);
let sensorMap;
let weatherMap;
let weatherRadarLayer;
let markerLayer;
let heatLayers = {};
let chartInstances = [];
let pollTimer;
let streamSource;
let logSocket = null;
let logsPollingTimer = null;
let espLogs = [];
let logsPaused = false;
let logsLoadedLimit = 250;

function init() {
  setTimeout(() => $('#loadingScreen')?.classList.add('done'), 500);
  initTheme();
  initLanding();
  initReveal();
  initNavigation();
  initInteractions();
  initMap();
  initWeatherMap();
  renderAll();
  loadWeather();
  loadSensorsFromBackend({ silent: true });
  startPolling();
  startRealtimeStream();
  initLogsRealtime();
  loadLogsFromBackend({ silent: true });
  toast('Frontend listo', 'La página consultará el backend y mostrará sensores y logs ESP32 en tiempo real.');
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
  const path = String(endpoint || '').startsWith('/') ? endpoint : `/${endpoint}`;
  return `${normalizeBaseUrl(API_CONFIG.baseUrl)}${path}`;
}

function buildUrlWithParams(endpoint, params = {}) {
  const url = new URL(buildUrl(endpoint), window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '' && value !== 'todos') url.searchParams.set(key, value);
  });
  return url.toString();
}

function fetchWithTimeout(url, options = {}, timeoutMs = API_CONFIG.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function showModal(content = '') {
  const modal = $('#mainModal');
  const body = $('#modalBody');
  if (!modal || !body) return alert(String(content).replace(/<[^>]*>/g, ' '));
  body.innerHTML = content;
  try {
    if (typeof modal.showModal === 'function') {
      if (!modal.open) modal.showModal();
    } else {
      modal.setAttribute('open', 'open');
      modal.classList.add('open');
    }
  } catch {
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
  if (!zone) return console.info(`${title}: ${message}`);
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
}

function initLanding() {
  $$('[data-open-app]').forEach(btn => btn.addEventListener('click', event => {
    event.preventDefault();
    openApp(btn.dataset.openApp || 'dashboard');
  }));
  $$('[data-open-landing]').forEach(btn => btn.addEventListener('click', event => {
    event.preventDefault();
    openLanding();
  }));
  $('#mobileLandingMenu')?.addEventListener('click', () => $('.landing-links')?.classList.toggle('mobile-open'));
}

function openApp(target = 'dashboard') {
  $('#landingPage')?.classList.add('hidden');
  $('#landingNav')?.classList.add('hidden');
  $('#appShell')?.classList.remove('hidden');
  setView(target);
}

function openLanding() {
  $('#appShell')?.classList.add('hidden');
  $('#landingPage')?.classList.remove('hidden');
  $('#landingNav')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initReveal() {
  if (!window.IntersectionObserver) return $$('.reveal').forEach(el => el.classList.add('visible'));
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });
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
  $('#globalSearch')?.addEventListener('input', debounce(handleGlobalSearch, 250));
  $('#globalSearch')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') handleGlobalSearch();
  });
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
  if (normalized === 'mapa') setTimeout(() => sensorMap?.invalidateSize?.(), 350);
  if (normalized === 'meteorologia') setTimeout(() => weatherMap?.invalidateSize?.(), 350);
  if (['dashboard', 'meteorologia', 'estadisticas'].includes(normalized)) setTimeout(drawAllCharts, 80);
}

function initInteractions() {
  ['sensorSearch', 'statusFilter', 'dateFilter'].forEach(id => $(`#${id}`)?.addEventListener('input', renderSensorsTable));
  $('#clearFilters')?.addEventListener('click', () => {
    ['sensorSearch', 'dateFilter'].forEach(id => { const el = $(`#${id}`); if (el) el.value = ''; });
    const status = $('#statusFilter');
    if (status) status.value = 'todos';
    renderSensorsTable();
  });
  $('#refreshDataBtn')?.addEventListener('click', () => loadSensorsFromBackend());
  $('#refreshLogsBtn')?.addEventListener('click', () => loadLogsFromBackend());
  $('#logsLevelFilter')?.addEventListener('change', renderLogs);
  $('#logsSensorFilter')?.addEventListener('change', renderLogs);
  $('#logsSearch')?.addEventListener('input', debounce(renderLogs, 180));
  $('#logsLimit')?.addEventListener('change', () => {
    const limit = Number($('#logsLimit')?.value || 250);
    logsLoadedLimit = Number.isFinite(limit) ? limit : 250;
    loadLogsFromBackend({ silent: true });
  });
  $('#pauseLogsBtn')?.addEventListener('click', toggleLogsPause);
  $('#clearLogsViewBtn')?.addEventListener('click', () => {
    espLogs = [];
    renderLogs();
    toast('Pantalla limpiada', 'Los logs permanecen guardados en MongoDB.');
  });
  $('#loadMoreLogsBtn')?.addEventListener('click', () => {
    logsLoadedLimit = Math.min(Math.max(logsLoadedLimit + 250, 250), 5000);
    loadLogsFromBackend({ silent: true });
  });
  $('#homeRefreshBtn')?.addEventListener('click', () => loadSensorsFromBackend());
  $('#refreshWeatherBtn')?.addEventListener('click', () => loadWeather());
  $('#refreshAnalyticsBtn')?.addEventListener('click', () => { loadSensorsFromBackend(); drawAllCharts(); });
  $('#exportSensorsBtn')?.addEventListener('click', exportSensorsCSV);
  $('#addSensorBtn')?.addEventListener('click', openAddSensorModal);
  $('#updateSensorBtn')?.addEventListener('click', openUpdateSensorModal);
  $('#deleteSensorBtn')?.addEventListener('click', openDeleteSensorModal);
  $('#previewReportBtn')?.addEventListener('click', previewReport);
  $('#generateReportBtn')?.addEventListener('click', generateReportBySelectedFormat);
  $('#reportSearch')?.addEventListener('input', renderReportsList);
  $('#htmlReportBtn')?.addEventListener('click', () => downloadReportHTML());
  $('#csvReportBtn')?.addEventListener('click', downloadReportCSV);
  $('#printReportBtn')?.addEventListener('click', printReport);
  $('#notificationBtn')?.addEventListener('click', showNotifications);
  $('#modalClose')?.addEventListener('click', closeModal);
  $('#mainModal')?.addEventListener('click', event => { if (event.target?.id === 'mainModal') closeModal(); });
  $('#configureAlertsBtn')?.addEventListener('click', showAlertRules);
  ['dashboardScope', 'dashboardSensorSelect'].forEach(id => $(`#${id}`)?.addEventListener('change', () => { renderDashboard(); drawAllCharts(); }));
  $$('[data-map-filter]').forEach(btn => btn.addEventListener('click', () => {
    state.currentMapFilter = btn.dataset.mapFilter;
    renderMapMarkers(state.currentMapFilter);
  }));
  $$('[data-heat]').forEach(input => input.addEventListener('change', updateHeatLayerVisibility));
  $('#mapFullscreen')?.addEventListener('click', () => $('#sensorMap')?.requestFullscreen?.());
}


function initLogsRealtime() {
  if (!window.io) {
    setLogsRealtimeState(false, 'Socket.IO no está disponible en el navegador.');
    return;
  }

  try {
    logSocket?.disconnect();
    logSocket = io(API_CONFIG.baseUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      timeout: 7000
    });

    logSocket.on('connect', () => {
      setLogsRealtimeState(true, `Socket.IO conectado · ${logSocket.id}`);
      setText('#logsRealtimeState', 'ON');
    });

    logSocket.on('server-ready', () => {
      setLogsRealtimeState(true, 'Socket.IO listo para eventos del backend.');
    });

    logSocket.on('esp-log', log => {
      if (!log || logsPaused) return;
      const incoming = normalizeEspLog(log);
      if (!incoming) return;
      if (incoming.id && espLogs.some(item => item.id === incoming.id)) return;

      espLogs.unshift(incoming);
      if (espLogs.length > 5000) espLogs.length = 5000;
      updateLogsSensorFilter();
      renderLogs();
    });

    logSocket.on('disconnect', reason => {
      setLogsRealtimeState(false, `Socket.IO desconectado: ${reason}`);
    });

    logSocket.on('connect_error', error => {
      setLogsRealtimeState(false, `Socket.IO: ${error?.message || 'error de conexión'}`);
    });
  } catch (error) {
    console.error('No fue posible iniciar Socket.IO:', error);
    setLogsRealtimeState(false, error.message);
  }
}

function setLogsRealtimeState(connected, message = '') {
  const stateText = $('#logsConnectionText');
  const chip = $('#logsLiveChip');
  if (stateText) stateText.textContent = message || (connected ? 'Tiempo real activo' : 'Tiempo real desconectado');
  if (chip) {
    chip.textContent = connected ? '● Escuchando' : '○ Desconectado';
    chip.classList.toggle('success', connected);
    chip.classList.toggle('danger-chip', !connected);
  }
  setText('#logsRealtimeState', connected ? 'ON' : 'OFF');
}

function toggleLogsPause() {
  logsPaused = !logsPaused;
  const button = $('#pauseLogsBtn');
  if (button) button.textContent = logsPaused ? '▶ Reanudar' : '⏸ Pausar';
  const chip = $('#logsLiveChip');
  if (chip && logsPaused) {
    chip.textContent = 'Ⅱ Pausado';
    chip.classList.remove('success');
  } else if (chip) {
    chip.textContent = '● Escuchando';
    chip.classList.add('success');
  }
  setLogsRealtimeState(Boolean(logSocket?.connected), logsPaused ? 'Recepción en pausa en pantalla.' : 'Recepción en tiempo real activa.');
}

function normalizeEspLog(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const level = String(raw.level ?? 'INFO').toUpperCase();
  const receivedAt = raw.received_at ?? raw.receivedAt ?? raw.timestamp ?? new Date().toISOString();
  return {
    id: raw.id ? String(raw.id) : `${raw.sensor_id || 'unknown'}-${receivedAt}-${raw.topic || ''}-${Math.random().toString(36).slice(2)}`,
    sensor_id: raw.sensor_id ?? raw.sensorId ?? '—',
    level,
    message: raw.message ?? raw.msg ?? raw.log ?? '',
    topic: raw.topic ?? '—',
    raw_payload: raw.raw_payload ?? (raw.payload !== undefined ? safeJsonStringify(raw.payload) : ''),
    payload: raw.payload ?? null,
    device_timestamp: raw.device_timestamp ?? raw.deviceTimestamp ?? null,
    received_at: receivedAt
  };
}

async function loadLogsFromBackend({ silent = false } = {}) {
  const limit = Math.min(Math.max(Number(logsLoadedLimit || $('#logsLimit')?.value || 250), 1), 5000);
  const params = {
    limit,
    sensor_id: $('#logsSensorFilter')?.value || 'todos',
    level: $('#logsLevelFilter')?.value || 'todos'
  };

  try {
    const response = await fetchWithTimeout(buildUrlWithParams(API_CONFIG.logsEndpoint, params), {
      headers: { Accept: 'application/json' }
    }, API_CONFIG.timeoutMs);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : (Array.isArray(payload.logs) ? payload.logs : []);
    espLogs = rows.map(normalizeEspLog).filter(Boolean);
    logsLoadedLimit = limit;
    updateLogsSensorFilter();
    renderLogs();
    setLogsRealtimeState(Boolean(logSocket?.connected), `Historial cargado · ${espLogs.length} log(s).`);
    if (!silent) toast('Logs actualizados', `${espLogs.length} registro(s) cargados desde MongoDB.`);
  } catch (error) {
    console.error('Error cargando logs ESP32:', error);
    setLogsRealtimeState(Boolean(logSocket?.connected), `No se pudo cargar el historial: ${error.message}`);
    renderLogs();
    if (!silent) toast('Error de logs', 'No se pudo consultar /api/logs. Revisa que el backend actualizado esté desplegado.');
  }
}

function updateLogsSensorFilter() {
  const select = $('#logsSensorFilter');
  if (!select) return;
  const current = select.value || 'todos';
  const sensorIds = [...new Set(espLogs.map(log => String(log.sensor_id || '').trim()).filter(id => id && id !== '—'))]
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  select.innerHTML = '<option value="todos">Todos los sensores</option>'
    + sensorIds.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('');
  if (sensorIds.includes(current)) select.value = current;
}

function getFilteredLogs() {
  const sensor = String($('#logsSensorFilter')?.value || 'todos');
  const level = String($('#logsLevelFilter')?.value || 'todos').toUpperCase();
  const search = String($('#logsSearch')?.value || '').trim().toLowerCase();

  return espLogs.filter(log => {
    if (sensor !== 'todos' && String(log.sensor_id) !== sensor) return false;
    if (level !== 'TODOS' && String(log.level).toUpperCase() !== level) return false;
    if (search) {
      const haystack = [
        log.message,
        log.topic,
        log.raw_payload,
        log.sensor_id,
        log.level
      ].map(value => String(value ?? '')).join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function renderLogs() {
  const filtered = getFilteredLogs();
  const body = $('#logsTableBody');
  if (!body) return;

  const errorCount = espLogs.filter(log => ['ERROR', 'FATAL'].includes(String(log.level).toUpperCase())).length;
  const sensorCount = new Set(espLogs.map(log => String(log.sensor_id || '').trim()).filter(Boolean)).size;
  setText('#logsTotalCount', String(filtered.length));
  setText('#logsErrorCount', String(errorCount));
  setText('#logsSensorCount', String(sensorCount));

  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="6" class="table-empty">${espLogs.length ? 'No hay logs que coincidan con los filtros.' : 'No hay logs cargados todavía.'}</td></tr>`;
    return;
  }

  body.innerHTML = filtered.map(log => {
    const safeLevel = ['TRACE','DEBUG','INFO','WARN','WARNING','ERROR','FATAL'].includes(log.level) ? log.level : 'INFO';
    const levelClass = safeLevel.toLowerCase().replace('warning', 'warn');
    const raw = String(log.raw_payload ?? '');
    const preview = raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
    const rawBlock = raw.length > 140 ? `<details class="log-payload-details"><summary>Ver completo</summary><pre>${escapeHtml(raw)}</pre></details>` : escapeHtml(raw || '—');
    return `<tr class="log-row log-${levelClass}">
      <td><time datetime="${escapeHtml(log.received_at)}">${escapeHtml(formatDateTime(log.received_at))}</time></td>
      <td><span class="log-sensor">${escapeHtml(String(log.sensor_id ?? '—'))}</span></td>
      <td><span class="log-level ${escapeHtml(levelClass)}">${escapeHtml(safeLevel)}</span></td>
      <td class="log-message">${escapeHtml(String(log.message || preview || '—'))}</td>
      <td><code class="log-topic">${escapeHtml(String(log.topic || '—'))}</code></td>
      <td class="log-payload">${raw.length > 140 ? `${escapeHtml(preview)}<br>${rawBlock}` : rawBlock}</td>
    </tr>`;
  }).join('');
}

function safeJsonStringify(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

function renderAll() {
  syncAlertLifecycle(generateAlerts(getAllSensors()));
  renderConnectionState();
  renderLandingStats();
  renderSelections();
  renderDashboard();
  renderSensorsTable();
  renderAlerts();
  renderReportsList();
  updateLogsSensorFilter();
  renderLogs();
  renderMapMarkers(state.currentMapFilter);
  renderHeatmapGrid();
  drawAllCharts();
}

function renderAllTablesAndSelections() {
  renderSelections();
  renderSensorsTable();
  renderReportsList();
}

function extractSensorRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.sensores)) return payload.sensores;
  if (Array.isArray(payload?.sensors)) return payload.sensors;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.lecturas)) return payload.lecturas;
  if (payload && typeof payload === 'object' && (payload.sensorId || payload.id || payload.sensor_id || payload.esp32Id || payload.deviceId)) return [payload];
  return [];
}

function sensorIdFromTopic(topic) {
  if (!topic) return '';
  const parts = String(topic).split('/').map(part => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : '';
}

function rawSensorId(raw) {
  if (!raw || typeof raw !== 'object') return '';
  return String(raw.sensorId ?? raw.sensor_id ?? raw.id ?? raw.codigo ?? raw.esp32Id ?? raw.deviceId ?? raw.device_id ?? raw?.device?.id ?? sensorIdFromTopic(raw.topic ?? raw.mqttTopic) ?? '').trim();
}

function latestRawRowsPerSensor(rows = []) {
  const map = new Map();

  rows.filter(item => item && typeof item === 'object').forEach(raw => {
    const normalized = normalizeSensorReading(raw);
    if (!normalized) return;

    const key = normalized.originalId || normalized.id;
    const current = map.get(key);

    if (!current) {
      map.set(key, raw);
      return;
    }

    const currentTime = new Date(normalizeSensorReading(current)?.timestamp || 0).getTime() || 0;
    const nextTime = new Date(normalized.timestamp || 0).getTime() || 0;

    if (nextTime >= currentTime) map.set(key, raw);
  });

  return [...map.values()];
}

function normalizeSensorReading(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const originalId = rawSensorId(raw);
  if (!originalId) return null;
  const id = String(sensorAliases[originalId] || originalId).trim();
  if (!id || hiddenSensorIds.includes(id) || hiddenSensorIds.includes(originalId)) return null;
  const timestamp = raw.timestamp ?? raw.created_at ?? raw.createdAt ?? raw.fechaHora ?? raw.fecha_hora ?? mergeDateTime(raw.date ?? raw.fecha, raw.time ?? raw.hora) ?? null;
  const sensor = {
    id,
    originalId,
    name: raw.name ?? raw.nombre ?? raw.label ?? `ESP32 ${id}`,
    location: raw.location ?? raw.ubicacion ?? raw.sector ?? raw.descripcion ?? 'Ubicación recibida del backend',
    lat: toNumberOrNull(raw.lat ?? raw.latitude ?? raw.latitud),
    lng: toNumberOrNull(raw.lng ?? raw.lon ?? raw.long ?? raw.longitude ?? raw.longitud),
    n: toNumberOrNull(raw.n ?? raw.N ?? raw.nitrogeno ?? raw.nitrogen ?? raw.nitrogen_ppm ?? raw.n_ppm),
    p: toNumberOrNull(raw.p ?? raw.P ?? raw.fosforo ?? raw.phosphorus ?? raw.phosphorus_ppm ?? raw.p_ppm),
    k: toNumberOrNull(raw.k ?? raw.K ?? raw.potasio ?? raw.potassium ?? raw.potassium_ppm ?? raw.k_ppm),
    soilHumidity: toNumberOrNull(raw.soilHumidity ?? raw.humedadSuelo ?? raw.humedad_suelo ?? raw.humiditySoil ?? raw.humedad ?? raw.humidity),
    humidity: toNumberOrNull(raw.soilHumidity ?? raw.humedadSuelo ?? raw.humedad_suelo ?? raw.humiditySoil ?? raw.humedad ?? raw.humidity),
    airTemp: toNumberOrNull(raw.airTemp ?? raw.temperaturaAmbiente ?? raw.temperatura_ambiente ?? raw.temperaturaAire ?? raw.temperatura_aire ?? raw.air_temperature ?? raw.temperatureAir ?? raw.tempAire ?? raw.temperatura ?? raw.temp ?? raw.temperature),
    temp: toNumberOrNull(raw.airTemp ?? raw.temperaturaAmbiente ?? raw.temperatura_ambiente ?? raw.temperaturaAire ?? raw.temperatura_aire ?? raw.air_temperature ?? raw.temperatureAir ?? raw.tempAire ?? raw.temperatura ?? raw.temp ?? raw.temperature),
    timestamp,
    raw,
    fromBackend: true
  };
  sensor.realData = hasAnyReading(sensor);
  sensor.status = normalizeStatus(raw.status ?? raw.estado, sensor);
  return sensor;
}

function normalizeLocalSensor(raw) {
  if (!raw || !raw.id || hiddenSensorIds.includes(raw.id)) return null;
  return {
    id: String(raw.id),
    originalId: String(raw.id),
    name: raw.name || `ESP32 ${raw.id}`,
    location: raw.location || 'ID local pendiente de lectura',
    lat: toNumberOrNull(raw.lat),
    lng: toNumberOrNull(raw.lng),
    n: null,
    p: null,
    k: null,
    soilHumidity: null,
    humidity: null,
    airTemp: null,
    temp: null,
    timestamp: null,
    realData: false,
    fromBackend: false,
    status: 'no_conectado'
  };
}

function getAllSensors() {
  const map = new Map();
  localSensors.map(normalizeLocalSensor).filter(Boolean).forEach(sensor => map.set(sensor.id, sensor));
  sensorReadings.map(normalizeSensorReading).filter(Boolean).forEach(sensor => {
    const existing = map.get(sensor.id) || {};
    map.set(sensor.id, { ...existing, ...sensor, status: normalizeStatus(sensor.status, sensor), realData: hasAnyReading(sensor) });
  });
  return [...map.values()].sort((a, b) => String(a.id).localeCompare(String(b.id), 'es', { numeric: true }));
}

function getConnectedSensors() {
  return getAllSensors().filter(sensor => sensor.realData && normalizeUiStatus(sensor.status) !== 'no_conectado' && hasAnyReading(sensor));
}

function getScopedSensors({ realOnly = true } = {}) {
  const base = realOnly ? getConnectedSensors() : getAllSensors();
  const scope = $('#dashboardScope')?.value || 'general';
  const sensorId = $('#dashboardSensorSelect')?.value || '';
  if (scope === 'sensor' && sensorId) return base.filter(sensor => sensor.id === sensorId);
  return base;
}

function hasAnyReading(sensor) {
  return [sensor?.n, sensor?.p, sensor?.k, sensor?.soilHumidity, sensor?.humidity, sensor?.airTemp, sensor?.temp].some(value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)));
}

function normalizeStatus(status, sensor) {
  const raw = String(status || '').toLowerCase().trim();
  if (!hasAnyReading(sensor)) return 'no_conectado';
  if (['critical', 'critico', 'crítico', 'alerta'].includes(raw)) return 'critico';
  if (['maintenance', 'mantenimiento'].includes(raw)) return 'mantenimiento';
  if (['inactive', 'inactivo', 'offline', 'desconectado', 'no_conectado'].includes(raw)) return 'no_conectado';
  if (isStale(sensor.timestamp)) return 'no_conectado';
  if (hasCriticalValues(sensor)) return 'critico';
  return 'conectado';
}

function normalizeUiStatus(status) {
  if (status === 'activo') return 'conectado';
  if (status === 'desconectado' || status === 'inactivo') return 'no_conectado';
  return status || 'no_conectado';
}

function avgSensors(rows, key) {
  const values = rows.map(row => Number(row[key])).filter(value => Number.isFinite(value));
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function isStale(timestamp) {
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time > alertRules.staleMinutes * 60 * 1000;
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
    || classifyRange(sensor.soilHumidity ?? sensor.humidity, alertRules.humidity) === 'critical'
    || classifyRange(sensor.airTemp ?? sensor.temp, alertRules.airTemp) === 'critical';
}

function sensorIdEndpointCandidates(sensorId) {
  const encoded = encodeURIComponent(sensorId);
  return [
    `/api/sensor/${encoded}/latest`,
    `/api/sensor/latest/${encoded}`,
    `/api/sensor/by-id/${encoded}`,
    `/api/sensor?sensor_id=${encoded}`,
    `/api/sensor/latest?sensor_id=${encoded}`,
    `/api/sensor/all?sensor_id=${encoded}`,
    `/api/sensores/${encoded}`,
    `/api/sensores?sensor_id=${encoded}`
  ];
}

async function fetchBackendSensorById(sensorId) {
  const candidates = sensorIdEndpointCandidates(sensorId);
  const result = await fetchJsonCandidate(candidates, { timeoutMs: 5000 });

  if (!result.ok) return null;

  const rows = latestRawRowsPerSensor(extractSensorRows(result.data));
  const normalized = rows.map(normalizeSensorReading).filter(Boolean);
  return normalized.find(sensor => sensor.id === sensorId || sensor.originalId === sensorId) || null;
}

async function syncLocalSensorById(sensorId, { silent = false } = {}) {
  await loadSensorsFromBackend({ silent: true });

  let sensor = getAllSensors().find(item => item.id === sensorId || item.originalId === sensorId);

  if (!sensor?.realData) {
    sensor = await fetchBackendSensorById(sensorId);
    if (sensor?.raw) {
      sensorReadings = mergeRawReadings(sensorReadings, [sensor.raw]);
      state.backendOnline = true;
      state.lastSync = new Date().toISOString();
      renderAll();
    }
  }

  if (!silent) {
    if (sensor?.realData) {
      toast('Sensor sincronizado', `El ID ${sensorId} coincide con datos reales del backend.`);
    } else {
      toast('ID agregado como pendiente', `El ID ${sensorId} quedó visible. Cuando el backend entregue ese sensor_id, se relacionará automáticamente.`);
    }
  }

  return sensor;
}

async function loadSensorsFromBackend({ silent = false } = {}) {
  const attempts = [];

  for (const endpointPath of API_CONFIG.endpoints) {
    const endpoint = buildUrl(endpointPath);

    try {
      const response = await fetchWithTimeout(endpoint, { headers: { Accept: 'application/json' } });
      attempts.push(`${endpoint} → HTTP ${response.status}`);

      if (!response.ok) continue;

      const payload = await response.json();
      const rows = extractSensorRows(payload);

      if (!rows.length) {
        attempts.push(`${endpoint} → sin filas de sensores`);
        continue;
      }

      const latestRows = latestRawRowsPerSensor(rows);

      if (endpointPath.includes('/latest') && latestRows.length === 1) {
        sensorReadings = mergeRawReadings(sensorReadings, latestRows);
      } else {
        sensorReadings = latestRows;
      }

      state.backendOnline = true;
      state.lastSync = new Date().toISOString();
      renderAll();

      if (!silent) {
        toast('Backend conectado', `${getAllSensors().length} sensor(es) listados desde ${endpointPath}.`);
      }

      return;
    } catch (error) {
      attempts.push(`${endpoint} → ${error.message}`);
    }
  }

  state.backendOnline = false;
  sensorReadings = [];
  renderAll();

  if (!silent) {
    toast('Backend sin listado de sensores', 'No encontré una ruta que devuelva sensores. Agrega GET /api/sensor/all en el backend o usa Agregar ID para dejarlo pendiente.');
  }

  console.info('Intentos de lectura del backend:', attempts);
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => loadSensorsFromBackend({ silent: true }), API_CONFIG.pollIntervalMs);
}

function startRealtimeStream() {
  if (streamSource) {
    streamSource.close();
    streamSource = null;
  }
  if (!window.EventSource) return;
  try {
    streamSource = new EventSource(buildUrl(API_CONFIG.streamEndpoint));
    streamSource.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        const rows = extractSensorRows(payload).filter(item => item && typeof item === 'object');
        if (!rows.length) return;
        sensorReadings = mergeRawReadings(sensorReadings, rows);
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

function mergeRawReadings(currentRows, newRows) {
  const map = new Map();
  currentRows.forEach(raw => {
    const normalized = normalizeSensorReading(raw);
    if (normalized?.originalId) map.set(normalized.originalId, raw);
  });
  newRows.forEach(raw => {
    const normalized = normalizeSensorReading(raw);
    if (normalized?.originalId) map.set(normalized.originalId, raw);
  });
  return [...map.values()];
}

function renderConnectionState() {
  const all = getAllSensors();
  const connected = getConnectedSensors();
  const disconnected = all.length - connected.length;
  const alerts = getActiveAlerts();
  const notificationItems = getNotificationItems();
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
      ? `<strong>Datos en tiempo real activos</strong><p>Última sincronización: ${state.lastSync ? formatDateTime(state.lastSync) : 'reciente'}. Sensores listados: ${all.length}. Sin lectura: ${disconnected}.</p>`
      : `<strong>Sensores no conectados</strong><p>${all.length ? 'Hay sensores listados, pero ninguno tiene lectura completa en este momento.' : 'El backend no ha enviado sensores o no está disponible.'}</p>`;
  }
  const sensorsBanner = $('#sensorsStatusBanner');
  if (sensorsBanner) {
    sensorsBanner.className = `connection-banner panel ${connected.length ? 'connected' : ''}`;
    sensorsBanner.innerHTML = connected.length
      ? `<strong>${connected.length} sensor(es) con datos reales</strong><p>Total en tabla: ${all.length}. Última actualización: ${state.lastSync ? formatDateTime(state.lastSync) : '--'}.</p>`
      : `<strong>Sensores no conectados</strong><p>Si un sensor llega con valores null, se mostrará como sin lectura y la página seguirá funcionando.</p>`;
  }
  setText('#healthScore', connected.length ? `${Math.round((connected.length / Math.max(all.length, connected.length)) * 100)}%` : '--');
  setText('#healthLabel', connected.length ? 'Sensores conectados' : 'Sensores no conectados');
  setText('#notificationCount', String(notificationItems.length));
  setText('#heroConnectionState', connected.length ? 'Datos en tiempo real' : 'Sensores no conectados');
  setText('#heroAnalyticsState', connected.length ? 'Activas con datos reales' : 'Sin datos reales');
  setText('#heroAlertBubble', alerts.length ? `${alerts.length} alerta(s)` : 'Sin alertas reales');
  setText('#heroSensorBubble', all.length ? `${all.length} sensor(es) listados` : 'Esperando backend');
  const nAvg = avgSensors(connected, 'n');
  const pAvg = avgSensors(connected, 'p');
  const kAvg = avgSensors(connected, 'k');
  setText('#heroNpkAverage', connected.length ? `${dash(nAvg)} · ${dash(pAvg)} · ${dash(kAvg)}` : '-- · -- · --');
  setText('#heroNpkMeta', connected.length ? 'Promedio de sensores reales' : 'Esperando sensores');
}

function renderLandingStats() {
  const all = getAllSensors();
  const connected = getConnectedSensors();
  setText('#landingConnectedSensors', connected.length);
  setText('#landingListedSensors', all.length);
  setText('#landingDisconnectedSensors', Math.max(0, all.length - connected.length));
  setText('#landingAlertCount', getActiveAlerts().length);
}

function renderDashboard() {
  const rows = getScopedSensors({ realOnly: true });
  const all = getAllSensors();
  const alerts = getActiveAlerts(rows.length ? rows : all);
  const grid = $('#kpiGrid');
  if (grid) {
    const nAvg = avgSensors(rows, 'n');
    const pAvg = avgSensors(rows, 'p');
    const kAvg = avgSensors(rows, 'k');
    const hAvg = avgSensors(rows.map(row => ({ value: row.soilHumidity ?? row.humidity })), 'value');
    const tAvg = avgSensors(rows.map(row => ({ value: row.airTemp ?? row.temp })), 'value');
    const kpis = [
      ['Nitrógeno', rows.length ? `${dash(nAvg)} ppm` : '--', 'Lectura N promedio real', '🌱'],
      ['Fósforo', rows.length ? `${dash(pAvg)} ppm` : '--', 'Lectura P promedio real', '🧪'],
      ['Potasio', rows.length ? `${dash(kAvg)} ppm` : '--', 'Lectura K promedio real', '⚡'],
      ['Humedad del suelo', rows.length ? `${dash(hAvg)}%` : '--', 'Promedio desde sensores', '💧'],
      ['Temperatura del aire', rows.length ? `${dash(tAvg)}°C` : '--', 'Promedio desde sensores', '🌡️'],
      ['Sensores conectados', rows.length, `Total listados: ${all.length}`, '📡'],
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
  if (compact) compact.innerHTML = alerts.length ? alerts.slice(0, 5).map(alert => alertTemplate(alert, { dismissible: false })).join('') : emptyState('No hay alertas reales para mostrar.');
}

function renderSelections() {
  const sensors = getAllSensors();
  fillSelect('#dashboardSensorSelect', sensors.map(s => [s.id, `${s.id}${s.name ? ' · ' + s.name : ''}`]), 'Seleccionar sensor');
  fillSelect('#reportSensorId', [['todos', 'Todos'], ...sensors.map(s => [s.id, `${s.id}${s.name ? ' · ' + s.name : ''}`])]);
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
  const date = $('#dateFilter')?.value || '';
  const all = getAllSensors();
  const filtered = all.filter(s => {
    const haystack = `${s.id} ${s.originalId || ''} ${s.name || ''} ${s.location || ''} ${statusLabels[s.status] || ''}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesStatus = status === 'todos' || normalizeUiStatus(s.status) === status || s.status === status;
    const matchesDate = !date || (s.timestamp && String(s.timestamp).startsWith(date));
    return matchesSearch && matchesStatus && matchesDate;
  });
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="11">${emptyState(all.length ? 'No hay sensores con ese filtro.' : 'Sensores no conectados. El backend todavía no envía sensores.')}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(sensor => `
    <tr data-sensor-row="${escapeAttr(sensor.id)}">
      <td><strong>${escapeHtml(sensor.id)}</strong>${sensor.originalId && sensor.originalId !== sensor.id ? `<br><small>Antes: ${escapeHtml(sensor.originalId)}</small>` : ''}</td>
      <td>${escapeHtml(sensor.name || '--')}</td>
      <td><span class="status-badge status-${normalizeUiStatus(sensor.status)}">${statusLabels[normalizeUiStatus(sensor.status)] || sensor.status}</span></td>
      <td>${escapeHtml(sensor.location || '--')}</td>
      <td>${dash(sensor.n)}</td>
      <td>${dash(sensor.p)}</td>
      <td>${dash(sensor.k)}</td>
      <td>${dash(sensor.soilHumidity ?? sensor.humidity)}${(sensor.soilHumidity ?? sensor.humidity) != null ? '%' : ''}</td>
      <td>${dash(sensor.airTemp ?? sensor.temp)}${(sensor.airTemp ?? sensor.temp) != null ? '°C' : ''}</td>
      <td>${sensor.timestamp ? formatDateTime(sensor.timestamp) : 'Sin lectura'}</td>
      <td class="action-stack"><button class="btn btn-small btn-outline" onclick="window.openSensorHistory('${escapeAttr(sensor.id)}')">Ver</button><button class="btn btn-small btn-secondary" onclick="window.syncSensorById('${escapeAttr(sensor.id)}')">Sincronizar</button><button class="btn btn-small btn-outline" onclick="window.exportOneSensor('${escapeAttr(sensor.id)}')">CSV</button><button class="btn btn-small btn-outline" onclick="window.openUpdateSensorModal('${escapeAttr(sensor.id)}')">Actualizar ID</button><button class="btn btn-small btn-primary" onclick="window.confirmHideSensor('${escapeAttr(sensor.id)}')">Eliminar</button></td>
    </tr>
  `).join('');
}

function generateAlerts(sourceRows = getAllSensors()) {
  const alerts = [];
  sourceRows.forEach(sensor => {
    const label = sensor.id || 'Sensor sin ID';
    if (!sensor.realData) {
      alerts.push({ type: 'Sensor sin lectura', severity: 'info', source: label, detail: `El sensor ${label} está listado, pero no tiene lecturas NPK, humedad o temperatura en este momento.` });
      return;
    }
    if (normalizeUiStatus(sensor.status) === 'no_conectado' || isStale(sensor.timestamp)) {
      alerts.push({ type: 'Conectividad', severity: 'critical', source: label, detail: `El sensor ${label} no reporta lectura reciente. Revisa alimentación, WiFi o backend.` });
    }
    const nutrientChecks = [
      ['Nitrógeno bajo', sensor.n, alertRules.nitrogen, 'nitrógeno'],
      ['Fósforo bajo', sensor.p, alertRules.phosphorus, 'fósforo'],
      ['Potasio bajo', sensor.k, alertRules.potassium, 'potasio']
    ];
    nutrientChecks.forEach(([type, value, rule, name]) => {
      const severity = classifyLow(value, rule);
      if (!severity) return;
      alerts.push({ type, severity, source: label, detail: `${rule.label} = ${value} ${rule.unit}. ${severity === 'critical' ? 'Nivel crítico' : 'Advertencia'}: posible deficiencia de ${name}.` });
    });
    const humidityValue = sensor.soilHumidity ?? sensor.humidity;
    const humiditySeverity = classifyRange(humidityValue, alertRules.humidity);
    if (humiditySeverity) alerts.push({ type: humidityValue < alertRules.humidity.warningLow ? 'Humedad baja' : 'Humedad alta', severity: humiditySeverity, source: label, detail: `Humedad del suelo = ${humidityValue}%. Rango recomendado ${alertRules.humidity.warningLow}% - ${alertRules.humidity.warningHigh}%.` });
    const tempValue = sensor.airTemp ?? sensor.temp;
    const tempSeverity = classifyRange(tempValue, alertRules.airTemp);
    if (tempSeverity) alerts.push({ type: tempValue < alertRules.airTemp.warningLow ? 'Temperatura baja' : 'Temperatura alta', severity: tempSeverity, source: label, detail: `Temperatura del aire = ${tempValue}°C. Rango recomendado ${alertRules.airTemp.warningLow}°C - ${alertRules.airTemp.warningHigh}°C.` });
  });
  return alerts.map(alert => ({ ...alert, id: alertKey(alert), status: 'active', date: new Date().toISOString() }));
}

function alertKey(alert) {
  return normalizeText(`${alert.source || 'sensor'}|${alert.type || 'alerta'}|${alert.detail || ''}`).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180) || `alerta-${Date.now()}`;
}

function getActiveAlerts(sourceRows = getAllSensors(), { includeDismissed = false } = {}) {
  const active = generateAlerts(sourceRows);
  return includeDismissed ? active : active.filter(alert => !dismissedNotificationIds.includes(alert.id));
}

function getNotificationItems() {
  return [...getActiveAlerts(), ...resolvedNotifications];
}

function syncAlertLifecycle(activeAlerts = generateAlerts(getAllSensors())) {
  const activeIds = [...new Set(activeAlerts.map(alert => alert.id))];
  const now = new Date().toISOString();
  const resolvedIds = previousActiveAlertIds.filter(id => !activeIds.includes(id));

  resolvedIds.forEach(id => {
    const last = previousAlertDetails[id] || { type: 'Alerta', source: 'Sensor', detail: 'La condición reportada ya no está activa.' };
    const alreadyLogged = resolvedNotifications.some(item => item.originalId === id && Date.now() - new Date(item.date || 0).getTime() < 60 * 1000);
    if (!alreadyLogged) {
      resolvedNotifications.unshift({
        id: `resolved-${id}-${Date.now()}`,
        originalId: id,
        type: `${last.type} resuelta`,
        severity: 'resolved',
        status: 'resolved',
        source: last.source,
        detail: `La condición fue corregida o dejó de aparecer en los datos actuales. Antes: ${last.detail}`,
        date: now
      });
    }
  });

  resolvedNotifications = resolvedNotifications.slice(0, 20);
  dismissedNotificationIds = dismissedNotificationIds.filter(id => activeIds.includes(id));
  activeAlerts.forEach(alert => {
    previousAlertDetails[alert.id] = { type: alert.type, source: alert.source, detail: alert.detail, severity: alert.severity };
  });
  previousActiveAlertIds = activeIds;
  saveJSON('npk-active-alert-ids', previousActiveAlertIds);
  saveJSON('npk-alert-details', previousAlertDetails);
  saveJSON('npk-dismissed-notifications', dismissedNotificationIds);
  saveJSON('npk-resolved-notifications', resolvedNotifications);
}

function renderAlerts() {
  const active = getActiveAlerts();
  const items = [...active, ...resolvedNotifications];
  const list = $('#alertList');
  if (list) list.innerHTML = items.length ? items.map(alert => alertTemplate(alert, { dismissible: true })).join('') : emptyState('No hay alertas ni notificaciones reales.');
  const summary = $('#alertSummaryGrid');
  if (summary) {
    const critical = active.filter(a => a.severity === 'critical').length;
    const warning = active.filter(a => a.severity === 'warning').length;
    const info = active.filter(a => a.severity === 'info').length;
    const resolved = resolvedNotifications.length;
    summary.innerHTML = `<div class="metric-card critical"><strong>${critical}</strong><span>Críticas</span></div><div class="metric-card warning"><strong>${warning}</strong><span>Advertencias</span></div><div class="metric-card"><strong>${info}</strong><span>Informativas</span></div><div class="metric-card resolved"><strong>${resolved}</strong><span>Resueltas</span></div>`;
  }
}

function alertTemplate(alert, { dismissible = false } = {}) {
  const icon = alert.severity === 'resolved' ? '✅' : alert.severity === 'critical' ? '⚠️' : alert.severity === 'warning' ? '🔔' : 'ℹ️';
  const date = alert.date ? `<small>${formatDateTime(alert.date)}</small>` : '';
  const action = dismissible ? `<button class="btn btn-small btn-outline alert-delete" onclick="window.deleteNotification('${escapeAttr(alert.id)}', '${escapeAttr(alert.status || 'active')}')">Eliminar</button>` : '';
  return `<article class="alert-item ${alert.severity}" data-alert-id="${escapeAttr(alert.id)}"><span class="alert-icon">${icon}</span><div><strong>${escapeHtml(alert.type)}</strong><p>${escapeHtml(alert.detail)}</p><small>${escapeHtml(alert.source)}</small>${date}</div>${action}</article>`;
}

window.deleteNotification = function(id, status = 'active') {
  if (!id) return;
  if (status === 'resolved' || String(id).startsWith('resolved-')) {
    resolvedNotifications = resolvedNotifications.filter(item => item.id !== id);
    saveJSON('npk-resolved-notifications', resolvedNotifications);
    toast('Notificación eliminada', 'La notificación resuelta fue retirada del historial local.');
  } else {
    if (!dismissedNotificationIds.includes(id)) dismissedNotificationIds.push(id);
    saveJSON('npk-dismissed-notifications', dismissedNotificationIds);
    toast('Notificación eliminada', 'La alerta activa fue ocultada en este navegador. Si se corrige, aparecerá como resuelta.');
  }
  renderAll();
};

function showAlertRules() {
  showModal(`<h2>Reglas de alertas y notificaciones</h2>
    <p class="muted">Estas reglas se aplican únicamente a datos recibidos desde el backend. Un sensor con valores null se clasifica como informativo: sin lectura.</p>
    <div class="settings-list">
      <label><span>Nitrógeno</span><strong>Advertencia &lt; ${alertRules.nitrogen.warningLow} ppm · Crítica &lt; ${alertRules.nitrogen.criticalLow} ppm</strong></label>
      <label><span>Fósforo</span><strong>Advertencia &lt; ${alertRules.phosphorus.warningLow} ppm · Crítica &lt; ${alertRules.phosphorus.criticalLow} ppm</strong></label>
      <label><span>Potasio</span><strong>Advertencia &lt; ${alertRules.potassium.warningLow} ppm · Crítica &lt; ${alertRules.potassium.criticalLow} ppm</strong></label>
      <label><span>Humedad del suelo</span><strong>Advertencia fuera de ${alertRules.humidity.warningLow}% - ${alertRules.humidity.warningHigh}% · Crítica fuera de ${alertRules.humidity.criticalLow}% - ${alertRules.humidity.criticalHigh}%</strong></label>
      <label><span>Temperatura del aire</span><strong>Advertencia fuera de ${alertRules.airTemp.warningLow}°C - ${alertRules.airTemp.warningHigh}°C · Crítica fuera de ${alertRules.airTemp.criticalLow}°C - ${alertRules.airTemp.criticalHigh}°C</strong></label>
      <label><span>Conectividad</span><strong>Crítica si supera ${alertRules.staleMinutes} minutos sin lectura reciente</strong></label>
    </div>`);
}

function showNotifications() {
  const items = getNotificationItems();
  showModal(`<h2>Notificaciones</h2><p class="muted">Puedes eliminar una notificación. Las alertas activas desaparecen automáticamente cuando el dato vuelve al rango normal y quedan registradas en verde como resueltas.</p>${items.length ? `<div class="modal-alert-list">${items.map(alert => alertTemplate(alert, { dismissible: true })).join('')}</div>` : emptyState('No hay notificaciones reales por ahora.')}`);
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
    ['H', sensor.soilHumidity ?? sensor.humidity, sensor.id],
    ['T', sensor.airTemp ?? sensor.temp, sensor.id]
  ]).filter(([, value]) => value !== null && value !== undefined);
  grid.innerHTML = cells.map(([key, value, id]) => `<span class="heat-cell" title="${key} ${escapeAttr(id)}: ${escapeAttr(value)}" style="--intensity:${Math.max(8, Math.min(100, Number(value) || 0))}"><b>${escapeHtml(key)}</b><small>${escapeHtml(id)}</small></span>`).join('');
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
    if (!rows.length) {
      setChartEmpty(line, 'Sin datos reales de sensores.');
    } else {
      clearChartEmpty(line);
      chartInstances.push(new Chart(line, {
        type: 'line',
        data: {
          labels: rows.map(s => s.id),
          datasets: [
            { label: 'Nitrógeno', data: rows.map(s => s.n), tension: 0.35, fill: false },
            { label: 'Fósforo', data: rows.map(s => s.p), tension: 0.35, fill: false },
            { label: 'Potasio', data: rows.map(s => s.k), tension: 0.35, fill: false },
            { label: 'Humedad suelo %', data: rows.map(s => s.soilHumidity ?? s.humidity), tension: 0.35, fill: false },
            { label: 'Temp. aire °C', data: rows.map(s => s.airTemp ?? s.temp), tension: 0.35, fill: false }
          ]
        },
        options: baseOptions()
      }));
    }
  }
  const donut = $('#cropDonutChart');
  if (donut) {
    const all = getAllSensors();
    if (!all.length) {
      setChartEmpty(donut, 'Sin sensores listados.');
    } else {
      clearChartEmpty(donut);
      chartInstances.push(new Chart(donut, {
        type: 'doughnut',
        data: { labels: ['Conectado', 'Crítico', 'Sin lectura', 'Mantenimiento'], datasets: [{ data: countStatuses(all), borderWidth: 0 }] },
        options: { responsive: true, cutout: '68%', plugins: { legend: { position: 'bottom' } } }
      }));
    }
  }
}

function countStatuses(rows = getAllSensors()) {
  return ['conectado', 'critico', 'no_conectado', 'mantenimiento'].map(status => rows.filter(s => normalizeUiStatus(s.status) === status).length);
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
  if (bar) {
    clearChartEmpty(bar);
    chartInstances.push(new Chart(bar, {
      type: 'bar',
      data: { labels: rows.map(s => s.id), datasets: [
        { label: 'N', data: rows.map(s => s.n) },
        { label: 'P', data: rows.map(s => s.p) },
        { label: 'K', data: rows.map(s => s.k) }
      ] },
      options: baseOptions()
    }));
  }
  if (area) {
    clearChartEmpty(area);
    chartInstances.push(new Chart(area, { type: 'line', data: { labels: rows.map(s => s.id), datasets: [{ label: 'Humedad %', data: rows.map(s => s.soilHumidity ?? s.humidity), fill: true, tension: 0.45 }] }, options: baseOptions() }));
  }
  if (alertDonut) {
    clearChartEmpty(alertDonut);
    const alerts = getActiveAlerts(rows);
    const labels = ['N bajo', 'P bajo', 'K bajo', 'Humedad', 'Temperatura', 'Conexión', 'Informativas'];
    const counts = [
      alerts.filter(a => a.type.includes('Nitrógeno')).length,
      alerts.filter(a => a.type.includes('Fósforo')).length,
      alerts.filter(a => a.type.includes('Potasio')).length,
      alerts.filter(a => a.type.includes('Humedad')).length,
      alerts.filter(a => a.type.includes('Temperatura')).length,
      alerts.filter(a => a.type.includes('Conectividad')).length,
      alerts.filter(a => a.severity === 'info').length
    ];
    chartInstances.push(new Chart(alertDonut, { type: 'doughnut', data: { labels, datasets: [{ data: counts, borderWidth: 0 }] }, options: { responsive: true, cutout: '64%', plugins: { legend: { position: 'bottom' } } } }));
  }
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
      { label: 'Temp máx °C', data: daily.temperature_2m_max || [], fill: true, tension: 0.42 },
      { label: 'Temp mín °C', data: daily.temperature_2m_min || [], fill: true, tension: 0.42 },
      { label: 'Lluvia mm', data: daily.precipitation_sum || [], fill: true, tension: 0.42 }
    ] },
    options: baseOptions()
  }));
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

function initMap() {
  if (!window.L || !$('#sensorMap')) return;
  sensorMap = L.map('sensorMap', { zoomControl: true, scrollWheelZoom: true }).setView([CHIGORODO.lat, CHIGORODO.lng], 14);
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri' }).addTo(sensorMap);
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' });
  L.control.layers({ Satelital: satellite, Calles: streets }, {}, { collapsed: true }).addTo(sensorMap);
  markerLayer = L.layerGroup().addTo(sensorMap);
  heatLayers = { nitrogen: L.layerGroup(), phosphorus: L.layerGroup(), potassium: L.layerGroup(), humidity: L.layerGroup() };
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
    if (info) info.innerHTML = `<h3>Mapa sin sensores ubicados</h3><p>${getAllSensors().length ? 'Existen sensores, pero ninguno tiene latitud y longitud.' : 'Sensores no conectados o backend sin datos.'}</p><div class="legend"><span><i class="dot active-dot"></i>Conectado</span><span><i class="dot warning-dot"></i>Crítico</span><span><i class="dot off-dot"></i>Sin lectura</span><span><i class="dot maintenance-dot"></i>Mantenimiento</span></div>`;
    return;
  }
  filtered.forEach(sensor => {
    const uiStatus = normalizeUiStatus(sensor.status);
    const icon = L.divIcon({ className: `marker-pin marker-${uiStatus}`, iconSize: [22, 22] });
    const marker = L.marker([sensor.lat, sensor.lng], { icon }).addTo(markerLayer);
    marker.bindPopup(`<strong>${escapeHtml(sensor.name || sensor.id)}</strong><br>ID: ${escapeHtml(sensor.id)}<br>Lat: ${Number(sensor.lat).toFixed(5)} · Lng: ${Number(sensor.lng).toFixed(5)}<br>N: ${dash(sensor.n)} ppm · P: ${dash(sensor.p)} ppm · K: ${dash(sensor.k)} ppm<br>Humedad: ${dash(sensor.soilHumidity ?? sensor.humidity)}% · Temp: ${dash(sensor.airTemp ?? sensor.temp)}°C<br>Estado: ${statusLabels[uiStatus] || uiStatus}<br><button onclick="window.openSensorHistory('${escapeAttr(sensor.id)}')">Ver sensor</button>`);
    marker.on('click', () => updateMapInfo(sensor));
    addHeatCircle('nitrogen', sensor, sensor.n);
    addHeatCircle('phosphorus', sensor, sensor.p);
    addHeatCircle('potassium', sensor, sensor.k);
    addHeatCircle('humidity', sensor, sensor.soilHumidity ?? sensor.humidity);
  });
  updateHeatLayerVisibility();
}

function addHeatCircle(layerName, sensor, value) {
  if (!sensor.realData || value === null || value === undefined || !heatLayers[layerName] || !window.L) return;
  const intensity = Math.max(0.18, Math.min(Number(value) / 100, 0.82));
  L.circle([sensor.lat, sensor.lng], { radius: 210 + intensity * 360, fillOpacity: intensity * 0.28, weight: 1 }).addTo(heatLayers[layerName]);
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
  panel.innerHTML = `<h3>${escapeHtml(sensor.name || sensor.id)}</h3><p><strong>ID ESP32:</strong> ${escapeHtml(sensor.id)}</p><div class="map-detail-list"><span><i class="dot ${uiStatus === 'conectado' ? 'active-dot' : uiStatus === 'critico' ? 'warning-dot' : uiStatus === 'no_conectado' ? 'off-dot' : 'maintenance-dot'}"></i>Estado: ${statusLabels[uiStatus] || uiStatus}</span><span>Latitud: ${sensor.lat !== null ? Number(sensor.lat).toFixed(6) : '--'}</span><span>Longitud: ${sensor.lng !== null ? Number(sensor.lng).toFixed(6) : '--'}</span><span>Nitrógeno: ${dash(sensor.n)} ppm</span><span>Fósforo: ${dash(sensor.p)} ppm</span><span>Potasio: ${dash(sensor.k)} ppm</span><span>Humedad: ${dash(sensor.soilHumidity ?? sensor.humidity)}%</span><span>Temperatura: ${dash(sensor.airTemp ?? sensor.temp)}°C</span><span>Última lectura: ${sensor.timestamp ? formatDateTime(sensor.timestamp) : 'Sin lectura'}</span></div><button class="btn btn-primary" style="margin-top:1rem" onclick="window.openSensorHistory('${escapeAttr(sensor.id)}')">Ver detalle</button>`;
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
    toast('Clima no disponible', 'No se pudo consultar Open-Meteo en este momento.');
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
    list.innerHTML = daily.time.map((date, i) => `<div class="forecast-row"><strong>${dayLabel(date)}</strong><span>${dash(daily.temperature_2m_min?.[i])}°C / ${dash(daily.temperature_2m_max?.[i])}°C</span><small>Lluvia: ${dash(daily.precipitation_sum?.[i])} mm</small></div>`).join('');
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

function initWeatherMap() {
  if (!window.L || !$('#weatherMap')) return;
  weatherMap = L.map('weatherMap', { zoomControl: true, scrollWheelZoom: true }).setView([CHIGORODO.lat, CHIGORODO.lng], 10);
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri', maxZoom: 18 }).addTo(weatherMap);
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 });
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
    weatherRadarLayer = L.tileLayer(`${data.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, { tileSize: 256, opacity: 0.58, maxNativeZoom: 7, maxZoom: 18, attribution: 'Radar © RainViewer' }).addTo(weatherMap);
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

function openAddSensorModal() {
  showModal(`<h2>Agregar o sincronizar sensor por ID</h2><p class="muted">Pega aquí el <strong>sensor_id</strong> que ya existe en MongoDB. El frontend no crea documentos: solo busca ese ID en el backend y lo relaciona con sus lecturas. Si todavía no aparece, queda como pendiente y se sincroniza cuando el backend lo entregue.</p><div class="form-grid" style="margin-top:16px;"><label>sensor_id de MongoDB / ESP32<input id="newSensorId" placeholder="Ej: 001"></label><label>Nombre opcional<input id="newSensorName" placeholder="Ej: Sensor cacao 001"></label><label>Ubicación opcional<input id="newSensorLocation" placeholder="Ej: Chigorodó"></label><label>Latitud opcional<input id="newSensorLat" placeholder="7.66638"></label><label>Longitud opcional<input id="newSensorLng" placeholder="-76.68106"></label></div><button class="btn btn-primary full" style="margin-top:14px" onclick="window.saveLocalSensor()">Guardar y sincronizar</button>`);
}

window.saveLocalSensor = async function() {
  const id = $('#newSensorId')?.value.trim();
  if (!id) return toast('Falta ID', 'Escribe el sensor_id exacto que aparece en MongoDB.');

  const sensor = {
    id,
    name: $('#newSensorName')?.value.trim() || `ESP32 ${id}`,
    location: $('#newSensorLocation')?.value.trim() || 'ID local pendiente de lectura',
    lat: toNumberOrNull($('#newSensorLat')?.value),
    lng: toNumberOrNull($('#newSensorLng')?.value)
  };

  const exists = localSensors.some(s => s.id === id);
  localSensors = exists ? localSensors.map(s => s.id === id ? { ...s, ...sensor } : s) : [...localSensors, sensor];
  hiddenSensorIds = hiddenSensorIds.filter(hiddenId => hiddenId !== id);

  saveJSON('npk-local-sensor-placeholders', localSensors);
  saveJSON('npk-hidden-sensors', hiddenSensorIds);

  closeModal();
  renderAll();

  await syncLocalSensorById(id);
};

function openUpdateSensorModal(id = '') {
  const sensors = getAllSensors();
  const options = sensors.map(s => `<option value="${escapeAttr(s.id)}" ${s.id === id ? 'selected' : ''}>${escapeHtml(s.id)}${s.name ? ' · ' + escapeHtml(s.name) : ''}</option>`).join('');
  showModal(`<h2>Actualizar ID ESP32</h2><p class="muted">Cambio visual del frontend. Útil si reemplazas una ESP32 y quieres que la página muestre el nuevo ID sin enviar datos a MongoDB.</p><div class="form-grid" style="margin-top:16px;"><label>Sensor actual<select id="oldSensorId"><option value="">Seleccionar</option>${options}</select></label><label>Nuevo ID ESP32<input id="replacementSensorId" placeholder="Ej: 003"></label></div><button class="btn btn-primary full" style="margin-top:14px" onclick="window.saveSensorAlias()">Actualizar ID en la página</button>`);
}
window.openUpdateSensorModal = openUpdateSensorModal;

window.saveSensorAlias = function() {
  const oldId = $('#oldSensorId')?.value.trim();
  const newId = $('#replacementSensorId')?.value.trim();
  if (!oldId || !newId) return toast('Datos incompletos', 'Selecciona el sensor actual y escribe el nuevo ID.');
  sensorAliases[oldId] = newId;
  localSensors = localSensors.map(s => s.id === oldId ? { ...s, id: newId, name: s.name?.includes(oldId) ? s.name.replace(oldId, newId) : s.name } : s);
  hiddenSensorIds = hiddenSensorIds.filter(id => id !== newId);
  saveJSON('npk-sensor-aliases', sensorAliases);
  saveJSON('npk-local-sensor-placeholders', localSensors);
  saveJSON('npk-hidden-sensors', hiddenSensorIds);
  closeModal();
  renderAll();
  toast('ID actualizado en frontend', `${oldId} ahora se muestra como ${newId}.`);
};

function openDeleteSensorModal() {
  const sensors = getAllSensors();
  const options = sensors.map(s => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.id)}${s.name ? ' · ' + escapeHtml(s.name) : ''}</option>`).join('');
  showModal(`<h2>Eliminar sensor de la vista</h2><p class="muted">Esto oculta el sensor en este navegador. No elimina documentos de MongoDB porque el frontend no debe escribir en el backend.</p><div class="form-grid" style="margin-top:16px;"><label>Sensor<select id="deleteSensorId"><option value="">Seleccionar</option>${options}</select></label></div><button class="btn btn-primary full" style="margin-top:14px" onclick="window.hideSelectedSensor()">Eliminar de la vista</button>`);
}

window.confirmHideSensor = function(id) {
  showModal(`<h2>Eliminar sensor ${escapeHtml(id)}</h2><p class="muted">Se ocultará solo en este frontend. Si el backend lo sigue enviando, no se mostrará en este navegador hasta restablecer datos locales.</p><button class="btn btn-primary full" onclick="window.hideSensor('${escapeAttr(id)}')">Confirmar eliminación visual</button>`);
};

window.hideSelectedSensor = function() {
  const id = $('#deleteSensorId')?.value.trim();
  if (!id) return toast('Selecciona sensor', 'Elige el sensor que quieres ocultar.');
  window.hideSensor(id);
};

window.hideSensor = function(id) {
  if (!hiddenSensorIds.includes(id)) hiddenSensorIds.push(id);
  localSensors = localSensors.filter(s => s.id !== id);
  saveJSON('npk-hidden-sensors', hiddenSensorIds);
  saveJSON('npk-local-sensor-placeholders', localSensors);
  closeModal();
  renderAll();
  toast('Sensor eliminado de la vista', `${id} fue ocultado localmente. No se modificó MongoDB.`);
};

window.openSensorHistory = function(id) {
  const sensor = getAllSensors().find(s => s.id === id);
  if (!sensor) return toast('Sensor no encontrado', 'Ese sensor no está disponible en la vista actual.');
  const real = sensor.realData ? 'Lectura real recibida del backend.' : 'Sensor listado, pero sin lectura real.';
  showModal(`<h2>Sensor ${escapeHtml(sensor.id)}</h2><p class="muted">${real}</p><div class="kpi-grid modal-kpis"><div class="kpi-card"><span>Nitrógeno</span><strong>${dash(sensor.n)} ppm</strong><small>N</small></div><div class="kpi-card"><span>Fósforo</span><strong>${dash(sensor.p)} ppm</strong><small>P</small></div><div class="kpi-card"><span>Potasio</span><strong>${dash(sensor.k)} ppm</strong><small>K</small></div><div class="kpi-card"><span>Humedad suelo</span><strong>${dash(sensor.soilHumidity ?? sensor.humidity)}%</strong><small>Suelo</small></div><div class="kpi-card"><span>Temperatura aire</span><strong>${dash(sensor.airTemp ?? sensor.temp)}°C</strong><small>Aire</small></div></div><div class="settings-list" style="margin-top:16px;"><label><span>Estado</span><strong>${escapeHtml(statusLabels[normalizeUiStatus(sensor.status)] || sensor.status)}</strong></label><label><span>Ubicación</span><strong>${escapeHtml(sensor.location || '--')}</strong></label><label><span>Última lectura</span><strong>${sensor.timestamp ? formatDateTime(sensor.timestamp) : 'Sin lectura'}</strong></label><label><span>Origen</span><strong>${sensor.fromBackend ? 'Backend' : 'ID local'}</strong></label></div>`);
};

window.exportOneSensor = function(id) {
  const sensor = getAllSensors().find(s => s.id === id);
  if (!sensor) return toast('Sensor no encontrado', 'No se encontró el sensor para exportar.');
  const csv = Object.entries(sensor).filter(([key]) => key !== 'raw').map(([k, v]) => `"${k}","${String(v ?? '').replaceAll('"', '""')}"`).join('\n');
  downloadText(`${safeFileName(id)}.csv`, csv, 'text/csv;charset=utf-8;');
};

function exportSensorsCSV() {
  const rows = getAllSensors();
  const headers = ['ID ESP32', 'ID original', 'Nombre', 'Estado', 'Ubicación', 'N', 'P', 'K', 'Humedad suelo', 'Temperatura aire', 'Latitud', 'Longitud', 'Última lectura', 'Origen'];
  const dataRows = rows.map(s => [s.id, s.originalId, s.name, statusLabels[normalizeUiStatus(s.status)] || s.status, s.location, s.n, s.p, s.k, s.soilHumidity ?? s.humidity, s.airTemp ?? s.temp, s.lat, s.lng, s.timestamp, s.fromBackend ? 'backend' : 'local']);
  const csv = [headers, ...dataRows].map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  downloadText('sensores-npk-smart-cacao-chigorodo.csv', csv, 'text/csv;charset=utf-8;');
  if (!rows.length) toast('CSV generado', 'Se descargó una plantilla vacía porque todavía no hay sensores.');
}

function getReportFilters() {
  return { type: $('#reportType')?.value || 'general', sensorId: $('#reportSensorId')?.value || 'todos', start: $('#reportStartDate')?.value || '', end: $('#reportEndDate')?.value || '' };
}

async function fetchJsonCandidate(endpoints, { params = {}, timeoutMs = API_CONFIG.timeoutMs } = {}) {
  const errors = [];
  for (const endpoint of [...new Set(endpoints.filter(Boolean))]) {
    try {
      const response = await fetchWithTimeout(buildUrlWithParams(endpoint, params), { method: 'GET', headers: { Accept: 'application/json' } }, timeoutMs);
      if (!response.ok) {
        errors.push(`${endpoint}: HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      const data = text ? JSON.parse(text) : [];
      return { ok: true, endpoint, data };
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }
  return { ok: false, errors };
}

async function getReportRows() {
  const filters = getReportFilters();

  const sensorId = filters.sensorId || "todos";

  const endpoint = sensorId !== "todos"
    ? `/api/sensor/${encodeURIComponent(sensorId)}/history`
    : "/api/sensor/history";

  const params = {
    start: filters.start,
    end: filters.end,
    source: "todos",
    limit: 5000
  };

  const result = await fetchJsonCandidate([endpoint], {
    params,
    timeoutMs: 7000
  });

  if (result.ok) {
    const backendRows = extractSensorRows(result.data)
      .map(normalizeSensorReading)
      .filter(Boolean);

    return filterRowsLocally(backendRows);
  }

  return filterRowsLocally(getAllSensors());
}

function filterRowsLocally(rows) {
  const { sensorId, start, end } = getReportFilters();
  return rows.filter(sensor => {
    if (!sensor.realData || !hasAnyReading(sensor)) return false;
    const bySensor = sensorId === 'todos' || sensor.id === sensorId || sensor.originalId === sensorId;
    const date = sensor.timestamp ? String(sensor.timestamp).slice(0, 10) : '';
    const byStart = !start || (date && date >= start);
    const byEnd = !end || (date && date <= end);
    return bySensor && byStart && byEnd;
  });
}

function getReportFilters() {
  return {
    type: $('#reportType')?.value || 'general',
    sensorId: $('#reportSensorId')?.value || 'todos',
    start: $('#reportStartDate')?.value || '',
    end: $('#reportEndDate')?.value || ''
  };
}

function getReportDefinition(type = 'general') {
  const definitions = {
    general: {
      label: 'General',
      includeRows: true,
      includeWeather: true,
      includeAlerts: true,
      columns: [
        { key: 'id', label: 'ID sensor' },
        { key: 'status', label: 'Estado' },
        { key: 'n', label: 'N' },
        { key: 'p', label: 'P' },
        { key: 'k', label: 'K' },
        { key: 'soilHumidity', label: 'Humedad suelo' },
        { key: 'airTemp', label: 'Temperatura aire' },
        { key: 'location', label: 'Ubicación' },
        { key: 'timestamp', label: 'Última lectura' }
      ]
    },

    npk: {
      label: 'NPK',
      includeRows: true,
      includeWeather: false,
      includeAlerts: false,
      columns: [
        { key: 'id', label: 'ID sensor' },
        { key: 'n', label: 'Nitrógeno' },
        { key: 'p', label: 'Fósforo' },
        { key: 'k', label: 'Potasio' },
        { key: 'timestamp', label: 'Fecha lectura' }
      ]
    },

    humedad: {
      label: 'Humedad',
      includeRows: true,
      includeWeather: false,
      includeAlerts: false,
      columns: [
        { key: 'id', label: 'ID sensor' },
        { key: 'soilHumidity', label: 'Humedad del suelo' },
        { key: 'timestamp', label: 'Fecha lectura' }
      ]
    },

    meteorologia: {
      label: 'Meteorología',
      includeRows: false,
      includeWeather: true,
      includeAlerts: false,
      columns: []
    },

    alertas: {
      label: 'Alertas',
      includeRows: false,
      includeWeather: false,
      includeAlerts: true,
      columns: []
    }
  };

  return definitions[type] || definitions.general;
}

function getReportFileSuffix() {
  const filters = getReportFilters();
  const definition = getReportDefinition(filters.type);
  const sensorPart = filters.sensorId && filters.sensorId !== 'todos'
    ? `-${filters.sensorId}`
    : '-todos';

  return `${definition.label.toLowerCase()}${sensorPart}`.replace(/\s+/g, '-');
}

function formatReportValue(sensor, key) {
  if (!sensor) return '--';

  if (key === 'id') return sensor.id || '--';

  if (key === 'status') {
    return statusLabels[normalizeUiStatus(sensor.status)] || sensor.status || '--';
  }

  if (key === 'n') return sensor.n != null ? `${dash(sensor.n)} ppm` : '--';

  if (key === 'p') return sensor.p != null ? `${dash(sensor.p)} ppm` : '--';

  if (key === 'k') return sensor.k != null ? `${dash(sensor.k)} ppm` : '--';

  if (key === 'soilHumidity') {
    const value = sensor.soilHumidity ?? sensor.humidity;
    return value != null ? `${dash(value)}%` : '--';
  }

  if (key === 'airTemp') {
    const value = sensor.airTemp ?? sensor.temp;
    return value != null ? `${dash(value)}°C` : '--';
  }

  if (key === 'location') return sensor.location || '--';

  if (key === 'timestamp') {
    return sensor.timestamp ? formatDateTime(sensor.timestamp) : 'Sin lectura';
  }

  return sensor[key] ?? '--';
}

function getWeatherReportHTML() {
  const current = state.weather?.current || {};
  const temp = current.temperature_2m ?? current.temperature ?? current.temp;
  const humidity = current.relative_humidity_2m ?? current.humidity;
  const rain = current.rain ?? current.precipitation ?? current.precipitation_probability;
  const wind = current.wind_speed_10m ?? current.windspeed;

  return `
    <h2>Meteorología</h2>
    <div class="box">
      <strong>Ubicación:</strong> Chigorodó, Antioquia<br>
      <strong>Temperatura externa:</strong> ${dash(temp)}°C<br>
      <strong>Humedad relativa externa:</strong> ${dash(humidity)}%<br>
      <strong>Lluvia / precipitación:</strong> ${dash(rain)}<br>
      <strong>Viento:</strong> ${dash(wind)}
    </div>
  `;
}

function getAlertsReportHTML(alerts) {
  return `
    <h2>Alertas</h2>
    ${
      alerts.length
        ? `<ul>${alerts.map(a => `<li><strong>${escapeHtml(a.type)}:</strong> ${escapeHtml(a.detail)} (${escapeHtml(a.source)})</li>`).join('')}</ul>`
        : '<p>No hay alertas para los filtros seleccionados.</p>'
    }
  `;
}

function buildReportHTMLFromRows(rows) {
  const filters = getReportFilters();
  const definition = getReportDefinition(filters.type);
  const alerts = generateAlerts(rows);

  const htmlRows = rows.map(sensor => `
    <tr>
      ${definition.columns.map(column => `
        <td>${escapeHtml(formatReportValue(sensor, column.key))}</td>
      `).join('')}
    </tr>
  `).join('');

  const tableHTML = definition.includeRows
    ? `
      ${
        rows.length
          ? `
            <h2>Lecturas reales · ${escapeHtml(definition.label)}</h2>
            <table>
              <thead>
                <tr>
                  ${definition.columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${htmlRows}
              </tbody>
            </table>
          `
          : '<p><strong>No hay lecturas reales para los filtros seleccionados.</strong></p>'
      }
    `
    : '';

  const weatherHTML = definition.includeWeather ? getWeatherReportHTML() : '';
  const alertsHTML = definition.includeAlerts ? getAlertsReportHTML(alerts) : '';

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Informe ${escapeHtml(definition.label)} · NPK Smart Cacao</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          color: #10231f;
          padding: 28px;
          line-height: 1.5;
        }

        h1 {
          margin-bottom: 4px;
          color: #0f3d2e;
        }

        h2 {
          margin-top: 26px;
          color: #14553f;
        }

        .box {
          background: #f1f7f3;
          border: 1px solid #d5e8dc;
          border-radius: 12px;
          padding: 14px;
          margin: 14px 0;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 14px;
          font-size: 12px;
        }

        th, td {
          border: 1px solid #d7e5dc;
          padding: 8px;
          text-align: left;
        }

        th {
          background: #e6f4ec;
          color: #12382b;
        }

        tr:nth-child(even) {
          background: #f8fbf9;
        }

        ul {
          padding-left: 20px;
        }
      </style>
    </head>
    <body>
      <h1>Informe técnico NPK Smart Cacao</h1>
      <p>Generado: ${escapeHtml(formatDateTime(new Date().toISOString()))}</p>

      <div class="box">
        <strong>Tipo de informe:</strong> ${escapeHtml(definition.label)}<br>
        <strong>ID sensor:</strong> ${escapeHtml(filters.sensorId || 'todos')}<br>
        <strong>Fecha inicial:</strong> ${escapeHtml(filters.start || 'No definida')}<br>
        <strong>Fecha final:</strong> ${escapeHtml(filters.end || 'No definida')}
      </div>

      <h2>Resumen</h2>
      <p>
        Lecturas incluidas: ${rows.length}.
        Tipo seleccionado: ${escapeHtml(definition.label)}.
      </p>

      ${tableHTML}
      ${weatherHTML}
      ${alertsHTML}
    </body>
    </html>
  `;
}

async function previewReport() {
  const rows = await getReportRows();
  showModal(`<h2>Vista previa del informe</h2><iframe class="report-preview" srcdoc="${escapeAttr(buildReportHTMLFromRows(rows))}"></iframe>`);
}

async function downloadReportHTML() {
  const rows = await getReportRows();
  if (!rows.length) toast('Informe sin lecturas', 'Se generará con el mensaje de no datos reales para los filtros seleccionados.');
  const name = `informe-npk-${Date.now()}.html`;
  downloadText(name, buildReportHTMLFromRows(rows), 'text/html;charset=utf-8;');
  addGeneratedReport(name, rows.length, 'HTML');
}

async function downloadReportCSV() {
  const rows = await getReportRows();
  const filters = getReportFilters();
  const definition = getReportDefinition(filters.type);

  if (!rows.length && definition.includeRows) {
    return toast('Sin datos', 'No hay lecturas reales para exportar con esos filtros.');
  }

  let csv = '';

  if (definition.includeRows) {
    const headers = definition.columns.map(column => column.label);

    const dataRows = rows.map(sensor =>
      definition.columns.map(column => formatReportValue(sensor, column.key))
    );

    csv = [headers, ...dataRows]
      .map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');
  }

  if (filters.type === 'meteorologia') {
    const current = state.weather?.current || {};
    const headers = ['ubicacion', 'temperatura_externa', 'humedad_relativa', 'lluvia_precipitacion', 'viento'];
    const dataRows = [[
      'Chigorodó, Antioquia',
      current.temperature_2m ?? current.temperature ?? current.temp ?? '',
      current.relative_humidity_2m ?? current.humidity ?? '',
      current.rain ?? current.precipitation ?? current.precipitation_probability ?? '',
      current.wind_speed_10m ?? current.windspeed ?? ''
    ]];

    csv = [headers, ...dataRows]
      .map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');
  }

  if (filters.type === 'alertas') {
    const alerts = generateAlerts(rows);
    const headers = ['tipo', 'detalle', 'fuente'];
    const dataRows = alerts.map(alert => [
      alert.type,
      alert.detail,
      alert.source
    ]);

    csv = [headers, ...dataRows]
      .map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');
  }

  const name = `informe-${getReportFileSuffix()}-${Date.now()}.csv`;
  downloadText(name, csv, 'text/csv;charset=utf-8;');
  addGeneratedReport(name, rows.length, 'CSV');
}

async function printReport() {
  const rows = await getReportRows();
  const filters = getReportFilters();
  const definition = getReportDefinition(filters.type);

  if (window.jspdf?.jsPDF) {
    const doc = new window.jspdf.jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4'
    });

    let y = 42;

    doc.setFontSize(18);
    doc.text(`Informe técnico · ${definition.label}`, 40, y);

    y += 24;
    doc.setFontSize(10);
    doc.text(`Generado: ${formatDateTime(new Date().toISOString())}`, 40, y);

    y += 18;
    doc.text(`Sensor: ${filters.sensorId || 'todos'} | Rango: ${filters.start || '--'} a ${filters.end || '--'}`, 40, y);

    y += 28;

    if (definition.includeRows) {
      if (!rows.length) {
        doc.text('No hay lecturas reales para los filtros seleccionados.', 40, y);
      } else {
        const columns = definition.columns;
        const pageWidth = 760;
        const startX = 40;
        const colWidth = pageWidth / columns.length;

        doc.setFontSize(9);

        columns.forEach((column, index) => {
          doc.text(String(column.label).slice(0, 18), startX + index * colWidth, y);
        });

        y += 12;
        doc.line(40, y, 800, y);
        y += 18;

        rows.slice(0, 40).forEach(sensor => {
          columns.forEach((column, index) => {
            const value = formatReportValue(sensor, column.key);
            doc.text(String(value).slice(0, 22), startX + index * colWidth, y);
          });

          y += 18;

          if (y > 540) {
            doc.addPage();
            y = 42;
          }
        });
      }
    }

    if (definition.includeWeather) {
      const current = state.weather?.current || {};

      doc.setFontSize(12);
      doc.text('Meteorología', 40, y);
      y += 20;

      doc.setFontSize(10);
      doc.text(`Ubicación: Chigorodó, Antioquia`, 40, y);
      y += 16;
      doc.text(`Temperatura externa: ${dash(current.temperature_2m ?? current.temperature ?? current.temp)}°C`, 40, y);
      y += 16;
      doc.text(`Humedad relativa externa: ${dash(current.relative_humidity_2m ?? current.humidity)}%`, 40, y);
      y += 16;
      doc.text(`Lluvia / precipitación: ${dash(current.rain ?? current.precipitation ?? current.precipitation_probability)}`, 40, y);
      y += 16;
      doc.text(`Viento: ${dash(current.wind_speed_10m ?? current.windspeed)}`, 40, y);
      y += 22;
    }

    if (definition.includeAlerts) {
      const alerts = generateAlerts(rows);

      doc.setFontSize(12);
      doc.text('Alertas', 40, y);
      y += 20;

      doc.setFontSize(9);

      if (!alerts.length) {
        doc.text('No hay alertas para los filtros seleccionados.', 40, y);
      } else {
        alerts.slice(0, 25).forEach(alert => {
          doc.text(`${alert.type}: ${alert.detail}`.slice(0, 110), 40, y);
          y += 16;

          if (y > 540) {
            doc.addPage();
            y = 42;
          }
        });
      }
    }

    const name = `informe-${getReportFileSuffix()}-${Date.now()}.pdf`;
    doc.save(name);
    addGeneratedReport(name, rows.length, 'PDF');
    toast('PDF generado', name);
    return;
  }

  const win = window.open('', '_blank');

  if (!win) {
    return toast('Ventana bloqueada', 'Permite ventanas emergentes para imprimir o guardar en PDF.');
  }

  win.document.write(buildReportHTMLFromRows(rows));
  win.document.close();
  win.focus();

  setTimeout(() => win.print(), 500);
}

function generateReportBySelectedFormat() {
  const format = $('#reportFormat')?.value || 'pdf';
  if (format === 'csv') return downloadReportCSV();
  if (format === 'html') return downloadReportHTML();
  return printReport();
}

function addGeneratedReport(name, rows, format) {
  generatedReports.unshift({ id: `report-${Date.now()}-${Math.random().toString(16).slice(2)}`, name, date: new Date().toISOString(), rows, format });
  generatedReports = generatedReports.slice(0, 20);
  saveJSON('npk-generated-reports', generatedReports);
  renderReportsList();
}

function renderReportsList() {
  const list = $('#reportList');
  if (!list) return;
  const term = normalizeText($('#reportSearch')?.value || '');
  const filtered = generatedReports.filter(report => !term || normalizeText(`${report.name} ${report.format || ''} ${report.rows} ${formatDateTime(report.date)}`).includes(term));
  list.innerHTML = filtered.length ? filtered.map((r, index) => {
    const id = r.id || `legacy-${index}`;
    if (!r.id) r.id = id;
    return `<article class="report-row" data-report-row="${escapeAttr(id)}"><div><strong>${escapeHtml(r.name)}</strong><small>${formatDateTime(r.date)} · ${r.rows} lectura(s) · ${escapeHtml(r.format || 'HTML')}</small></div><button class="btn btn-small btn-outline" onclick="window.deleteGeneratedReport('${escapeAttr(id)}')">Eliminar</button></article>`;
  }).join('') : emptyState(generatedReports.length ? 'No encontré informes con ese criterio de búsqueda.' : 'Aún no se han generado informes.');
  saveJSON('npk-generated-reports', generatedReports);
}

window.deleteGeneratedReport = function(id) {
  generatedReports = generatedReports.filter(report => report.id !== id);
  saveJSON('npk-generated-reports', generatedReports);
  renderReportsList();
  toast('Informe eliminado', 'El registro del informe fue retirado del historial local.');
};

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

function handleGlobalSearch() {
  const input = $('#globalSearch');
  const term = normalizeText(input?.value || '');
  $$('.search-hit').forEach(el => el.classList.remove('search-hit'));
  if (!term || term.length < 2) return;

  const sensors = getAllSensors();
  const sensor = sensors.find(s => normalizeText(`${s.id} ${s.originalId || ''} ${s.name || ''} ${s.location || ''}`).includes(term));
  if (sensor) {
    setView('sensores');
    setTimeout(() => {
      const row = $(`[data-sensor-row="${CSS.escape(sensor.id)}"]`);
      row?.classList.add('search-hit');
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return;
  }

  const views = $$('.view');
  const view = views.find(section => normalizeText(`${section.dataset.searchKeywords || ''} ${section.textContent || ''}`).includes(term));
  if (view?.id?.startsWith('view-')) {
    const viewName = view.id.replace('view-', '');
    setView(viewName);
    setTimeout(() => {
      view.classList.add('search-hit');
      view.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return;
  }
  toast('Sin coincidencias', `No encontré “${input.value}” en la página actual.`);
}

function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function normalizeText(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
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

function safeFileName(value) {
  return String(value || 'sensor').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'sensor';
}


window.syncSensorById = function(id) {
  return syncLocalSensorById(id);
};

window.addEventListener('resize', () => setTimeout(() => { drawAllCharts(); sensorMap?.invalidateSize?.(); weatherMap?.invalidateSize?.(); }, 150));
document.addEventListener('DOMContentLoaded', init);
