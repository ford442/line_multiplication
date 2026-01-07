import './style.css';

const main = async () => {
  if (!navigator.gpu) {
    throw new Error('WebGPU not supported on this browser.');
  }
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Could not get WebGPU context.');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No adapter found.');
  const device = await adapter.requestDevice();
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device: device,
    format: canvasFormat,
    alphaMode: 'premultiplied',
  });

  const uniformBufferSize = 16;
  const uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const uniforms = new Float32Array(uniformBufferSize / 4);

  const multiplierSlider = document.getElementById('multiplier') as HTMLInputElement;
  const totalPointsSlider = document.getElementById('total-points') as HTMLInputElement;
  const multiplierValue = document.getElementById('multiplier-value') as HTMLSpanElement;
  const totalPointsValue = document.getElementById('total-points-value') as HTMLSpanElement;

  const shaderModule = device.createShaderModule({
    code: `
      struct Uniforms {
        multiplier: f32,
        totalPoints: f32,
        aspectRatio: f32,
      };
      @group(0) @binding(0) var<uniform> uniforms: Uniforms;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec4<f32>,
      };

      @vertex
      fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
        let pi = 3.14159265359;
        let total_points_u = u32(uniforms.totalPoints);
        let multiplier_u = u32(uniforms.multiplier);
        let point_index_u = vertex_index / 2u;
        let is_start_point = (vertex_index % 2u) == 0u;

        let p_index_u = select(point_index_u * multiplier_u, point_index_u, is_start_point);
        let final_index = f32(p_index_u % total_points_u);
        let angle = 2.0 * pi * final_index / uniforms.totalPoints;

        var pos = vec2<f32>(cos(angle), sin(angle));
        if (uniforms.aspectRatio > 1.0) {
            pos.y /= uniforms.aspectRatio;
        } else {
            pos.x *= uniforms.aspectRatio;
        }
        
        let other_p_index_u = select(point_index_u, point_index_u * multiplier_u, is_start_point);
        let other_final_index = f32(other_p_index_u % total_points_u);
        let other_angle = 2.0 * pi * other_final_index / uniforms.totalPoints;

        var other_pos = vec2<f32>(cos(other_angle), sin(other_angle));
        if (uniforms.aspectRatio > 1.0) {
            other_pos.y /= uniforms.aspectRatio;
        } else {
            other_pos.x *= uniforms.aspectRatio;
        }

        let dist = distance(pos, other_pos);
        
        var out: VertexOutput;
        out.position = vec4<f32>(pos, 0.0, 1.0);
        out.color = vec4<f32>(dist / 2.0, 1.0 - dist / 1.5, 0.8, 1.0);
        return out;
      }

      @fragment
      fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
        return in.color;
      }
    `,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: 'uniform' },
    }],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format: canvasFormat }] },
    primitive: { topology: 'line-list' },
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const updateUniforms = () => {
    uniforms[0] = parseFloat(multiplierSlider.value);
    uniforms[1] = parseFloat(totalPointsSlider.value);
    uniforms[2] = canvas.width / canvas.height;
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);

    multiplierValue.textContent = multiplierSlider.value;
    totalPointsValue.textContent = totalPointsSlider.value;
  };

  const render = () => {
    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();
    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [{ view: textureView, clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }, loadOp: 'clear', storeOp: 'store' }],
    };
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.draw(2 * parseInt(totalPointsSlider.value));
    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);
  };

  const renderLoop = () => {
    updateUniforms();
    render();
    requestAnimationFrame(renderLoop);
  };

  new ResizeObserver(entries => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      canvas.width = width;
      canvas.height = height;
    }
  }).observe(canvas);

  requestAnimationFrame(renderLoop);
};

document.addEventListener('DOMContentLoaded', main);
