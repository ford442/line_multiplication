import './style.css';
import { mat4, vec3, project, Mat4 } from './math';

// --- Configuration ---
const LINE_SPACING = 0.15;
const DIGIT_SPACING = 0.5;
const LINE_LENGTH = 10.0; // Increased line length for larger numbers
const DOT_SIZE = 0.05;

// --- Colors for Place Values (Ones, Tens, Hundreds, Thousands...) ---
const ZONE_COLORS = [
  [0.2, 0.8, 0.8], // 0: Ones (Cyan)
  [0.6, 0.4, 1.0], // 1: Tens (Purple)
  [1.0, 0.6, 0.2], // 2: Hundreds (Orange)
  [0.2, 1.0, 0.4], // 3: Thousands (Green)
  [1.0, 0.2, 0.4], // 4: Ten Thousands (Red)
  [0.2, 0.4, 1.0], // 5: Hundred Thousands (Blue)
  [1.0, 0.2, 1.0], // 6: Millions (Magenta)
  [0.8, 0.8, 0.2], // 7: Ten Millions (Yellow)
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

  // 2. Uniform Buffer
  const uniformBuffer = device.createBuffer({
    size: 64, // 4x4 matrix
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  // 3. Shader Code
  const shaderCode = `
    struct Uniforms {
      viewProj: mat4x4<f32>,
    };
    @group(0) @binding(0) var<uniform> uniforms: Uniforms;

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

    struct GroundVertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
    };

    // --- Ground Shader ---
    @vertex
    fn vs_ground(@builtin(vertex_index) v_index: u32) -> GroundVertexOutput {
        var pos = vec2<f32>(0.0, 0.0);
        let size = 1000.0;
        let idx = v_index % 6u;
        // Quad
        if (idx == 0u || idx == 3u) { pos = vec2<f32>(-size, -size); }
        if (idx == 1u) { pos = vec2<f32>( size, -size); }
        if (idx == 2u || idx == 4u) { pos = vec2<f32>(-size,  size); }
        if (idx == 5u) { pos = vec2<f32>( size,  size); }

        var out: GroundVertexOutput;
        // XZ Plane
        out.position = uniforms.viewProj * vec4<f32>(pos.x, -0.1, pos.y, 1.0);
        out.uv = pos;
        return out;
    }

    @fragment
    fn fs_ground(in: GroundVertexOutput) -> @location(0) vec4<f32> {
        let dist = length(in.uv);
        // Gradient: Grey center fading to black
        // 50.0 is the "bright" radius, 200.0 is dark
        let t = clamp(dist / 150.0, 0.0, 1.0);
        let color = mix(vec3<f32>(0.2, 0.2, 0.22), vec3<f32>(0.0, 0.0, 0.0), t);
        return vec4<f32>(color, 1.0);
    }


    // --- Line Shader ---
    struct LineInput {
      @location(0) start: vec2<f32>,
      @location(1) end: vec2<f32>,
      @location(2) color: vec3<f32>,
    };

    @vertex
    fn vs_lines(@builtin(vertex_index) v_index: u32, input: LineInput) -> LineVertexOutput {
      let thickness = 0.08; // Thicker for 3D visibility
      let p0 = input.start;
      let p1 = input.end;

      let dir = p1 - p0;
      let len = length(dir);

      var normal = vec2<f32>(0.0, 1.0);
      var forward = vec2<f32>(1.0, 0.0);
      if (len > 0.0001) {
         normal = normalize(vec2<f32>(-dir.y, dir.x));
         forward = dir / len;
      }

      var uv = vec2<f32>(0.0, 0.0);
      let idx = v_index % 6u;

      if (idx == 0u || idx == 3u) { uv = vec2<f32>(0.0, -1.0); }
      if (idx == 1u) { uv = vec2<f32>(1.0, -1.0); }
      if (idx == 2u || idx == 4u) { uv = vec2<f32>(0.0, 1.0); }
      if (idx == 5u) { uv = vec2<f32>(1.0, 1.0); }

      let localX = uv.x * len;
      let localY = uv.y * thickness * 0.5;

      let pos2D = p0 + (forward * localX) + (normal * localY);

      // Map 2D (x,y) to 3D (x, 0, z)
      var out: LineVertexOutput;
      out.position = uniforms.viewProj * vec4<f32>(pos2D.x, 0.05, pos2D.y, 1.0);
      out.color = vec4<f32>(input.color, 1.0);
      out.uv = uv;
      return out;
    }

    @fragment
    fn fs_lines(in: LineVertexOutput) -> @location(0) vec4<f32> {
      let dist = abs(in.uv.y);
      let alpha = 1.0 - smoothstep(0.7, 1.0, dist);
      return vec4<f32>(in.color.rgb * alpha, alpha);
    }

    // --- Dot Shader ---
    struct DotInput {
      @location(0) center: vec2<f32>,
      @location(1) zoneColor: vec3<f32>,
    };

    @vertex
    fn vs_dots(@builtin(vertex_index) v_index: u32, input: DotInput) -> DotVertexOutput {
       let size = ${DOT_SIZE}; // Might need to increase for 3D perception
       var corner = vec2<f32>(0.0, 0.0);
       let idx = v_index % 6u;

       if (idx == 0u || idx == 3u) { corner = vec2<f32>(-1.0, -1.0); }
       if (idx == 1u) { corner = vec2<f32>( 1.0, -1.0); }
       if (idx == 2u || idx == 4u) { corner = vec2<f32>(-1.0,  1.0); }
       if (idx == 5u) { corner = vec2<f32>( 1.0,  1.0); }

       let pos2D = input.center + (corner * size);

       var out: DotVertexOutput;
       out.position = uniforms.viewProj * vec4<f32>(pos2D.x, 0.15, pos2D.y, 1.0); // Slightly higher than lines
       out.color = vec4<f32>(input.zoneColor, 1.0);
       out.localPos = corner;
       return out;
    }

    @fragment
    fn fs_dots(in: DotVertexOutput) -> @location(0) vec4<f32> {
      let d = abs(in.localPos.x) + abs(in.localPos.y);
      if (d > 1.0) { discard; }
      var brightness = 1.0;
      if (in.localPos.y > 0.0) { brightness *= 0.7; } else { brightness *= 1.1; }
      if (abs(in.localPos.x) > 0.0) { brightness *= 0.95; }
      let dist = length(in.localPos);
      if (dist < 0.2) { brightness += (0.2 - dist) * 4.0; }
      if (d > 0.9) { brightness *= 0.8; }
      return vec4<f32>(in.color.rgb * brightness, 1.0);
    }
  `;

  const shaderModule = device.createShaderModule({ code: shaderCode });

  // 4. Pipelines

  // Ground
  const groundPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
        module: shaderModule,
        entryPoint: 'vs_ground'
    },
    fragment: { module: shaderModule, entryPoint: 'fs_ground', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
    }
  });

  // Lines
  const linePipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_lines',
      buffers: [{
        arrayStride: 28,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },  // start
          { shaderLocation: 1, offset: 8, format: 'float32x2' },  // end
          { shaderLocation: 2, offset: 16, format: 'float32x3' }, // color
        ]
      }]
    },
    fragment: { module: shaderModule, entryPoint: 'fs_lines', targets: [{ format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
    } }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
        depthWriteEnabled: false, // Transparent lines usually don't write depth, but in 3D...
        depthCompare: 'less',
        format: 'depth24plus',
    }
  });

  // Dots
  const dotPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_dots',
      buffers: [{
        arrayStride: 20,
        stepMode: 'instance',
        attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x3' }
        ]
      }]
    },
    fragment: { module: shaderModule, entryPoint: 'fs_dots', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
    }
  });

  // Bind Groups
  const groundBindGroup = device.createBindGroup({
    layout: groundPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });
  const lineBindGroup = device.createBindGroup({
    layout: linePipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });
  const dotBindGroup = device.createBindGroup({
      layout: dotPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

  // Create Depth Texture
  let depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // --- State ---
  let lineBuffer: GPUBuffer | null = null;
  let dotBuffer: GPUBuffer | null = null;
  let lineInstanceCount = 0;
  let dotInstanceCount = 0;
  let currentLabels: { data: LabelData; el: HTMLDivElement }[] = [];

  const inputA = document.getElementById('num-a') as HTMLInputElement;
  const inputB = document.getElementById('num-b') as HTMLInputElement;
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
    currentLabels = [];
    labels.forEach(l => {
        const el = document.createElement('div');
        el.className = `overlay-label ${l.type === 'A' ? 'label-a' : 'label-b'}`;
        el.textContent = l.text;
        overlay.appendChild(el);
        currentLabels.push({ data: l, el });
    });
  };

  const updateLabelPositions = (viewProj: Mat4) => {
    currentLabels.forEach(item => {
        // Project world pos (x, 0, y) -> Screen
        const worldPos = vec3.create(item.data.x, 0.0, item.data.y);
        const sPos = project(worldPos, viewProj, canvas.width, canvas.height);

        if (sPos) {
            const cssX = sPos.x / window.devicePixelRatio;
            const cssY = sPos.y / window.devicePixelRatio;

            item.el.style.display = 'block';
            item.el.style.left = `${cssX}px`;
            item.el.style.top = `${cssY}px`;
        } else {
            item.el.style.display = 'none';
        }
    });
  };

  let geometryBounds = { minX: -5, maxX: 5, minY: -5, maxY: 5 };

  const generateGeometry = () => {
    const numA = parseInt(inputA.value) || 1;
    const numB = parseInt(inputB.value) || 1;

    displayResult.textContent = `${numA * numB}`;

    const digitsA = getDigits(numA);
    const digitsB = getDigits(numB);

    const lineVertices: number[] = [];
    const dotData: number[] = [];
    const storedLinesA: LineSegment[] = [];
    const storedLinesB: LineSegment[] = [];
    const labels: LabelData[] = [];

    // Reset bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const updateBounds = (x: number, y: number) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    };

    const cos45 = 0.7071, sin45 = 0.7071;
    // Dynamic Line Length based on max digits to ensure intersection
    const maxDigits = Math.max(digitsA.length, digitsB.length);
    const dynamicLineLength = Math.max(LINE_LENGTH, maxDigits * 3.0 + 2.0);

    // 1. Generate Blue Lines (A)
    const widthA = (digitsA.reduce((s, d) => s + (d - 1) * LINE_SPACING, 0)) + (digitsA.length - 1) * DIGIT_SPACING;
    let currentOffset = -widthA / 2;

    digitsA.forEach((digit, visualIndex) => {
      const power = digitsA.length - 1 - visualIndex;
      const groupStart = currentOffset;

      for (let i = 0; i < digit; i++) {
        const off = currentOffset + i * LINE_SPACING;
        const cx = off, cy = off;

        const x1 = (cx * cos45) - ((-dynamicLineLength/2) * sin45);
        const y1 = (cy * sin45) + ((-dynamicLineLength/2) * cos45);
        const x2 = (cx * cos45) - ((dynamicLineLength/2) * sin45);
        const y2 = (cy * sin45) + ((dynamicLineLength/2) * cos45);

        updateBounds(x1, y1); updateBounds(x2, y2);
        storedLinesA.push({ x1, y1, x2, y2, power });
        lineVertices.push(x1, y1, x2, y2, 0.4, 0.4, 1.0);
      }

      // Calculate Label Position for Group A
      const avgOff = groupStart + (digit - 1) * LINE_SPACING * 0.5;
      const labelDist = -dynamicLineLength/2 - 0.4; // Slightly outside
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

        const x1 = (cx * cos45) - ((-dynamicLineLength/2) * -sin45);
        const y1 = (cx * -sin45) + ((-dynamicLineLength/2) * cos45);
        const x2 = (cx * cos45) - ((dynamicLineLength/2) * -sin45);
        const y2 = (cx * -sin45) + ((dynamicLineLength/2) * cos45);

        updateBounds(x1, y1); updateBounds(x2, y2);
        storedLinesB.push({ x1, y1, x2, y2, power });
        lineVertices.push(x1, y1, x2, y2, 0.3, 0.8, 0.5);
      }

      // Calculate Label Position for Group B
      const avgOff = groupStart + (digit - 1) * LINE_SPACING * 0.5;
      const labelDist = -dynamicLineLength/2 - 0.4;
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
          const zonePower = lA.power + lB.power;
          const color = ZONE_COLORS[Math.min(zonePower, ZONE_COLORS.length - 1)];
          dotData.push(pt[0], pt[1]); // Position
          dotData.push(color[0], color[1], color[2]); // Color
        }
      }
    }

    // 4. Upload Buffers
    lineInstanceCount = lineVertices.length / 7;
    dotInstanceCount = dotData.length / 5;

    if (lineBuffer) lineBuffer.destroy();
    if (lineInstanceCount > 0) {
      lineBuffer = device.createBuffer({
        size: Math.max(lineVertices.length * 4, 28),
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

    // Update global bounds correctly (inside generateGeometry)
    if (minX !== Infinity) {
         geometryBounds = { minX: minX - 2, maxX: maxX + 2, minY: minY - 2, maxY: maxY + 2 };
    }
  };

  const render = () => {
    // 1. Update Camera Matrix based on bounds
    const centerX = (geometryBounds.minX + geometryBounds.maxX) / 2;
    const centerY = (geometryBounds.minY + geometryBounds.maxY) / 2;
    const sizeX = geometryBounds.maxX - geometryBounds.minX;
    const sizeY = geometryBounds.maxY - geometryBounds.minY;
    const maxDim = Math.max(sizeX, sizeY);

    // Position camera
    const fov = 60 * (Math.PI / 180);
    const aspect = canvas.width / canvas.height;

    // Calculate distance needed to fit the object
    // tan(fov/2) = (height/2) / dist
    let dist = (maxDim / 2) / Math.tan(fov / 2);
    dist *= 1.5; // Add some margin
    dist = Math.max(dist, 5.0); // Min distance

    // Look from above and angle
    // We want to look at (centerX, 0, centerY)
    // From (centerX, dist, centerY + dist*0.5) to give a bird's eye view
    const eye = vec3.create(centerX, dist * 0.8, centerY + dist * 0.5);
    const center = vec3.create(centerX, 0, centerY);
    const up = vec3.create(0, 1, 0);

    const view = mat4.lookAt(eye, center, up);
    const proj = mat4.perspective(fov, aspect, 0.1, 2000.0);
    const viewProj = mat4.multiply(proj, view);

    // Update Uniforms
    // @ts-ignore: SharedArrayBuffer issue with Float32Array in some TS envs
    device.queue.writeBuffer(uniformBuffer, 0, viewProj);

    // Update Labels
    updateLabelPositions(viewProj);

    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();

    // Check depth texture size
    if (depthTexture.width !== canvas.width || depthTexture.height !== canvas.height) {
        depthTexture.destroy();
        depthTexture = device.createTexture({
          size: [canvas.width, canvas.height],
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }
    const depthView = depthTexture.createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
          view: depthView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
      }
    });

    // Draw Ground
    renderPass.setPipeline(groundPipeline);
    renderPass.setBindGroup(0, groundBindGroup);
    renderPass.draw(6);

    // Draw Lines
    if (lineInstanceCount > 0 && lineBuffer) {
        renderPass.setPipeline(linePipeline);
        renderPass.setBindGroup(0, lineBindGroup);
        renderPass.setVertexBuffer(0, lineBuffer);
        renderPass.draw(6, lineInstanceCount);
    }

    // Draw Dots
    if (dotInstanceCount > 0 && dotBuffer) {
        renderPass.setPipeline(dotPipeline);
        renderPass.setBindGroup(0, dotBindGroup);
        renderPass.setVertexBuffer(0, dotBuffer);
        renderPass.draw(6, dotInstanceCount);
    }

    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);
    requestAnimationFrame(render);
  };

  inputA.addEventListener('input', generateGeometry);
  inputB.addEventListener('input', generateGeometry);
  generateGeometry();
  requestAnimationFrame(render);
};

document.addEventListener('DOMContentLoaded', main);
