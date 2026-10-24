// Canvas 3D surface for maps: shaded quads drawn back to front, the
// selection marked on its vertices, compare values as a dashed wireframe.
import { setupCanvas, token, rampRgb, css } from './dom.js';
import { normSel } from '../ops.js';

export const DEFAULT_CAM = { yaw: -0.65, pitch: 0.62, zoom: 1 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
const LIGHT = unit([0.35, 0.45, 0.82]);

export function drawSurface(canvas, d, cam) {
  const { g, width: w, height: h } = setupCanvas(canvas);
  if (w < 40 || h < 40) return;
  const { grid, ref } = d;
  const rows = grid.length, cols = grid[0].length;
  let lo = Infinity, hi = -Infinity;
  for (const src of ref ? [grid, ref] : [grid]) {
    for (const row of src) for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  const span = hi - lo || 1;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const scale = Math.min(w, h) * 0.30 * cam.zoom;
  const ox = w / 2, oy = h / 2 + scale * 0.12;
  // Model space: columns on x in [-1, 1], rows on y in [1, -1], value on z in [-0.6, 0.6].
  const xpos = c => (cols > 1 ? (c / (cols - 1)) * 2 - 1 : 0);
  const ypos = r => (rows > 1 ? 1 - (r / (rows - 1)) * 2 : 0);
  const model = (r, c, v) => [xpos(c), ypos(r), ((v - lo) / span - 0.5) * 1.2];
  // Orthographic view: yaw turns the floor, pitch tilts it towards the viewer.
  const project = ([x, y, z]) => {
    const X = x * cy - y * sy, Y = x * sy + y * cy;
    return { x: ox + X * scale, y: oy - (Y * sp + z * cp) * scale, depth: Y * cp - z * sp };
  };
  const M = grid.map((row, r) => row.map((v, c) => model(r, c, v)));
  const S = M.map(row => row.map(project));

  const quads = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const pts = [S[r][c], S[r][c + 1], S[r + 1][c + 1], S[r + 1][c]];
      quads.push({ r, c, pts, depth: (pts[0].depth + pts[1].depth + pts[2].depth + pts[3].depth) / 4 });
    }
  }
  quads.sort((a, b) => b.depth - a.depth);                // farthest first
  const edge = token('--cell-line'), accent = token('--accent'), muted = token('--muted'), fg = token('--fg');
  g.lineWidth = 0.6;
  g.lineJoin = 'round';
  for (const { r, c, pts } of quads) {
    const n = unit(cross(sub(M[r][c + 1], M[r][c]), sub(M[r + 1][c], M[r][c])));
    const lit = 0.7 + 0.3 * Math.abs(dot(n, LIGHT));
    const t = ((grid[r][c] + grid[r][c + 1] + grid[r + 1][c] + grid[r + 1][c + 1]) / 4 - lo) / span;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.fillStyle = css(rampRgb(t, 'plot').map(v => Math.round(v * lit)));
    g.fill();
    g.strokeStyle = edge;
    g.stroke();
  }

  if (ref) {
    const R = ref.map((row, r) => row.map((v, c) => project(model(r, c, v))));
    const line = pts => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
    };
    g.save();
    g.setLineDash([4, 3]);
    g.strokeStyle = muted;
    g.lineWidth = 1;
    R.forEach(line);
    for (let c = 0; c < cols; c++) line(R.map(row => row[c]));
    g.restore();
  }

  if (d.sel) {
    const s = normSel(d.sel);
    g.fillStyle = accent;
    for (let r = s.r0; r <= s.r1; r++) {
      for (let c = s.c0; c <= s.c1; c++) {
        const p = S[r]?.[c];
        if (!p) continue;
        g.beginPath();
        g.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // Axis end values just outside the floor, axis names further out, value range top-left.
  const at = (x, y) => project([x, y, -0.6]);
  const fit = s => (s.length > 28 ? s.slice(0, 27) + '…' : s);
  const put = (p, text) => {
    const half = g.measureText(text).width / 2;
    g.fillText(text, Math.min(w - 4 - half, Math.max(4 + half, p.x)), Math.min(h - 8, Math.max(8, p.y)));
  };
  g.font = '11px "JetBrains Mono", ui-monospace, Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = muted;
  put(at(xpos(0), -1.2), d.fmtX(d.xs[0]));
  put(at(xpos(cols - 1), -1.2), d.fmtX(d.xs[cols - 1]));
  put(at(-1.2, ypos(0)), d.fmtY(d.ys[0]));
  put(at(-1.2, ypos(rows - 1)), d.fmtY(d.ys[rows - 1]));
  g.fillStyle = fg;
  if (d.xLabel) put(at(0, -1.42), fit(d.xLabel));
  if (d.yLabel) put(at(-1.42, 0), fit(d.yLabel));
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillStyle = muted;
  g.fillText(fit(`${d.zLabel ? d.zLabel + ': ' : ''}`) + `${d.fmtZ(lo)} … ${d.fmtZ(hi)}`, 10, 10);
}

export function attachOrbit(canvas, cam, onChange, enabled) {
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (!enabled()) return;
    drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    cam.yaw = drag.yaw + (e.clientX - drag.x) * 0.01;
    cam.pitch = Math.min(1.5, Math.max(0.05, drag.pitch + (e.clientY - drag.y) * 0.01));
    onChange(false);
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    canvas.classList.remove('dragging');
    onChange(true);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => {
    if (!enabled()) return;
    e.preventDefault();
    cam.zoom = Math.min(3, Math.max(0.4, cam.zoom * Math.exp(-e.deltaY * 0.001)));
    onChange(true);
  }, { passive: false });
  canvas.addEventListener('dblclick', () => {
    if (!enabled()) return;
    Object.assign(cam, DEFAULT_CAM);
    onChange(true);
  });
}
