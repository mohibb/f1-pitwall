const POLL_INTERVAL = 1000;

const STATUS_MAP = {
    '1': null,
    '2': { label: 'YELLOW FLAG',    cls: 'yellow' },
    '4': { label: 'SAFETY CAR',     cls: 'sc'     },
    '5': { label: 'RED FLAG',       cls: 'red'    },
    '6': { label: 'VSC DEPLOYED',   cls: 'vsc'    },
    '7': { label: 'VSC ENDING',     cls: 'vsc'    },
};

async function poll() {
    try {
        const res = await fetch('/api/state');
        if (!res.ok) return;
        const state = await res.json();

        window._f1state = state;

        updateModeBadge(state.mode);
        updateIdleOverlay(state.mode);
        updateSessionStrip(state.session);
        updateTrackStatusBanner(state.track_status);

        document.dispatchEvent(new CustomEvent('f1:update', { detail: state }));
    } catch (e) {
        console.warn('[poll] fetch failed:', e);
    }
}

function updateIdleOverlay(mode) {
    const overlay = document.getElementById('idle-overlay');
    if (!overlay) return;
    overlay.style.display = (mode === 'IDLE') ? 'flex' : 'none';
}

function updateModeBadge(mode) {
    const badge = document.getElementById('mode-badge');
    if (!badge) return;
    if (mode === 'LIVE') {
        badge.textContent = '● LIVE';
        badge.className = 'mode-badge live';
    } else if (mode === 'REPLAY') {
        badge.textContent = '↺ REPLAY';
        badge.className = 'mode-badge replay';
    } else {
        badge.textContent = '— IDLE';
        badge.className = 'mode-badge idle';
    }
}

function updateSessionStrip(session) {
    if (!session) return;
    const el = (id) => document.getElementById(id);
    if (session.circuit)  el('strip-circuit').textContent = session.circuit.toUpperCase();
    if (session.round)    el('strip-round').textContent   = `R${session.round}`;
    if (session.name)     el('strip-session').textContent = session.name.toUpperCase();
    if (session.simulated_time) el('strip-clock').textContent = session.simulated_time;

    const lapEl = el('strip-lap');
    if (session.current_lap && session.total_laps) {
        lapEl.textContent = `LAP ${session.current_lap}/${session.total_laps}`;
    } else if (session.total_laps) {
        lapEl.textContent = `${session.total_laps} LAPS`;
    }
}

function updateTrackStatusBanner(status) {
    const banner  = document.getElementById('track-status-banner');
    const content = document.getElementById('main-content');
    if (!banner) return;

    const info = STATUS_MAP[status];
    if (info) {
        banner.textContent = info.label;
        banner.className   = `track-status-banner visible ${info.cls}`;
        if (content) content.classList.add('has-status-banner');
    } else {
        banner.textContent = '';
        banner.className   = 'track-status-banner';
        if (content) content.classList.remove('has-status-banner');
    }
}

setInterval(poll, POLL_INTERVAL);
poll();
