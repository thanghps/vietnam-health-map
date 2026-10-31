/* Vietnam Health Map: MapLibre GL JS + OpenStreetMap data */
const $ = id => document.getElementById(id);
const COLORS = { hospital: '#e11d48', clinic: '#0ea5e9' };
const isPhone = window.innerWidth < 760;

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [106.0, 16.2],
  zoom: isPhone ? 4.2 : 5.1,
  minZoom: 3.5,
  maxZoom: 18,
  attributionControl: { compact: true },
});
if (!isPhone) map.setPadding({ left: 340, top: 0, right: 0, bottom: 0 });
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');

let all = [];          // every feature
let filtered = null;   // FeatureCollection currently shown
let view = 'clusters';

// ---------- helpers ----------
const R = 6371;
const toRad = d => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function circle(center, km, steps = 72) {
  const [lon, lat] = center, pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    pts.push([lon + (km / (111.32 * Math.cos(toRad(lat)))) * Math.cos(t), lat + (km / 110.57) * Math.sin(t)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} };
}
const fold = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const label = p => p.n || (p.t === 'hospital' ? 'Unnamed hospital' : 'Unnamed clinic');

function popupHtml(p) {
  const kind = p.t === 'hospital' ? 'Hospital' : 'Clinic';
  return `<div class="pop"><div class="k" style="color:${COLORS[p.t]}">${kind}</div><h3>${esc(label(p))}</h3>` +
    (p.a ? `<p>${esc(p.a)}</p>` : '') + (p.ph ? `<p>☎ ${esc(p.ph)}</p>` : '') +
    (p.b ? `<p>${esc(p.b)} beds</p>` : '') + (p.s ? `<p>${esc(p.s.replace(/;/g, ', '))}</p>` : '') +
    (p.e ? '<span class="tag">Emergency</span>' : '') + '</div>';
}

// ---------- filters ----------
function applyFilters() {
  const h = $('f-hospital').checked, c = $('f-clinic').checked, e = $('f-emergency').checked;
  const feats = all.filter(f => ((f.properties.t === 'hospital' && h) || (f.properties.t === 'clinic' && c)) && (!e || f.properties.e));
  filtered = { type: 'FeatureCollection', features: feats };
  map.getSource('facilities').setData(filtered);
  updateViewStats();
}

function setView(v) {
  view = v;
  const vis = (id, on) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  vis('clusters', v === 'clusters'); vis('cluster-count', v === 'clusters'); vis('unclustered', v === 'clusters');
  vis('heat', v === 'heat'); vis('points', v === 'points');
}

function updateViewStats() {
  if (!filtered) return;
  const b = map.getBounds();
  let h = 0, c = 0;
  for (const f of filtered.features) {
    const [lon, lat] = f.geometry.coordinates;
    if (b.contains([lon, lat])) f.properties.t === 'hospital' ? h++ : c++;
  }
  $('v-h').textContent = h.toLocaleString();
  $('v-c').textContent = c.toLocaleString();
  $('v-share').textContent = `${Math.round(((h + c) / Math.max(1, filtered.features.length)) * 100)}%`;
}

// ---------- nearest ----------
let marker = null;
function findNearest(lngLat) {
  const origin = [lngLat.lng, lngLat.lat];
  const pool = filtered ? filtered.features : all;
  const ranked = pool.map(f => ({ f, d: haversine(origin, f.geometry.coordinates) })).sort((a, b) => a.d - b.d).slice(0, 5);
  if (!ranked.length) return;
  const lines = ranked.map(r => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [origin, r.f.geometry.coordinates] } }));
  map.getSource('near-lines').setData({ type: 'FeatureCollection', features: lines });
  map.getSource('near-ring').setData(circle(origin, ranked[ranked.length - 1].d));
  if (marker) marker.remove();
  marker = new maplibregl.Marker({ color: '#0f172a' }).setLngLat(origin).addTo(map);
  $('near-hint').textContent = `${lngLat.lat.toFixed(3)}, ${lngLat.lng.toFixed(3)}`;
  $('nearest').innerHTML = ranked.map((r, i) =>
    `<li data-i="${i}"><div><b>${esc(label(r.f.properties))}</b><small>${r.f.properties.t === 'hospital' ? 'Hospital' : 'Clinic'}${r.f.properties.e ? ' · Emergency' : ''}</small></div>` +
    `<span class="d">${r.d < 10 ? r.d.toFixed(1) : Math.round(r.d)} km</span></li>`).join('');
  $('nearest').onclick = e => {
    const li = e.target.closest('li');
    if (li) focusFeature(ranked[Number(li.dataset.i)].f);
  };
  const bounds = new maplibregl.LngLatBounds(origin, origin);
  ranked.forEach(r => bounds.extend(r.f.geometry.coordinates));
  map.fitBounds(bounds, { padding: isPhone ? 60 : { top: 80, bottom: 80, left: 60, right: 80 }, maxZoom: 14, duration: 900 });
}

let popup = null;
function focusFeature(f) {
  if (popup) popup.remove();
  popup = new maplibregl.Popup({ offset: 10 }).setLngLat(f.geometry.coordinates).setHTML(popupHtml(f.properties)).addTo(map);
  map.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 14), duration: 900 });
}

// ---------- search ----------
function search(q) {
  const ul = $('results');
  const k = fold(q.trim());
  if (k.length < 2) { ul.innerHTML = ''; return; }
  const hits = all.filter(f => f.properties._k.includes(k)).slice(0, 8);
  ul.innerHTML = hits.length
    ? hits.map((f, i) => `<li data-i="${i}"><i class="sw ${f.properties.t === 'hospital' ? 'h' : 'c'}"></i>${esc(label(f.properties))}<small>${f.properties.t}</small></li>`).join('')
    : '<li class="muted">No match</li>';
  ul.onclick = e => {
    const li = e.target.closest('li[data-i]');
    if (li) focusFeature(hits[Number(li.dataset.i)]);
  };
}

// ---------- map setup ----------
map.once('style.load', async () => {
  const data = await (await fetch('data/facilities.geojson')).json();
  all = data.features;
  for (const f of all) f.properties._k = fold(f.properties.n);
  const count = t => all.filter(f => f.properties.t === t).length;
  $('total').textContent = all.length.toLocaleString();
  $('c-hospital').textContent = count('hospital').toLocaleString();
  $('c-clinic').textContent = count('clinic').toLocaleString();
  $('c-emergency').textContent = all.filter(f => f.properties.e).length.toLocaleString();

  // hide the basemap's sea names and label the sea and Vietnam's archipelagos explicitly
  for (const l of map.getStyle().layers) if (l.id.startsWith('water_name')) map.setLayoutProperty(l.id, 'visibility', 'none');
  // Vietnam's archipelagos, labelled explicitly
  map.addSource('islands', { type: 'geojson', data: { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [112.0, 16.45] }, properties: { name: 'Quần đảo Hoàng Sa\n(Việt Nam)' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [114.2, 9.9] }, properties: { name: 'Quần đảo Trường Sa\n(Việt Nam)' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [113.2, 13.2] }, properties: { name: 'Biển Đông', sea: 1 } },
  ] } });
  map.addLayer({ id: 'islands', type: 'symbol', source: 'islands', layout: {
    'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12.5, 'text-allow-overlap': true },
    paint: { 'text-color': ['case', ['has', 'sea'], '#3b6ea8', '#334155'], 'text-halo-color': '#fff', 'text-halo-width': 2 } });

  map.addSource('facilities', { type: 'geojson', data, cluster: true, clusterRadius: 48, clusterMaxZoom: 12,
    clusterProperties: { hospitals: ['+', ['case', ['==', ['get', 't'], 'hospital'], 1, 0]] } });
  map.addSource('facilities-raw', { type: 'geojson', data });

  // nearest-facility helpers
  map.addSource('near-ring', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('near-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'near-ring-fill', type: 'fill', source: 'near-ring', paint: { 'fill-color': '#0f172a', 'fill-opacity': 0.06 } });
  map.addLayer({ id: 'near-ring-line', type: 'line', source: 'near-ring', paint: { 'line-color': '#0f172a', 'line-width': 1.2, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'near-lines', type: 'line', source: 'near-lines', paint: { 'line-color': '#0f172a', 'line-width': 1.6, 'line-opacity': 0.7 } });

  // heatmap
  map.addLayer({ id: 'heat', type: 'heatmap', source: 'facilities-raw', layout: { visibility: 'none' }, paint: {
    'heatmap-weight': ['case', ['==', ['get', 't'], 'hospital'], 1, 0.6],
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 12, 2.5],
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 8, 9, 22, 13, 36],
    'heatmap-opacity': 0.85,
    'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(255,255,255,0)', 0.15, '#fde68a', 0.4, '#fb923c', 0.7, '#e11d48', 1, '#7f1d1d'],
  } });

  // clusters: size by count, color by hospital share
  map.addLayer({ id: 'clusters', type: 'circle', source: 'facilities', filter: ['has', 'point_count'], paint: {
    'circle-color': ['interpolate', ['linear'], ['/', ['get', 'hospitals'], ['get', 'point_count']], 0, COLORS.clinic, 0.5, '#8b5cf6', 1, COLORS.hospital],
    'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 24, 200, 32],
    'circle-stroke-width': 3, 'circle-stroke-color': 'rgba(255,255,255,0.85)', 'circle-opacity': 0.9,
  } });
  map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'facilities', filter: ['has', 'point_count'], layout: {
    'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12 }, paint: { 'text-color': '#fff' } });
  const pointPaint = {
    'circle-color': ['match', ['get', 't'], 'hospital', COLORS.hospital, COLORS.clinic],
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.5, 12, 6, 16, 9],
    'circle-stroke-width': ['case', ['has', 'e'], 2.5, 1.5],
    'circle-stroke-color': ['case', ['has', 'e'], '#f59e0b', '#ffffff'],
  };
  map.addLayer({ id: 'unclustered', type: 'circle', source: 'facilities', filter: ['!', ['has', 'point_count']], paint: pointPaint });
  map.addLayer({ id: 'points', type: 'circle', source: 'facilities-raw', layout: { visibility: 'none' }, paint: pointPaint });

  // interactions
  map.on('click', 'clusters', async e => {
    const f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
    const zoom = await map.getSource('facilities').getClusterExpansionZoom(f.properties.cluster_id);
    map.easeTo({ center: f.geometry.coordinates, zoom });
  });
  for (const id of ['unclustered', 'points']) {
    map.on('click', id, e => { e.preventDefault(); focusFeature(e.features[0]); });
    map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
  }
  map.on('mouseenter', 'clusters', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'clusters', () => (map.getCanvas().style.cursor = ''));
  map.on('click', e => {
    if (e.defaultPrevented) return;
    if (map.queryRenderedFeatures(e.point, { layers: ['clusters'] }).length) return;
    findNearest(e.lngLat);
  });
  map.on('moveend', updateViewStats);

  // filtered copy for the "points" + "heat" layers too
  const syncRaw = () => map.getSource('facilities-raw').setData(filtered);
  for (const id of ['f-hospital', 'f-clinic', 'f-emergency']) $(id).addEventListener('change', () => { applyFilters(); syncRaw(); });
  applyFilters();

  // deep links for screenshots: ?view=heat&near=21.0285,105.8542&q=bach mai
  const qs = new URLSearchParams(location.search);
  if (qs.has('view')) { setView(qs.get('view')); for (const b of $('view').children) b.classList.toggle('on', b.dataset.v === qs.get('view')); }
  if (qs.has('near')) { const [lat, lng] = qs.get('near').split(',').map(Number); findNearest({ lat, lng }); }
  if (qs.has('q')) { $('search').value = qs.get('q'); search(qs.get('q')); }
});

$('view').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  for (const x of $('view').children) x.classList.toggle('on', x === b);
  setView(b.dataset.v);
});
$('search').addEventListener('input', e => search(e.target.value));
$('collapse').addEventListener('click', () => $('panel').classList.toggle('collapsed'));
if (isPhone) $('panel').classList.add('collapsed');
