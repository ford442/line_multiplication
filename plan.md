# Implementation Plan: WebGPU Upgrade

## Phase 1: WebGPU Skeleton
**Goal:** Replace the 2D Canvas context with a WebGPU context and clear the screen to a specific color.
- [ ] Add `checkWebGPUSupport()` function in `main.ts`.
- [ ] Initialize `adapter`, `device`, and `context`.
- [ ] Configure the canvas context (`bgra8unorm` is standard).
- [ ] Create a basic render loop that performs a `clear` pass (e.g., clear to black).

## Phase 2: The Data Pipeline (Uniforms)
**Goal:** Pass the simulation variables (Multiplier, Total Points) to the GPU.
- [ ] Define the Uniform interface (Multiplier: f32, TotalPoints: f32, AspectRatio: f32).
- [ ] Create a `GPUBuffer` for uniforms (usage: `UNIFORM | COPY_DST`).
- [ ] Create a `BindGroup` layout and the BindGroup itself.
- [ ] Hook up HTML sliders to update this buffer via `device.queue.writeBuffer`.

## Phase 3: The "Magic" Vertex Shader
**Goal:** Draw lines without calculating positions in JS.
- [ ] Write `shaders.wgsl`.
- [ ] **Vertex Logic:**
    * Input: `vertex_index` (u32).
    * Logic:
        * If `vertex_index` is even: It's the START point. Index $i$.
        * If `vertex_index` is odd: It's the END point. Index $(i \times Multiplier) \pmod {Total}$.
        * Calculate Angle: $\theta = \frac{index}{Total} \times 2\pi$.
        * Position: $x = \cos(\theta), y = \sin(\theta)$.
- [ ] Create the `renderPipeline` with topology: `line-list`.

## Phase 4: Rendering & Polish
**Goal:** Final assembly and visual enhancements.
- [ ] Update the Render Pass to draw `TotalPoints * 2` vertices.
- [ ] Add coloring in Fragment Shader (e.g., color based on angle/hue).
- [ ] Add a "Play/Pause" auto-rotate feature for the multiplier.
