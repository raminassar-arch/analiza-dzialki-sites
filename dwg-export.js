/* Analiza terenu — eksport wybranego obszaru 1/2/4/6 km² do prawdziwego DWG.
   Dane: GUGiK ULDK (działki), OpenStreetMap Overpass (budynki, drogi, zbrojenie,
   obiekty, użytkowanie, miejsca parkingowe). Geometria w PUWG 1992 (EPSG:2180),
   jednostki: metry. Wszystkie warstwy CAD mają prefiks BIMRN_AR_. */

(function () {
  'use strict';

  const AREA_OPTIONS = [1, 2, 4, 6];
  const DEFAULT_AREA = 1;
  const SAMPLE_M = 100;
  const CONCURRENCY = 10;
  const LAYER_PREFIX = 'BIMRN_AR_';
  const OVERPASS_HOSTS = [
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.osm.ch/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  let opts = null;
  let selecting = false;
  let preview = null;
  let busy = false;

  /* lineWeight = setna część milimetra (50 → 0,50 mm); encja dziedziczy ją przez ByLayer. */
  const LAYER_DEFS = [
    { key: 'GRANICA',            color: 5,  lineWeight: 50, desc: 'Granica eksportowanego obszaru (kwadrat)' },
    { key: 'DZIALKI',            color: 3,  lineWeight: 25, desc: 'Działki ewidencyjne (GUGiK ULDK)' },
    { key: 'ZAGOSPODAROWANIE',   color: 82, lineWeight: 18, desc: 'Zagospodarowanie — zbiorcza warstwa działek, budynków, dróg, terenów i parkingów' },
    { key: 'BUDYNKI',            color: 1,  lineWeight: 35, desc: 'Budynki (OpenStreetMap)' },
    { key: 'DROGI',              color: 8,  lineWeight: 25, desc: 'Drogi i linie kolejowe (OpenStreetMap)' },
    { key: 'ZBROJENIE',          color: 30, lineWeight: 18, desc: 'Zbrojenie terenu — energetyka, woda, kanalizacja, gaz, ciepło, telekom (OSM)' },
    { key: 'MIEJSCA_PARKINGOWE', color: 6,  lineWeight: 18, desc: 'Miejsca parkingowe i parkingi (OpenStreetMap)' },
    { key: 'OBIEKTY',            color: 4,  lineWeight: 13, desc: 'Obiekty i punkty zainteresowania (OpenStreetMap)' },
    { key: 'UZYTKOWANIE',        color: 94, lineWeight: 13, desc: 'Użytkowanie terenu (OpenStreetMap)' },
    { key: 'INFO',               color: 7,  lineWeight: 13, desc: 'Opis źródeł i parametrów eksportu' },
    { key: 'LEGENDA',            color: 7,  lineWeight: 13, desc: 'Legenda warstw i opis zawartości rysunku' }
  ];
  const LAYERS = LAYER_DEFS.map(d => ({
    key: d.key, name: LAYER_PREFIX + d.key, color: d.color, lineWeight: d.lineWeight, desc: d.desc
  }));
  const LN = {};
  LAYERS.forEach(l => { LN[l.key] = l.name; });
  function layerName(key) { return LAYER_PREFIX + key; }

  /* ------------------------------------------------------------- helpers */
  function el(id) { return document.getElementById(id); }
  function fmt(n, d = 0) { return Number(n).toLocaleString('pl-PL', { maximumFractionDigits: d }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function setProgress(pct, stage) {
    const bar = el('dwg-bar'), track = el('dwg-track'), txt = el('dwg-pct'), st = el('dwg-stage');
    const v = clamp(Math.round(pct), 0, 100);
    if (bar) bar.style.width = v + '%';
    if (track) track.setAttribute('aria-valuenow', String(v));
    if (txt) txt.textContent = v + '%';
    if (st && stage) st.textContent = stage;
  }
  function showProgress(show) {
    const box = el('dwg-progress');
    if (box) box.hidden = !show;
    if (show) setProgress(2, 'Przygotowuję obszar…');
  }

  function normalizeArea(area) {
    const n = Number(area == null ? DEFAULT_AREA : area);
    return AREA_OPTIONS.indexOf(n) !== -1 ? n : DEFAULT_AREA;
  }
  function selectedArea() {
    return normalizeArea(el('dwg-area')?.value);
  }
  function sideMeters(area) {
    return Math.sqrt(normalizeArea(area == null ? selectedArea() : area)) * 1000;
  }
  function areaLabel(area) {
    return String(normalizeArea(area)).replace('.', ',');
  }
  function sampleStep(area) {
    const a = normalizeArea(area);
    return a >= 6 ? 150 : a >= 4 ? 125 : SAMPLE_M;
  }

  function areaBounds(lat, lon, areaKm2) {
    const area = normalizeArea(areaKm2 == null ? selectedArea() : areaKm2);
    const side = sideMeters(area);
    const dLat = (side / 2) / 111320;
    const dLon = dLat / Math.max(0.05, Math.cos(lat * Math.PI / 180));
    return {
      south: lat - dLat, north: lat + dLat,
      west: lon - dLon, east: lon + dLon,
      center: [lat, lon], area, side, sampleM: sampleStep(area)
    };
  }

  function boxFromLatLng(latlng, area) {
    const b = areaBounds(latlng.lat, latlng.lng, area);
    return L.latLngBounds([b.south, b.west], [b.north, b.east]);
  }

  function updateAreaUi() {
    const area = selectedArea();
    const side = Math.round(sideMeters(area));
    const btn = el('dwg-btn');
    if (btn) {
      btn.textContent = '📐 Eksport DWG ' + areaLabel(area) + ' km²';
      btn.title = 'Wybierz środek obszaru ' + areaLabel(area) + ' km² (' + side + ' × ' + side + ' m) i wyeksportuj do DWG';
    }
    const title = el('dwg-progress-title');
    if (title) title.textContent = 'Eksport DWG ' + areaLabel(area) + ' km²';
    if (selecting && preview && opts?.map) preview.setBounds(boxFromLatLng(opts.map.getCenter(), area));
  }

  function setSelecting(on) {
    selecting = on;
    const area = selectedArea();
    const side = Math.round(sideMeters(area));
    const btn = el('dwg-btn');
    if (btn) {
      btn.classList.toggle('active', on);
      btn.title = on ? 'Anuluj wybór obszaru (Esc)' :
        'Wybierz środek obszaru ' + areaLabel(area) + ' km² (' + side + ' × ' + side + ' m) i wyeksportuj do DWG';
    }
    if (opts?.map) opts.map.getContainer().style.cursor = on ? 'crosshair' : '';
    if (!on && preview) { preview.remove(); preview = null; }
    if (on) opts?.toast?.('Kliknij środek obszaru na mapie — zostanie wyeksportowany kwadrat ' +
      areaLabel(area) + ' km² (' + side + ' × ' + side + ' m). Esc anuluje.');
  }

  /* Fetch through the desktop IPC when available (some open-data servers do
     not send CORS headers), otherwise straight from the static web page. */
  async function getText(url, timeout = 30000) {
    if (window.desktop?.fetchUrl) return window.desktop.fetchUrl(url, timeout);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': '*/*' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } finally { clearTimeout(timer); }
  }
  async function getJson(url, timeout) { return JSON.parse(await getText(url, timeout)); }

  async function mapLimit(items, limit, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const index = i++;
        await fn(items[index], index);
      }
    });
    await Promise.all(workers);
  }

  /* --------------------------------------------------------------- WKT */
  function parseWkt(wkt) {
    if (!wkt) return null;
    const clean = wkt.replace(/^SRID=\d+;/i, '').trim();
    const type = (clean.match(/^([A-Z]+)/) || [])[1] || '';
    const rings = [];
    const re = /\(\s*([-\d.eE+,\s]+?)\s*\)/g;
    let m;
    while ((m = re.exec(clean))) {
      const nums = m[1].trim().split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n));
      const ring = [];
      for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i], nums[i + 1]]);
      if (ring.length) rings.push(ring);
    }
    return rings.length ? { type, rings } : null;
  }

  function ringCentroid(ring) {
    if (!ring?.length) return null;
    const n = ring.length;
    let x = 0, y = 0;
    for (const p of ring) { x += p[0]; y += p[1]; }
    return [x / n, y / n];
  }

  /* --------------------------------------------------------- ULDK parcels */
  async function fetchParcels(bounds, report) {
    const pts = [];
    const stepDeg = (bounds.sampleM || SAMPLE_M) / 111320;
    for (let la = bounds.south; la <= bounds.north; la += stepDeg) {
      const stepLon = stepDeg / Math.max(0.05, Math.cos(la * Math.PI / 180));
      for (let lo = bounds.west; lo <= bounds.east; lo += stepLon) {
        pts.push([la, lo]);
      }
    }
    const found = new Map();
    let done = 0;
    await mapLimit(pts, CONCURRENCY, async ([la, lo]) => {
      const url = 'https://uldk.gugik.gov.pl/?request=GetParcelByXY' +
        '&xy=' + lo.toFixed(6) + ',' + la.toFixed(6) + ',4326' +
        '&result=id,parcel,region,commune,geom_wkt&srid=2180';
      try {
        const txt = await getText(url, 25000);
        const lines = txt.trim().split(/\r?\n/).filter(Boolean);
        if (lines[0] === '0' && lines[1]) {
          const f = lines[1].split('|');
          const id = f[0];
          if (id && !found.has(id)) {
            const g = parseWkt(f[f.length - 1]);
            if (g) found.set(id, {
              id, number: f[1] || '', region: f[2] || '', commune: f[3] || '',
              geometry: g
            });
          }
        }
      } catch (_) { /* a single failed sample must not abort the export */ }
      done++;
      report(done, pts.length);
    });
    return [...found.values()];
  }

  /* ------------------------------------------------------------- Overpass */
  function overpassQuery(bounds) {
    const b = [bounds.south, bounds.west, bounds.north, bounds.east]
      .map(v => v.toFixed(6)).join(',');
    const parts = [
      `way[building](${b});`,
      `way[highway](${b});`,
      `way[railway](${b});`,
      `nwr[power](${b});`,
      `nwr[utility](${b});`,
      `way[man_made=pipeline](${b});`,
      `nwr[pipeline](${b});`,
      `nwr[amenity~"water_point|drinking_water|wastewater_plant|water_works|school|kindergarten|pharmacy|clinic|doctors|library|fuel|restaurant|cafe|bar|hospital|bank|post_office"](${b});`,
      `nwr[amenity~"parking|parking_space|parking_entrance|motorcycle_parking|bicycle_parking"](${b});`,
      `nwr[parking](${b});`,
      `way[service=parking_aisle](${b});`,
      `nwr[shop](${b});`,
      `nwr[leisure~"park|playground|garden"](${b});`,
      `nwr[landuse~"industrial|railway|residential|commercial|retail|grass|forest|farmland"](${b});`,
      `nwr[natural~"water|wood|grassland"](${b});`
    ];
    const timeout = normalizeArea(bounds.area) > 1 ? 90 : 40;
    return '[out:json][timeout:' + timeout + '];(' + parts.join('') + ');out geom tags;';
  }

  async function fetchOsm(bounds) {
    const query = overpassQuery(bounds);
    const timeout = normalizeArea(bounds.area) > 1 ? 120000 : 60000;
    let last;
    for (const host of OVERPASS_HOSTS) {
      try {
        const data = await getJson(host + '?data=' + encodeURIComponent(query), timeout);
        if (Array.isArray(data.elements) && data.elements.length) return data.elements;
        throw new Error('Pusty wynik');
      } catch (e) { last = e; }
    }
    throw last || new Error('Overpass niedostępny');
  }

  function xy(lat, lon) {
    if (!window.proj4) throw new Error('Brak biblioteki proj4');
    if (!window.proj4.defs('EPSG:2180')) {
      window.proj4.defs('EPSG:2180',
        '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 ' +
        '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
    }
    return window.proj4('EPSG:4326', 'EPSG:2180', [lon, lat]);
  }

  function elementPoints(e) {
    if (Array.isArray(e.geometry) && e.geometry.length) {
      const pts = e.geometry.map(g => [g.lat, g.lon]).filter(p => p[0] != null && p[1] != null);
      if (pts.length) return pts;
    }
    if (e.lat != null && e.lon != null) return [[e.lat, e.lon]];
    if (e.center) return [[e.center.lat, e.center.lon]];
    return [];
  }

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

  function parkingCategory(t) {
    const a = String(t.amenity || '').toLowerCase();
    if (a === 'parking' || a === 'parking_space' || a === 'parking_entrance' ||
        a === 'motorcycle_parking' || a === 'bicycle_parking') return a;
    if (t.parking || t.capacity || t['parking:lane'] || t.service === 'parking_aisle') {
      return 'parking';
    }
    return null;
  }

  function parkingLabel(t, cat) {
    const parts = [];
    if (t.name) parts.push(String(t.name));
    if (t.capacity) parts.push('Miejsc: ' + t.capacity);
    if (t.parking) parts.push('Rodzaj: ' + String(t.parking).replace(/_/g, ' '));
    if (cat === 'parking_space') parts.push('Miejsce');
    if (cat === 'parking_entrance') parts.push('Wjazd');
    if (cat === 'bicycle_parking') parts.push('Rowery');
    if (cat === 'motorcycle_parking') parts.push('Motocykle');
    if (t.access) parts.push('Dostęp: ' + t.access);
    return parts.join(' — ') || 'Miejsce parkingowe';
  }

  /* ------------------------------------------------------------- DWG build */
  function buildDwg(bounds, parcels, osm) {
    const A = window.AcadTs;
    if (!A) throw new Error('Brak biblioteki CAD');
    /* AC1024 (AutoCAD 2010) is used instead of AC1021: upstream acad-ts documents
       that R2007 output was written with an R2004 container and rejected by
       strict CAD readers as "Drawing file is not valid". AC1024 keeps Unicode
       text (Polish diacritics) and uses a valid R2010 container. */
    const doc = new A.CadDocument(A.ACadVersion.AC1024, true);
    doc.header.insUnits = A.UnitsType.Meters;

    /* Skale annotative: lista skal (ACAD_SCALELIST) + CANNOSCALE. Opisy są
       annotative (MultiLeader MText) z reprezentacjami dla 1:500 i 1:1000. */
    const ANNOT_SCALES = [['1:500', 1, 500], ['1:1000', 1, 1000]];
    const root = doc.rootDictionary;
    let scaleDict = root.getEntry(A.CadDictionary.acadScaleList);
    if (!scaleDict) { scaleDict = new A.CadDictionary(A.CadDictionary.acadScaleList); root.add(scaleDict); }
    const scales = new A.ScaleCollection(scaleDict);
    scales.createDefaults();
    ANNOT_SCALES.forEach(([n, p, d]) => {
      const s = new A.Scale(n); s.paperUnits = p; s.drawingUnits = d; s.isUnitScale = false; scales.add(s);
    });
    doc.scales = scales; doc.registerCollection(scales);
    let varDict = root.getEntry(A.CadDictionary.variableDictionary);
    if (!varDict) { varDict = new A.CadDictionary(A.CadDictionary.variableDictionary); root.add(varDict); }
    const vars = new A.DictionaryVariableCollection(varDict);
    vars.createDefaults();
    doc.dictionaryVariables = vars; doc.registerCollection(vars);
    vars.addOrUpdateVariable(A.DictionaryVariable.currentAnnotationScale, '1:500');

    /* Styl TrueType (Arial), aby polskie znaki diakrytyczne renderowały się w CAD. */
    const textStyle = new A.TextStyle('BIMRN_AR');
    textStyle.filename = 'Arial';
    textStyle.height = 0;
    doc.textStyles.add(textStyle);

    const layers = {};
    LAYERS.forEach(def => {
      const layer = new A.Layer(def.name);
      layer.color = new A.Color(def.color);
      layer.lineWeight = def.lineWeight;
      doc.layers.add(layer);
      layers[def.name] = layer;
    });
    const counts = {};
    LAYERS.forEach(d => counts[d.name] = 0);
    const add = (layerRef, entity) => {
      entity.layer = layers[layerRef];
      doc.modelSpace.entities.add(entity);
      counts[layerRef]++;
    };
    const poly = (layerRef, points, closed) => {
      if (!points || points.length < 2) return;
      const verts = points.map(p => new A.LwPolylineVertex(new A.XY(p[0], p[1])));
      const e = new A.LwPolyline(verts);
      e.isClosed = !!closed;
      e.lineWeight = A.LineWeightType.ByLayer;
      add(layerRef, e);
    };
    const point = (layerRef, p) => {
      if (!p) return;
      const e = new A.Point(new A.XYZ(p[0], p[1], 0));
      e.lineWeight = A.LineWeightType.ByLayer;
      add(layerRef, e);
    };
    /* Opis annotative: MultiLeader (MText) z reprezentacjami skal w słowniku
       ACAD_ANNOTSCALE. paperH = wysokość papierowa w mm; wysokość w modelu =
       paperH × mianownik skali (tekst ma stały rozmiar na wydruku). */
    const fillCtx = (ctx, x, y, str, h) => {
      ctx.scaleFactor = 1; ctx.hasTextContents = true; ctx.textLabel = str; ctx.textHeight = h;
      ctx.textLocation = new A.XYZ(x, y, 0); ctx.contentBasePoint = new A.XYZ(x, y, 0); ctx.basePoint = new A.XYZ(x, y, 0);
      ctx.textNormal = new A.XYZ(0, 0, 1); ctx.direction = new A.XYZ(1, 0, 0);
      ctx.textAlignment = A.TextAlignmentType.Left;
      ctx.textLeftAttachment = A.TextAttachmentType.MiddleOfText;
      ctx.textRightAttachment = A.TextAttachmentType.MiddleOfText;
      ctx.textColor = A.Color.byLayer; ctx.textStyle = textStyle;
      const rr = new A.LeaderRoot(); rr.connectionPoint = new A.XYZ(x, y, 0); rr.direction = new A.XYZ(1, 0, 0); rr.contentValid = true;
      const ll = new A.LeaderLine(); ll.points = [new A.XYZ(x, y, 0), new A.XYZ(x, y, 0)]; rr.lines.push(ll); ctx.leaderRoots.push(rr);
    };
    const text = (layerRef, value, p, paperH) => {
      if (!p || !value) return;
      const str = String(value).slice(0, 200);
      const h = paperH || 2.5;
      const ml = new A.MultiLeader();
      ml.contentType = A.LeaderContentType.MText; ml.enableAnnotationScale = true; ml.scaleFactor = 1;
      ml.pathType = A.MultiLeaderPathType.Invisible; ml.enableDogleg = false; ml.enableLanding = false; ml.arrowheadSize = 0;
      ml.textStyle = textStyle; ml.textColor = A.Color.byLayer; ml.lineWeight = A.LineWeightType.ByLayer;
      fillCtx(ml.contextData, p[0], p[1], str, h);
      ml.contextData.scale = scales.get('1:500');
      const xd = new A.CadDictionary(); ml.xDictionary = xd;
      const ad = new A.CadDictionary('ACAD_ANNOTSCALE'); xd.addByKey('ACAD_ANNOTSCALE', ad);
      ANNOT_SCALES.forEach(([n]) => {
        const rep = ml.contextData.clone(); rep.scale = scales.get(n); rep.textStyle = textStyle; ad.addByKey(n, rep);
      });
      add(layerRef, ml);
    };
    /* Zbiorcza warstwa zagospodarowania — kopiuje wybrane obiekty powierzchniowe. */
    const development = (points, closed, label) => {
      if (!points || !points.length) return;
      if (points.length > 1) poly(LN.ZAGOSPODAROWANIE, points, closed);
      else point(LN.ZAGOSPODAROWANIE, points[0]);
      if (label) text(LN.ZAGOSPODAROWANIE, label, points[0], 2.5);
    };

    /* Granica obszaru */
    const corners = [
      xy(bounds.south, bounds.west), xy(bounds.south, bounds.east),
      xy(bounds.north, bounds.east), xy(bounds.north, bounds.west)
    ];
    poly(LN.GRANICA, corners.concat([corners[0]]), false);
    development(corners, true, '');

    /* Działki ULDK */
    parcels.forEach(pc => {
      const number = pc.number || pc.id.split('.').pop();
      pc.geometry.rings.forEach((ring, i) => {
        const pts = ring.map(([x, y]) => [x, y]);
        poly(LN.DZIALKI, pts, true);
        development(pts, true, i === 0 ? number : '');
        if (i === 0) text(LN.DZIALKI, number, ringCentroid(pts), 3);
      });
    });

    /* Obiekty OSM */
    (osm || []).forEach(e => {
      const t = e.tags || {};
      const ll = elementPoints(e);
      if (!ll.length) return;
      const pts = ll.map(([la, lo]) => xy(la, lo));
      const label = t.name || t.ref || t.operator || '';
      const parking = parkingCategory(t);

      if (parking) {
        const pLabel = parkingLabel(t, parking);
        const closed = e.type === 'way' && !t.highway;
        if (pts.length > 1) poly(LN.MIEJSCA_PARKINGOWE, pts, closed);
        else point(LN.MIEJSCA_PARKINGOWE, pts[0]);
        text(LN.MIEJSCA_PARKINGOWE, pLabel, pts[0], 2.5);
        development(pts, closed, pLabel);
        return;
      }
      if (e.type === 'way' && t.building) {
        poly(LN.BUDYNKI, pts, true);
        if (label) text(LN.BUDYNKI, label, ringCentroid(pts), 2.5);
        development(pts, true, label || 'Budynek');
        return;
      }
      if (e.type === 'way' && (t.highway || t.railway)) {
        poly(LN.DROGI, pts, false);
        if (t.highway && label) text(LN.DROGI, label, pts[Math.floor(pts.length / 2)], 2.5);
        development(pts, false, label || (t.railway ? 'Linia kolejowa' : 'Droga'));
        return;
      }
      const util = utilCategory(t);
      if (util) {
        if (pts.length > 1) poly(LN.ZBROJENIE, pts, false);
        else point(LN.ZBROJENIE, pts[0]);
        const names = { el: 'energia', water: 'woda', sewer: 'kanalizacja', gas: 'gaz', heat: 'ciepło', tel: 'telekomunikacja' };
        text(LN.ZBROJENIE, (names[util] || util) + (label ? ' — ' + label : ''), pts[0], 2.5);
        return;
      }
      if (t.landuse || t.natural || t.leisure) {
        poly(LN.UZYTKOWANIE, pts, e.type === 'way');
        if (label) text(LN.UZYTKOWANIE, label, ringCentroid(pts), 2.5);
        development(pts, e.type === 'way', label || 'Użytkowanie terenu');
        return;
      }
      if (label) {
        if (pts.length > 1) poly(LN.OBIEKTY, pts, false);
        else point(LN.OBIEKTY, pts[0]);
        text(LN.OBIEKTY, label, pts[0], 2.5);
        development(pts, false, label);
      }
    });

    /* Metadane + legenda w lewym dolnym rogu obszaru (opisy annotative).
       Rozstaw w modelu dobrany dla 1:1000 (3 mm papieru → 3 m), bez nakładania. */
    const x0 = Math.min(...corners.map(p => p[0])) + 20;
    const y0 = Math.min(...corners.map(p => p[1])) + 20;
    const area = normalizeArea(bounds.area);
    const center = bounds.center || [
      (bounds.south + bounds.north) / 2, (bounds.west + bounds.east) / 2
    ];
    const LH = 4.5;
    let ty = y0;
    const meta = [
      'ANALIZA TERENU — EKSPORT OBSZARU ' + areaLabel(area) + ' km²',
      'Bok kwadratu: ' + fmt(sideMeters(area)) + ' m · Środek: ' + center[0].toFixed(5) + ', ' + center[1].toFixed(5) + ' (WGS84)',
      'Układ: PUWG 1992 (EPSG:2180) · jednostki: metry · prefiks warstw: ' + LAYER_PREFIX,
      'Źródła: GUGiK ULDK (działki, siatka ' + (bounds.sampleM || SAMPLE_M) + ' m) · OpenStreetMap / Overpass',
      'Data eksportu: ' + new Date().toLocaleString('pl-PL'),
      'Działki: ' + parcels.length + ' · obiekty OSM: ' + (osm || []).length +
        ' · zagospodarowanie: ' + counts[LN.ZAGOSPODAROWANIE] + ' · parkingi: ' + counts[LN.MIEJSCA_PARKINGOWE]
    ];
    meta.forEach(line => { text(LN.INFO, line, [x0, ty], 3); ty += LH; });
    ty += LH;
    /* Legenda warstw — próbka linii (kolor + grubość) i opis zawartości każdej warstwy. */
    text(LN.LEGENDA, 'LEGENDA WARSTW — CO ZAWIERA RYSUNEK', [x0, ty], 3.5); ty += LH;
    const SW = 6;
    LAYERS.filter(d => d.key !== 'INFO' && d.key !== 'LEGENDA').forEach(def => {
      const sw = new A.LwPolyline([
        new A.LwPolylineVertex(new A.XY(x0, ty)),
        new A.LwPolylineVertex(new A.XY(x0 + SW, ty))
      ]);
      sw.layer = layers[LN.LEGENDA];
      sw.color = new A.Color(def.color);
      sw.lineWeight = def.lineWeight;
      doc.modelSpace.entities.add(sw); counts[LN.LEGENDA]++;
      const mm = (def.lineWeight / 100).toFixed(2);
      text(LN.LEGENDA, def.name + '  (' + mm + ' mm · ' + counts[def.name] + ')  —  ' + def.desc, [x0 + SW + 3, ty], 3);
      ty += LH;
    });
    text(LN.LEGENDA, 'Opisy annotative: 1:500 i 1:1000 (CANNOSCALE 1:500). Grubości linii wg warstw (ByLayer).', [x0, ty], 3); ty += LH;
    text(LN.LEGENDA, 'Warstwy INFO i LEGENDA to adnotacje. Wszystkie warstwy mają prefiks ' + LAYER_PREFIX + '.', [x0, ty], 3);

    return { buffer: A.DwgWriter.writeToBuffer(doc), counts };
  }

  /* ----------------------------------------------------------------- save */
  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(bin);
  }

  async function saveDwg(buffer, filename) {
    if (window.desktop?.saveDwg) {
      const result = await window.desktop.saveDwg(toBase64(buffer), filename);
      if (result) opts?.toast?.('Zapisano plik DWG: ' + result);
      return;
    }
    const blob = new Blob([buffer], { type: 'application/acad' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    opts?.toast?.('Pobrano plik DWG: ' + filename);
  }

  /* --------------------------------------------------------------- export */
  async function exportArea(latlng, areaKm2) {
    if (busy) { opts?.toast?.('Trwa poprzedni eksport DWG.'); return; }
    busy = true;
    const area = normalizeArea(areaKm2 == null ? selectedArea() : areaKm2);
    const btn = el('dwg-btn');
    if (btn) btn.disabled = true;
    updateAreaUi();
    showProgress(true);
    const center = [latlng.lat, latlng.lng];
    const bounds = areaBounds(center[0], center[1], area);
    try {
      setProgress(3, 'Pobieram działki z GUGiK ULDK (' + areaLabel(area) + ' km²)…');
      const parcels = await fetchParcels(bounds, (done, total) => {
        setProgress(3 + 47 * done / total,
          'Pobieram działki ULDK (' + done + '/' + total + ')…');
      });
      setProgress(52, 'Pobieram dane OpenStreetMap…');
      let osm = [];
      try { osm = await fetchOsm(bounds); }
      catch (e) { opts?.toast?.('Uwaga: dane OSM niedostępne — eksportuję same działki. ' + e.message); }
      setProgress(72, 'Buduję dokument DWG…');
      const { buffer, counts } = buildDwg(bounds, parcels, osm);
      setProgress(90, 'Zapisuję plik DWG…');
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      await saveDwg(buffer, 'analiza-terenu-' + String(area).replace('.', '_') + 'km2-' + stamp + '.dwg');
      setProgress(100, 'Gotowe.');
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      opts?.toast?.('Eksport DWG ' + areaLabel(area) + ' km² zakończony: ' + parcels.length +
        ' działek, ' + osm.length + ' obiektów OSM, ' + total + ' elementów CAD.');
      setTimeout(() => showProgress(false), 1600);
    } catch (e) {
      showProgress(false);
      opts?.toast?.('Eksport DWG nie powiódł się: ' + (e.message || e));
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ init */
  function init(options) {
    opts = options || {};
    if (!opts.map) return;
    const btn = el('dwg-btn');
    const areaSel = el('dwg-area');
    if (areaSel) areaSel.addEventListener('change', updateAreaUi);
    if (btn) btn.onclick = () => setSelecting(!selecting);
    updateAreaUi();
    opts.map.on('mousemove', e => {
      if (!selecting || busy) return;
      const area = selectedArea();
      if (!preview) {
        preview = L.rectangle(boxFromLatLng(e.latlng, area), {
          color: '#7c3aed', weight: 2, dashArray: '6 6', fillOpacity: 0.06,
          interactive: false
        }).addTo(opts.map);
      } else {
        preview.setBounds(boxFromLatLng(e.latlng, area));
      }
    });
    opts.map.on('click', e => {
      if (!selecting || busy) return;
      const center = [e.latlng.lat, e.latlng.lng];
      const area = selectedArea();
      /* The application's own map-click handler must not start a new analysis
         while the DWG area is being picked. */
      setTimeout(() => setSelecting(false), 0);
      exportArea({ lat: center[0], lng: center[1] }, area);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && selecting) setSelecting(false);
    });
  }

  window.DwgExport = {
    init,
    isSelecting: () => selecting,
    exportArea,
    areaBounds,
    selectedArea,
    sideMeters,
    parseWkt,
    buildDwg,
    LAYER_PREFIX,
    layerName,
    LAYERS
  };
})();
