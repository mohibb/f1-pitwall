/**
 * circle_map.js — Circular track map for Page 2 (Timing Tower)
 *
 * Orientation: clockwise, 12 o'clock = start/finish line
 * Driver position derived from lap_fraction (0.0–1.0) → angle → x,y
 */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const PADDING          = 24;
  const DOT_RADIUS_DESKTOP = 8;
  const DOT_RADIUS_MOBILE  = 6;
  const MOBILE_BREAKPOINT  = 600;
  const TRACK_WIDTH        = 8;
  const PIT_NOTCH_ANGLE    = 0.06;   // radians — width of pit lane gap
  const PIT_LABEL_OFFSET   = 28;     // px inward from circle edge
  const SECTOR_TICK_INNER  = 0.82;   // fraction of radius for inner tick end
  const SECTOR_TICK_OUTER  = 1.05;   // fraction of radius for outer tick end
  const DRS_ARC_OFFSET     = 18;     // px outside track circle
  const DRS_ARC_WIDTH      = 4;

  // ── Colours ────────────────────────────────────────────────────────────────
  const C = {
    track:      '#3a3a3a',
    trackBg:    '#1a1a1a',
    border:     '#2a2a2a',
    sf:         '#ffffff',
    pit:        '#888888',
    pitLabel:   '#666666',
    sector:     '#444444',
    drs:        '#27ae60',
    text:       '#ffffff',
    textMuted:  '#666666',
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let _canvas    = null;
  let _ctx       = null;
  let _cx        = 0;
  let _cy        = 0;
  let _radius    = 0;
  let _dotR      = DOT_RADIUS_DESKTOP;
  let _lastState = null;
  let _circuit   = null;   // loaded from circuits.json
  let _circuits  = {};     // full config

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    _canvas = document.getElementById('circle-map-canvas');
    if (!_canvas) return;

    _ctx = _canvas.getContext('2d');

    loadCircuits().then(function () {
      resize();
      window.addEventListener('resize', resize);

      document.addEventListener('f1:update', function (e) {
        _lastState = e.detail;
        updateCircuit();
        draw();
      });

      draw();
    });
  }

  // ── Load circuit config ────────────────────────────────────────────────────
  function loadCircuits() {
    return fetch('/static/data/circuits.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { _circuits = data; _circuit = data['default']; })
      .catch(function () { _circuit = { pit_fraction: 0.93, sectors: [0.333, 0.666], drs_zones: [] }; });
  }

  function updateCircuit() {
    if (!_lastState || !_lastState.session) return;
    const name = _lastState.session.circuit;
    _circuit = _circuits[name] || _circuits['default'];
  }

  // ── Resize ─────────────────────────────────────────────────────────────────
  function resize() {
    if (!_canvas) return;
    const container = _canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    _canvas.width  = w * dpr;
    _canvas.height = h * dpr;
    _canvas.style.width  = w + 'px';
    _canvas.style.height = h + 'px';
    _ctx.scale(dpr, dpr);
    _cx    = w / 2;
    _cy    = h / 2;
    _radius = Math.min(w, h) / 2 - PADDING;
    _dotR  = w < MOBILE_BREAKPOINT ? DOT_RADIUS_MOBILE : DOT_RADIUS_DESKTOP;
    draw();
  }

  // ── Coordinate helpers ─────────────────────────────────────────────────────
  function fractionToAngle(fraction) {
    return (fraction * 2 * Math.PI) - (Math.PI / 2);
  }

  function fractionToXY(fraction, r) {
    r = r !== undefined ? r : _radius;
    const a = fractionToAngle(fraction);
    return { x: _cx + r * Math.cos(a), y: _cy + r * Math.sin(a) };
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  function draw() {
    if (!_ctx || !_circuit) return;
    const w = _canvas.width  / (window.devicePixelRatio || 1);
    const h = _canvas.height / (window.devicePixelRatio || 1);
    _ctx.clearRect(0, 0, w, h);

    drawTrackCircle();
    drawDRSZones();
    drawSectorMarkers();
    drawPitLane();
    drawStartFinish();
  }

  // ── Track circle ───────────────────────────────────────────────────────────
  function drawTrackCircle() {
    const pitF  = _circuit.pit_fraction;
    const gap   = PIT_NOTCH_ANGLE;
    // Start angle: just after pit exit (pit_fraction + gap/2), end: just before pit entry
    const startA = fractionToAngle(pitF + gap / 2);
    const endA   = fractionToAngle(pitF - gap / 2 + 1) - 2 * Math.PI;

    // Track band (filled arc with inner cutout = thick arc via lineWidth)
    _ctx.strokeStyle = C.track;
    _ctx.lineWidth   = TRACK_WIDTH;
    _ctx.lineCap     = 'butt';
    _ctx.beginPath();
    _ctx.arc(_cx, _cy, _radius, startA, endA, false);
    _ctx.stroke();
  }

  // ── DRS zones ──────────────────────────────────────────────────────────────
  function drawDRSZones() {
    if (!_circuit.drs_zones || !_circuit.drs_zones.length) return;
    const r = _radius + DRS_ARC_OFFSET;
    _ctx.strokeStyle = C.drs;
    _ctx.lineWidth   = DRS_ARC_WIDTH;
    _ctx.lineCap     = 'round';
    _circuit.drs_zones.forEach(function (zone) {
      const startA = fractionToAngle(zone[0]);
      let   endA   = fractionToAngle(zone[1]);
      // Handle wrap-around (e.g. 0.92 → 0.08 crosses 12 o'clock)
      if (zone[1] < zone[0]) endA += 2 * Math.PI;
      _ctx.beginPath();
      _ctx.arc(_cx, _cy, r, startA, endA, false);
      _ctx.stroke();
    });
  }

  // ── Sector markers ─────────────────────────────────────────────────────────
  function drawSectorMarkers() {
    const sectors = _circuit.sectors.slice(0, 2); // S1/S2 boundaries only
    _ctx.strokeStyle = C.sector;
    _ctx.lineWidth   = 1.5;
    sectors.forEach(function (f) {
      const inner = fractionToXY(f, _radius * SECTOR_TICK_INNER);
      const outer = fractionToXY(f, _radius * SECTOR_TICK_OUTER);
      _ctx.beginPath();
      _ctx.moveTo(inner.x, inner.y);
      _ctx.lineTo(outer.x, outer.y);
      _ctx.stroke();

      // Sector label
      const labelPos = fractionToXY(f - 0.02, _radius * 1.15);
      _ctx.fillStyle    = C.textMuted;
      _ctx.font         = '9px JetBrains Mono, monospace';
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      const idx = sectors.indexOf(f);
      _ctx.fillText('S' + (idx + 2), labelPos.x, labelPos.y);
    });

    // S1 label near start/finish
    const s1Pos = fractionToXY(0.04, _radius * 1.15);
    _ctx.fillStyle    = C.textMuted;
    _ctx.font         = '9px JetBrains Mono, monospace';
    _ctx.textAlign    = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.fillText('S1', s1Pos.x, s1Pos.y);
  }

  // ── Pit lane notch ─────────────────────────────────────────────────────────
  function drawPitLane() {
    const pitF = _circuit.pit_fraction;

    // Small arc gap is already in drawTrackCircle — just draw pit lane indicator
    const pitPos    = fractionToXY(pitF, _radius);
    const pitInner  = fractionToXY(pitF, _radius - PIT_LABEL_OFFSET);

    // Dashed line inward to show pit entrance
    _ctx.strokeStyle = C.pit;
    _ctx.lineWidth   = 1;
    _ctx.setLineDash([3, 3]);
    _ctx.beginPath();
    _ctx.moveTo(pitPos.x, pitPos.y);
    _ctx.lineTo(pitInner.x, pitInner.y);
    _ctx.stroke();
    _ctx.setLineDash([]);

    // PIT label
    const labelPos = fractionToXY(pitF, _radius - PIT_LABEL_OFFSET - 10);
    _ctx.fillStyle    = C.pitLabel;
    _ctx.font         = '9px JetBrains Mono, monospace';
    _ctx.textAlign    = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.fillText('PIT', labelPos.x, labelPos.y);
  }

  // ── Start / finish line ────────────────────────────────────────────────────
  function drawStartFinish() {
    // Tick mark perpendicular to circle at 12 o'clock (fraction = 0)
    const outer = fractionToXY(0, _radius + TRACK_WIDTH / 2 + 2);
    const inner = fractionToXY(0, _radius - TRACK_WIDTH / 2 - 2);

    _ctx.strokeStyle = C.sf;
    _ctx.lineWidth   = 2;
    _ctx.lineCap     = 'round';
    _ctx.beginPath();
    _ctx.moveTo(inner.x, inner.y);
    _ctx.lineTo(outer.x, outer.y);
    _ctx.stroke();
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window._circleMap = { fractionToXY: fractionToXY };

})();
