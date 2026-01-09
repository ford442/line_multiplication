import './style.css';

// --- Configuration ---
const LINE_SPACING = 0.15;
const DIGIT_SPACING = 0.5;
const LINE_LENGTH = 4.0;
const DOT_SIZE = 0.04; // Size of intersection dots

// --- Types ---
type LineSegment = {
  x1: number; y1: number;
  x2: number; y2: number;
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

  // 2. Shader Code (Handles both Lines and Dots)
  const shaderCode = `
    struct VertexInput {
      @location(0) position: vec2<f32>,
      @location(1) color: vec3<f32>, // Used for lines
    };

    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec4<f32>,
    };

    // --- Line Shader ---
    @vertex
    fn vs_lines(input: VertexInput) -> VertexOutput {
      // Scale world space to NDC
      let pos = input.position / 3.0;
      var out: VertexOutput;
      out.position = vec4<f32>(pos, 0.0, 1.0);
      out.color = vec4<f32>(input.color, 1.0);
      return out;
    }

    @fragment
    fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
      return in.color;
    }

    // --- Dot Shader (Procedural Quad) ---
    // We pass the center of the dot as an attribute, and expand it into a quad
    // using the vertex_index to determine which corner of the square we are drawing.
    struct DotInput {
      @location(0) center: vec2<f32>,
    }

    @vertex
    fn vs_dots(@builtin(vertex_index) v_index: u32, input: DotInput) -> VertexOutput {
       let size = ${DOT_SIZE};
       // 0, 1, 2, 2, 1, 3  <- Indices for a quad (Triangle List)
       // We can generate corner offsets based on index % 6

       var corner = vec2<f32>(0.0, 0.0);
       let idx = v_index % 6u;

       if (idx == 0u) { corner = vec2<f32>(-1.0, -1.0); }
       if (idx == 1u) { corner = vec2<f32>( 1.0, -1.0); }
       if (idx == 2u) { corner = vec2<f32>(-1.0,  1.0); }
       if (idx == 3u) { corner = vec2<f32>(-1.0,  1.0); } // Repeat
       if (idx == 4u) { corner = vec2<f32>( 1.0, -1.0); } // Repeat
       if (idx == 5u) { corner = vec2<f32>( 1.0,  1.0); }

       let worldPos = input.center + (corner * size);
       let ndcPos = worldPos / 3.0;

       var out: VertexOutput;
       out.position = vec4<f32>(ndcPos, 0.0, 1.0);
       out.color = vec4<f32>(1.0, 1.0, 1.0, 1.0); // White dots
       return out;
    }
  `;

  const shaderModule = device.createShaderModule({ code: shaderCode });

  // 3. Pipelines
  // Pipeline for Lines
  const linePipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_lines',
      buffers: [{
        arrayStride: 20, // 2x f32 pos, 3x f32 color
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

  // Pipeline for Dots
  const dotPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_dots',
      buffers: [{
        arrayStride: 8, // 2x f32 center
        stepMode: 'instance', // IMPORTANT: We change data per instance (per dot)
        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
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

  // Math helper: Intersection of two line segments
  const getIntersection = (l1: LineSegment, l2: LineSegment): [number, number] | null => {
    const x1 = l1.x1, y1 = l1.y1, x2 = l1.x2, y2 = l1.y2;
    const x3 = l2.x1, y3 = l2.y1, x4 = l2.x2, y4 = l2.y2;

    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (denom === 0) return null; // Parallel

    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

    // Check if intersection is within the segments
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
    displayResult.textContent = (numA * numB).toString();

    const digitsA = getDigits(numA);
    const digitsB = getDigits(numB);

    const lineVertices: number[] = [];
    const dotCenters: number[] = [];
    const storedLinesA: LineSegment[] = [];
    const storedLinesB: LineSegment[] = [];

    // 1. Generate Blue Lines (A) - Top-Left to Bottom-Right
    const widthA = (digitsA.reduce((s, d) => s + (d - 1) * LINE_SPACING, 0)) + (digitsA.length - 1) * DIGIT_SPACING;
    let currentOffset = -widthA / 2;
    const cos45 = 0.7071, sin45 = 0.7071;

    digitsA.forEach(digit => {
      for (let i = 0; i < digit; i++) {
        const off = currentOffset + i * LINE_SPACING;
        // Construct line rotated -45 deg (slope -1 in screen space usually, but here y-down logic vs y-up)
        // Let's use simple Vector math: Center is (off, off). Direction is (1, -1)
        
        // In WebGPU NDC: Y is Up.
        // We want Top-Left (-X, +Y) to Bottom-Right (+X, -Y).
        // Center (off, -off).
        // x = center + t, y = center - t

        const cx = off;
        const cy = off; // This creates the diagonal shift

        // Rotated -45 degrees
        const x1 = (cx * cos45) - ((-LINE_LENGTH/2) * sin45);
        const y1 = (cy * sin45) + ((-LINE_LENGTH/2) * cos45);
        const x2 = (cx * cos45) - ((LINE_LENGTH/2) * sin45);
        const y2 = (cy * sin45) + ((LINE_LENGTH/2) * cos45);

        storedLinesA.push({ x1, y1, x2, y2 });
        lineVertices.push(x1, y1, 0.4, 0.4, 1.0); // Blue
        lineVertices.push(x2, y2, 0.4, 0.4, 1.0);
      }
      currentOffset += (digit - 1) * LINE_SPACING + DIGIT_SPACING;
    });

    // 2. Generate Green Lines (B) - Bottom-Left to Top-Right
    const widthB = (digitsB.reduce((s, d) => s + (d - 1) * LINE_SPACING, 0)) + (digitsB.length - 1) * DIGIT_SPACING;
    currentOffset = -widthB / 2;

    digitsB.forEach(digit => {
      for (let i = 0; i < digit; i++) {
        const off = currentOffset + i * LINE_SPACING;

        // Perpendicular: Rotated +45 degrees
        // Bottom-Left (-X, -Y) to Top-Right (+X, +Y)

        const cx = off;

        // Rotate +45
        // x' = x cos - y sin
        // y' = x sin + y cos
        // Here we just swap signs on sin

        const x1 = (cx * cos45) - ((-LINE_LENGTH/2) * -sin45);
        const y1 = (cx * -sin45) + ((-LINE_LENGTH/2) * cos45);
        const x2 = (cx * cos45) - ((LINE_LENGTH/2) * -sin45);
        const y2 = (cx * -sin45) + ((LINE_LENGTH/2) * cos45);

        storedLinesB.push({ x1, y1, x2, y2 });
        lineVertices.push(x1, y1, 0.3, 0.8, 0.5); // Green
        lineVertices.push(x2, y2, 0.3, 0.8, 0.5);
      }
      currentOffset += (digit - 1) * LINE_SPACING + DIGIT_SPACING;
    });

    // 3. Calculate Intersections
    for (const lA of storedLinesA) {
      for (const lB of storedLinesB) {
        const pt = getIntersection(lA, lB);
        if (pt) {
          dotCenters.push(pt[0], pt[1]);
        }
      }
    }

    // 4. Upload Buffers
    lineVertexCount = lineVertices.length / 5;
    dotInstanceCount = dotCenters.length / 2;

    // Line Buffer
    if (lineBuffer) lineBuffer.destroy();
    lineBuffer = device.createBuffer({
      size: Math.max(lineVertices.length * 4, 16), // Min size safety
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(lineBuffer, 0, new Float32Array(lineVertices));

    // Dot Buffer
    if (dotBuffer) dotBuffer.destroy();
    if (dotInstanceCount > 0) {
        dotBuffer = device.createBuffer({
            size: dotCenters.length * 4,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(dotBuffer, 0, new Float32Array(dotCenters));
    }
  };

  // --- Render Loop ---
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

    // Draw Lines
    if (lineVertexCount > 0 && lineBuffer) {
        renderPass.setPipeline(linePipeline);
        renderPass.setVertexBuffer(0, lineBuffer);
        renderPass.draw(lineVertexCount);
    }

    // Draw Dots (Instanced)
    // We draw 6 vertices (1 quad) for every instance (dot)
    if (dotInstanceCount > 0 && dotBuffer) {
        renderPass.setPipeline(dotPipeline);
        renderPass.setVertexBuffer(0, dotBuffer); // Bind centers as instance data
        renderPass.draw(6, dotInstanceCount);
    }

    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);
    requestAnimationFrame(render);
  };

  sliderA.addEventListener('input', generateGeometry);
  sliderB.addEventListener('input', generateGeometry);

  // Initial
  generateGeometry();
  requestAnimationFrame(render);
};

document.addEventListener('DOMContentLoaded', main);