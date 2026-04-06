/**
 * circle_map.js — Circular track map for Page 2 (Timing Tower)
 *
 * Orientation: clockwise, 12 o'clock = start/finish line
 * Driver position derived from lap_fraction (0.0–1.0) → angle → x,y
 */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const PADDING            = 24;
  const DOT_RADIUS_DESKTOP = 8;
  const DOT_RADIUS_MOBILE  = 6;
  const MOBILE_BREAKPOINT  = 600;
  const TRACK_WIDTH        = 8;
  const PIT_NOTCH_ANGLE    = 0.06;
  const PIT_LABEL_OFFSET   = 28;
  const SECTOR_TICK_INNER  = 0.82;
  const SECTOR_TICK_OUTER  = 1.05;
  const LERP_FACTOR        = 0.05;   // smoothing: 0=no movement, 1=instant snap
  const LABEL_OFFSET       = 14;    // px from dot centre to label

  // ── Colours ────────────────────────────────────────────────────────────────
  const C = {
    track:     '#3a3a3a',
    border:    '#2a2a2a',
    sf:        '#ffffff',
    pit:       '#888888',
    pitLabel:  '#666666',
    sector:    '#444444',
    text:      '#ffffff',
    textMuted: '#666666',
    dotBorder: '#ffffff',
    fallback:  '#555555',
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let _canvas    = null;
  let _ctx       = null;
  let _cx        = 0;
  let _cy        = 0;
  let _radius    = 0;
  let _dotR      = DOT_RADIUS_DESKTOP;
  let _lastState = null;
  let _circuit   = null;
  let _circuits  = {};

  // Driver tracking: keyed by driver abbreviation
  // fraction     — current smoothed display fraction
  // target       — latest fraction from API
  // speed        — fraction per ms (derived from avg lap time)
  // lastUpdate   — ms timestamp of last API update
  let _driverPos  = {};
  let _lastPollMs = 0;   // real time of last f1:update
  let _pitDrivers = [];  // ordered list of abbrs currently in pit

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
        _lastPollMs = performance.now();
        updateCircuit();
        updatePitDrivers();
        // Don't call draw() here — animation loop handles it at 60fps
      });

      // Start 60fps animation loop
      animationLoop();
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
    _cx     = w / 2;
    _cy     = h / 2;
    _radius = Math.min(w, h) / 2 - PADDING;
    _dotR   = w < MOBILE_BREAKPOINT ? DOT_RADIUS_MOBILE : DOT_RADIUS_DESKTOP;
    // Reset cached positions on resize so lerp doesn't animate across the canvas
    _driverPos = {};
    // draw() called by animation loop
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

  // Linear interpolation
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Shortest-path lerp on a circular fraction (handles 0/1 wrap-around)
  function lerpFraction(current, target, t) {
    let delta = target - current;
    // Wrap delta to [-0.5, 0.5] so we always take the short arc
    if (delta > 0.5)  delta -= 1.0;
    if (delta < -0.5) delta += 1.0;
    return (current + delta * t + 1.0) % 1.0;
  }

  // ── Animation loop (60fps) ────────────────────────────────────────────────
  function animationLoop() {
    draw();
    requestAnimationFrame(animationLoop);
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  function draw() {
    if (!_ctx || !_circuit) return;
    const w = _canvas.width  / (window.devicePixelRatio || 1);
    const h = _canvas.height / (window.devicePixelRatio || 1);
    _ctx.clearRect(0, 0, w, h);

    drawTrackCircle();
    drawSectorMarkers();
    drawPitLane();
    drawStartFinish();
    drawDrivers();
    drawPitDrivers();
  }

  // ── Track circle ───────────────────────────────────────────────────────────
  function drawTrackCircle() {
    const pitF   = _circuit.pit_fraction;
    const gap    = PIT_NOTCH_ANGLE;
    const startA = fractionToAngle(pitF + gap / 2);
    const endA   = fractionToAngle(pitF - gap / 2 + 1) - 2 * Math.PI;
    _ctx.strokeStyle = C.track;
    _ctx.lineWidth   = TRACK_WIDTH;
    _ctx.lineCap     = 'butt';
    _ctx.beginPath();
    _ctx.arc(_cx, _cy, _radius, startA, endA, false);
    _ctx.stroke();
  }

  // ── Sector markers ─────────────────────────────────────────────────────────
  function drawSectorMarkers() {
    const sectors = _circuit.sectors.slice(0, 2);
    _ctx.strokeStyle = C.sector;
    _ctx.lineWidth   = 1.5;
    sectors.forEach(function (f, idx) {
      const inner = fractionToXY(f, _radius * SECTOR_TICK_INNER);
      const outer = fractionToXY(f, _radius * SECTOR_TICK_OUTER);
      _ctx.beginPath();
      _ctx.moveTo(inner.x, inner.y);
      _ctx.lineTo(outer.x, outer.y);
      _ctx.stroke();
      const labelPos = fractionToXY(f - 0.02, _radius * 1.15);
      _ctx.fillStyle    = C.textMuted;
      _ctx.font         = '9px JetBrains Mono, monospace';
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText('S' + (idx + 2), labelPos.x, labelPos.y);
    });
    const s1Pos = fractionToXY(0.04, _radius * 1.15);
    _ctx.fillStyle    = C.textMuted;
    _ctx.font         = '9px JetBrains Mono, monospace';
    _ctx.textAlign    = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.fillText('S1', s1Pos.x, s1Pos.y);
  }

  // ── Pit lane ───────────────────────────────────────────────────────────────
  function drawPitLane() {
    const pitF     = _circuit.pit_fraction;
    const pitPos   = fractionToXY(pitF, _radius);
    const pitInner = fractionToXY(pitF, _radius - PIT_LABEL_OFFSET);
    _ctx.strokeStyle = C.pit;
    _ctx.lineWidth   = 1;
    _ctx.setLineDash([3, 3]);
    _ctx.beginPath();
    _ctx.moveTo(pitPos.x, pitPos.y);
    _ctx.lineTo(pitInner.x, pitInner.y);
    _ctx.stroke();
    _ctx.setLineDash([]);
    const labelPos = fractionToXY(pitF, _radius - PIT_LABEL_OFFSET - 10);
    _ctx.fillStyle    = C.pitLabel;
    _ctx.font         = '9px JetBrains Mono, monospace';
    _ctx.textAlign    = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.fillText('PIT', labelPos.x, labelPos.y);
  }

  // ── Start / finish ─────────────────────────────────────────────────────────
  function drawStartFinish() {
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

  // ── Driver dots ────────────────────────────────────────────────────────────
  function drawDrivers() {
    if (!_lastState || !_lastState.drivers) return;

    const drivers = _lastState.drivers;
    const keys    = Object.keys(drivers);
    if (!keys.length) return;

    // Time elapsed since last poll (seconds) — used for extrapolation
    const msSincePoll = performance.now() - _lastPollMs;
    const secsSincePoll = Math.min(msSincePoll / 1000, 2.0); // cap at 2s

    // Sort by position so higher-placed drivers draw on top
    keys.sort(function (a, b) {
      return (drivers[b].position || 99) - (drivers[a].position || 99);
    });

    keys.forEach(function (abbr) {
      const d = drivers[abbr];
      if (d.in_pit) return;   // pit lane handled in 6.4

      const targetFraction = typeof d.lap_fraction === 'number' ? d.lap_fraction : null;
      if (targetFraction === null) return;

      // Estimate speed from avg lap time (~95s for F1)
      // speed = fraction per second = 1 / lap_time_seconds
      const lapTimeSecs = d.last_lap ? lapTimeToSeconds(d.last_lap) : 95.0;
      const speed = lapTimeSecs > 0 ? 1.0 / lapTimeSecs : 1.0 / 95.0;

      // Extrapolated target: where the driver should be right now
      const extrapolated = (targetFraction + speed * secsSincePoll) % 1.0;

      if (!_driverPos[abbr]) {
        _driverPos[abbr] = { fraction: extrapolated };
      } else {
        _driverPos[abbr].fraction = lerpFraction(
          _driverPos[abbr].fraction, extrapolated, LERP_FACTOR
        );
      }

      const pos   = fractionToXY(_driverPos[abbr].fraction);
      const color = d.team_colour ? '#' + d.team_colour.replace('#', '') : C.fallback;

      // Dot
      _ctx.beginPath();
      _ctx.arc(pos.x, pos.y, _dotR, 0, 2 * Math.PI);
      _ctx.fillStyle   = color;
      _ctx.fill();
      _ctx.strokeStyle = C.dotBorder;
      _ctx.lineWidth   = 1.5;
      _ctx.stroke();

      // Label
      const angle    = fractionToAngle(_driverPos[abbr].fraction);
      const labelX   = pos.x + Math.cos(angle) * (_dotR + LABEL_OFFSET);
      const labelY   = pos.y + Math.sin(angle) * (_dotR + LABEL_OFFSET);
      _ctx.fillStyle    = C.text;
      _ctx.font         = 'bold 8px JetBrains Mono, monospace';
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText(abbr, labelX, labelY);
    });
  }

  // Parse "1:33.771" → seconds
  function lapTimeToSeconds(lapTime) {
    if (!lapTime) return 95.0;
    try {
      const parts = lapTime.split(':');
      return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    } catch (e) {
      return 95.0;
    }
  }

  // ── Pit lane drivers ───────────────────────────────────────────────────────
  function updatePitDrivers() {
    if (!_lastState || !_lastState.drivers) return;
    const drivers = _lastState.drivers;

    // Maintain stable order — keep existing pit drivers in their slot,
    // append newly pitting drivers at the end, remove drivers that rejoined
    const nowInPit = Object.keys(drivers).filter(function (a) {
      return drivers[a].in_pit;
    });

    // Remove drivers that left the pit
    _pitDrivers = _pitDrivers.filter(function (a) {
      return nowInPit.indexOf(a) !== -1;
    });

    // Add newly pitting drivers
    nowInPit.forEach(function (a) {
      if (_pitDrivers.indexOf(a) === -1) _pitDrivers.push(a);
    });
  }

  function drawPitDrivers() {
    if (!_lastState || !_lastState.drivers) return;
    if (!_pitDrivers.length) return;

    const drivers  = _lastState.drivers;
    const pitF     = _circuit.pit_fraction;

    // Pit lane centre point (inward from circle)
    const pitCentre = fractionToXY(pitF, _radius - PIT_LABEL_OFFSET + 6);

    // Direction vector pointing inward along the radius at pit_fraction
    const angle   = fractionToAngle(pitF);
    const perpX   = -Math.sin(angle);   // perpendicular to radius = along circle tangent
    const perpY   =  Math.cos(angle);

    // Spacing between dots in the pit lane
    const spacing = _dotR * 2.8;
    // Centre the group of dots
    const totalW  = (_pitDrivers.length - 1) * spacing;
    const startX  = pitCentre.x - perpX * totalW / 2;
    const startY  = pitCentre.y - perpY * totalW / 2;

    _pitDrivers.forEach(function (abbr, i) {
      const d = drivers[abbr];
      if (!d) return;

      const x     = startX + perpX * i * spacing;
      const y     = startY + perpY * i * spacing;
      const color = d.team_colour ? '#' + d.team_colour.replace('#', '') : C.fallback;

      // Dot — slightly smaller, dashed border to distinguish from on-track
      _ctx.beginPath();
      _ctx.arc(x, y, _dotR * 0.85, 0, 2 * Math.PI);
      _ctx.fillStyle = color;
      _ctx.fill();
      _ctx.setLineDash([2, 2]);
      _ctx.strokeStyle = C.dotBorder;
      _ctx.lineWidth   = 1.5;
      _ctx.stroke();
      _ctx.setLineDash([]);

      // Label
      _ctx.fillStyle    = C.text;
      _ctx.font         = 'bold 7px JetBrains Mono, monospace';
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText(abbr, x, y + _dotR * 0.85 + 8);
    });
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window._circleMap = { fractionToXY: fractionToXY };

})();
