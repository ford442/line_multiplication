// Pure geometry + arithmetic for line multiplication. No rendering here.

export const LINE_SPACING = 0.15;
export const DIGIT_SPACING = 0.5;
const MIN_LINE_LENGTH = 10.0;

// Place-value colours (ones, tens, hundreds, ...). Shared by GPU, 2D and CSS.
export const ZONE_COLORS: [number, number, number][] = [
  [0.2, 0.85, 0.85], // ones       cyan
  [0.62, 0.42, 1.0], // tens       purple
  [1.0, 0.6, 0.2],   // hundreds   orange
  [0.25, 1.0, 0.45], // thousands  green
  [1.0, 0.25, 0.45], // 10k        red
  [0.3, 0.5, 1.0],   // 100k       blue
  [1.0, 0.3, 1.0],   // millions   magenta
  [0.9, 0.9, 0.25],  // 10M        yellow
];
export const ZONE_NAMES = [
  'Ones', 'Tens', 'Hundreds', 'Thousands', 'Ten-thousands',
  'Hundred-thousands', 'Millions', 'Ten-millions',
];
export const COLOR_A: [number, number, number] = [0.42, 0.45, 1.0];
export const COLOR_B: [number, number, number] = [0.3, 0.85, 0.65];

export const zoneColor = (z: number) => ZONE_COLORS[Math.min(z, ZONE_COLORS.length - 1)];
export const zoneName = (z: number) => ZONE_NAMES[z] ?? `10^${z}`;
export const cssColor = (c: [number, number, number], a = 1) =>
  `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

export type Line = {
  x1: number; y1: number; x2: number; y2: number;
  set: 0 | 1;        // 0 = first number (A), 1 = second number (B)
  power: number;     // place value of the digit group
  order: number;     // 0..1 reveal order within its set
};

export type Dot = { x: number; y: number; zone: number; order: number };

export type Label = { text: string; x: number; y: number; type: 'A' | 'B' };

export type ZoneInfo = { zone: number; count: number; cx: number; cy: number };

/** One bundle-meets-bundle region = one partial product (e.g. 4 lines × 6 lines). */
export type Cluster = { zone: number; da: number; db: number; count: number; cx: number; cy: number };

export type CarryStep = {
  zone: number; count: number; carryIn: number; total: number; digit: number; carryOut: number;
};

export type Geometry = {
  a: number; b: number; product: number;
  digitsA: number[]; digitsB: number[];
  lines: Line[]; dots: Dot[]; labels: Label[];
  zones: ZoneInfo[];          // indexed by zone (power), ones first
  clusters: Cluster[];
  carries: CarryStep[];       // same order as zones
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
};

const digitsOf = (n: number) => n.toString().split('').map(Number);

const intersect = (l1: Line, l2: Line): [number, number] | null => {
  const denom = (l2.y2 - l2.y1) * (l1.x2 - l1.x1) - (l2.x2 - l2.x1) * (l1.y2 - l1.y1);
  if (denom === 0) return null;
  const ua = ((l2.x2 - l2.x1) * (l1.y1 - l2.y1) - (l2.y2 - l2.y1) * (l1.x1 - l2.x1)) / denom;
  const ub = ((l1.x2 - l1.x1) * (l1.y1 - l2.y1) - (l1.y2 - l1.y1) * (l1.x1 - l2.x1)) / denom;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  return [l1.x1 + ua * (l1.x2 - l1.x1), l1.y1 + ua * (l1.y2 - l1.y1)];
};

export const computeCarries = (counts: number[]): CarryStep[] => {
  const out: CarryStep[] = [];
  let carry = 0;
  counts.forEach((count, zone) => {
    const total = count + carry;
    const step = { zone, count, carryIn: carry, total, digit: total % 10, carryOut: Math.floor(total / 10) };
    carry = step.carryOut;
    out.push(step);
  });
  return out;
};

export const buildGeometry = (a: number, b: number): Geometry => {
  const digitsA = digitsOf(a);
  const digitsB = digitsOf(b);
  const lines: Line[] = [];
  const labels: Label[] = [];
  const c = Math.SQRT1_2;
  const len = Math.max(MIN_LINE_LENGTH, Math.max(digitsA.length, digitsB.length) * 3 + 2);
  const half = len / 2;

  const buildSet = (digits: number[], set: 0 | 1) => {
    const total = digits.reduce((s, d) => s + d, 0) || 1;
    const sign = set === 0 ? 1 : -1;
    const width = digits.reduce((s, d) => s + Math.max(d - 1, 0) * LINE_SPACING, 0) +
      (digits.length - 1) * DIGIT_SPACING;
    let off = -width / 2;
    let n = 0;
    digits.forEach((digit, i) => {
      const power = digits.length - 1 - i;
      const groupStart = off;
      for (let k = 0; k < digit; k++) {
        const o = off + k * LINE_SPACING;
        // Rotate a vertical line at offset o by ±45°.
        const x1 = o * c + half * sign * c, y1 = o * c * sign - half * c;
        const x2 = o * c - half * sign * c, y2 = o * c * sign + half * c;
        lines.push({ x1, y1, x2, y2, set, power, order: n / total });
        n++;
      }
      const mid = groupStart + Math.max(digit - 1, 0) * LINE_SPACING * 0.5;
      const ld = -half - 0.5;
      labels.push({
        text: String(digit),
        x: mid * c - ld * sign * c,
        y: mid * c * sign + ld * c,
        type: set === 0 ? 'A' : 'B',
      });
      off += Math.max(digit - 1, 0) * LINE_SPACING + DIGIT_SPACING;
    });
  };
  buildSet(digitsA, 0);
  buildSet(digitsB, 1);

  const zoneCount = digitsA.length + digitsB.length - 1;
  const raw: { x: number; y: number; zone: number; pa: number; pb: number }[] = [];
  const A = lines.filter(l => l.set === 0);
  const B = lines.filter(l => l.set === 1);
  for (const la of A) for (const lb of B) {
    const p = intersect(la, lb);
    if (p) raw.push({ x: p[0], y: p[1], zone: la.power + lb.power, pa: la.power, pb: lb.power });
  }

  const zones: ZoneInfo[] = [];
  for (let z = 0; z < zoneCount; z++) {
    const inZone = raw.filter(d => d.zone === z);
    // Centroid of where the zone *would* be even if empty: average the group crossings.
    let cx = 0, cy = 0;
    if (inZone.length) {
      inZone.forEach(d => { cx += d.x; cy += d.y; });
      cx /= inZone.length; cy /= inZone.length;
    }
    zones.push({ zone: z, count: inZone.length, cx, cy });
  }

  // Order dots within a zone so they "count up" in a sweep.
  const dots: Dot[] = [];
  zones.forEach(z => {
    const inZone = raw.filter(d => d.zone === z.zone).sort((p, q) => (p.x + p.y) - (q.x + q.y) || p.x - q.x);
    inZone.forEach((d, i) => dots.push({ x: d.x, y: d.y, zone: d.zone, order: inZone.length > 1 ? i / inZone.length : 0 }));
  });

  // Empty zones (a 0 digit) — place the badge between neighbours.
  zones.forEach((z, i) => {
    if (z.count === 0) {
      const near = zones.filter(o => o.count > 0);
      if (near.length) {
        const prev = zones.slice(0, i).reverse().find(o => o.count > 0) ?? near[0];
        const next = zones.slice(i + 1).find(o => o.count > 0) ?? near[near.length - 1];
        z.cx = (prev.cx + next.cx) / 2; z.cy = (prev.cy + next.cy) / 2;
      }
    }
  });

  const clusters: Cluster[] = [];
  digitsA.forEach((da, ia) => digitsB.forEach((db, ib) => {
    const pa = digitsA.length - 1 - ia, pb = digitsB.length - 1 - ib;
    const pts = raw.filter(d => d.pa === pa && d.pb === pb);
    if (!pts.length) return;
    const cx = pts.reduce((s, d) => s + d.x, 0) / pts.length;
    const cy = pts.reduce((s, d) => s + d.y, 0) / pts.length;
    clusters.push({ zone: pa + pb, da, db, count: pts.length, cx, cy });
  }));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  lines.forEach(l => {
    minX = Math.min(minX, l.x1, l.x2); maxX = Math.max(maxX, l.x1, l.x2);
    minY = Math.min(minY, l.y1, l.y2); maxY = Math.max(maxY, l.y1, l.y2);
  });
  if (minX === Infinity) { minX = -5; maxX = 5; minY = -5; maxY = 5; }

  return {
    a, b, product: a * b, digitsA, digitsB, lines, dots, labels, zones, clusters,
    carries: computeCarries(zones.map(z => z.count)),
    bounds: { minX: minX - 1.5, maxX: maxX + 1.5, minY: minY - 1.5, maxY: maxY + 1.5 },
  };
};
