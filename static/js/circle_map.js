/**
 * circle_map.js — Circular track map for Page 2 (Timing Tower)
 *
 * Orientation: clockwise, 12 o'clock = start/finish line
 * Driver position derived from lap_fraction (0.0–1.0) → angle → x,y
 */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const PADDING = 20;         // px gap between canvas edge and track circle
  const DOT_RADIUS_DESKTOP = 8;
  const DOT_RADIUS_MOBILE  = 6;
  const MOBILE_BREAKPOINT  = 600;

  // ── State ──────────────────────────────────────────────────────────────────
  let _canvas  = null;
  let _ctx     = null;
  let _cx      = 0;   // centre x
  let _cy      = 0;   // centre y
  let _radius  = 0;   // track circle radius
  let _dotR    = DOT_RADIUS_DESKTOP;
  let _lastState = null;

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    _canvas = document.getElementById('circle-map-canvas');
    if (!_canvas) return;   // not on timing page

    _ctx = _canvas.getContext('2d');

    resize();
    window.addEventListener('resize', resize);

    // Subscribe to polling updates
    document.addEventListener('f1:update', function (e) {
      _lastState = e.detail;
      draw();
    });

    // Draw placeholder immediately so canvas isn't blank
    draw();
  }

  // ── Resize ─────────────────────────────────────────────────────────────────
  function resize() {
    if (!_canvas) return;

    const container = _canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;

    // Match canvas resolution to container (fixes blurry canvas on retina)
    const dpr = window.devicePixelRatio || 1;
    _canvas.width  = w * dpr;
    _canvas.height = h * dpr;
    _canvas.style.width  = w + 'px';
    _canvas.style.height = h + 'px';
    _ctx.scale(dpr, dpr);

    // Recalculate geometry
    _cx     = w / 2;
    _cy     = h / 2;
    _radius = Math.min(w, h) / 2 - PADDING;
    _dotR   = w < MOBILE_BREAKPOINT ? DOT_RADIUS_MOBILE : DOT_RADIUS_DESKTOP;

    draw();
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────
  /**
   * Convert lap_fraction (0.0–1.0) to canvas x,y.
   * 0.0 and 1.0 = 12 o'clock (top), clockwise.
   */
  function fractionToXY(fraction, r) {
    r = r !== undefined ? r : _radius;
    // 12 o'clock = -π/2, clockwise = positive angle
    const angle = (fraction * 2 * Math.PI) - (Math.PI / 2);
    return {
      x: _cx + r * Math.cos(angle),
      y: _cy + r * Math.sin(angle),
    };
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  function draw() {
    if (!_ctx) return;

    const w = _canvas.width  / (window.devicePixelRatio || 1);
    const h = _canvas.height / (window.devicePixelRatio || 1);

    // Clear
    _ctx.clearRect(0, 0, w, h);

    drawPlaceholder();
  }

  // Placeholder — shown until real drawing phases are added
  function drawPlaceholder() {
    _ctx.strokeStyle = '#2a2a2a';
    _ctx.lineWidth   = 2;
    _ctx.beginPath();
    _ctx.arc(_cx, _cy, _radius, 0, 2 * Math.PI);
    _ctx.stroke();

    // Start/finish tick at 12 o'clock
    const sf = fractionToXY(0);
    _ctx.strokeStyle = '#ffffff';
    _ctx.lineWidth = 2;
    _ctx.beginPath();
    _ctx.moveTo(sf.x, sf.y - 8);
    _ctx.lineTo(sf.x, sf.y + 8);
    _ctx.stroke();

    // "CIRCLE MAP" label
    _ctx.fillStyle    = '#333333';
    _ctx.font         = '12px JetBrains Mono, monospace';
    _ctx.textAlign    = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.fillText('CIRCLE MAP', _cx, _cy);
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export helpers for later phases
  window._circleMap = { fractionToXY: fractionToXY };

})();
