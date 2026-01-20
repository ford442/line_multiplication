
export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;

export const vec3 = {
  create: (x = 0, y = 0, z = 0): Vec3 => [x, y, z],
  subtract: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  normalize: (v: Vec3): Vec3 => {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (len > 0.00001) {
      return [v[0] / len, v[1] / len, v[2] / len];
    }
    return [0, 0, 0];
  },
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
};

export const mat4 = {
  create: (): Mat4 => new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]),

  perspective: (fovY: number, aspect: number, near: number, far: number): Mat4 => {
    const f = 1.0 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    const out = new Float32Array(16);

    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;

    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;

    out[8] = 0;
    out[9] = 0;
    out[10] = far * nf; // WebGPU Z [0, 1]
    out[11] = -1;

    out[12] = 0;
    out[13] = 0;
    out[14] = far * near * nf; // WebGPU Z [0, 1]
    out[15] = 0;
    return out;
  },

  lookAt: (eye: Vec3, center: Vec3, up: Vec3): Mat4 => {
    const f = vec3.normalize(vec3.subtract(center, eye));
    const s = vec3.normalize(vec3.cross(f, up));
    const u = vec3.cross(s, f);

    const out = new Float32Array(16);
    out[0] = s[0];
    out[1] = u[0];
    out[2] = -f[0];
    out[3] = 0;

    out[4] = s[1];
    out[5] = u[1];
    out[6] = -f[1];
    out[7] = 0;

    out[8] = s[2];
    out[9] = u[2];
    out[10] = -f[2];
    out[11] = 0;

    out[12] = -vec3.dot(s, eye);
    out[13] = -vec3.dot(u, eye);
    out[14] = vec3.dot(f, eye);
    out[15] = 1;
    return out;
  },

  multiply: (a: Mat4, b: Mat4): Mat4 => {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
        const ai0 = a[i]; const ai1 = a[i+4]; const ai2 = a[i+8]; const ai3 = a[i+12];
        out[i]    = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
        out[i+4]  = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
        out[i+8]  = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
        out[i+12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
    }
    return out;
  }
};

export const project = (
  worldPos: Vec3,
  viewProj: Mat4,
  width: number,
  height: number
): { x: number, y: number } | null => {
  // 1. Transform world -> Clip
  // v = M * p
  const x = worldPos[0], y = worldPos[1], z = worldPos[2];
  const w = 1.0;

  const clipX = x * viewProj[0] + y * viewProj[4] + z * viewProj[8] + w * viewProj[12];
  const clipY = x * viewProj[1] + y * viewProj[5] + z * viewProj[9] + w * viewProj[13];
  // const clipZ = x * viewProj[2] + y * viewProj[6] + z * viewProj[10] + w * viewProj[14];
  const clipW = x * viewProj[3] + y * viewProj[7] + z * viewProj[11] + w * viewProj[15];

  // 2. Clip -> NDC
  if (clipW === 0) return null; // Avoid division by zero
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  // const ndcZ = clipZ / clipW;

  // Basic clipping check (optional, but good for labels behind camera)
  if (clipW < 0) return null; // Behind camera? usually w < 0 means behind
  // Actually, standard perspective projection:
  // if w < 0, point is behind camera.

  // 3. NDC -> Screen
  // NDC is [-1, 1]. Screen is [0, width], [0, height].
  // WebGPU NDC Y is up. HTML Y is down.
  const screenX = (ndcX + 1) * 0.5 * width;
  const screenY = (1 - ndcY) * 0.5 * height;

  return { x: screenX, y: screenY };
};
