// 2D line graph for curves; compare values dashed, selected points marked.
import { setupCanvas, token } from './dom.js';
import { strictlyMonotonic } from '../ops.js';

export function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 1.5 ? 2 : 1) * mag;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let k = 0; k < 50; k++) {
    const v = Number((start + k * step).toFixed(10));
    ticks.push(v);
    if (v >= hi) break;
  }
  if (ticks.length < 2) ticks.push(Number((ticks[0] + step).toFixed(10)));
  return ticks;
}

export function drawCurve(canvas, d) {
  const { g, width: w, height: h } = setupCanvas(canvas);
  if (w < 40 || h < 40) return;
  const { values, ref, xs, selIdx } = d;
  const n = values.length;
  const numeric = xs.length === n && xs.every(v => typeof v === 'number' && Number.isFinite(v)) && strictlyMonotonic(xs);
  const xv = numeric ? xs : values.map((_, i) => i);
  let x0 = Math.min(...xv), x1 = Math.max(...xv);
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const all = ref ? values.concat(ref) : values;
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const m = { l: 60, r: 16, t: 14, b: 38 };
  const X = v => m.l + ((v - x0) / (x1 - x0)) * (w - m.l - m.r);
  const Y = v => h - m.b - ((v - y0) / (y1 - y0)) * (h - m.t - m.b);
  const fg = token('--fg'), muted = token('--muted'), grid = token('--cell-line'), accent = token('--accent');

  g.font = '11px "JetBrains Mono", ui-monospace, Menlo, monospace';
  g.lineWidth = 1;
  g.strokeStyle = grid;
  g.fillStyle = muted;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (const t of ticks) {
    g.beginPath();
    g.moveTo(m.l, Y(t));
    g.lineTo(w - m.r, Y(t));
    g.stroke();
    g.fillText(d.fmtY(t), m.l - 8, Y(t));
  }
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - m.l - m.r) / 58))));
  for (let i = 0; i < n; i += every) g.fillText(d.fmtX(xs[i] ?? i), X(xv[i]), h - m.b + 8);
  if (d.zeroLine && y0 <= 0 && y1 >= 0) {                 // differences: mark where A equals B
    g.save();
    g.strokeStyle = muted;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(m.l, Y(0));
    g.lineTo(w - m.r, Y(0));
    g.stroke();
    g.restore();
  }

  const path = (vals, dash, color, width) => {
    g.save();
    g.setLineDash(dash);
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    vals.forEach((v, i) => (i ? g.lineTo(X(xv[i]), Y(v)) : g.moveTo(X(xv[i]), Y(v))));
    g.stroke();
    g.restore();
  };
  if (ref) {
    const cmp = token('--cmp');
    path(ref, [6, 4], cmp, 2.2);
    g.fillStyle = cmp;
    ref.forEach((v, i) => {
      g.beginPath();
      g.arc(X(xv[i]), Y(v), 2.5, 0, Math.PI * 2);
      g.fill();
    });
  }
  // Differences are coloured by sign: blue below zero, red above (the height shows the size).
  const below = token('--dplot-lo'), above = token('--dplot-hi');
  const signColour = v => (v < 0 ? below : v > 0 ? above : muted);
  if (d.diverging) {
    g.save();
    g.lineWidth = 2.5;
    for (let i = 1; i < n; i++) {
      g.strokeStyle = signColour((values[i - 1] + values[i]) / 2);
      g.beginPath();
      g.moveTo(X(xv[i - 1]), Y(values[i - 1]));
      g.lineTo(X(xv[i]), Y(values[i]));
      g.stroke();
    }
    g.restore();
  } else {
    path(values, [], accent, 2);
  }
  values.forEach((v, i) => {
    const on = selIdx && i >= selIdx[0] && i <= selIdx[1];
    g.beginPath();
    g.arc(X(xv[i]), Y(v), on ? 4.5 : d.diverging ? 3 : 2.5, 0, Math.PI * 2);
    g.fillStyle = on ? accent : d.diverging ? signColour(v) : fg;
    g.fill();
  });
}
