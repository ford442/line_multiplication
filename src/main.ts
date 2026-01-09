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

const main = async () => {
  // 1. WebGPU Setup
  if (!navigator.gpu) throw new Error('WebGPU not supported.');
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No adapter.');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('No context.');

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  // 2. Shader Code
  const shaderCode = `
    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec4<f32>,
    };

    // --- Line Shader ---
    struct LineInput {
      @location(0) position: vec2<f32>,
      @location(1) color: vec3<f32>,
    };

    @vertex
    fn vs_lines(input: LineInput) -> VertexOutput {
      let pos = input.position / 3.5; // Zoom out slightly
      var out: VertexOutput;
      out.position = vec4<f32>(pos, 0.0, 1.0);
      out.color = vec4<f32>(input.color, 1.0);
      return out;
    }

    // --- Dot Shader ---
    struct DotInput {
      @location(0) center: vec2<f32>,
      @location(1) zoneColor: vec3<f32>, // New: Color based on place value
    };

    @vertex
    fn vs_dots(@builtin(vertex_index) v_index: u32, input: DotInput) -> VertexOutput {
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

       var out: VertexOutput;
       out.position = vec4<f32>(ndcPos, 0.0, 1.0);

       // Pass the zone color to the fragment shader
       out.color = vec4<f32>(input.zoneColor, 1.0);
       return out;
    }

    @fragment
    fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
      return in.color;
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
        arrayStride: 20,
        stepMode: 'vertex',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' }, // pos
          { shaderLocation: 1, offset: 8, format: 'float32x3' }, // color
        ]
      }]
    },
    fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { topology: 'line-list' }
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
    fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { topology: 'triangle-list' }
  });

  // --- State ---
  let lineBuffer: GPUBuffer | null = null;
  let dotBuffer: GPUBuffer | null = null;
  let lineVertexCount = 0;
  let dotInstanceCount = 0;

  const sliderA = document.getElementById('num-a') as HTMLInputElement;
  const sliderB = document.getElementById('num-b') as HTMLInputElement;
  const displayA = document.getElementById('val-a') as HTMLSpanElement;
  const displayB = document.getElementById('val-b') as HTMLSpanElement;
  const displayResult = document.getElementById('result-display') as HTMLSpanElement;

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

    const cos45 = 0.7071, sin45 = 0.7071;

    // 1. Generate Blue Lines (A)
    // We reverse digits so index 0 is Ones, 1 is Tens, etc.
    // const revDigitsA = [...digitsA].reverse();
    const widthA = (digitsA.reduce((s, d) => s + (d - 1) * LINE_SPACING, 0)) + (digitsA.length - 1) * DIGIT_SPACING;

    // We draw left-to-right (High power to Low power), so we need to map visual order back to power
    let currentOffset = -widthA / 2;

    digitsA.forEach((digit, visualIndex) => {
      // The power is based on the position from the right
      const power = digitsA.length - 1 - visualIndex;

      for (let i = 0; i < digit; i++) {
        const off = currentOffset + i * LINE_SPACING;
        const cx = off, cy = off;

        const x1 = (cx * cos45) - ((-LINE_LENGTH/2) * sin45);
        const y1 = (cy * sin45) + ((-LINE_LENGTH/2) * cos45);
        const x2 = (cx * cos45) - ((LINE_LENGTH/2) * sin45);
        const y2 = (cy * sin45) + ((LINE_LENGTH/2) * cos45);

        storedLinesA.push({ x1, y1, x2, y2, power });
        lineVertices.push(x1, y1, 0.4, 0.4, 1.0);
        lineVertices.push(x2, y2, 0.4, 0.4, 1.0);
      }
      currentOffset += (digit - 1) * LINE_SPACING + DIGIT_SPACING;
    });

    // 2. Generate Green Lines (B)
    const widthB = (digitsB.reduce((s, d) => s + (d - 1) * LINE_SPACING, 0)) + (digitsB.length - 1) * DIGIT_SPACING;
    currentOffset = -widthB / 2;

    digitsB.forEach((digit, visualIndex) => {
      const power = digitsB.length - 1 - visualIndex;

      for (let i = 0; i < digit; i++) {
        const off = currentOffset + i * LINE_SPACING;
        const cx = off;

        const x1 = (cx * cos45) - ((-LINE_LENGTH/2) * -sin45);
        const y1 = (cx * -sin45) + ((-LINE_LENGTH/2) * cos45);
        const x2 = (cx * cos45) - ((LINE_LENGTH/2) * -sin45);
        const y2 = (cx * -sin45) + ((LINE_LENGTH/2) * cos45);

        storedLinesB.push({ x1, y1, x2, y2, power });
        lineVertices.push(x1, y1, 0.3, 0.8, 0.5);
        lineVertices.push(x2, y2, 0.3, 0.8, 0.5);
      }
      currentOffset += (digit - 1) * LINE_SPACING + DIGIT_SPACING;
    });

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
    lineVertexCount = lineVertices.length / 5;
    dotInstanceCount = dotData.length / 5; // 5 floats per dot

    if (lineBuffer) lineBuffer.destroy();
    lineBuffer = device.createBuffer({
      size: Math.max(lineVertices.length * 4, 16),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(lineBuffer, 0, new Float32Array(lineVertices));

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

    if (lineVertexCount > 0 && lineBuffer) {
        renderPass.setPipeline(linePipeline);
        renderPass.setVertexBuffer(0, lineBuffer);
        renderPass.draw(lineVertexCount);
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
