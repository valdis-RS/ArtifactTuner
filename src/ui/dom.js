// Small DOM helpers shared by the UI modules.

export const $ = id => document.getElementById(id);

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

export const hex = (n, width = 0) => '0x' + n.toString(16).toUpperCase().padStart(width, '0');

export const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

export function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('artifact-tuner.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('artifact-tuner.' + key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable (private window, blocked site data); preferences are optional.
    }
  },
};

export const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function rgb(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

export const css = ([r, g, b], a = 1) => `rgb(${r} ${g} ${b} / ${a})`;

const ramps = new Map();

export function resetTheme() {
  ramps.clear();
}

// Colour for t in [0, 1] on the three-stop ramp --<kind>-lo / -mid / -hi.
export function rampRgb(t, kind = 'heat') {
  if (!ramps.has(kind)) ramps.set(kind, ['lo', 'mid', 'hi'].map(s => rgb(token(`--${kind}-${s}`))));
  const [a, b, c] = ramps.get(kind);
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const [p, q, k] = u < 0.5 ? [a, b, u * 2] : [b, c, (u - 0.5) * 2];
  return p.map((v, i) => Math.round(v + (q[i] - v) * k));
}

export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);
  return { g, width, height };
}
