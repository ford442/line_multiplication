# AGENTS.md

## Project Context
**Line Multiplication** is a mathematical visualization tool that renders modular arithmetic on a circle (Cardioid/Limacon patterns).
* **Current State:** HTML5 Canvas (CPU-bound rendering).
* **Target State:** **WebGPU** (GPU-bound rendering).
* **Goal:** Render 10,000+ lines smoothly by calculating geometry in the Vertex Shader.

## Key Directives

### 1. WebGPU Architecture
* **Topology:** Use `line-list` primitive topology.
* **Buffers:** Do **not** calculate line coordinates on the CPU.
    * Create a single `vertex_index` buffer (or use `@builtin(vertex_index)`).
    * Pass the "Total Points" and "Multiplier" as **Uniforms**.
* **Shaders:** Use WGSL.
    * **Vertex Shader:** Calculate the unit circle positions `(cos θ, sin θ)` dynamically based on the index.
    * **Fragment Shader:** Handle coloring (potentially based on line length or index).

### 2. Implementation Rules
* **No "Thick" Lines (v1):** WebGPU `line-list` is always 1px wide on most implementations. Accept this limitation for v1 to maximize performance.
* **Coordinate System:** Use a normalized device coordinate (NDC) system `[-1, 1]` but maintain aspect ratio in the shader (pass `aspectRatio` uniform).
* **Performance:** The loop must be non-blocking. Use `requestAnimationFrame`.

## Directory Structure
* **`/src`**:
    * `main.ts`: WebGPU initialization and render loop.
    * `shaders.wgsl`: The shader code (keep it in a separate file or template literal).
    * `controls.ts`: UI logic for changing the Multiplier.

## Available Tools
* **Build:** `npm run dev` (Vite)
* **Lint:** `npm run build` (TSC)

## Common Pitfalls
1.  **Padding:** WebGPU Uniform buffers require 16-byte alignment. Ensure your `Uniforms` struct in WGSL matches the `Float32Array` padding in TypeScript.
2.  **Device Lost:** Always check if `navigator.gpu` exists before initializing.
