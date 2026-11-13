import { Geometry, zoneName, zoneColor, cssColor, COLOR_A, COLOR_B } from './geometry';

// What the scene should look like at a given step. The renderer eases toward this.
export type SceneTarget = {
  revealA: number;     // 0..1 fraction of first-number lines drawn
  revealB: number;     // 0..1 fraction of second-number lines drawn
  zonesShown: number;  // zones [0, zonesShown) fully counted; fractional = counting in progress
  focusZone: number;   // zone to spotlight, -1 = none
  showAnswer: boolean;
};

export type Step = {
  title: string;
  html: string;        // caption (trusted, built here)
  target: SceneTarget;
  duration: number;    // ms the auto-player lingers
  /** number of carry columns visible in the breakdown table */
  columns: number;
};

const swatch = (c: [number, number, number], text: string) =>
  `<b style="color:${cssColor(c)}">${text}</b>`;

export const buildSteps = (g: Geometry): Step[] => {
  const steps: Step[] = [];
  const Z = g.zones.length;
  const base = { revealA: 0, revealB: 0, zonesShown: 0, focusZone: -1, showAnswer: false };

  steps.push({
    title: 'The challenge',
    html: `Let's work out ${swatch(COLOR_A, String(g.a))} × ${swatch(COLOR_B, String(g.b))} — using nothing but lines and dots.`,
    target: { ...base }, duration: 2200, columns: 0,
  });

  const groupsA = g.digitsA.map(d => `<span class="chip chip-a">${d}</span>`).join('');
  steps.push({
    title: 'Step 1 · Draw the first number',
    html: `Each digit of ${swatch(COLOR_A, String(g.a))} becomes a bundle of parallel lines: ${groupsA}. A digit of 3 means 3 lines.` +
      (g.digitsA.includes(0) ? ' A <b>0</b> leaves an empty gap — no lines.' : ''),
    target: { ...base, revealA: 1 }, duration: 3200, columns: 0,
  });

  const groupsB = g.digitsB.map(d => `<span class="chip chip-b">${d}</span>`).join('');
  steps.push({
    title: 'Step 2 · Cross with the second number',
    html: `Now draw ${swatch(COLOR_B, String(g.b))} the same way, crossing the first set: ${groupsB}. Every crossing point is one dot.`,
    target: { ...base, revealA: 1, revealB: 1 }, duration: 3200, columns: 0,
  });

  g.carries.forEach((c, z) => {
    const name = zoneName(z);
    const col = zoneColor(z);
    const parts = g.clusters.filter(k => k.zone === z);
    let html = parts.length > 1
      ? `The ${name.toLowerCase()} dots come from ${parts.length} crossings: ${parts.map(k => `${k.da}×${k.db} = ${k.count}`).join(' and ')} — ${swatch(col, `${c.count} dots`)} in total.`
      : c.count === 0
        ? `No lines cross in the ${name.toLowerCase()} spot (there's a 0 digit) — ${swatch(col, '0 dots')}.`
        : `Count the dots where the ${name.toLowerCase()} lines cross: ${swatch(col, `${c.count} dot${c.count === 1 ? '' : 's'}`)}.`;
    if (c.carryIn) html += ` Plus the carried ${swatch(col, String(c.carryIn))} = <b>${c.total}</b>.`;
    if (c.carryOut && z < Z - 1) html += ` That's more than 9, so keep <b>${c.digit}</b> and carry <b>${c.carryOut}</b> to the ${zoneName(z + 1).toLowerCase()}.`;
    else if (z < Z - 1) html += ` Write down <b>${c.digit}</b>.`;
    else html += ` This is the leftmost column — write <b>${c.total}</b>.`;
    steps.push({
      title: `Step ${3 + z} · Count the ${name.toLowerCase()}`,
      html,
      target: { ...base, revealA: 1, revealB: 1, zonesShown: z + 1, focusZone: z },
      duration: 2600 + Math.min(c.count, 30) * 90,
      columns: z + 1,
    });
  });

  steps.push({
    title: 'The answer',
    html: `Read the digits left to right: <b class="answer-inline">${g.a} × ${g.b} = ${g.product.toLocaleString()}</b>`,
    target: { revealA: 1, revealB: 1, zonesShown: Z, focusZone: -1, showAnswer: true },
    duration: 4000, columns: Z,
  });

  return steps;
};

/** The breakdown table: one column per zone, highest place on the left. */
export const renderBreakdown = (g: Geometry, columns: number, hideAnswer: boolean): string => {
  const Z = g.zones.length;
  const cols = [...g.carries].reverse(); // highest place first
  const cell = (z: number, inner: string, cls = '') =>
    `<td class="${cls} ${z < columns ? 'on' : ''}" style="--zc:${cssColor(zoneColor(z))}">${inner}</td>`;
  const head = cols.map(c => cell(c.zone, zoneName(c.zone).replace('Ten-', '10-').replace('Hundred-', '100-'), 'zhead')).join('');
  const dots = cols.map(c => cell(c.zone, String(c.count), 'zcount')).join('');
  const carry = cols.map(c => cell(c.zone, c.carryIn ? `+${c.carryIn}` : '', 'zcarry')).join('');
  const digit = cols.map(c => {
    const v = c.zone === Z - 1 ? String(c.total) : String(c.digit);
    return cell(c.zone, hideAnswer ? '?' : v, 'zdigit');
  }).join('');
  return `<table class="breakdown">
    <tr><th></th>${head}</tr>
    <tr><th>Dots</th>${dots}</tr>
    <tr><th>Carry</th>${carry}</tr>
    <tr class="digit-row"><th>Digit</th>${digit}</tr>
  </table>`;
};
