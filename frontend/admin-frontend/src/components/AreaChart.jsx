import { useState } from "react";
import { compact, formatPriceShort } from "../utils/format";

const W = 720;
const H = 270;
const PAD = { left: 52, right: 18, top: 24, bottom: 34 };

// A smooth line through the points (Catmull-Rom turned into Bezier curves).
function smooth(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    const top = PAD.top;
    const bottom = H - PAD.bottom;
    d += ` C ${c1.x} ${Math.min(bottom, Math.max(top, c1.y))} ${c2.x} ${Math.min(bottom, Math.max(top, c2.y))} ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Sales over time. points = [{ label, full_label, value }]. Hover a dot to see the value. */
export default function AreaChart({ points }) {
  const [hover, setHover] = useState(null);
  const values = points.map((p) => Number(p.value));
  const max = Math.max(...values, 0);
  const niceMax = max === 0 ? 1000 : Math.ceil(max / 4 / 10 ** Math.floor(Math.log10(max / 4))) * 4 * 10 ** Math.floor(Math.log10(max / 4));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => PAD.top + innerH - (v / niceMax) * innerH;
  const coords = points.map((p, i) => ({ x: x(i), y: y(Number(p.value)) }));
  const line = smooth(coords);
  const area = coords.length > 1 ? `${line} L ${coords[coords.length - 1].x} ${H - PAD.bottom} L ${coords[0].x} ${H - PAD.bottom} Z` : "";
  const ticks = [0, 1, 2, 3, 4].map((n) => (niceMax / 4) * n);
  const every = points.length > 12 ? Math.ceil(points.length / 8) : 1;

  return (
    <div className="ad-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sales over time" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="adArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.left - 10} y={y(t) + 4} textAnchor="end" className="axis">
              ₹{compact(t)}
            </text>
          </g>
        ))}
        {area && <path d={area} fill="url(#adArea)" />}
        {line && <path d={line} className="line" />}
        {coords.map((c, i) => (
          <g key={i}>
            <rect x={c.x - innerW / points.length / 2} y={PAD.top} width={innerW / points.length} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
            {(points.length <= 12 || hover === i) && <circle cx={c.x} cy={c.y} r={hover === i ? 5.5 : 3.5} className={`dot${hover === i ? " on" : ""}`} />}
          </g>
        ))}
        {points.map((p, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className={`axis${hover === i ? " on" : ""}`}>
              {p.label}
            </text>
          ) : null
        )}
        {hover !== null && (
          <g transform={`translate(${Math.min(Math.max(coords[hover].x, 92), W - 92)} ${Math.max(coords[hover].y - 52, 4)})`}>
            <rect x="-84" width="168" height="40" rx="8" className="tip" />
            <text x="0" y="16" textAnchor="middle" className="tip-label">{points[hover].full_label}</text>
            <text x="0" y="32" textAnchor="middle" className="tip-value">{formatPriceShort(points[hover].value)}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
