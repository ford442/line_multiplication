import { mat4, vec3, project, Mat4 } from './math';
import { Geometry, zoneColor, COLOR_A, COLOR_B, cssColor } from './geometry';

export type SceneState = {
  revealA: number; revealB: number; zonesShown: number;
  focusZone: number; focusAmt: number;
  time: number;
  yaw: number; pitch: number; zoom: number;
};

export interface Renderer {
  kind: 'webgpu' | 'canvas2d';
  setGeometry(g: Geometry): void;
  render(s: SceneState): void;
  /** world (x, y-plane) -> CSS pixels in the canvas, or null if off-screen */
  toScreen(x: number, y: number): { x: number; y: number } | null;
  resize(): void;
}

const focusRadius = (g: Geometry, z: number) => {
  const pts = g.dots.filter(d => d.zone === z);
  const zi = g.zones[z];
  if (!zi || !pts.length) return 0.6;
  let r = 0;
  pts.forEach(p => { r = Math.max(r, Math.hypot(p.x - zi.cx, p.y - zi.cy)); });
  return r + 0.45;
};

// ---------------------------------------------------------------- camera
const cameraFor = (g: Geometry, s: SceneState, aspect: number) => {
  const b = g.bounds;
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const maxDim = Math.max(b.maxX - b.minX, (b.maxY - b.minY));
  const fov = (50 * Math.PI) / 180;
  let dist = (maxDim / 2) / Math.tan(fov / 2) * 1.05;
  if (aspect < 1) dist /= Math.max(aspect, 0.45);
  dist = Math.max(dist, 5) / s.zoom;
  const yaw = s.yaw + Math.sin(s.time * 0.00025) * 0.06; // gentle breathing sway
  const pitch = s.pitch;
  const eye = vec3.create(
    cx + Math.sin(yaw) * Math.cos(pitch) * dist,
    Math.sin(pitch) * dist,
    cy + Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  const view = mat4.lookAt(eye, vec3.create(cx, 0, cy), vec3.create(0, 1, 0));
  const proj = mat4.perspective(fov, aspect, 0.1, 2000);
  return mat4.multiply(proj, view);
};

// ---------------------------------------------------------------- WebGPU
const SHADER = /* wgsl */ `
struct U {
  viewProj: mat4x4<f32>,
  p0: vec4<f32>,   // revealA, revealB, zonesShown, time(s)
  p1: vec4<f32>,   // focusZone, focusAmt, focusCx, focusCy
  p2: vec4<f32>,   // focusRadius, focusColor.rgb
};
@group(0) @binding(0) var<uniform> u: U;

fn quad(i: u32) -> vec2<f32> {
  var q = array<vec2<f32>, 6>(vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
  return q[i % 6u];
}

// ---- ground: dark plane, faint grid, spotlight under the focused zone
struct GOut { @builtin(position) pos: vec4<f32>, @location(0) w: vec2<f32> };
@vertex fn vs_ground(@builtin(vertex_index) i: u32) -> GOut {
  let p = quad(i) * 200.0;
  var o: GOut;
  o.pos = u.viewProj * vec4(p.x, -0.05, p.y, 1.0);
  o.w = p;
  return o;
}
@fragment fn fs_ground(in: GOut) -> @location(0) vec4<f32> {
  let d = length(in.w);
  var col = mix(vec3(0.075, 0.08, 0.11), vec3(0.02, 0.02, 0.03), clamp(d / 30.0, 0.0, 1.0));
  let g = abs(fract(in.w / 1.0) - 0.5);
  let line = 1.0 - smoothstep(0.0, 0.03, min(g.x, g.y));
  col += vec3(0.05, 0.06, 0.09) * line * (1.0 - clamp(d / 25.0, 0.0, 1.0));
  // focus spotlight
  let fd = length(in.w - u.p1.zw);
  let spot = (1.0 - smoothstep(u.p2.x * 0.6, u.p2.x * 1.4, fd)) * u.p1.y;
  let ring = (1.0 - smoothstep(0.0, 0.06, abs(fd - u.p2.x))) * u.p1.y;
  col += u.p2.yzw * (spot * 0.22 + ring * 0.6);
  return vec4(col, 1.0);
}

// ---- lines: thick quads that grow along their length
struct LIn {
  @location(0) a: vec2<f32>, @location(1) b: vec2<f32>,
  @location(2) color: vec3<f32>, @location(3) info: vec3<f32>, // order, set, power
};
struct LOut { @builtin(position) pos: vec4<f32>, @location(0) color: vec3<f32>, @location(1) uv: vec2<f32>, @location(2) dim: f32 };
@vertex fn vs_lines(@builtin(vertex_index) i: u32, l: LIn) -> LOut {
  let reveal = select(u.p0.x, u.p0.y, l.info.y > 0.5);
  let prog = clamp((reveal * 1.35 - l.info.x) / 0.35, 0.0, 1.0);
  let dir = l.b - l.a;
  let len = length(dir);
  let f = dir / max(len, 1e-4);
  let n = vec2(-f.y, f.x);
  let q = quad(i);
  let t = (q.x * 0.5 + 0.5);
  let p = l.a + f * (t * len * prog) + n * (q.y * 0.045);
  var o: LOut;
  o.pos = u.viewProj * vec4(p.x, 0.02 + l.info.y * 0.01, p.y, 1.0);
  o.color = l.color;
  o.uv = vec2(t, q.y);
  o.dim = 1.0 - 0.45 * u.p1.y;
  if (prog <= 0.0) { o.pos = vec4(0.0, 0.0, -2.0, 1.0); }
  return o;
}
@fragment fn fs_lines(in: LOut) -> @location(0) vec4<f32> {
  let e = abs(in.uv.y);
  let a = (1.0 - smoothstep(0.55, 1.0, e)) * in.dim;
  let core = 1.0 - smoothstep(0.0, 0.5, e);
  let c = in.color * (0.75 + core * 0.5);
  return vec4(c * a, a);
}

// ---- dots: glowing discs that pop in, zone by zone
struct DIn { @location(0) c: vec2<f32>, @location(1) color: vec3<f32>, @location(2) info: vec2<f32> }; // zone, order
struct DOut { @builtin(position) pos: vec4<f32>, @location(0) color: vec3<f32>, @location(1) q: vec2<f32>, @location(2) k: vec2<f32> };
@vertex fn vs_dots(@builtin(vertex_index) i: u32, d: DIn) -> DOut {
  let f = u.p0.z - d.info.x;
  let s0 = d.info.y * 0.8;
  let t = clamp((f - s0) / 0.18, 0.0, 1.0);
  // overshoot pop
  let pop = t * (1.0 + 0.6 * sin(t * 3.14159));
  let focused = select(0.0, 1.0, abs(d.info.x - u.p1.x) < 0.5);
  let pulse = 1.0 + focused * u.p1.y * 0.18 * sin(u.p0.w * 5.0 - d.info.y * 6.28);
  let size = 0.075 * pop * pulse;
  let q = quad(i);
  let p = d.c + q * size * 2.6;
  var o: DOut;
  o.pos = u.viewProj * vec4(p.x, 0.08, p.y, 1.0);
  o.color = d.color;
  o.q = q;
  let dim = mix(1.0, select(0.35, 1.0, focused > 0.5), u.p1.y);
  o.k = vec2(dim, t);
  if (t <= 0.0) { o.pos = vec4(0.0, 0.0, -2.0, 1.0); }
  return o;
}
@fragment fn fs_dots(in: DOut) -> @location(0) vec4<f32> {
  let r = length(in.q) * 2.6;           // 1.0 == disc edge
  let disc = 1.0 - smoothstep(0.85, 1.0, r);
  let glow = exp(-r * r * 0.9) * 0.55;
  let hi = (1.0 - smoothstep(0.0, 0.45, length(in.q * 2.6 + vec2(0.3, 0.3)))) * 0.6;
  let c = in.color * (disc + glow) + vec3(hi * disc);
  let a = clamp(disc + glow, 0.0, 1.0) * in.k.x;
  return vec4(c * in.k.x, a);
}
`;

export const createWebGPURenderer = async (canvas: HTMLCanvasElement): Promise<Renderer | null> => {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  const ubuf = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const module = device.createShaderModule({ code: SHADER });
  const depth: GPUDepthStencilState = { format: 'depth24plus', depthCompare: 'less', depthWriteEnabled: false };
  const blend: GPUBlendState = {
    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  };
  const ground = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs_ground' },
    fragment: { module, entryPoint: 'fs_ground', targets: [{ format }] },
    depthStencil: { ...depth, depthWriteEnabled: true },
  });
  const linesP = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module, entryPoint: 'vs_lines',
      buffers: [{ arrayStride: 40, stepMode: 'instance', attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' },
        { shaderLocation: 1, offset: 8, format: 'float32x2' },
        { shaderLocation: 2, offset: 16, format: 'float32x3' },
        { shaderLocation: 3, offset: 28, format: 'float32x3' },
      ] }],
    },
    fragment: { module, entryPoint: 'fs_lines', targets: [{ format, blend }] },
    depthStencil: depth,
  });
  const dotsP = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module, entryPoint: 'vs_dots',
      buffers: [{ arrayStride: 28, stepMode: 'instance', attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' },
        { shaderLocation: 1, offset: 8, format: 'float32x3' },
        { shaderLocation: 2, offset: 20, format: 'float32x2' },
      ] }],
    },
    fragment: { module, entryPoint: 'fs_dots', targets: [{ format, blend }] },
    depthStencil: depth,
  });
  const bg = (p: GPURenderPipeline) => device.createBindGroup({
    layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }],
  });
  const groundBG = bg(ground), linesBG = bg(linesP), dotsBG = bg(dotsP);

  let depthTex: GPUTexture | null = null;
  let lineBuf: GPUBuffer | null = null, dotBuf: GPUBuffer | null = null;
  let nLines = 0, nDots = 0;
  let geo: Geometry | null = null;
  let viewProj: Mat4 = mat4.create();
  const uniforms = new Float32Array(28);

  const r: Renderer = {
    kind: 'webgpu',
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      depthTex?.destroy();
      depthTex = device.createTexture({ size: [canvas.width, canvas.height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    },
    setGeometry(g) {
      geo = g;
      const L = new Float32Array(Math.max(g.lines.length, 1) * 10);
      g.lines.forEach((l, i) => {
        const c = l.set === 0 ? COLOR_A : COLOR_B;
        L.set([l.x1, l.y1, l.x2, l.y2, c[0], c[1], c[2], l.order, l.set, l.power], i * 10);
      });
      const D = new Float32Array(Math.max(g.dots.length, 1) * 7);
      g.dots.forEach((d, i) => {
        const c = zoneColor(d.zone);
        D.set([d.x, d.y, c[0], c[1], c[2], d.zone, d.order], i * 7);
      });
      lineBuf?.destroy(); dotBuf?.destroy();
      lineBuf = device.createBuffer({ size: L.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      dotBuf = device.createBuffer({ size: D.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(lineBuf, 0, L);
      device.queue.writeBuffer(dotBuf, 0, D);
      nLines = g.lines.length; nDots = g.dots.length;
    },
    render(s) {
      if (!geo || !depthTex) return;
      viewProj = cameraFor(geo, s, canvas.width / canvas.height);
      const fz = geo.zones[s.focusZone];
      const fc = zoneColor(Math.max(s.focusZone, 0));
      uniforms.set(viewProj, 0);
      uniforms.set([s.revealA, s.revealB, s.zonesShown, s.time / 1000], 16);
      uniforms.set([s.focusZone, fz ? s.focusAmt : 0, fz?.cx ?? 0, fz?.cy ?? 0], 20);
      uniforms.set([fz ? focusRadius(geo, s.focusZone) : 0, fc[0], fc[1], fc[2]], 24);
      device.queue.writeBuffer(ubuf, 0, uniforms);

      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0.02, g: 0.02, b: 0.03, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setPipeline(ground); pass.setBindGroup(0, groundBG); pass.draw(6);
      if (nLines && lineBuf) { pass.setPipeline(linesP); pass.setBindGroup(0, linesBG); pass.setVertexBuffer(0, lineBuf); pass.draw(6, nLines); }
      if (nDots && dotBuf) { pass.setPipeline(dotsP); pass.setBindGroup(0, dotsBG); pass.setVertexBuffer(0, dotBuf); pass.draw(6, nDots); }
      pass.end();
      device.queue.submit([enc.finish()]);
    },
    toScreen(x, y) {
      const p = project(vec3.create(x, 0, y), viewProj, canvas.clientWidth, canvas.clientHeight);
      return p;
    },
  };
  r.resize();
  return r;
};

// ---------------------------------------------------------------- Canvas 2D fallback
export const createCanvas2DRenderer = (canvas: HTMLCanvasElement): Renderer => {
  const ctx = canvas.getContext('2d')!;
  let geo: Geometry | null = null;
  let scale = 1, ox = 0, oy = 0, dpr = 1;
  const fit = (s: SceneState) => {
    if (!geo) return;
    const b = geo.bounds;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    scale = Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY)) * s.zoom * 0.95;
    ox = w / 2 - ((b.minX + b.maxX) / 2) * scale;
    oy = h / 2 - ((b.minY + b.maxY) / 2) * scale;
  };
  return {
    kind: 'canvas2d',
    resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    },
    setGeometry(g) { geo = g; },
    render(s) {
      if (!geo) return;
      fit(s);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      grd.addColorStop(0, '#13151d'); grd.addColorStop(1, '#050507');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
      const X = (x: number) => ox + x * scale, Y = (y: number) => oy + y * scale;

      const fz = geo.zones[s.focusZone];
      if (fz && s.focusAmt > 0) {
        const r = focusRadius(geo, s.focusZone) * scale;
        const c = zoneColor(s.focusZone);
        ctx.fillStyle = cssColor(c, 0.12 * s.focusAmt);
        ctx.strokeStyle = cssColor(c, 0.7 * s.focusAmt);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(fz.cx), Y(fz.cy), r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }

      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, scale * 0.07);
      ctx.globalAlpha = 1 - 0.45 * s.focusAmt;
      geo.lines.forEach(l => {
        const rev = l.set === 0 ? s.revealA : s.revealB;
        const p = Math.min(Math.max((rev * 1.35 - l.order) / 0.35, 0), 1);
        if (p <= 0) return;
        ctx.strokeStyle = cssColor(l.set === 0 ? COLOR_A : COLOR_B);
        ctx.beginPath();
        ctx.moveTo(X(l.x1), Y(l.y1));
        ctx.lineTo(X(l.x1 + (l.x2 - l.x1) * p), Y(l.y1 + (l.y2 - l.y1) * p));
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      geo.dots.forEach(d => {
        const f = s.zonesShown - d.zone;
        const t = Math.min(Math.max((f - d.order * 0.8) / 0.18, 0), 1);
        if (t <= 0) return;
        const focused = d.zone === s.focusZone;
        const pulse = 1 + (focused ? s.focusAmt * 0.18 * Math.sin(s.time / 200 - d.order * 6.28) : 0);
        const rad = Math.max(3, scale * 0.08) * t * (1 + 0.6 * Math.sin(t * Math.PI)) * pulse;
        const dim = focused || s.focusAmt === 0 ? 1 : 1 - 0.65 * s.focusAmt;
        const c = zoneColor(d.zone);
        ctx.shadowColor = cssColor(c, 0.9 * dim); ctx.shadowBlur = rad * 2.5;
        ctx.fillStyle = cssColor(c, dim);
        ctx.beginPath(); ctx.arc(X(d.x), Y(d.y), rad, 0, Math.PI * 2); ctx.fill();
      });
      ctx.shadowBlur = 0;
    },
    toScreen(x, y) { return { x: ox + x * scale, y: oy + y * scale }; },
  };
};
