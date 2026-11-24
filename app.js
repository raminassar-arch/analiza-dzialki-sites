/* Analiza terenu — static web application built on open data.
   Sources: GUGiK (ULDK, EGiB, MPZP), GUS BDL, OpenStreetMap (Photon, Nominatim, Overpass),
   SunCalc (sun position). No API key, no backend. */

const $ = id => document.getElementById(id);
const POLAND = [[49.0, 14.1], [54.9, 24.2]];
const UA = 'AnalizaTerenU/1.2 (web; open data)';
const KIMP = 'https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaMiejscowychPlanowZagospodarowaniaPrzestrzennego';
/* Categories of utility networks shown as a controllable layer and in the report. */
const UTIL = {
  el:    { label: 'Energia elektryczna', color: '#f5a300' },
  water: { label: 'Woda', color: '#1e90ff' },
  sewer: { label: 'Kanalizacja', color: '#8b6b4a' },
  gas:   { label: 'Gaz', color: '#ff6f00' },
  heat:  { label: 'Ciepło', color: '#e53935' },
  tel:   { label: 'Telekomunikacja', color: '#9c27b0' }
};

/* ------------------------------------------------------------------ map */
const map = L.map('map').fitBounds(POLAND);
const baseLayers = {
  osmfr: L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    { maxZoom: 19, subdomains: 'abc', attribution: '&copy; OpenStreetMap contributors · styl OSM France' }),
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
  otm: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { maxZoom: 17, subdomains: 'abc', attribution: '&copy; OpenTopoMap, &copy; OpenStreetMap' }),
  dark: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, className: 'dark-base', attribution: '&copy; OpenStreetMap contributors · ciemny styl (CSS)' }),
  orto: L.tileLayer.wms('https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution',
    { layers: 'Raster', format: 'image/jpeg', maxZoom: 20, attribution: 'Ortofotomapa: GUGiK' })
};
const overlays = {
  egib: L.tileLayer.wms('https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow',
    { layers: 'dzialki,numery_dzialek,budynki', format: 'image/png', transparent: true, maxZoom: 20, attribution: 'EGiB: GUGiK' }),
  mpzp: L.tileLayer.wms('https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaMiejscowychPlanowZagospodarowaniaPrzestrzennego',
    { layers: 'raster,wektor-str,wektor-lin,wektor-pow,wektor-pkt', format: 'image/png', transparent: true, opacity: 0.7, maxZoom: 20, attribution: 'MPZP: GUGiK' })
};
/* Standard OSM tiles are used by default — the OSM France style blocks
   hotlinking from browsers/GitHub Pages and leaves the map empty. */
baseLayers.osm.addTo(map);
overlays.egib.addTo(map);

const selection = L.layerGroup().addTo(map);
const shadeLayer = L.layerGroup().addTo(map);
const buildingLayer = L.layerGroup().addTo(map);
const inspectLayer = L.layerGroup().addTo(map);
const utilityLayer = L.layerGroup().addTo(map);
let placeMarker = null;

/* ---------------------------------------------------------------- helpers */
const fmt = (n, d = 1) => Number(n).toLocaleString('pl-PL', { maximumFractionDigits: d });
const dist = (a, b) => {
  const k = 111320, dx = (a[1] - b[1]) * k * Math.cos(a[0] * Math.PI / 180), dy = (a[0] - b[0]) * k;
  return Math.hypot(dx, dy);
};
function area(ring) {
  if (!ring || ring.length < 3) return 0;
  const k = 111320, c = ring[0];
  let s = 0;
  const p = ring.map(([la, lo]) => [(lo - c[1]) * k * Math.cos(c[0] * Math.PI / 180), (la - c[0]) * k]);
  for (let i = 0; i < p.length; i++) {
    const [a, b] = [p[i], p[(i + 1) % p.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s / 2);
}
function pip(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
        pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function ringBBox(ring) {
  const la = ring.map(p => p[0]), lo = ring.map(p => p[1]);
  return [Math.min(...la), Math.max(...la), Math.min(...lo), Math.max(...lo)];
}
function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function segmentsIntersect(a, b, c, d) {
  const c1 = cross(a, b, c), c2 = cross(a, b, d), c3 = cross(c, d, a), c4 = cross(c, d, b);
  return ((c1 > 0 && c2 < 0) || (c1 < 0 && c2 > 0)) &&
         ((c3 > 0 && c4 < 0) || (c3 < 0 && c4 > 0));
}
function ringsIntersect(a, b) {
  if (a.some(p => pip(p, b)) || b.some(p => pip(p, a))) return true;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i], a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}
function ringSamples(ring, limit = 9) {
  const [minLa, maxLa, minLo, maxLo] = ringBBox(ring);
  const centre = ringCenterLocal(ring);
  const pts = [centre];
  for (let iy = 1; iy <= 3; iy++) {
    for (let ix = 1; ix <= 3; ix++) {
      const p = [minLa + (maxLa - minLa) * iy / 4, minLo + (maxLo - minLo) * ix / 4];
      if (pip(p, ring)) pts.push(p);
    }
  }
  if (!pts.some(p => pip(p, ring))) {
    const v = ring[0];
    pts.push([(centre[0] + v[0]) / 2, (centre[1] + v[1]) / 2]);
  }
  return pts.slice(0, limit);
}
function ringCenterLocal(ring) {
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length,
          ring.reduce((s, p) => s + p[1], 0) / ring.length];
}
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}
/* Live download counter shown under the loading bar. */
let downloadedBytes = 0;
function fmtBytes(b) {
  return b < 1024 ? Math.round(b) + ' B'
    : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
}
function countBytes(txt) {
  downloadedBytes += new Blob([txt]).size;
  const el = $('load-bytes');
  if (el) el.textContent = 'Pobrano ' + fmtBytes(downloadedBytes);
}
async function fetchJson(url, opts = {}, timeout = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text();
    countBytes(txt);
    return JSON.parse(txt);
  } finally { clearTimeout(timer); }
}
async function fetchText(url, timeout = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text();
    countBytes(txt);
    return txt;
  } finally { clearTimeout(timer); }
}

/* ------------------------------------------------------- progress helpers */
const LOAD_WEIGHT = { uld: 28, osm: 30, mpzp: 18, bdl: 16 };
let loadToken = 0;
function progress(pct, stage) {
  if (pct != null) {
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    if ($('load-bar')) $('load-bar').style.width = v + '%';
    if ($('load-pct')) $('load-pct').textContent = v + '%';
    if ($('load-track')) $('load-track').setAttribute('aria-valuenow', v);
  }
  if (stage != null && $('load-stage')) $('load-stage').textContent = stage;
}
function loadStep(key, state, stage) {
  const li = $('load-' + key);
  if (li) li.className = state || '';
  if (stage) progress(null, stage);
}
function resetLoading() {
  Object.keys(LOAD_WEIGHT).forEach(k => loadStep(k, ''));
  downloadedBytes = 0;
  if ($('load-bytes')) $('load-bytes').textContent = 'Pobrano 0 B';
  progress(6, 'Przygotowuję zapytania…');
}

/* ------------------------------------------------------- MPZP (KIMP WMS) */
/* GetFeatureInfo zwraca m.in. numer uchwały, nazwę planu, oznaczenie,
   opis przeznaczenia oraz adres dokumentu (często link do BIP gminy). */
async function fetchPlanInfo(lat, lon) {
  const x = lon * 20037508.34 / 180;
  const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180;
  const r = 400;
  const url = `${KIMP}?service=WMS&version=1.3.0&request=GetFeatureInfo` +
    `&layers=plany&query_layers=plany&crs=EPSG%3A3857` +
    `&bbox=${(x - r).toFixed(2)},${(y - r).toFixed(2)},${(x + r).toFixed(2)},${(y + r).toFixed(2)}` +
    `&width=400&height=400&i=200&j=200&info_format=text%2Fhtml&feature_count=20`;
  return parsePlanInfo(await fetchText(url, 22000));
}
function parsePlanInfo(txt) {
  if (!txt || /brak (serwisu|wyniku)/i.test(txt)) return [];
  const rows = [];
  try {
    if (/GetFeatureInfo_Result|ROWSET/i.test(txt)) {
      // Geoportal sometimes prefixes the XML with <hr/>, which breaks strict XML parsing.
      const at = txt.indexOf('<GetFeatureInfo_Result');
      const doc = new DOMParser().parseFromString(at >= 0 ? txt.slice(at) : txt, 'text/xml');
      doc.querySelectorAll('ROW').forEach(row => {
        const v = tag => row.getElementsByTagName(tag)[0]?.textContent.trim() || '';
        const req = [v('FUN_NAZWA'), v('FUN_SYMB') && 'oznaczenie: ' + v('FUN_SYMB'),
          v('MAX_WYS') && 'maks. wysokość: ' + v('MAX_WYS') + ' m',
          v('INTEN_ZAB') && 'intensywność zabudowy: ' + v('INTEN_ZAB')].filter(Boolean).join(' · ');
        rows.push({ number: '', date: '', effective: '', name: v('NAZWA_PLAN'), symbol: v('FUN_SYMB'), desc: req, www: v('WWW') });
      });
    } else {
      const doc = new DOMParser().parseFromString(txt, 'text/html');
      doc.querySelectorAll('table').forEach(table => {
        const heads = [...table.querySelectorAll('th')].map(th =>
          th.textContent.trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, '_'));
        if (!heads.some(h => /NAZWA_?MPZP|NAZWA_PLAN/.test(h))) return;
        [...table.querySelectorAll('tr')].forEach(tr => {
          const tds = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
          if (!tds.length || tds.length !== heads.length) return;
          const r = Object.fromEntries(heads.map((h, i) => [h, tds[i]]));
          const req = [r.OZNACZENIE,
            r.RODZAJ_OZNACZENIA && r.RODZAJ_OZNACZENIA !== r.OZNACZENIE ? r.RODZAJ_OZNACZENIA : '',
            r.OPIS_OZNAC].filter(Boolean).join(' — ');
          rows.push({
            number: r.UCHWALENIE || '', date: r.DATA_UCHWALENIA || '', effective: r.DATA_OBOWIAZYWANIA || '',
            name: r.NAZWA_MPZP || r.NAZWA_PLAN || '', symbol: r.OZNACZENIE || '', desc: req, www: r.WWW || ''
          });
        });
      });
    }
  } catch (e) { /* nieoczekiwany format odpowiedzi — wynik pozostaje pusty */ }
  const seen = new Set();
  return rows.filter(r => {
    const k = [r.number, r.name, r.symbol, r.desc].join('|');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, 10);
}
function planDocUrl(www) {
  // Only a real, directly accessible document URL is returned. Relative KIMP
  // paths point to a gated store (401), so they are treated as unavailable.
  return /^https?:\/\//i.test(www || '') ? www : '';
}
function setMarker(lat, lon, label) {
  if (placeMarker) selection.removeLayer(placeMarker);
  placeMarker = L.marker([lat, lon]).addTo(selection);
  if (label) placeMarker.bindPopup(label).openPopup();
}
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}

/* -------------------------------------------------------------- geocoding */
function photonLabel(p) {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const parts = [p.name, street, p.city || p.town || p.village, p.state].filter(Boolean);
  const uniq = parts.filter((v, i) => parts.indexOf(v) === i);
  return uniq.join(', ') || [p.osm_key, p.osm_value].filter(Boolean).join(': ');
}
async function suggestPlaces(q) {
  const url = 'https://photon.komoot.io/api/?limit=6&bbox=14.1,49.0,24.2,54.9&lat=52.14&lon=19.35&q=' + encodeURIComponent(q);
  try {
    const j = await fetchJson(url);
    return (j.features || []).map(f => ({
      label: photonLabel(f.properties || {}),
      detail: [f.properties?.city || f.properties?.town, f.properties?.state, f.properties?.country]
        .filter(Boolean).join(', '),
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0]
    }));
  } catch (e) {
    const j = await fetchJson('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=pl&accept-language=pl&q=' + encodeURIComponent(q));
    return (j || []).map(f => ({ label: f.display_name.split(',').slice(0, 2).join(','), detail: f.display_name, lat: +f.lat, lon: +f.lon }));
  }
}
async function geocodeOne(q) {
  const list = await suggestPlaces(q);
  return list[0] || null;
}

let suggestList = [], suggestIndex = -1, suggestTimer;
function hideSuggest() { $('suggest').hidden = true; $('suggest').innerHTML = ''; suggestIndex = -1; }
function renderSuggest() {
  const box = $('suggest');
  if (!suggestList.length) { box.innerHTML = '<div class="suggest-empty">Brak wyników w Polsce.</div>'; box.hidden = false; return; }
  box.innerHTML = suggestList.map((s, i) =>
    `<div class="suggest-item${i === suggestIndex ? ' active' : ''}" data-i="${i}"><b>${escapeHtml(s.label)}</b><small>${escapeHtml(s.detail || '')}</small></div>`
  ).join('');
  box.hidden = false;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function choosePlace(i) {
  const s = suggestList[i];
  if (!s) return;
  $('search').value = s.label;
  hideSuggest();
  map.setView([s.lat, s.lon], 18, { animate: false });
  setMarker(s.lat, s.lon, s.label);
  switchTab('place');
  analyze(s.lat, s.lon);
}

/* --------------------------------------------------------------- analysis */
async function getParcel(lat, lon) {
  for (const xy of [`${lon},${lat}`, `${lat},${lon}`]) {
    const u = `https://uldk.gugik.gov.pl/?request=GetParcelByXY&xy=${xy},4326&result=id,voivodeship,county,commune,region,parcel,geom_wkt&srid=4326`;
    const t = (await fetchText(u)).trim().split('\n');
    if (t[0] !== '0' || !t[1]) continue;
    const f = t[1].split('|');
    const nums = [...f[6].replace(/^SRID=\d+;/, '').match(/-?\d+\.?\d*/g)].map(Number);
    const ring = [];
    for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i + 1], nums[i]]);
    if (Math.abs(ring[0][0] - lat) > 1) ring.forEach(r => r.reverse());
    return { id: f[0], woj: f[1], pow: f[2], gm: f[3], obr: f[4], nr: f[5], ring, area: area(ring) };
  }
  return null;
}

/* EGiB building attributes from ULDK (open, no API key). */
async function getBuildingInfo(lat, lon) {
  const fields = ['id', 'function', 'voivodeship', 'county', 'commune', 'region', 'parcel', 'geom_wkt', 'datasource'];
  for (const xy of [`${lon},${lat}`, `${lat},${lon}`]) {
    const u = `https://uldk.gugik.gov.pl/?request=GetBuildingByXY&xy=${xy},4326&result=${fields.join(',')}&srid=4326`;
    const t = (await fetchText(u)).trim().split('\n');
    if (t[0] !== '0' || !t[1]) continue;
    const f = t[1].split('|');
    let ring = null;
    if (f[7]) {
      const nums = [...f[7].replace(/^SRID=\d+;/, '').match(/-?\d+\.?\d*/g)].map(Number);
      const r = [];
      for (let i = 0; i + 1 < nums.length; i += 2) r.push([nums[i + 1], nums[i]]);
      if (r.length >= 3) {
        if (Math.abs(r[0][0] - lat) > 1) r.forEach(p => p.reverse());
        ring = r;
      }
    }
    return {
      id: f[0] || '', funkcja: f[1] || '', woj: f[2] || '', pow: f[3] || '',
      gm: f[4] || '', obr: f[5] || '', parcela: f[6] || '',
      zrodlo: f[8] || '', ring
    };
  }
  return null;
}

/* ---------------------------------------------------- GUS BDL (open data) */
const BDL = 'https://bdl.stat.gov.pl/api/v1';
const bdlCache = { counties: null, gminy: new Map() };
const bdlNorm = s => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s*\([^)]*\)/g, '')
  .replace(/^(city with powiat status|powiat|gmina miejska|gmina wiejska|gmina|miasto)\b\s*/i, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
async function bdlAllUnits(level, parentId) {
  const base = `${BDL}/units?level=${level}&page-size=100` + (parentId ? `&parent-id=${parentId}` : '');
  const first = await fetchJson(base + '&page=0');
  const pages = Math.min(20, Math.max(1, Math.ceil((first.totalRecords || 0) / 100)));
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchJson(base + `&page=${i + 1}`)));
  return [first, ...rest].flatMap(j => j.results || []);
}
async function findBdlGmina(parcel) {
  if (!bdlCache.counties) bdlCache.counties = bdlAllUnits(5);
  const counties = await bdlCache.counties;
  const pow = bdlNorm(parcel.pow);
  const county = counties.find(c => bdlNorm(c.name) === pow) ||
                 counties.find(c => bdlNorm(c.name).includes(pow));
  if (!county) throw new Error('Nie znaleziono powiatu w BDL');
  if (!bdlCache.gminy.has(county.id)) {
    bdlCache.gminy.set(county.id, bdlAllUnits(6, county.id));
  }
  const units = await bdlCache.gminy.get(county.id);
  const gm = bdlNorm(parcel.gm);
  const matches = units.filter(u => {
    const n = bdlNorm(u.name);
    return (n === gm || n.includes(gm) || gm.includes(n)) && ![4, 5].includes(u.kind);
  }).sort((a, b) => (a.kind || 9) - (b.kind || 9));
  if (!matches.length) throw new Error('Nie znaleziono gminy w BDL');
  return matches[0];
}
async function getSocialData(parcel) {
  const unit = await findBdlGmina(parcel);
  const data = await fetchJson(`${BDL}/data/by-unit/${unit.id}?var-id=72305&var-id=60559`);
  const latest = varId => {
    const r = (data.results || []).find(x => x.id === varId);
    const values = (r?.values || []).slice().sort((a, b) => +b.year - +a.year);
    return values.length ? { year: +values[0].year, val: +values[0].val } : null;
  };
  const pop = latest(72305), dens = latest(60559);
  if (!pop && !dens) throw new Error('Brak danych BDL dla gminy');
  return { unit: unit.name, pop, dens, year: pop?.year || dens?.year };
}

/* Buildings selected on the map are checked against ULDK parcel geometries. */
async function getParcelsUnderBuilding(building) {
  const found = new Map();
  const errors = [];
  await Promise.all(ringSamples(building.ring).map(async p => {
    try {
      const parcel = await getParcel(p[0], p[1]);
      if (parcel) found.set(parcel.id, parcel);
    } catch (e) { errors.push(e.message); }
  }));
  const parcels = [...found.values()].filter(pc => ringsIntersect(building.ring, pc.ring));
  return { parcels, err: errors[0] || '' };
}

/* Public Overpass mirrors with open CORS — tried in order until one answers. */
const OVERPASS_HOSTS = [
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
async function overpass(query, timeout = 15000) {
  let last;
  for (const host of OVERPASS_HOSTS) {
    try {
      return await fetchJson(host + '?data=' + encodeURIComponent(query), {}, timeout);
    } catch (e) { last = e; }
  }
  throw last || new Error('Overpass niedostępny');
}
function bboxAround(lat, lon, radiusM) {
  const dLat = radiusM / 111320;
  const dLon = dLat / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  return `${(lat - dLat).toFixed(5)},${(lon - dLon).toFixed(5)},${(lat + dLat).toFixed(5)},${(lon + dLon).toFixed(5)}`;
}
async function getOsm(lat, lon) {
  const b250 = bboxAround(lat, lon, 250), b300 = bboxAround(lat, lon, 300);
  const b500 = bboxAround(lat, lon, 500), b800 = bboxAround(lat, lon, 800);
  const q = `[out:json][timeout:25];(
    way[building](${b250});
    way[highway](${b250});
    nwr[highway=bus_stop](${b500});
    nwr[railway~"station|tram_stop|halt"](${b800});
    nwr[amenity~"school|kindergarten|pharmacy|clinic|doctors|library"](${b800});
    nwr[shop~"supermarket|convenience"](${b500});
    nwr[leisure~"park|playground"](${b500});
    nwr[landuse~"industrial|railway"](${b300});
    nwr[power](${b300});
    way[man_made=pipeline](${b300});
    nwr[man_made=water_well](${b300});
    nwr[utility](${b300});
    nwr[amenity~"water_point|drinking_water|wastewater_plant|water_works"](${b300});
  );out geom tags;`;
  return (await overpass(q, 20000)).elements;
}

/* Utility networks (uzbrojenie działki) from OSM tags. */
function utilCategory(t) {
  const s = [t.substance, t.utility, t.man_made, t.amenity, t.power, t['pipe:content']]
    .filter(Boolean).join(' ').toLowerCase();
  if (t.power) return 'el';
  if (/gas/.test(s)) return 'gas';
  if (/sewage|wastewater|sludge|kanal|scop/.test(s)) return 'sewer';
  if (/water|well|hydrant|drinking|wod/.test(s)) return 'water';
  if (/steam|hot_water|heating|heat|c\.o\./.test(s)) return 'heat';
  if (/telecom|telephone|fiber|optic|antenna|mast|communication|internet/.test(s)) return 'tel';
  return null;
}
function parseUtilities(el, pt) {
  const features = [];
  el.forEach(e => {
    const t = e.tags || {};
    const cat = utilCategory(t);
    if (!cat) return;
    const line = e.geometry?.map(g => [g.lat, g.lon]) || null;
    const point = e.lat != null ? [e.lat, e.lon]
      : (e.center ? [e.center.lat, e.center.lon] : (line?.length ? line[0] : null));
    if (!point && !line) return;
    const pts = line?.length ? line : [point];
    features.push({ cat, point, line: line && line.length > 1 ? line : null,
      name: t.name || t.ref || t.operator || '', d: Math.min(...pts.map(p => dist(pt, p))) });
  });
  const summary = {};
  Object.keys(UTIL).forEach(k => summary[k] = { d: Infinity, n: 0 });
  features.forEach(f => { const u = summary[f.cat]; u.n++; u.d = Math.min(u.d, f.d); });
  return { features, summary };
}
function drawUtilities(features) {
  utilityLayer.clearLayers();
  (features || []).forEach(f => {
    const u = UTIL[f.cat]; if (!u) return;
    const title = u.label + (f.name ? ' — ' + f.name : '');
    let obj;
    if (f.line) obj = L.polyline(f.line, { color: u.color, weight: 3, opacity: 0.9 });
    else if (f.point) obj = L.circleMarker(f.point, { color: u.color, weight: 2,
      fillColor: u.color, fillOpacity: 0.85, radius: 5 });
    if (obj) { obj.bindTooltip(title, { sticky: true }); obj.addTo(utilityLayer); }
  });
}

let A = null, shadeOn = true, utilOn = true; // current analysis + user preferences
async function analyze(lat, lon) {
  const token = ++loadToken;
  $('place-empty').hidden = true;
  $('place-content').hidden = true;
  $('place-loading').hidden = false;
  resetLoading();
  let pct = 6;
  const finish = (key, ok) => {
    loadStep(key, ok ? 'done' : 'error');
    pct += LOAD_WEIGHT[key] || 0;
    progress(pct);
  };
  selection.clearLayers();
  shadeLayer.clearLayers();
  buildingLayer.clearLayers();
  inspectLayer.clearLayers();
  utilityLayer.clearLayers();
  $('building-result').hidden = true;
  $('building-result').innerHTML = '';
  setMarker(lat, lon);
  let planErr = '', socialErr = '';
  loadStep('mpzp', 'active', 'Pobieram plan miejscowy…');
  const planPromise = fetchPlanInfo(lat, lon)
    .then(r => { finish('mpzp', true); return r; })
    .catch(e => { planErr = e.message; finish('mpzp', false); return []; });
  let parcel = null, el = [], err = '';
  loadStep('uld', 'active', 'Pobieram dane ewidencyjne…');
  try { parcel = await getParcel(lat, lon); finish('uld', true); }
  catch (e) { err += 'ULDK (działki) nie odpowiada: ' + e.message + '. '; finish('uld', false); }
  loadStep('bdl', 'active', 'Pobieram dane statystyczne…');
  const socialPromise = parcel
    ? getSocialData(parcel)
        .then(r => { finish('bdl', true); return r; })
        .catch(e => { socialErr = e.message; finish('bdl', false); return null; })
    : (pct += LOAD_WEIGHT.bdl, progress(pct, 'Brak działki — pomijam dane statystyczne'), Promise.resolve(null));
  loadStep('osm', 'active', 'Pobieram budynki i otoczenie…');
  try { el = await getOsm(lat, lon); finish('osm', true); }
  catch (e) { err += 'Dane OSM niedostępne: ' + e.message + '. '; finish('osm', false); }
  const plan = await planPromise;
  const social = await socialPromise;

  const pt = [lat, lon];
  const util = parseUtilities(el, pt);
  const geo = e => e.geometry ? e.geometry.map(g => [g.lat, g.lon]) : null;
  const blds = el.filter(e => e.type === 'way' && e.tags?.building && e.geometry).map(e => ({
    ring: geo(e), t: e.tags,
    h: e.tags.height ? parseFloat(e.tags.height) : (e.tags['building:levels'] ? +e.tags['building:levels'] * 3 : 6)
  })).filter(b => b.ring && b.ring.length >= 3);
  const mine = blds.find(b => pip(pt, b.ring)) ||
    blds.slice().sort((a, b) => dist(pt, a.ring[0]) - dist(pt, b.ring[0]))[0];

  const roads = {};
  el.filter(e => e.type === 'way' && e.tags?.highway && e.geometry).forEach(e => {
    const d = Math.min(...e.geometry.map(g => dist(pt, [g.lat, g.lon])));
    const h = e.tags.highway;
    if (!roads[h] || roads[h].d > d) roads[h] = { d, name: e.tags.name || '', n: (roads[h]?.n || 0) + 1 };
    else roads[h].n++;
  });

  const cat = { 'Przystanki autobusowe': 0, 'Stacje kolej/tramwaj': 0, 'Szkoły i przedszkola': 0,
    'Apteki, przychodnie': 0, 'Sklepy spożywcze': 0, 'Parki i place zabaw': 0, 'Biblioteki': 0 };
  let industrial = 0;
  el.forEach(e => {
    const t = e.tags || {};
    if ((e.type === 'way' && t.highway) || t.building) return;
    if (t.highway === 'bus_stop') cat['Przystanki autobusowe']++;
    else if (t.railway) cat['Stacje kolej/tramwaj']++;
    else if (/school|kindergarten/.test(t.amenity)) cat['Szkoły i przedszkola']++;
    else if (/pharmacy|clinic|doctors/.test(t.amenity)) cat['Apteki, przychodnie']++;
    else if (t.amenity === 'library') cat['Biblioteki']++;
    else if (t.shop) cat['Sklepy spożywcze']++;
    else if (t.leisure) cat['Parki i place zabaw']++;
    else if (t.landuse) industrial++;
  });

  /* Named OSM objects near the point — used by the report's object list. */
  const poiKind = t =>
    /restaurant|cafe|fast_food|bar|pub/.test(t.amenity || '') ? 'Gastronomia' :
    t.amenity === 'fuel' ? 'Paliwo' :
    /hospital|clinic|doctors|pharmacy/.test(t.amenity || '') ? 'Zdrowie' :
    /school|kindergarten/.test(t.amenity || '') ? 'Edukacja' :
    t.amenity === 'library' ? 'Biblioteka' :
    t.shop ? 'Sklep' :
    /park|playground/.test(t.leisure || '') ? 'Park / plac zabaw' :
    t.highway === 'bus_stop' ? 'Przystanek' :
    t.railway ? 'Kolej / tramwaj' : 'Obiekt';
  const pois = el.filter(e => {
    const t = e.tags || {};
    return (t.name || t.brand) && (t.amenity || t.shop || t.leisure || t.highway === 'bus_stop' || t.railway);
  }).map(e => {
    const t = e.tags || {}, g = e.geometry || [];
    const la = e.lat ?? e.center?.lat ?? (g.length ? g.reduce((s, p) => s + p.lat, 0) / g.length : null);
    const lo = e.lon ?? e.center?.lon ?? (g.length ? g.reduce((s, p) => s + p.lon, 0) / g.length : null);
    return { name: t.name || t.brand, kind: poiKind(t), lat: la, lon: lo,
             d: la && lo ? dist(pt, [la, lo]) : Infinity };
  }).filter(x => x.d <= 800).sort((a, b) => a.d - b.d);

  const y = new Date().getFullYear();
  const days = [['21 grudnia', new Date(y, 11, 21, 12)], ['21 marca', new Date(y, 2, 21, 12)], ['21 czerwca', new Date(y, 5, 21, 12)]];
  const sun = days.map(([n, d]) => {
    const t = SunCalc.getTimes(d, lat, lon), p = SunCalc.getPosition(t.solarNoon, lat, lon);
    return { n, alt: p.altitude * 180 / Math.PI, rise: t.sunrise, set: t.sunset,
      len: (t.sunset - t.sunrise) / 36e5, shadow: 1 / Math.tan(p.altitude) };
  });

  A = { lat, lon, parcel, mine, blds, roads, cat, industrial, sun, plan, planErr, pois, social, socialErr,
        utilities: util };
  if (parcel) L.polygon(parcel.ring, { color: '#1e6bd6', weight: 3, fillColor: '#1e6bd6', fillOpacity: 0.22 })
    .bindPopup(`Działka nr ${parcel.nr}, obr. ${parcel.obr}`).addTo(selection);
  blds.forEach((b, i) => {
    const poly = L.polygon(b.ring, {
      color: '#0b3f91', weight: 1.5, fillColor: '#1e6bd6', fillOpacity: 0.18,
      bubblingMouseEvents: false
    }).addTo(buildingLayer);
    poly.bindTooltip(`Budynek ${i + 1}${b.t.name ? ' — ' + b.t.name : ''} · kliknij, aby sprawdzić działki`, { sticky: true });
    poly.on('click', () => selectBuilding(b));
  });
  if (utilOn) drawUtilities(util.features);

  progress(100, 'Gotowe — ładuję wyniki…');
  setTimeout(() => { if (token === loadToken) $('place-loading').hidden = true; }, 300);
  $('place-content').hidden = false;
  $('pdf-btn').disabled = false;
  $('place-content').innerHTML = analysisHtml() +
    `<h2>Widok mapy do raportu</h2>
     <div class="field-row">
       <label class="shade-toggle"><input type="radio" name="plan-scale" value="500"> 1:500</label>
       <label class="shade-toggle"><input type="radio" name="plan-scale" value="1000" checked> 1:1000</label>
       <select id="plan-radius" style="flex:1">
         <option value="100">100 m</option>
         <option value="200">200 m</option>
         <option value="300" selected>300 m</option>
       </select>
     </div>
     <p class="note">Widok sytuacyjny z działką i otaczającymi budynkami, wymiarowany w skali wydruku A4. Gdy promień nie mieści się na kartce, raport zawiera dodatkowy widok przeglądowy.</p>
      <p class="note">Kliknij budynek na mapie (lub użyj przycisku ▣), aby sprawdzić, na jakich działkach się znajduje.</p>`;
    $('shadow-on').checked = shadeOn;
  updateShadowButton();
  drawShade();
  if (err) toast('Uwaga: ' + err.trim());
}

/* ------------------------------------------------- building / parcel check */
async function selectBuilding(building) {
  if (!A) { toast('Najpierw przeanalizuj działkę.'); return; }
  inspectLayer.clearLayers();
  const ring = building.ring;
  L.polygon(ring, {
    color: '#e23d8c', weight: 3, fillColor: '#e23d8c', fillOpacity: 0.3,
    bubblingMouseEvents: false
  }).addTo(inspectLayer).bindPopup('Zaznaczony budynek');
  const centre = ringSamples(ring).find(p => pip(p, ring)) || ringCenterLocal(ring);
  const box = $('building-result');
  box.hidden = false;
  box.innerHTML = `<h2>Sprawdzanie budynku</h2><p class="hint progress-inline"><span class="spinner small"></span>Pobieram dane o budynku i działkach…</p>`;
  try {
    const [res, info] = await Promise.all([
      getParcelsUnderBuilding(building),
      getBuildingInfo(centre[0], centre[1]).catch(() => null)
    ]);
    A.buildingCheck = { building, parcels: res.parcels, info, err: res.err };
    res.parcels.forEach(pc => {
      L.polygon(pc.ring, {
        color: '#2f6f5e', weight: 2, fillColor: '#2f6f5e', fillOpacity: 0.2,
        bubblingMouseEvents: false
      }).addTo(inspectLayer).bindPopup(`Działka nr ${pc.nr}, obr. ${pc.obr}<br>Id: ${pc.id}`);
    });
    if (info?.ring) {
      L.polygon(info.ring, {
        color: '#7b1fa2', weight: 2, dashArray: '5 4', fill: false,
        bubblingMouseEvents: false
      }).addTo(inspectLayer).bindPopup('Geometria budynku z EGiB (ULDK)');
    }
    const all = [ring, ...res.parcels.map(pc => pc.ring), ...(info?.ring ? [info.ring] : [])].flat();
    map.fitBounds(L.latLngBounds(all), { padding: [40, 40], maxZoom: 19 });

    const parcelsHtml = res.parcels.length
      ? `<div class="parcel-list">${res.parcels.map(pc => `
          <div class="parcel-item">
            <div class="parcel-top"><b>Działka nr ${escapeHtml(pc.nr)}</b><span>${fmt(pc.area)} m² · obr. ${escapeHtml(pc.obr)}</span></div>
            <span class="parcel-sub">Identyfikator: ${escapeHtml(pc.id)}</span>
          </div>`).join('')}</div>`
      : `<p class="note">Nie znaleziono działek przecinających ten budynek. ${res.err ? escapeHtml(res.err) : 'ULDK nie zwrócił geometrii dla tego obszaru.'}</p>`;
    const egibRows = info ? [
      ['Identyfikator budynku (EGiB)', info.id],
      ['Funkcja budynku', info.funkcja],
      ['Działka ewidencyjna', info.parcela],
      ['Obręb', info.obr],
      ['Gmina', info.gm],
      ['Powiat', info.pow],
      ['Województwo', info.woj],
      ['Źródło danych', info.zrodlo]
    ].filter(r => r[1]) : [];
    const osmRows = Object.entries(building.t || {})
      .filter(([k, v]) => v !== '' && v != null && !/^(id|version|timestamp|changeset|uid|user)$/.test(k))
      .sort((a, b) => a[0].localeCompare(b[0]));
    box.innerHTML = `<h2>Sprawdzanie budynku</h2>
      <h3>Działki pod budynkiem (${res.parcels.length})</h3>${parcelsHtml}
      <h3>Dane z ewidencji gruntów i budynków (ULDK)</h3>` +
      (egibRows.length
        ? `<table>${egibRows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`
        : `<p class="note">ULDK nie zwrócił danych ewidencyjnych dla tego budynku.</p>`) +
      `<h3>Wszystkie atrybuty budynku w OSM (${osmRows.length})</h3>` +
      (osmRows.length
        ? `<table>${osmRows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`
        : `<p class="note">Brak dodatkowych atrybutów w danych OSM.</p>`) +
      (res.err ? `<p class="note">Uwaga: ${escapeHtml(res.err)}</p>` : '');
    $('place-content').innerHTML = analysisHtml() + $('place-content').innerHTML.slice($('place-content').innerHTML.indexOf('<h2>Widok mapy do raportu</h2>'));
  } catch (e) {
    box.innerHTML = `<h2>Sprawdzanie budynku</h2><p class="note">Błąd: ${escapeHtml(e.message)}</p>`;
  }
}

function nearestBuilding(pt) {
  if (!A?.blds?.length) return null;
  return A.blds.slice().sort((a, b) =>
    Math.min(...a.ring.map(p => dist(pt, p))) - Math.min(...b.ring.map(p => dist(pt, p))))[0];
}

const T = d => d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
const RN = { motorway: 'autostrada', trunk: 'droga ekspresowa', primary: 'droga główna', secondary: 'droga drugorzędna',
  tertiary: 'droga zbiorcza', residential: 'ulica osiedlowa', service: 'droga dojazdowa', living_street: 'strefa zamieszkania',
  footway: 'chodnik', cycleway: 'droga rowerowa', pedestrian: 'ulica piesza' };
function trafficScore(r) {
  const w = { motorway: 5, trunk: 5, primary: 4, secondary: 3, tertiary: 2 };
  let s = 0;
  for (const [k, v] of Object.entries(r)) if (w[k]) {
    const f = v.d < 30 ? 1 : v.d < 80 ? 0.6 : v.d < 150 ? 0.3 : 0.1;
    s = Math.max(s, w[k] * f);
  }
  return s >= 3 ? 'wysokie (ruchliwa droga w pobliżu)' : s >= 1.5 ? 'umiarkowane' : 'niskie';
}
function analysisHtml() {
  const p = A.parcel, m = A.mine;
  const sunMar = A.sun?.[1];
  const tiles = [
    ['Działka', p ? escapeHtml(p.nr) : '-',
      p ? `obr. ${escapeHtml(p.obr)} · gm. ${escapeHtml(p.gm)}` : 'Nie znaleziono w ULDK'],
    ['Powierzchnia', p ? fmt(p.area) + ' m²' : '-',
      'z geometrii ewidencyjnej ULDK'],
    ['Najbliższy budynek', m ? fmt(m.h) + ' m' : '-',
      m ? `${escapeHtml(m.t.building || 'budynek')}${m.t['building:levels'] ? ' · kond. ' + escapeHtml(m.t['building:levels']) : ''}` : 'brak obiektów w OSM'],
    ['Nasłonecznienie 21 marca', sunMar ? fmt(sunMar.len) + ' h' : '-',
      sunMar ? `${T(sunMar.rise)}–${T(sunMar.set)} · wschód–zachód` : 'brak danych SunCalc']
  ];
  let h = `<div class="tiles">${tiles.map(([t, v, sub]) => `
    <div class="tile"><div class="tile-top"><span class="tile-title">${t}</span><span class="tile-val">${v}</span></div>
    <span class="tile-sub">${sub}</span></div>`).join('')}</div>`;
  h += `<h2>1. Identyfikacja</h2><table>
    <tr><td>Współrzędne</td><td>${A.lat.toFixed(5)}, ${A.lon.toFixed(5)}</td></tr>`;
  h += p
    ? `<tr><td>Działka</td><td>${escapeHtml(p.nr)}, obręb ${escapeHtml(p.obr)}, gm. ${escapeHtml(p.gm)}, pow. ${escapeHtml(p.pow)}, woj. ${escapeHtml(p.woj)}</td></tr>
       <tr><td>Identyfikator</td><td>${escapeHtml(p.id)}</td></tr>
       <tr><td>Powierzchnia (z geometrii)</td><td>${fmt(p.area)} m²</td></tr>`
    : `<tr><td>Działka</td><td>Nie znaleziono w ULDK. Kliknij bliżej środka działki.</td></tr>`;
  if (m) h += `<tr><td>Najbliższy budynek</td><td>${escapeHtml(m.t.building || 'budynek')}, ok. ${m.h} m wys.${m.t['building:levels'] ? ', kond. ' + m.t['building:levels'] : ' (wysokość szacowana)'}, pow. zabudowy ok. ${fmt(area(m.ring))} m²</td></tr>`;
  if (p && m) h += `<tr><td>Intensywność zabudowy (szac.)</td><td>${fmt(area(m.ring) / p.area * 100)}% działki</td></tr>`;
  if (A.buildingCheck?.parcels?.length) {
    const bi = A.buildingCheck.info;
    h += `<tr><td>Zaznaczony budynek — działki</td><td>${A.buildingCheck.parcels
      .map(x => `nr ${escapeHtml(x.nr)}, obr. ${escapeHtml(x.obr)}`).join('; ')}</td></tr>`;
    if (bi?.id) h += `<tr><td>Zaznaczony budynek — EGiB</td><td>${escapeHtml(bi.id)}${bi.funkcja ? ' · ' + escapeHtml(bi.funkcja) : ''}</td></tr>`;
  }
  h += '</table>';

  h += `<h2>2. Plan miejscowy, wymagania i pozwolenia</h2>`;
  const plans = A.plan || [];
  if (plans.length) {
    h += `<table><tr><th>Uchwała / numer planu</th><th>Plan</th><th>Przeznaczenie i wymagania</th><th>Dokument</th></tr>`;
    plans.forEach(r => {
      const num = r.number ? escapeHtml(r.number) + (r.date ? `<br><small>${escapeHtml(r.date)}</small>` : '') : '<span class="brak">-</span>';
      const name = escapeHtml(r.name || '-') + (r.effective ? `<br><small>obowiązuje od ${escapeHtml(r.effective)}</small>` : '');
      const url = planDocUrl(r.www);
      const doc = url
        ? `<a target="_blank" rel="noopener" href="${escapeHtml(url)}">Uchwała BIP ↗</a>`
        : '<span class="brak">-</span>';
      h += `<tr><td>${num}</td><td>${name}</td><td>${escapeHtml(r.desc || r.symbol || '-')}</td><td>${doc}</td></tr>`;
    });
    h += `</table>`;
  } else {
    h += `<table>
      <tr><td>Plan miejscowy (MPZP)</td><td><span class="brak">-</span></td></tr>
      <tr><td>Powód</td><td>${A.planErr ? escapeHtml(A.planErr) : 'Brak planu w rejestrze KIMP dla tego punktu.'}</td></tr>
    </table>`;
  }
  h += `<table>
    <tr><td>Warunki zabudowy (WZ)</td><td><span class="brak">-</span></td></tr>
    <tr><td>Pozwolenie na budowę (PnB)</td><td><span class="brak">-</span></td></tr>
  </table>
  <p class="note">„-" oznacza brak bezpośrednich danych w otwartych źródłach dla tego punktu. Numer uchwały, wymagania i link do dokumentu są wyświetlane tylko wtedy, gdy usługa KIMP zwróciła je bezpośrednio.</p>`;

  h += `<h2>3. Nasłonecznienie</h2><table>
    <tr><th>Dzień</th><th>Wschód–zachód</th><th>Dzień</th><th>Wys. słońca</th><th>Cień 10 m</th></tr>`;
  A.sun.forEach(s => h += `<tr><td>${s.n}</td><td>${T(s.rise)}–${T(s.set)}</td><td>${fmt(s.len)} h</td><td>${fmt(s.alt)}°</td><td>${fmt(s.shadow * 10)} m</td></tr>`);
  h += `</table><p class="note">WT: pomieszczenia mieszkalne powinny mieć min. 3 h nasłonecznienia 21 marca. Poniżej cienie sąsiednich budynków.</p>`;

  h += `<h2>4. Ruch i drogi</h2><table><tr><th>Typ</th><th>Najbliższa</th><th>Odległość</th></tr>`;
  Object.entries(A.roads).sort((a, b) => a[1].d - b[1].d).slice(0, 7)
    .forEach(([k, v]) => h += `<tr><td>${RN[k] || k}</td><td>${escapeHtml(v.name || '—')}</td><td>${fmt(v.d)} m</td></tr>`);
  h += `</table><p>Oddziaływanie ruchu: <b>${trafficScore(A.roads)}</b>${A.industrial ? '; w promieniu 300 m tereny przemysłowe/kolejowe.' : '.'}</p>
    <p class="note">Wskaźnik z klasy dróg i odległości, nie pomiar natężenia ruchu.</p>`;

  h += `<h2>5. Otoczenie i dostępność usług</h2><table>`;
  Object.entries(A.cat).forEach(([k, v]) => h += `<tr><td>${k}</td><td>${v}</td></tr>`);
  h += `</table><p class="note">Promienie: sklepy, parki, przystanki 500 m; szkoły, zdrowie, kolej 800 m. Źródło: OSM, dane mogą być niepełne.</p>`;

  h += `<h2>6. Uzbrojenie działki</h2><table>
    <tr><th>Media</th><th>Najbliższy obiekt</th><th>Liczba w promieniu 300 m</th></tr>`;
  Object.entries(A.utilities?.summary || {}).forEach(([k, v]) => {
    h += `<tr><td>${UTIL[k].label}</td><td>${isFinite(v.d) ? fmt(v.d) + ' m' : '<span class="brak">-</span>'}</td><td>${v.n || '<span class="brak">-</span>'}</td></tr>`;
  });
  const roadD = Math.min(...Object.values(A.roads || {}).map(r => r.d));
  h += `<tr><td>Droga dojazdowa</td><td>${isFinite(roadD) ? fmt(roadD) + ' m' : '<span class="brak">-</span>'}</td><td><span class="brak">-</span></td></tr>`;
  h += `</table><p class="note">Uzbrojenie według otwartych danych OSM (Overpass) w promieniu 300 m od punktu analizy.
    Brak obiektu w danych nie oznacza braku przyłącza — sprawdź w starostwie lub u dostawcy mediów.</p>`;

  h += `<h2>7. Dane społeczne</h2>`;
  const s = A.social;
  if (s) {
    h += `<table>
      <tr><td>Jednostka (gmina)</td><td>${escapeHtml(s.unit)}</td></tr>
      <tr><td>Ludność (${s.pop?.year || '—'})</td><td>${s.pop ? fmt(s.pop.val, 0) : '<span class="brak">-</span>'}</td></tr>
      <tr><td>Gęstość zaludnienia (${s.dens?.year || '—'})</td><td>${s.dens ? fmt(s.dens.val) + ' os./km²' : '<span class="brak">-</span>'}</td></tr>
    </table><p class="note">Źródło: GUS Bank Danych Lokalnych (bdl.stat.gov.pl), zmienne 72305 (ludność) i 60559 (os./km²). Dane dla gminy dopasowanej przez ULDK: ${p ? escapeHtml(p.gm) : '—'}.</p>`;
  } else {
    h += `<table>
      <tr><td>Ludność i gęstość</td><td><span class="brak">-</span></td></tr>
      <tr><td>Powód</td><td>${A.socialErr ? escapeHtml(A.socialErr) : 'Brak dopasowania gminy w BDL.'}</td></tr>
    </table>`;
  }
  return h;
}
/* Single source of truth for the shading settings used on the map and in PDF. */
function shadeSettings() {
  const si = +($('shadow-day')?.value || 0);
  const hr = +($('shadow-hour')?.value || 12);
  const day = $('shadow-day')?.selectedOptions?.[0]?.textContent || A?.sun?.[si]?.n || '—';
  const time = String(hr).padStart(2, '0') + ':00';
  return { si, hr, day, time,
           text: shadeOn ? `włączone — ${day}, godz. ${time}` : 'wyłączone' };
}
function updateShadowButton() {
  const b = $('btn-shadow');
  if (!b) return;
  b.classList.toggle('active', shadeOn);
  b.title = shadeOn ? 'Wyłącz cienie budynków' : 'Włącz cienie budynków';
}
function drawShade() {
  shadeLayer.clearLayers();
  if (!A || !shadeOn || !$('shadow-day')) return;
  const { si, hr, time } = shadeSettings();
  $('shadow-label').textContent = time;
  const d = [new Date(new Date().getFullYear(), 11, 21, hr),
             new Date(new Date().getFullYear(), 2, 21, hr),
             new Date(new Date().getFullYear(), 5, 21, hr)][si];
  const p = SunCalc.getPosition(d, A.lat, A.lon);
  if (p.altitude <= 0.02) return;
  const az = p.azimuth + Math.PI;
  (A.blds || []).forEach(b => {
    const len = Math.min(b.h / Math.tan(p.altitude), 150);
    const dLat = len * Math.cos(az + Math.PI) / 111320;
    const dLon = len * Math.sin(az + Math.PI) / (111320 * Math.cos(A.lat * Math.PI / 180));
    const r2 = b.ring.map(([a, o]) => [a + dLat, o + dLon]);
    for (let i = 0; i < b.ring.length - 1; i++)
      L.polygon([b.ring[i], b.ring[i + 1], r2[i + 1], r2[i]],
        { stroke: false, fillColor: '#000', fillOpacity: 0.28, interactive: false }).addTo(shadeLayer);
  });
}
/* ---------------------------------------------------------- site plan / print screen */
/* Renders a real map image (OSM tiles + analysed vectors) at an exact paper
   scale. The canvas is sized from the PDF page width, so 1:500 / 1:1000 is
   the scale on A4, not just a zoom level. */
const TILE = 256, PLAN_DPI = 170, PLAN_W = 190, PLAN_H = 160;
const sitePlanCache = new Map();
function llToWorld(la, lo, z) {
  const s = TILE * Math.pow(2, z), sin = Math.sin(la * Math.PI / 180);
  return { x: (lo + 180) / 360 * s,
           y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}
function ringCenter(ring) {
  if (!ring || !ring.length) return null;
  return [ring.reduce((s, r) => s + r[0], 0) / ring.length,
          ring.reduce((s, r) => s + r[1], 0) / ring.length];
}
async function renderSitePlan(a, scale, radiusM, paper = {}, withShade = false) {
  const wMm = paper.w || PLAN_W, hMm = paper.h || PLAN_H;
  const sh = withShade ? shadeSettings() : null;
  const key = [a.lat.toFixed(6), a.lon.toFixed(6), scale, radiusM, wMm, hMm, a.parcel?.id || '',
               a.utilities?.features?.length || 0, sh ? `shade-${sh.si}-${sh.hr}` : ''].join('|');
  if (sitePlanCache.has(key)) return sitePlanCache.get(key);

  const mmPx = 25.4 / PLAN_DPI;
  const W = Math.round(wMm / mmPx), H = Math.round(hMm / mmPx);
  const mPx = scale * mmPx / 1000;                 // metres per canvas pixel
  const centre = ringCenter(a.parcel?.ring) || [a.lat, a.lon];
  const cos = Math.cos(centre[0] * Math.PI / 180);
  let z = Math.ceil(Math.log2(156543.03392804097 * cos / mPx));
  z = Math.max(0, Math.min(19, z));                // standard OSM tiles end at z19
  const nativeMpp = 156543.03392804097 * cos / Math.pow(2, z);
  const c = llToWorld(centre[0], centre[1], z);
  const srcW = W * mPx / nativeMpp, srcH = H * mPx / nativeMpp;
  const sx = c.x - srcW / 2, sy = c.y - srcH / 2, k = W / srcW;
  const xy = (la, lo) => { const p = llToWorld(la, lo, z); return [(p.x - sx) * k, (p.y - sy) * k]; };

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#eef1ec';
  ctx.fillRect(0, 0, W, H);

  let tilesOk = 0, tilesFail = 0, tx0 = Math.floor(sx / TILE);
  const tasks = [];
  for (let tx = tx0; tx <= Math.floor((sx + srcW) / TILE); tx++) {
    for (let ty = Math.floor(sy / TILE); ty <= Math.floor((sy + srcH) / TILE); ty++) {
      tasks.push((async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          // Standard OSM tiles: open CORS, no key, works directly in the browser.
          const r = await fetch(`https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`,
            { signal: ctrl.signal });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const bmp = await createImageBitmap(await r.blob());
          ctx.drawImage(bmp, (tx * TILE - sx) * k, (ty * TILE - sy) * k, TILE * k, TILE * k);
          if (bmp.close) bmp.close();
          tilesOk++;
        } catch (e) { tilesFail++; }
        finally { clearTimeout(timer); }
      })());
    }
  }
  await Promise.all(tasks);

  // distance rings up to 300 m (clipped naturally by the figure)
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(26,115,232,.55)';
  ctx.fillStyle = '#1557b0';
  ctx.font = `${Math.round(11 * PLAN_DPI / 96)}px Segoe UI, sans-serif`;
  [50, 100, 200, 300].forEach(r => {
    const px = r / mPx;
    if (px > Math.max(W, H)) return;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, px, 0, 2 * Math.PI); ctx.stroke();
    if (px < W - 40 && px < H - 16) ctx.fillText(r + ' m', W / 2 + px + 4, H / 2 - 4);
  });
  ctx.restore();

  const path = ring => {
    const p = ring.map(([la, lo]) => xy(la, lo));
    if (p.length < 3) return false;
    ctx.beginPath();
    p.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    return true;
  };
  (a.blds || []).forEach(b => {
    if (!path(b.ring || [])) return;
    ctx.fillStyle = 'rgba(110,110,110,.30)'; ctx.fill();
    ctx.strokeStyle = 'rgba(60,60,60,.55)'; ctx.lineWidth = 0.8; ctx.stroke();
  });
  /* Same shadow geometry as the live map, painted into the PDF figure. */
  if (sh) {
    const d = [new Date(new Date().getFullYear(), 11, 21, sh.hr),
               new Date(new Date().getFullYear(), 2, 21, sh.hr),
               new Date(new Date().getFullYear(), 5, 21, sh.hr)][sh.si];
    const sunPos = SunCalc.getPosition(d, a.lat, a.lon);
    if (sunPos.altitude > 0.02) {
      const az = sunPos.azimuth + Math.PI;
      (a.blds || []).forEach(b => {
        const len = Math.min(b.h / Math.tan(sunPos.altitude), 150);
        const dLat = len * Math.cos(az + Math.PI) / 111320;
        const dLon = len * Math.sin(az + Math.PI) / (111320 * Math.cos(a.lat * Math.PI / 180));
        const r2 = b.ring.map(([la, lo]) => [la + dLat, lo + dLon]);
        for (let i = 0; i < b.ring.length - 1; i++) {
          if (!path([b.ring[i], b.ring[i + 1], r2[i + 1], r2[i]])) continue;
          ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fill();
        }
      });
    }
    ctx.font = `bold ${Math.round(10 * PLAN_DPI / 96)}px Segoe UI, sans-serif`;
    ctx.fillStyle = '#202124';
    ctx.fillText(`Cienie: ${sh.day}, ${sh.time}`, 10, 18);
  }
  if (a.parcel?.ring?.length >= 3 && path(a.parcel.ring)) {
    ctx.fillStyle = 'rgba(26,115,232,.25)'; ctx.fill();
    ctx.strokeStyle = '#1257c0'; ctx.lineWidth = 2.5; ctx.stroke();
  }
  /* Utility networks shown on the map are also painted into the PDF figure. */
  (a.utilities?.features || []).forEach(f => {
    const col = UTIL[f.cat]?.color || '#777';
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.2;
    ctx.setLineDash([5, 3]);
    if (f.line?.length > 1) {
      ctx.beginPath();
      f.line.forEach(([la, lo], i) => { const [x, y] = xy(la, lo); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    } else if (f.point) {
      const [x, y] = xy(f.point[0], f.point[1]);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();
    }
    ctx.restore();
  });
  const [mx, my] = xy(a.lat, a.lon);
  ctx.beginPath(); ctx.arc(mx, my, 6, 0, 2 * Math.PI);
  ctx.fillStyle = '#ea4335'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(mx - 12, my); ctx.lineTo(mx + 12, my);
  ctx.moveTo(mx, my - 12); ctx.lineTo(mx, my + 12);
  ctx.strokeStyle = '#ea4335'; ctx.lineWidth = 1; ctx.stroke();

  // north arrow
  const nx = W - 34, ny = 40;
  ctx.fillStyle = '#202124';
  ctx.beginPath();
  ctx.moveTo(nx, ny - 16); ctx.lineTo(nx - 8, ny + 12);
  ctx.lineTo(nx, ny + 6); ctx.lineTo(nx + 8, ny + 12);
  ctx.closePath(); ctx.fill();
  ctx.font = `bold ${Math.round(12 * PLAN_DPI / 96)}px Segoe UI, sans-serif`;
  ctx.textAlign = 'center'; ctx.fillText('N', nx, ny - 21); ctx.textAlign = 'left';

  // graphic scale bar
  const groundW = W * mPx;
  const barM = [10, 20, 25, 50, 100, 200, 250, 500].filter(v => v <= groundW * 0.28).pop() || 10;
  const barPx = barM / mPx, seg = barPx / 4, bx = 16, by = H - 20;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#fff' : '#202124';
    ctx.fillRect(bx + i * seg, by - 6, seg, 7);
  }
  ctx.strokeStyle = '#202124'; ctx.lineWidth = 1; ctx.strokeRect(bx, by - 6, barPx, 7);
  ctx.font = `${Math.round(10 * PLAN_DPI / 96)}px Segoe UI, sans-serif`;
  ctx.fillStyle = '#202124'; ctx.fillText(barM + ' m', bx, by - 10);

  ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, W, H);
  const result = { dataUrl: cv.toDataURL('image/png'), tilesOk, tilesFail,
                   visibleRadius: Math.floor(Math.min(W, H) / 2 * mPx) };
  sitePlanCache.set(key, result);
  if (sitePlanCache.size > 8) sitePlanCache.delete(sitePlanCache.keys().next().value);
  return result;
}

function objectListHtml(radiusM) {
  const items = (A.pois || []).filter(x => x.d <= radiusM);
  let h = `<h2>8. Obiekty w zasięgu ${radiusM} m</h2>`;
  if (!items.length) return h + `<p class="note">Brak nazwanych obiektów OSM w promieniu ${radiusM} m od punktu analizy.</p>`;
  h += `<table><tr><th>Obiekt</th><th>Typ</th><th>Odległość</th></tr>` +
    items.slice(0, 60).map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.kind)}</td><td>${fmt(x.d)} m</td></tr>`).join('') +
    `</table>`;
  if (items.length > 60) h += `<p class="note">Pokazano 60 z ${items.length} obiektów (dla czytelności raportu).</p>`;
  h += `<p class="note">Źródło: OpenStreetMap (Overpass). Lista obiektów nazwanych w ustalonym promieniu ${radiusM} m od punktu analizy.</p>`;
  return h;
}

/* ------------------------------------------------------- browser PDF generation */
/* The web build creates the PDF locally with jsPDF and downloads it directly.
   This avoids the browser print dialog, which is unreliable in an iframe
   (Google Sites) and can block the page. A font with Polish glyphs is embedded
   so ą/ć/ę/ł/ń/ś/ź/ż survive in the saved file. */
const PDF_MM = { w: 210, h: 297, m: 12, cw: 186 };
const PDF_INK = [31, 36, 33], PDF_GREEN = [23, 92, 70], PDF_MUTE = [105, 113, 106];
const PDF_LINE = [223, 229, 222], PDF_NOTE = [249, 246, 236];
let pdfY = PDF_MM.m;

function pdfTextOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}
function pdfNeed(doc, h) {
  if (pdfY + h > PDF_MM.h - PDF_MM.m) { doc.addPage(); pdfY = PDF_MM.m; }
}
function pdfDrawText(doc, text, x, y, w, size, style, color, lineH) {
  doc.setFont('DejaVu', style || 'normal');
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
  const lines = Array.isArray(text) ? text : doc.splitTextToSize(String(text), w);
  lines.forEach((ln, i) => doc.text(ln, x, y + i * lineH + lineH - size * 0.18));
  return lines.length * lineH;
}
function pdfH1(doc, text) {
  pdfNeed(doc, 13);
  pdfDrawText(doc, text, PDF_MM.m, pdfY, PDF_MM.cw, 18, 'bold', PDF_GREEN, 9);
  pdfY += 9;
  doc.setDrawColor(PDF_GREEN[0], PDF_GREEN[1], PDF_GREEN[2]);
  doc.setLineWidth(0.6);
  doc.line(PDF_MM.m, pdfY, PDF_MM.m + PDF_MM.cw, pdfY);
  pdfY += 4;
}
function pdfH2(doc, text) {
  pdfNeed(doc, 9);
  pdfDrawText(doc, text, PDF_MM.m, pdfY, PDF_MM.cw, 11, 'bold', PDF_GREEN, 5);
  pdfY += 5;
  doc.setDrawColor(PDF_LINE[0], PDF_LINE[1], PDF_LINE[2]);
  doc.setLineWidth(0.3);
  doc.line(PDF_MM.m, pdfY, PDF_MM.m + PDF_MM.cw, pdfY);
  pdfY += 4;
}
function pdfParagraph(doc, el) {
  const text = pdfTextOf(el);
  if (!text) return;
  if (el.classList.contains('note')) {
    doc.setFont('DejaVu', 'normal');
    doc.setFontSize(8);
    const lines = doc.splitTextToSize(text, PDF_MM.cw - 7);
    const h = lines.length * 3.4 + 5;
    pdfNeed(doc, h);
    doc.setFillColor(PDF_NOTE[0], PDF_NOTE[1], PDF_NOTE[2]);
    doc.setDrawColor(222, 211, 173);
    doc.roundedRect(PDF_MM.m, pdfY, PDF_MM.cw, h, 2, 2, 'FD');
    pdfDrawText(doc, lines, PDF_MM.m + 3.5, pdfY + 2.5, PDF_MM.cw - 7, 8, 'normal', PDF_MUTE, 3.4);
    pdfY += h + 3;
    return;
  }
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(text, PDF_MM.cw);
  const h = lines.length * 4 + 3;
  pdfNeed(doc, h);
  pdfDrawText(doc, lines, PDF_MM.m, pdfY, PDF_MM.cw, 9, 'normal', PDF_INK, 4);
  pdfY += h;
}
function pdfFigure(doc, fig) {
  const img = fig.querySelector('img');
  if (!img || !/^data:image\//.test(img.src || '')) return;
  const cap = pdfTextOf(fig.querySelector('figcaption'));
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(8);
  const capLines = cap ? doc.splitTextToSize(cap, PDF_MM.cw) : [];
  const imgH = PDF_MM.cw * 160 / 190;
  const h = imgH + 2 + capLines.length * 3.3 + 4;
  pdfNeed(doc, h);
  doc.addImage(img.src, 'PNG', PDF_MM.m, pdfY, PDF_MM.cw, imgH);
  pdfY += imgH + 2;
  if (capLines.length) {
    pdfDrawText(doc, capLines, PDF_MM.m, pdfY, PDF_MM.cw, 8, 'normal', PDF_MUTE, 3.3);
    pdfY += capLines.length * 3.3;
  }
  pdfY += 4;
}
function pdfTiles(doc, el) {
  const tiles = [...el.querySelectorAll('.tile')];
  if (!tiles.length) return;
  const cols = tiles.length >= 3 ? 2 : tiles.length;
  const gap = 3, cw = (PDF_MM.cw - gap * (cols - 1)) / cols;
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(7.5);
  const items = tiles.map(t => {
    const sub = doc.splitTextToSize(pdfTextOf(t.querySelector('.tile-sub')), cw - 6).slice(0, 2);
    return {
      title: pdfTextOf(t.querySelector('.tile-title')),
      val: pdfTextOf(t.querySelector('.tile-val')),
      sub, h: 15 + sub.length * 3.2
    };
  });
  for (let i = 0; i < items.length; i += cols) {
    const row = items.slice(i, i + cols), rh = Math.max(...row.map(x => x.h));
    pdfNeed(doc, rh + 3);
    row.forEach((it, j) => {
      const x = PDF_MM.m + j * (cw + gap);
      doc.setFillColor(250, 252, 250);
      doc.setDrawColor(PDF_LINE[0], PDF_LINE[1], PDF_LINE[2]);
      doc.roundedRect(x, pdfY, cw, rh, 2, 2, 'FD');
      pdfDrawText(doc, it.title, x + 3, pdfY + 2, cw - 6, 8, 'normal', PDF_GREEN, 4);
      pdfDrawText(doc, it.val, x + 3, pdfY + 7, cw - 6, 13, 'bold', PDF_INK, 6);
      pdfDrawText(doc, it.sub, x + 3, pdfY + rh - 2 - it.sub.length * 3.2, cw - 6, 7.5, 'normal', PDF_MUTE, 3.2);
    });
    pdfY += rh + 3;
  }
}
function pdfTable(doc, table) {
  const rows = [...table.querySelectorAll('tr')];
  if (!rows.length) return;
  const cols = Math.max(...rows.map(r => r.children.length));
  let widths;
  if (cols === 2) {
    const a = Math.min(58, PDF_MM.cw * 0.34);
    widths = [a, PDF_MM.cw - a];
  } else if (cols === 3) {
    widths = [PDF_MM.cw * 0.26, PDF_MM.cw * 0.37, PDF_MM.cw * 0.37];
  } else {
    widths = Array(cols).fill(PDF_MM.cw / cols);
  }
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(8);
  const prep = rows.map(r => Array.from({ length: cols }, (_, ci) => {
    const cell = r.children[ci];
    return doc.splitTextToSize(pdfTextOf(cell) || '-', widths[ci] - 3);
  }));
  const hasHead = !!rows[0].querySelector('th');
  const rowH = cells => Math.max(1, ...cells.map(l => l.length)) * 3.4 + 3;
  const drawRow = (cells, isHead) => {
    const h = rowH(cells);
    if (isHead) doc.setFillColor(238, 244, 238);
    else doc.setFillColor(255, 255, 255);
    doc.setDrawColor(PDF_LINE[0], PDF_LINE[1], PDF_LINE[2]);
    doc.setLineWidth(0.15);
    let x = PDF_MM.m;
    cells.forEach((lines, ci) => {
      doc.rect(x, pdfY, widths[ci], h, 'FD');
      pdfDrawText(doc, lines, x + 1.5, pdfY + 1.5, widths[ci] - 3, 8,
        isHead ? 'bold' : 'normal', isHead ? PDF_GREEN : PDF_INK, 3.4);
      x += widths[ci];
    });
    pdfY += h;
  };
  if (hasHead) drawRow(prep[0], true);
  prep.slice(hasHead ? 1 : 0).forEach(cells => {
    const need = rowH(cells) + (hasHead ? rowH(prep[0]) : 0);
    const before = doc.getNumberOfPages();
    pdfNeed(doc, need);
    if (hasHead && doc.getNumberOfPages() !== before) drawRow(prep[0], true);
    drawRow(cells, false);
  });
  pdfY += 4;
}
function downloadPdf() {
  const JsPDF = window.jspdf?.jsPDF;
  if (!JsPDF) { toast('Nie wczytano biblioteki PDF.'); return false; }
  try {
    const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const font = String(window.ANALIZA_PDF_FONT || '');
    if (!font) throw new Error('brak fontu z polskimi znakami');
    doc.addFileToVFS('DejaVuSans.ttf', font.includes(',') ? font.split(',')[1] : font);
    doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
    doc.addFont('DejaVuSans.ttf', 'DejaVu', 'bold');
    doc.setFont('DejaVu', 'normal');
    pdfY = PDF_MM.m;
    const report = $('report');
    [...report.children].forEach(node => {
      const tag = node.tagName.toLowerCase();
      if (tag === 'h1') pdfH1(doc, pdfTextOf(node));
      else if (tag === 'h2') pdfH2(doc, pdfTextOf(node));
      else if (tag === 'p') pdfParagraph(doc, node);
      else if (tag === 'figure') pdfFigure(doc, node);
      else if (tag === 'table') pdfTable(doc, node);
      else if (tag === 'div' && node.classList.contains('tiles')) pdfTiles(doc, node);
      else if (pdfTextOf(node)) pdfParagraph(doc, node);
    });
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('DejaVu', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(140, 148, 141);
      doc.text('Analiza terenu · ' + new Date().toLocaleDateString('pl-PL'), PDF_MM.m, PDF_MM.h - 6);
      doc.text('Strona ' + p + ' / ' + pages, PDF_MM.w - PDF_MM.m, PDF_MM.h - 6, { align: 'right' });
    }
    doc.save('Analiza_terenu_' + new Date().toISOString().slice(0, 10) + '.pdf');
    return true;
  } catch (e) {
    toast('Błąd tworzenia PDF: ' + e.message);
    return false;
  }
}

async function makePdf() {
  if (!A) return;
  const btn = $('pdf-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Przygotowuję widok mapy…'; }
  let figures = '';
  try {
    const scale = +(document.querySelector('input[name=plan-scale]:checked')?.value || 1000);
    const radiusM = +($('plan-radius')?.value || 300);
    const plan = await renderSitePlan(A, scale, radiusM);
    const fits = radiusM <= plan.visibleRadius + 1;
    const base = 'Zaznaczono działkę, najbliższe budynki, uzbrojenie (media) i punkt analizy. ' +
      (plan.tilesOk ? 'Podkład: OpenStreetMap.' : 'Podkład niedostępny — pokazano same wektory.');
    figures = `<h2>Widok sytuacyjny — skala 1:${scale}</h2>
      <figure class="site-plan"><img src="${plan.dataUrl}" alt="Widok sytuacyjny działki">
      <figcaption>Punkt: ${A.lat.toFixed(5)}, ${A.lon.toFixed(5)} · skala 1:${scale} na papierze A4 · promień analizy do ${radiusM} m. ${base}${fits ? '' :
        ` Widok obejmuje ok. ${fmt(plan.visibleRadius)} m wokół punktu — pełny zasięg ${radiusM} m pokazuje widok przeglądowy poniżej.`}</figcaption></figure>`;
    if (!fits) {
      const ovScale = Math.round(2 * radiusM * 1000 / PLAN_W);
      const ov = await renderSitePlan(A, ovScale, radiusM, { w: PLAN_W, h: PLAN_W });
      figures += `<h2>Zasięg analizy do ${radiusM} m — widok przeglądowy</h2>
        <figure class="site-plan"><img src="${ov.dataUrl}" alt="Widok obszaru do ${radiusM} m">
        <figcaption>Promień ${radiusM} m wokół punktu analizy · skala ok. 1:${ovScale} · działka, budynki i uzbrojenie według OSM.</figcaption></figure>`;
    }
    const sh = shadeSettings();
    const shaded = await renderSitePlan(A, scale, radiusM, {}, true);
    figures += `<h2>Widok z cieniem budynków — skala 1:${scale}</h2>
      <figure class="site-plan"><img src="${shaded.dataUrl}" alt="Widok działki z cieniami budynków">
      <figcaption>Cienie: ${sh.day}, godz. ${sh.time}. Widok dodawany do raportu niezależnie od przełącznika cieni na mapie (na mapie: ${shadeOn ? 'włączone' : 'wyłączone'}). Skala 1:${scale} na papierze A4.</figcaption></figure>`;
    const dt = new Date().toLocaleDateString('pl-PL');
    $('report').innerHTML = `<h1>Raport analizy terenu</h1>
      <p class="note">Wygenerowano ${dt}. Źródła: GUGiK (ULDK, EGiB, MPZP), GUS BDL, OpenStreetMap, SunCalc.
      Cienie budynków: ${shadeSettings().text}.
      Raport informacyjny; nie zastępuje wypisu z MPZP ani decyzji organu.</p>` + figures + analysisHtml() + objectListHtml(radiusM);
    await Promise.all([...$('report').querySelectorAll('img')].map(img => new Promise(res => {
      if (img.complete) return res();
      img.onload = img.onerror = res;
    })));
  } catch (e) {
    figures = `<p class="note">Nie udało się przygotować widoku mapy: ${escapeHtml(e.message)}</p>` + figures;
    $('report').innerHTML = `<h1>Raport analizy terenu</h1>` + figures + analysisHtml() +
      objectListHtml(+($('plan-radius')?.value || 300));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄 Generuj raport PDF'; }
  }
  if (window.desktop?.savePdf) {
    window.desktop.savePdf().then(p => toast(p ? 'Zapisano: ' + p : 'Anulowano zapis'))
      .catch(e => toast('Błąd zapisu PDF: ' + e.message));
  } else if (downloadPdf()) {
    toast('Pobrano raport PDF. Plik zapisano w folderze pobierania przeglądarki.');
  }
}

/* --------------------------------------------------------------- UI wiring */
$('pdf-btn').onclick = () => {
  if (!A) { toast('Najpierw wybierz działkę na mapie lub w wyszukiwarce.'); return; }
  makePdf();
};
document.querySelectorAll('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

$('search').addEventListener('input', () => {
  const q = $('search').value.trim();
  clearTimeout(suggestTimer);
  if (q.length < 3) { hideSuggest(); return; }
  suggestTimer = setTimeout(async () => {
    try { suggestList = await suggestPlaces(q); suggestIndex = -1; renderSuggest(); }
    catch (e) { $('suggest').innerHTML = `<div class="suggest-empty">Błąd wyszukiwarki: ${escapeHtml(e.message)}</div>`; $('suggest').hidden = false; }
  }, 280);
});
$('search').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' && suggestList.length) { e.preventDefault(); suggestIndex = (suggestIndex + 1) % suggestList.length; renderSuggest(); }
  else if (e.key === 'ArrowUp' && suggestList.length) { e.preventDefault(); suggestIndex = (suggestIndex - 1 + suggestList.length) % suggestList.length; renderSuggest(); }
  else if (e.key === 'Enter') {
    if (suggestIndex >= 0) choosePlace(suggestIndex);
    else if ($('search').value.trim()) geocodeOne($('search').value.trim()).then(g => {
      if (!g) { toast('Nie znaleziono adresu w Polsce.'); return; }
      suggestList = [g];
      choosePlace(0);
    }).catch(e => toast('Błąd wyszukiwarki: ' + e.message));
  } else if (e.key === 'Escape') hideSuggest();
});
$('suggest').addEventListener('click', e => {
  const item = e.target.closest('.suggest-item');
  if (item) choosePlace(+item.dataset.i);
});
$('search-clear').onclick = () => { $('search').value = ''; hideSuggest(); $('search').focus(); };
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) hideSuggest();
});

/* Base-map chooser lives in a small popover opened by the 🗺 icon on the map. */
const baseBtn = $('btn-basemap'), basePop = $('basemap-popover');
function showBasePop(open) {
  basePop.hidden = !open;
  baseBtn.classList.toggle('active', open);
  baseBtn.setAttribute('aria-expanded', String(open));
}
baseBtn.onclick = e => { e.stopPropagation(); showBasePop(basePop.hidden); };
basePop.onclick = e => e.stopPropagation();
document.addEventListener('click', () => { if (!basePop.hidden) showBasePop(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !basePop.hidden) showBasePop(false); });
document.querySelectorAll('input[name=base]').forEach(r => r.onchange = () => {
  Object.values(baseLayers).forEach(l => map.removeLayer(l));
  baseLayers[r.value].addTo(map);
  baseBtn.title = 'Mapa podkładowa: ' + r.parentElement.textContent.trim();
  showBasePop(false);
});
$('ov-egib').onchange = e => e.target.checked ? map.addLayer(overlays.egib) : map.removeLayer(overlays.egib);
$('ov-mpzp').onchange = e => e.target.checked ? map.addLayer(overlays.mpzp) : map.removeLayer(overlays.mpzp);
$('ov-util').onchange = e => {
  utilOn = e.target.checked;
  if (utilOn) drawUtilities(A?.utilities?.features); else utilityLayer.clearLayers();
};
$('mpzp-opacity').oninput = e => overlays.mpzp.setOpacity(+e.target.value / 100);
$('shadow-day').onchange = $('shadow-hour').oninput = drawShade;
$('shadow-on').onchange = e => { shadeOn = e.target.checked; updateShadowButton(); drawShade(); };
$('btn-shadow').onclick = () => {
  shadeOn = !shadeOn;
  if ($('shadow-on')) $('shadow-on').checked = shadeOn;
  updateShadowButton();
  drawShade();
  toast(shadeOn ? 'Cienie budynków włączone' : 'Cienie budynków wyłączone');
};
updateShadowButton();

let buildingPickMode = false;
function setBuildingPick(on) {
  buildingPickMode = on;
  $('btn-building').classList.toggle('active', on);
  $('btn-building').title = on ? 'Anuluj wybór budynku' : 'Zaznacz budynek i sprawdź działki';
  if (on) toast('Kliknij budynek na mapie, aby sprawdzić jego działki.');
}
$('btn-building').onclick = () => setBuildingPick(!buildingPickMode);

$('btn-locate').onclick = () => map.locate({ setView: true, maxZoom: 16 });
map.on('locationfound', e => toast(`Twoja lokalizacja: ±${fmt(e.accuracy)} m`));
map.on('locationerror', () => toast('Nie uzyskano lokalizacji (sprawdź uprawnienia).'));
$('btn-reset').onclick = () => map.fitBounds(POLAND, { animate: false });

map.on('click', e => {
  /* DWG export is triggered only by Shift+click. A normal click must still
     select a building or start the parcel analysis while export mode is armed. */
  if (window.DwgExport?.isSelecting() && window.DwgExport?.isExportClick(e)) return;
  if (buildingPickMode) {
    if (!A?.blds?.length) { toast('Najpierw przeanalizuj działkę, aby zobaczyć budynki.'); return; }
    const pt = [e.latlng.lat, e.latlng.lng];
    const b = nearestBuilding(pt);
    if (!b || Math.min(...b.ring.map(p => dist(pt, p))) > 60) {
      toast('Kliknij bliżej budynku lub wyłącz tryb wyboru (▣).');
      return;
    }
    selectBuilding(b);
    setBuildingPick(false);
    return;
  }
  if (map.getZoom() < 15) {
    map.setView(e.latlng, 17);
    toast('Przybliżyłem mapę — kliknij ponownie, aby przeanalizować działkę.');
    return;
  }
  setMarker(e.latlng.lat, e.latlng.lng);
  switchTab('place');
  analyze(e.latlng.lat, e.latlng.lng);
});
const updateStatus = () => {
  $('status-zoom').textContent = 'z' + map.getZoom();
};
map.on('mousemove', e => $('status-coords').textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`);
map.on('zoomend', updateStatus);
updateStatus();

window.DwgExport?.init({
  map,
  toast,
  getCenter: () => A ? [A.lat, A.lon]
    : (placeMarker ? [placeMarker.getLatLng().lat, placeMarker.getLatLng().lng] : null)
});

toast('Gotowe. Wpisz adres lub kliknij mapę, aby rozpocząć analizę.');
