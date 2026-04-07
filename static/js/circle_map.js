/**
 * circle_map.js — Circular track map for Page 2 (Timing Tower)
 *
 * Orientation: clockwise, 12 o'clock = start/finish line
 * Driver position derived from lap_fraction (0.0-1.0) -> angle -> x,y
 */

(function () {
  'use strict';

  // Constants
  const PADDING            = 32;
  const DOT_RADIUS_DESKTOP = 8;
  const DOT_RADIUS_MOBILE  = 6;
  const MOBILE_BREAKPOINT  = 600;
  const TRACK_WIDTH        = 8;
  const PIT_NOTCH_ANGLE    = 0.06;
  const PIT_LABEL_OFFSET   = 28;
  const SECTOR_TICK_INNER  = 0.82;
  const SECTOR_TICK_OUTER  = 1.05;
  const LERP_FACTOR        = 0.05;
  const LABEL_OFFSET       = 14;

  // Colours
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

  // State
  let _canvas    = null;
  let _ctx       = null;
  let _cx        = 0;
  let _cy        = 0;
  let _radius    = 0;
  let _dotR      = DOT_RADIUS_DESKTOP;
  let _lastState = null;
  let _circuit   = null;
  let _circuits  = {};
  let _driverPos  = {};
  let _lastPollMs = 0;
  let _pitDrivers = [];
  let _selected   = null;
  let _mouseX     = 0;
  let _mouseY     = 0;
  let _lastTouchMs  = 0;
  let _touchStartX  = 0;
  let _touchStartY  = 0;

  // Init
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
      });

      _canvas.addEventListener('mousemove', onMouseMove);
      _canvas.addEventListener('click', onClick);
      document.addEventListener('touchstart', function(e) {
        const touch = e.touches && e.touches[0];
        if (!touch) return;
        const rect = _canvas.getBoundingClientRect();
        _touchStartX = touch.clientX - rect.left;
        _touchStartY = touch.clientY - rect.top;
      }, { passive: true });
      document.addEventListener('touchend', function(e) {
        const touch = e.changedTouches && e.changedTouches[0];
        if (!touch) return;
        const rect = _canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        // Only handle if touch ended within canvas bounds
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
        // Only handle if finger didn't move much (it's a tap not a scroll)
        const dx = Math.abs(x - _touchStartX);
        const dy = Math.abs(y - _touchStartY);
        if (dx > 10 || dy > 10) return;
        _lastTouchMs = performance.now();
        const hit = hitTest(x, y, 24);
        _selected = (hit && hit !== _selected) ? hit : null;
        updateDetailPanel();
      }, { passive: true });
      // Attach touch to parent panel for better mobile compatibility
      const mapPanel = _canvas.parentElement;
      if (mapPanel) {
        mapPanel.addEventListener('touchend', onTouch, { passive: true });
      }

      animationLoop();
    });
  }

  // Load circuit config
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

  // Resize
  function resize() {
    if (!_canvas) return;
    const container = _canvas.parentElement;
    const w = container.clientWidth;
    const h = _canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    _canvas.width  = w * dpr;
    _canvas.height = h * dpr;
    _canvas.style.width  = w + 'px';
    _canvas.style.height = h + 'px';
    _ctx.setTransform(1, 0, 0, 1, 0, 0);  // reset transform before scaling
    _ctx.scale(dpr, dpr);
    _cx     = w / 2;
    _cy     = h / 2;
    _radius = Math.max(10, Math.min(w, h) / 2 - PADDING);
    _dotR   = w < MOBILE_BREAKPOINT ? DOT_RADIUS_MOBILE : DOT_RADIUS_DESKTOP;
    _driverPos = {};
  }

  // Coordinate helpers
  function fractionToAngle(fraction) {
    return (fraction * 2 * Math.PI) - (Math.PI / 2);
  }

  function fractionToXY(fraction, r) {
    r = r !== undefined ? r : _radius;
    const a = fractionToAngle(fraction);
    return { x: _cx + r * Math.cos(a), y: _cy + r * Math.sin(a) };
  }

  function lerpFraction(current, target, t) {
    let delta = target - current;
    if (delta > 0.5)  delta -= 1.0;
    if (delta < -0.5) delta += 1.0;
    return (current + delta * t + 1.0) % 1.0;
  }

  function lapTimeToSeconds(lapTime) {
    if (!lapTime) return 95.0;
    try {
      const parts = lapTime.split(':');
      return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    } catch (e) { return 95.0; }
  }

  function getPitLoss() {
    if (_lastState && _lastState.session && _lastState.session.pit_stop_duration) {
      return _lastState.session.pit_stop_duration;
    }
    return 25;
  }

  // Animation loop
  function animationLoop() {
    draw();
    requestAnimationFrame(animationLoop);
  }

  // Draw
  function draw() {
    if (!_ctx || !_circuit || _radius <= 10) return;
    const w = _canvas.width  / (window.devicePixelRatio || 1);
    const h = _canvas.height / (window.devicePixelRatio || 1);
    _ctx.clearRect(0, 0, w, h);

    drawTrackCircle();
    drawPitWindow();
    drawSectorMarkers();
    drawPitLane();
    drawStartFinish();
    drawDrivers();
    drawPitDrivers();
    drawGhostDot();
    drawTooltip();
  }

  // Track status colour + pulse
  function trackStatusStyle() {
    const status = _lastState ? (_lastState.track_status || '1') : '1';
    const t      = performance.now() / 1000;
    const pulse  = 0.55 + 0.45 * Math.sin(t * Math.PI * 2);

    switch (status) {
      case '2': return { color: '#ffd700', alpha: 1.0,   width: TRACK_WIDTH };
      case '4': return { color: '#ffd700', alpha: pulse,  width: TRACK_WIDTH + 2 };
      case '5': return { color: '#ff0000', alpha: 1.0,   width: TRACK_WIDTH + 2 };
      case '6': return { color: '#ffa500', alpha: pulse,  width: TRACK_WIDTH + 2 };
      case '7': return { color: '#ffa500', alpha: 0.5,   width: TRACK_WIDTH };
      default:  return { color: C.track,   alpha: 1.0,   width: TRACK_WIDTH };
    }
  }

  // Track circle
  function drawTrackCircle() {
    const pitF   = _circuit.pit_fraction;
    const gap    = PIT_NOTCH_ANGLE;
    const startA = fractionToAngle(pitF + gap / 2);
    const endA   = fractionToAngle(pitF - gap / 2 + 1) - 2 * Math.PI;

    const style  = trackStatusStyle();
    _ctx.globalAlpha = style.alpha;
    _ctx.strokeStyle = style.color;
    _ctx.lineWidth   = style.width;
    _ctx.lineCap     = 'butt';
    _ctx.beginPath();
    _ctx.arc(_cx, _cy, _radius, startA, endA, false);
    _ctx.stroke();
    _ctx.globalAlpha = 1.0;

    // Status label
    const label = { '4': 'SC', '6': 'VSC', '5': 'RED FLAG', '2': 'YELLOW' }[
      _lastState ? _lastState.track_status : '1'
    ];
    if (label) {
      const style2  = trackStatusStyle();
      _ctx.fillStyle    = style2.color;
      _ctx.globalAlpha  = style2.alpha;
      _ctx.font         = 'bold 11px JetBrains Mono, monospace';
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText(label, _cx, _cy);
      _ctx.globalAlpha  = 1.0;
    }
  }

  // Sector markers
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

  // Pit lane
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

  // Start/finish line
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

  // Driver dots
  function drawDrivers() {
    if (!_lastState || !_lastState.drivers) return;
    const drivers = _lastState.drivers;
    const keys    = Object.keys(drivers);
    if (!keys.length) return;

    const msSincePoll   = performance.now() - _lastPollMs;
    const secsSincePoll = Math.min(msSincePoll / 1000, 2.0);

    keys.sort(function (a, b) {
      return (drivers[b].position || 99) - (drivers[a].position || 99);
    });

    keys.forEach(function (abbr) {
      const d = drivers[abbr];
      if (d.in_pit) return;

      const targetFraction = typeof d.lap_fraction === 'number' ? d.lap_fraction : null;
      if (targetFraction === null) return;

      const lapTimeSecs = d.last_lap ? lapTimeToSeconds(d.last_lap) : 95.0;
      const speed       = lapTimeSecs > 0 ? 1.0 / lapTimeSecs : 1.0 / 95.0;
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
      const isSelected = abbr === _selected;

      _ctx.beginPath();
      _ctx.arc(pos.x, pos.y, _dotR, 0, 2 * Math.PI);
      _ctx.fillStyle   = color;
      _ctx.fill();
      _ctx.strokeStyle = isSelected ? '#ffd700' : C.dotBorder;
      _ctx.lineWidth   = isSelected ? 2.5 : 1.5;
      _ctx.stroke();

      const angle  = fractionToAngle(_driverPos[abbr].fraction);
      const labelX = pos.x + Math.cos(angle) * (_dotR + LABEL_OFFSET);
      const labelY = pos.y + Math.sin(angle) * (_dotR + LABEL_OFFSET);
      _ctx.fillStyle    = C.text;
      _ctx.font         = 'bold 8px JetBrains Mono, monospace';
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText(abbr, labelX, labelY);
    });
  }

  // Pit lane drivers
  function updatePitDrivers() {
    if (!_lastState || !_lastState.drivers) return;
    const drivers  = _lastState.drivers;
    const nowInPit = Object.keys(drivers).filter(function (a) { return drivers[a].in_pit; });
    _pitDrivers = _pitDrivers.filter(function (a) { return nowInPit.indexOf(a) !== -1; });
    nowInPit.forEach(function (a) {
      if (_pitDrivers.indexOf(a) === -1) _pitDrivers.push(a);
    });
  }

  function drawPitDrivers() {
    if (!_lastState || !_lastState.drivers) return;
    if (!_pitDrivers.length) return;

    const drivers   = _lastState.drivers;
    const pitF      = _circuit.pit_fraction;
    const pitCentre = fractionToXY(pitF, _radius - PIT_LABEL_OFFSET + 6);
    const angle     = fractionToAngle(pitF);
    const perpX     = -Math.sin(angle);
    const perpY     =  Math.cos(angle);
    const spacing   = _dotR * 2.8;
    const totalW    = (_pitDrivers.length - 1) * spacing;
    const startX    = pitCentre.x - perpX * totalW / 2;
    const startY    = pitCentre.y - perpY * totalW / 2;

    _pitDrivers.forEach(function (abbr, i) {
      const d = drivers[abbr];
      if (!d) return;
      const x     = startX + perpX * i * spacing;
      const y     = startY + perpY * i * spacing;
      const color = d.team_colour ? '#' + d.team_colour.replace('#', '') : C.fallback;
      const isSelected = abbr === _selected;

      _ctx.beginPath();
      _ctx.arc(x, y, _dotR * 0.85, 0, 2 * Math.PI);
      _ctx.fillStyle = color;
      _ctx.fill();
      _ctx.setLineDash([2, 2]);
      _ctx.strokeStyle = isSelected ? '#ffd700' : C.dotBorder;
      _ctx.lineWidth   = isSelected ? 2.5 : 1.5;
      _ctx.stroke();
      _ctx.setLineDash([]);

      _ctx.fillStyle    = C.text;
      _ctx.font         = 'bold 7px JetBrains Mono, monospace';
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText(abbr, x, y + _dotR * 0.85 + 8);
    });
  }

  // Interaction
  function onMouseMove(e) {
    const rect = _canvas.getBoundingClientRect();
    _mouseX = e.clientX - rect.left;
    _mouseY = e.clientY - rect.top;
  }

  function onClick(e) {
    const rect = _canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = hitTest(x, y, 24);
    _selected  = (hit && hit !== _selected) ? hit : null;
    updateDetailPanel();
  }

  function onTouch(e) {
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const rect = _canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    const hit = hitTest(x, y);
_selected  = (hit && hit !== _selected) ? hit : null;
    updateDetailPanel();
  }

  function hitTest(x, y) {
    if (!_lastState || !_lastState.drivers) return null;
    const hitR    = _dotR + 6;
    const drivers = _lastState.drivers;

    for (const abbr of Object.keys(drivers)) {
      if (drivers[abbr].in_pit) continue;
      if (!_driverPos[abbr]) continue;
      const pos = fractionToXY(_driverPos[abbr].fraction);
      const dx  = pos.x - x;
      const dy  = pos.y - y;
      if (Math.sqrt(dx * dx + dy * dy) <= hitR) return abbr;
    }

    if (_pitDrivers.length) {
      const pitF      = _circuit.pit_fraction;
      const pitCentre = fractionToXY(pitF, _radius - PIT_LABEL_OFFSET + 6);
      const angle     = fractionToAngle(pitF);
      const perpX     = -Math.sin(angle);
      const perpY     =  Math.cos(angle);
      const spacing   = _dotR * 2.8;
      const totalW    = (_pitDrivers.length - 1) * spacing;
      const startX    = pitCentre.x - perpX * totalW / 2;
      const startY    = pitCentre.y - perpY * totalW / 2;
      for (let i = 0; i < _pitDrivers.length; i++) {
        const dx = (startX + perpX * i * spacing) - x;
        const dy = (startY + perpY * i * spacing) - y;
        if (Math.sqrt(dx * dx + dy * dy) <= hitR) return _pitDrivers[i];
      }
    }
    return null;
  }

  // Tooltip — only show on hover when nothing is selected
  function drawTooltip() {
    if (_selected || !_lastState || !_lastState.drivers) return;
    const d = _lastState.drivers[_selected];
    if (!d) return;

    const lines = [
      _selected,
      'P' + (d.position || '?') + '  ' + (d.gap_to_leader || '-'),
      (d.compound || '?') + '  Age: ' + (d.tyre_life || '?') + 'L',
      d.in_pit ? 'IN PIT' : ('INT: ' + (d.interval || '-')),
    ];

    const PAD = 10;
    const LH  = 16;
    const W   = 130;
    const H   = PAD * 2 + lines.length * LH;
    const cw  = _canvas.width  / (window.devicePixelRatio || 1);
    const ch  = _canvas.height / (window.devicePixelRatio || 1);
    let tx = _mouseX + 14;
    let ty = _mouseY - H / 2;
    if (tx + W > cw) tx = _mouseX - W - 14;
    if (ty < 4) ty = 4;
    if (ty + H > ch) ty = ch - H - 4;

    _ctx.fillStyle   = 'rgba(10,10,10,0.92)';
    _ctx.strokeStyle = '#444';
    _ctx.lineWidth   = 1;
    _ctx.beginPath();
    _ctx.roundRect(tx, ty, W, H, 4);
    _ctx.fill();
    _ctx.stroke();

    _ctx.textAlign    = 'left';
    _ctx.textBaseline = 'top';
    lines.forEach(function (line, i) {
      _ctx.fillStyle = i === 0 ? '#ffffff' : '#aaaaaa';
      _ctx.font      = i === 0
        ? 'bold 11px JetBrains Mono, monospace'
        : '10px JetBrains Mono, monospace';
      _ctx.fillText(line, tx + PAD, ty + PAD + i * LH);
    });
  }

  // Pit window arc
  function drawPitWindow() {
    if (!_selected || !_lastState || !_lastState.drivers) return;
    const d = _lastState.drivers[_selected];
    if (!d || d.in_pit || !_driverPos[_selected]) return;

    const lapTimeSecs     = d.last_lap ? lapTimeToSeconds(d.last_lap) : 95.0;
    const pitLossFraction = getPitLoss() / lapTimeSecs;
    const driverFraction  = _driverPos[_selected].fraction;
    const startAngle      = fractionToAngle(driverFraction);
    const endAngle        = fractionToAngle((driverFraction - pitLossFraction + 1.0) % 1.0);

    _ctx.beginPath();
    _ctx.arc(_cx, _cy, _radius, endAngle, startAngle, false);
    _ctx.strokeStyle = 'rgba(255, 215, 0, 0.15)';
    _ctx.lineWidth   = TRACK_WIDTH + 2;
    _ctx.stroke();

    _ctx.beginPath();
    _ctx.arc(_cx, _cy, _radius, endAngle, startAngle, false);
    _ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
    _ctx.lineWidth   = 1;
    _ctx.stroke();
  }

  // Ghost rejoin dot
  function drawGhostDot() {
    if (!_selected || !_lastState || !_lastState.drivers) return;
    const d = _lastState.drivers[_selected];
    if (!d || d.in_pit || !_driverPos[_selected]) return;

    const lapTimeSecs     = d.last_lap ? lapTimeToSeconds(d.last_lap) : 95.0;
    const pitLossFraction = getPitLoss() / lapTimeSecs;
    const rejoinFraction  = (_driverPos[_selected].fraction - pitLossFraction + 1.0) % 1.0;
    const pos             = fractionToXY(rejoinFraction);
    const color           = d.team_colour ? '#' + d.team_colour.replace('#', '') : C.fallback;

    _ctx.globalAlpha = 0.4;
    _ctx.beginPath();
    _ctx.arc(pos.x, pos.y, _dotR, 0, 2 * Math.PI);
    _ctx.fillStyle = color;
    _ctx.fill();
    _ctx.globalAlpha = 1.0;

    _ctx.setLineDash([3, 3]);
    _ctx.strokeStyle = '#ffffff';
    _ctx.lineWidth   = 1.5;
    _ctx.beginPath();
    _ctx.arc(pos.x, pos.y, _dotR, 0, 2 * Math.PI);
    _ctx.stroke();
    _ctx.setLineDash([]);

    _ctx.fillStyle    = 'rgba(255,255,255,0.5)';
    _ctx.font         = '8px JetBrains Mono, monospace';
    _ctx.textAlign    = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.fillText('REJOIN', pos.x, pos.y + _dotR + 10);
  }

  // Detail panel
  function updateDetailPanel() {
    const panel = document.getElementById('map-detail');
    if (!panel) return;

    if (!_selected || !_lastState || !_lastState.drivers[_selected]) {
      panel.innerHTML = '<div class="map-detail-empty">Tap a driver to see details</div>';
      return;
    }

    const d     = _lastState.drivers[_selected];
    const color = d.team_colour ? '#' + d.team_colour.replace('#', '') : '#555';
    const TYRE_COLOURS = {
      SOFT: '#e8002d', MEDIUM: '#ffd700', HARD: '#ffffff',
      INTER: '#39b54a', WET: '#0067ff', UNKNOWN: '#888888'
    };
    const tyreColor = TYRE_COLOURS[d.compound] || '#888888';

    panel.innerHTML = `
      <div class="map-detail-card">
        <div class="map-detail-header">
          <div style="width:4px;height:28px;border-radius:2px;background:${color};flex-shrink:0"></div>
          <div>
            <div class="map-detail-name">${_selected}</div>
            <div class="map-detail-team">${d.team || ''}</div>
          </div>
          <div class="map-detail-pos">P${d.position || '?'}</div>
        </div>
        <div class="map-detail-row">
          <span class="map-detail-label">GAP</span>
          <span class="map-detail-value">${d.gap_to_leader || '-'}</span>
        </div>
        <div class="map-detail-row">
          <span class="map-detail-label">INTERVAL</span>
          <span class="map-detail-value">${d.in_pit ? 'IN PIT' : (d.interval || '-')}</span>
        </div>
        <div class="map-detail-row">
          <span class="map-detail-label">LAST LAP</span>
          <span class="map-detail-value">${d.last_lap || '-'}</span>
        </div>
        <div class="map-detail-row">
          <span class="map-detail-label">BEST LAP</span>
          <span class="map-detail-value">${d.best_lap || '-'}</span>
        </div>
        <div class="map-detail-row">
          <span class="map-detail-label">TYRE</span>
          <span class="map-detail-value">
            <span class="map-detail-tyre-dot" style="background:${tyreColor}"></span>
            ${d.compound || '?'} - ${d.tyre_life || '?'}L
          </span>
        </div>
        <div class="map-detail-row">
          <span class="map-detail-label">STOPS</span>
          <span class="map-detail-value">${d.pit_stops !== undefined ? d.pit_stops : '-'}</span>
        </div>
        <div class="map-detail-row">
          <span class="map-detail-label">SECTORS</span>
          <span class="map-detail-value">${d.sector_1 || '-'} / ${d.sector_2 || '-'} / ${d.sector_3 || '-'}</span>
        </div>
      </div>
    `;
  }

  // Bootstrap
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window._circleMap = { fractionToXY: fractionToXY };

})();
