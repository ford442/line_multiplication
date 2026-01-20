import './style.css';

// --- Configuration ---
const LINE_SPACING = 0.15;
const DIGIT_SPACING = 0.5;
const LINE_LENGTH = 4.0;
const DOT_SIZE = 0.05;

// --- Colors for Place Values (Ones, Tens, Hundreds, Thousands...) ---
// We'll pass these as a lookup in the shader or just distinct RGBs
const ZONE_COLORS = [
  [0.2, 0.8, 0.8], // 0: Ones (Cyan)
  [0.6, 0.4, 1.0], // 1: Tens (Purple)
  [1.0, 0.6, 0.2], // 2: Hundreds (Orange)
  [0.2, 1.0, 0.4], // 3: Thousands (Green)
  [1.0, 0.2, 0.4], // 4: Ten Thousands (Red)
];

// --- Types ---
type LineSegment = {
  x1: number; y1: number;
  x2: number; y2: number;
  power: number; // New: Tracks 10^power (0=ones, 1=tens, etc)
};

type LabelData = {
  text: string;
  x: number;
  y: number;
  type: 'A' | 'B';
};

const main = async () => {
  // 1. WebGPU Setup
  if (!navigator.gpu) {
    console.error("WebGPU not supported on this browser.");
    alert("WebGPU is not supported. Please try Chrome Canary or a compatible browser.");
    throw new Error('WebGPU not supported.');
  }

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;

  // Ensure canvas has a size
  const width = canvas.clientWidth * window.devicePixelRatio;
  const height = canvas.clientHeight * window.devicePixelRatio;
  canvas.width = width;
  canvas.height = height;

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance'
  });

  if (!adapter) {
    console.error("No WebGPU adapter found.");
    alert("No WebGPU adapter found.");
    throw new Error('No adapter.');
  }

  const device = await adapter.requestDevice();

  const context = canvas.getContext('webgpu');
  if (!context) {
    console.error("Failed to get WebGPU context.");
    throw new Error('No context.');
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  try {
    context.configure({
      device,
      format,
      alphaMode: 'premultiplied'
    });
  } catch (e) {
    console.error("Context configuration failed:", e);
    // Fallback attempts or just re-throw
    throw e;
  }

  // 2. Shader Code
  const shaderCode = `
    struct LineVertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec4<f32>,
      @location(1) uv: vec2<f32>,
    };

    struct DotVertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec4<f32>,
      @location(1) localPos: vec2<f32>,
    };

    // --- Line Shader ---
    struct LineInput {
      @location(0) start: vec2<f32>,
      @location(1) end: vec2<f32>,
      @location(2) color: vec3<f32>,
    };

    @vertex
    fn vs_lines(@builtin(vertex_index) v_index: u32, input: LineInput) -> LineVertexOutput {
      let thickness = 0.04;
      let p0 = input.start;
      let p1 = input.end;

      let dir = p1 - p0;
      let len = length(dir);

      // Handle zero length lines safely
      var normal = vec2<f32>(0.0, 1.0);
      var forward = vec2<f32>(1.0, 0.0);
      if (len > 0.0001) {
         normal = normalize(vec2<f32>(-dir.y, dir.x));
         forward = dir / len;
      }

      var uv = vec2<f32>(0.0, 0.0);
      let idx = v_index % 6u;

      // Expand line to quad
      if (idx == 0u || idx == 3u) { uv = vec2<f32>(0.0, -1.0); }
      if (idx == 1u) { uv = vec2<f32>(1.0, -1.0); }
      if (idx == 2u || idx == 4u) { uv = vec2<f32>(0.0, 1.0); }
      if (idx == 5u) { uv = vec2<f32>(1.0, 1.0); }

      let localX = uv.x * len;
      let localY = uv.y * thickness * 0.5;

      let worldPos = p0 + (forward * localX) + (normal * localY);
      let ndcPos = worldPos / 3.5;

      var out: LineVertexOutput;
      out.position = vec4<f32>(ndcPos, 0.0, 1.0);
      out.color = vec4<f32>(input.color, 1.0);
      out.uv = uv;
      return out;
    }

    @fragment
    fn fs_lines(in: LineVertexOutput) -> @location(0) vec4<f32> {
      // Anti-aliasing along the width (Y axis of UV)
      let dist = abs(in.uv.y);
      let alpha = 1.0 - smoothstep(0.7, 1.0, dist);

      // Premultiplied alpha
      return vec4<f32>(in.color.rgb * alpha, alpha);
    }

    // --- Dot Shader ---
    struct DotInput {
      @location(0) center: vec2<f32>,
      @location(1) zoneColor: vec3<f32>,
    };

    @vertex
    fn vs_dots(@builtin(vertex_index) v_index: u32, input: DotInput) -> DotVertexOutput {
       let size = ${DOT_SIZE};
       var corner = vec2<f32>(0.0, 0.0);
       let idx = v_index % 6u;

       // Standard Quad Expansion
       if (idx == 0u || idx == 3u) { corner = vec2<f32>(-1.0, -1.0); }
       if (idx == 1u) { corner = vec2<f32>( 1.0, -1.0); }
       if (idx == 2u || idx == 4u) { corner = vec2<f32>(-1.0,  1.0); }
       if (idx == 5u) { corner = vec2<f32>( 1.0,  1.0); }

       let worldPos = input.center + (corner * size);
       let ndcPos = worldPos / 3.5;

       var out: DotVertexOutput;
       out.position = vec4<f32>(ndcPos, 0.0, 1.0);
       out.color = vec4<f32>(input.zoneColor, 1.0);
       out.localPos = corner;
       return out;
    }

    @fragment
    fn fs_dots(in: DotVertexOutput) -> @location(0) vec4<f32> {
      // Create a "Gem" shape
      // Diamond shape: abs(x) + abs(y) <= 1.0
      let d = abs(in.localPos.x) + abs(in.localPos.y);
      if (d > 1.0) { discard; }

      // Faceted Look
      var brightness = 1.0;

      // Top facets are brighter, bottom darker
      if (in.localPos.y > 0.0) { brightness *= 0.7; }
      else { brightness *= 1.1; }

      // Side facets
      if (abs(in.localPos.x) > 0.0) { brightness *= 0.95; }

      // Specular highlight in the center
      let dist = length(in.localPos);
      if (dist < 0.2) { brightness += (0.2 - dist) * 4.0; }

      // Edge outline effect (slight darkening at very edge of diamond)
      if (d > 0.9) { brightness *= 0.8; }

      return vec4<f32>(in.color.rgb * brightness, 1.0);
    }
  `;

  const shaderModule = device.createShaderModule({ code: shaderCode });

  // 3. Pipelines
  const linePipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_lines',
      buffers: [{
        arrayStride: 28, // start(2) + end(2) + color(3) = 7 floats * 4 = 28
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },  // start
          { shaderLocation: 1, offset: 8, format: 'float32x2' },  // end
          { shaderLocation: 2, offset: 16, format: 'float32x3' }, // color
        ]
      }]
    },
    fragment: { module: shaderModule, entryPoint: 'fs_lines', targets: [{ format }] },
    primitive: { topology: 'triangle-list' }
  });

  const dotPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_dots',
      buffers: [{
        arrayStride: 20, // Increased stride: 2 floats (pos) + 3 floats (color) = 20 bytes
        stepMode: 'instance',
        attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' }, // center
            { shaderLocation: 1, offset: 8, format: 'float32x3' }  // zoneColor
        ]
      }]
    },
    fragment: { module: shaderModule, entryPoint: 'fs_dots', targets: [{ format }] },
    primitive: { topology: 'triangle-list' }
  });

  // --- State ---
  let lineBuffer: GPUBuffer | null = null;
  let dotBuffer: GPUBuffer | null = null;
  let lineInstanceCount = 0;
  let dotInstanceCount = 0;

  const sliderA = document.getElementById('num-a') as HTMLInputElement;
  const sliderB = document.getElementById('num-b') as HTMLInputElement;
  const displayA = document.getElementById('val-a') as HTMLSpanElement;
  const displayB = document.getElementById('val-b') as HTMLSpanElement;
  const displayResult = document.getElementById('result-display') as HTMLSpanElement;
  const overlay = document.getElementById('overlay') as HTMLDivElement;

  // --- Geometry Logic ---
  const getDigits = (num: number) => num.toString().split('').map(Number);

  const getIntersection = (l1: LineSegment, l2: LineSegment): [number, number] | null => {
    const x1 = l1.x1, y1 = l1.y1, x2 = l1.x2, y2 = l1.y2;
    const x3 = l2.x1, y3 = l2.y1, x4 = l2.x2, y4 = l2.y2;

    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (denom === 0) return null;

    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

    if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
      return [x1 + ua * (x2 - x1), y1 + ua * (y2 - y1)];
    }
    return null;
  };

  const updateLabels = (labels: LabelData[]) => {
    overlay.innerHTML = '';
    labels.forEach(l => {
        const el = document.createElement('div');
        el.className = `overlay-label ${l.type === 'A' ? 'label-a' : 'label-b'}`;
        el.textContent = l.text;

        // Convert NDC (Normalized Device Coordinates) to Screen Pixels
        // Note: Our coordinates are "World" space, which is divided by 3.5 in the vertex shader to get NDC.
        const ndcX = l.x / 3.5;
        const ndcY = l.y / 3.5;

        const screenX = (ndcX + 1) * 0.5 * canvas.clientWidth;
        // Flip Y because Screen Y is down, WebGPU Y is up (usually)
        // Actually, in WebGPU NDC Y is up. HTML Y is down.
        const screenY = (1 - ndcY) * 0.5 * canvas.clientHeight;

        el.style.left = `${screenX}px`;
        el.style.top = `${screenY}px`;
        overlay.appendChild(el);
    });
  };

  const generateGeometry = () => {
    const numA = parseInt(sliderA.value);
    const numB = parseInt(sliderB.value);

    displayA.textContent = numA.toString();
    displayB.textContent = numB.toString();
    displayResult.textContent = `${numA * numB}`;

    const digitsA = getDigits(numA);
    const digitsB = getDigits(numB);

    const lineVertices: number[] = [];
    const dotData: number[] = []; // Now stores x, y, r, g, b
    const storedLinesA: LineSegment[] = [];
    const storedLinesB: LineSegment[] = [];
    const labels: LabelData[] = [];

    const cos45 = 0.7071, sin45 = 0.7071;

    // 1. Generate Blue Lines (A)
    // We reverse digits so index 0 is Ones, 1 is Tens, etc.
    // const revDigitsA = [...digitsA].reverse();
    const widthA = (digitsA.reduce((s, d) => s + (d - 1) * LINE_SPACING, 0)) + (digitsA.length - 1) * DIGIT_SPACING;

    // We draw left-to-right (High power to Low power), so we need to map visual order back to power
    let currentOffset = -widthA / 2;

    digitsA.forEach((digit, visualIndex) => {
      const power = digitsA.length - 1 - visualIndex;
      const groupStart = currentOffset;

      for (let i = 0; i < digit; i++) {
        const off = currentOffset + i * LINE_SPACING;
        const cx = off, cy = off;

        const x1 = (cx * cos45) - ((-LINE_LENGTH/2) * sin45);
        const y1 = (cy * sin45) + ((-LINE_LENGTH/2) * cos45);
        const x2 = (cx * cos45) - ((LINE_LENGTH/2) * sin45);
        const y2 = (cy * sin45) + ((LINE_LENGTH/2) * cos45);

        storedLinesA.push({ x1, y1, x2, y2, power });
        // Push Instance Data: x1, y1, x2, y2, r, g, b
        lineVertices.push(x1, y1, x2, y2, 0.4, 0.4, 1.0);
      }

      // Calculate Label Position for Group A
      const avgOff = groupStart + (digit - 1) * LINE_SPACING * 0.5;
      // Position at start of line (Bottom-Leftish)
      const labelDist = -LINE_LENGTH/2 - 0.4; // Slightly outside
      const lx = (avgOff * cos45) - (labelDist * sin45);
      const ly = (avgOff * sin45) + (labelDist * cos45);

      labels.push({ text: digit.toString(), x: lx, y: ly, type: 'A' });

      currentOffset += (digit - 1) * LINE_SPACING + DIGIT_SPACING;
    });

    // 2. Generate Green Lines (B)
    const widthB = (digitsB.reduce((s, d) => s + (d - 1) * LINE_SPACING, 0)) + (digitsB.length - 1) * DIGIT_SPACING;
    currentOffset = -widthB / 2;

    digitsB.forEach((digit, visualIndex) => {
      const power = digitsB.length - 1 - visualIndex;
      const groupStart = currentOffset;

      for (let i = 0; i < digit; i++) {
        const off = currentOffset + i * LINE_SPACING;
        const cx = off;

        const x1 = (cx * cos45) - ((-LINE_LENGTH/2) * -sin45);
        const y1 = (cx * -sin45) + ((-LINE_LENGTH/2) * cos45);
        const x2 = (cx * cos45) - ((LINE_LENGTH/2) * -sin45);
        const y2 = (cx * -sin45) + ((LINE_LENGTH/2) * cos45);

        storedLinesB.push({ x1, y1, x2, y2, power });
        lineVertices.push(x1, y1, x2, y2, 0.3, 0.8, 0.5);
      }

      // Calculate Label Position for Group B
      const avgOff = groupStart + (digit - 1) * LINE_SPACING * 0.5;
      // Position at start (Top-Leftish)
      const labelDist = -LINE_LENGTH/2 - 0.4;
      const lx = (avgOff * cos45) - (labelDist * -sin45);
      const ly = (avgOff * -sin45) + (labelDist * cos45);

      labels.push({ text: digit.toString(), x: lx, y: ly, type: 'B' });

      currentOffset += (digit - 1) * LINE_SPACING + DIGIT_SPACING;
    });

    updateLabels(labels);

    // 3. Calculate Intersections with Zone Colors
    for (const lA of storedLinesA) {
      for (const lB of storedLinesB) {
        const pt = getIntersection(lA, lB);
        if (pt) {
          // The magic: Zone Power = Power A + Power B
          // Example: 10 (power 1) * 1 (power 0) = 10 (power 1) -> Tens Zone
          const zonePower = lA.power + lB.power;

          // Get color for this zone (clamp to max color defined)
          const color = ZONE_COLORS[Math.min(zonePower, ZONE_COLORS.length - 1)];

          dotData.push(pt[0], pt[1]); // Position
          dotData.push(color[0], color[1], color[2]); // Color
        }
      }
    }

    // 4. Upload Buffers
    lineInstanceCount = lineVertices.length / 7; // 7 floats per line instance
    dotInstanceCount = dotData.length / 5; // 5 floats per dot

    if (lineBuffer) lineBuffer.destroy();
    if (lineInstanceCount > 0) {
      lineBuffer = device.createBuffer({
        size: Math.max(lineVertices.length * 4, 28), // Minimum size to avoid errors
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(lineBuffer, 0, new Float32Array(lineVertices));
    }

    if (dotBuffer) dotBuffer.destroy();
    if (dotInstanceCount > 0) {
        dotBuffer = device.createBuffer({
            size: dotData.length * 4,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(dotBuffer, 0, new Float32Array(dotData));
    }
  };

  const render = () => {
    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    if (lineInstanceCount > 0 && lineBuffer) {
        renderPass.setPipeline(linePipeline);
        renderPass.setVertexBuffer(0, lineBuffer);
        renderPass.draw(6, lineInstanceCount);
    }

    if (dotInstanceCount > 0 && dotBuffer) {
        renderPass.setPipeline(dotPipeline);
        renderPass.setVertexBuffer(0, dotBuffer);
        renderPass.draw(6, dotInstanceCount);
    }

    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);
    requestAnimationFrame(render);
  };

  sliderA.addEventListener('input', generateGeometry);
  sliderB.addEventListener('input', generateGeometry);
  generateGeometry();
  requestAnimationFrame(render);
};

document.addEventListener('DOMContentLoaded', main);
