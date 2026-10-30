// Procedural rabbit asset builder.
// Generates a skinned, surface-nets rabbit (coat + shell LOD), eyes, nose, whiskers,
// an embedded procedural fur texture, and writes a self-contained GLB.
// No external assets or libraries.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'public/models/rabbit.glb');
const T0 = performance.now();

/* ---------------------------------------------------------------- vectors */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* ---------------------------------------------------------------- noise */
function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}
function vnoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm2(x, y, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * vnoise2(x * f, y * f); f *= 2.03; amp *= 0.5; }
  return s;
}
function hashf(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const n = (a, b, c) => hashf(a * 157.3 + b * 311.7 + c * 74.7);
  const x00 = n(xi, yi, zi) + (n(xi + 1, yi, zi) - n(xi, yi, zi)) * u;
  const x10 = n(xi, yi + 1, zi) + (n(xi + 1, yi + 1, zi) - n(xi, yi + 1, zi)) * u;
  const x01 = n(xi, yi, zi + 1) + (n(xi + 1, yi, zi + 1) - n(xi, yi, zi + 1)) * u;
  const x11 = n(xi, yi + 1, zi + 1) + (n(xi + 1, yi + 1, zi + 1) - n(xi, yi + 1, zi + 1)) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/* ---------------------------------------------------------------- SDF tools */
function sdEllipsoid(p, c, r) {
  const qx = (p[0] - c[0]) / r[0], qy = (p[1] - c[1]) / r[1], qz = (p[2] - c[2]) / r[2];
  const k0 = Math.hypot(qx, qy, qz);
  if (k0 === 0) return -Math.min(r[0], r[1], r[2]);
  const k1 = Math.hypot(qx / r[0], qy / r[1], qz / r[2]);
  return k0 * (k0 - 1) / k1;
}
function sdSphere(p, c, r) { return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r; }
function sdCapsule(p, a, b, r) {
  const px = p[0] - a[0], py = p[1] - a[1], pz = p[2] - a[2];
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const t = clamp((px * bax + py * bay + pz * baz) / (bax * bax + bay * bay + baz * baz || 1), 0, 1);
  return Math.hypot(px - bax * t, py - bay * t, pz - baz * t) - r;
}
function smin(a, b, k) {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return b * (1 - h) + a * h - k * h * (1 - h);
}
function smax(a, b, k) { return -smin(-a, -b, k); }

/* ---------------------------------------------------------------- anatomy */
const EAR_L = [];
{
  const P0 = [0.068, 0.925, 0.548], P1 = [0.112, 1.135, 0.552], P2 = [0.148, 1.335, 0.455];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const it = 1 - t;
    const p = [
      it * it * P0[0] + 2 * it * t * P1[0] + t * t * P2[0],
      it * it * P0[1] + 2 * it * t * P1[1] + t * t * P2[1],
      it * it * P0[2] + 2 * it * t * P1[2] + t * t * P2[2],
    ];
    const r = 0.060 * (1 - t) + 0.015 + 0.020 * Math.sin(Math.PI * t);
    EAR_L.push({ p, r, t });
  }
}
const mirror = (p) => [-p[0], p[1], p[2]];

/* Signed distance of a single ear (left, +x). p in local ear space is flattened in z. */
function sdEar(p, side) {
  const q = [p[0] * side, p[1], p[2]];
  let d = 1e9;
  for (let i = 0; i < EAR_L.length - 1; i++) {
    const a = EAR_L[i], b = EAR_L[i + 1];
    // flatten in z: distance measured with squashed z and x widened slightly
    const dz = 2.35;
    const ax = [a.p[0], a.p[1], a.p[2] * dz], bx = [b.p[0], b.p[1], b.p[2] * dz];
    const px = [q[0], q[1], q[2] * dz];
    const dd = sdCapsule(px, ax, bx, (a.r + b.r) * 0.5);
    d = Math.min(d, dd / dz * 1.35);
  }
  // cup the front of the ear
  const cup = sdEllipsoid(q, [0.105, 1.15, 0.602], [0.043, 0.175, 0.05]);
  d = smax(d, -cup, 0.018);
  // round the tip
  d = smin(d, sdEllipsoid(q, [0.146, 1.325, 0.455], [0.022, 0.028, 0.022]), 0.018);
  return d;
}

function sdRabbit(p) {
  const x = p[0], y = p[1], z = p[2];
  let d = sdEllipsoid(p, [0, 0.435, -0.03], [0.245, 0.245, 0.40]);
  d = smin(d, sdEllipsoid(p, [0, 0.46, 0.32], [0.205, 0.215, 0.235]), 0.07);
  d = smin(d, sdEllipsoid(p, [0.16, 0.35, -0.14], [0.155, 0.205, 0.245]), 0.06);
  d = smin(d, sdEllipsoid(p, [-0.16, 0.35, -0.14], [0.155, 0.205, 0.245]), 0.06);
  // rump
  d = smin(d, sdEllipsoid(p, [0, 0.44, -0.32], [0.215, 0.21, 0.18]), 0.06);
  // chest
  d = smin(d, sdEllipsoid(p, [0, 0.42, 0.30], [0.185, 0.20, 0.20]), 0.07);
  // neck
  d = smin(d, sdCapsule(p, [0, 0.52, 0.36], [0, 0.66, 0.49], 0.145), 0.06);
  // head
  d = smin(d, sdEllipsoid(p, [0, 0.775, 0.585], [0.158, 0.155, 0.185]), 0.055);
  // muzzle
  d = smin(d, sdEllipsoid(p, [0, 0.723, 0.748], [0.102, 0.092, 0.115]), 0.05);
  // cheeks / whisker pads
  d = smin(d, sdEllipsoid(p, [0.072, 0.705, 0.705], [0.062, 0.06, 0.075]), 0.03);
  d = smin(d, sdEllipsoid(p, [-0.072, 0.705, 0.705], [0.062, 0.06, 0.075]), 0.03);
  // brow
  d = smin(d, sdEllipsoid(p, [0, 0.845, 0.70], [0.115, 0.06, 0.08]), 0.035);
  // chin
  d = smin(d, sdEllipsoid(p, [0, 0.665, 0.715], [0.062, 0.045, 0.06]), 0.03);
  // ears
  d = smin(d, sdEar(p, 1), 0.028);
  d = smin(d, sdEar(p, -1), 0.028);
  // fluffy tail
  d = smin(d, sdEllipsoid(p, [0, 0.505, -0.425], [0.105, 0.105, 0.10]), 0.05);
  // front legs (slender, planted)
  for (const s of [1, -1]) {
    d = smin(d, sdCapsule(p, [0.128 * s, 0.42, 0.335], [0.128 * s, 0.10, 0.40], 0.052), 0.05);
    d = smin(d, sdEllipsoid(p, [0.128 * s, 0.048, 0.455], [0.058, 0.048, 0.105]), 0.035);
  }
  // hind legs: big folded haunch, long foot forward
  for (const s of [1, -1]) {
    d = smin(d, sdEllipsoid(p, [0.185 * s, 0.285, 0.045], [0.105, 0.20, 0.20]), 0.05);
    d = smin(d, sdEllipsoid(p, [0.178 * s, 0.055, 0.225], [0.075, 0.052, 0.20]), 0.035);
  }
  // subtle eye sockets
  for (const s of [1, -1]) {
    const e = sdSphere(p, [0.098 * s, 0.828, 0.718], 0.053);
    d = smin(d, e, 0.02);
  }
  // nostrils
  for (const s of [1, -1]) d = smax(d, -sdSphere(p, [0.022 * s, 0.742, 0.855], 0.0075), 0.004);
  // mouth crease
  d = smax(d, -sdCapsule(p, [0, 0.706, 0.862], [0, 0.692, 0.80], 0.004), 0.006);
  return d;
}

/* ---------------------------------------------------------------- meshing */
function surfaceNets(bounds, res) {
  const [min, max] = bounds;
  const nx = res[0], ny = res[1], nz = res[2];
  const sx = (max[0] - min[0]) / (nx - 1);
  const sy = (max[1] - min[1]) / (ny - 1);
  const sz = (max[2] - min[2]) / (nz - 1);
  const N = nx * ny * nz;
  const field = new Float32Array(N);
  const xyz = [0, 0, 0];
  for (let k = 0; k < nz; k++) {
    xyz[2] = min[2] + k * sz;
    for (let j = 0; j < ny; j++) {
      xyz[1] = min[1] + j * sy;
      for (let i = 0; i < nx; i++) {
        xyz[0] = min[0] + i * sx;
        field[i + nx * (j + ny * k)] = sdRabbit(xyz);
      }
    }
  }
  const cw = nx - 1, ch = ny - 1, cd = nz - 1;
  const cellVert = new Int32Array(cw * ch * cd).fill(-1);
  const cidx = (i, j, k) => i + cw * (j + ch * k);
  const at = (i, j, k) => field[i + nx * (j + ny * k)];
  const edgePairs = [
    [0, 1], [1, 3], [2, 3], [0, 2],
    [4, 5], [5, 7], [6, 7], [4, 6],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const corner = (c) => [c & 1, (c >> 1) & 1, (c >> 2) & 1];
  const verts = [];
  const faces = [];
  const loopCorners = new Float64Array(8);

  for (let k = 0; k < cd; k++) {
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const o = corner(c);
          const v = at(i + o[0], j + o[1], k + o[2]);
          loopCorners[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0, py = 0, pz = 0, cnt = 0;
        for (let e = 0; e < 12; e++) {
          const a = edgePairs[e][0], b = edgePairs[e][1];
          const va = loopCorners[a], vb = loopCorners[b];
          if ((va < 0) === (vb < 0)) continue;
          const oa = corner(a), ob = corner(b);
          const t = va / (va - vb);
          px += (oa[0] + (ob[0] - oa[0]) * t);
          py += (oa[1] + (ob[1] - oa[1]) * t);
          pz += (oa[2] + (ob[2] - oa[2]) * t);
          cnt++;
        }
        const idx = verts.length / 3;
        verts.push(min[0] + (i + px / cnt) * sx, min[1] + (j + py / cnt) * sy, min[2] + (k + pz / cnt) * sz);
        cellVert[cidx(i, j, k)] = idx;
      }
    }
  }

  // emit quads for sign-changing grid edges, oriented outward via field gradient
  const grad = (i, j, k) => {
    const gx = at(Math.min(nx - 1, i + 1), j, k) - at(Math.max(0, i - 1), j, k);
    const gy = at(i, Math.min(ny - 1, j + 1), k) - at(i, Math.max(0, j - 1), k);
    const gz = at(i, j, Math.min(nz - 1, k + 1)) - at(i, j, Math.max(0, k - 1));
    return [gx, gy, gz];
  };
  const pushQuad = (cells, flip) => {
    const ids = cells.map(([a, b, c]) => cellVert[cidx(a, b, c)]);
    if (ids.some((v) => v < 0)) return;
    if (flip) faces.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    else faces.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v0 = at(i, j, k);
        if (i < nx - 1) {
          const v1 = at(i + 1, j, k);
          if ((v0 < 0) !== (v1 < 0) && j > 0 && k > 0) {
            const cells = [[i, j - 1, k - 1], [i, j, k - 1], [i, j, k], [i, j - 1, k]];
            const g = grad(i, j, k);
            const p0 = verts.slice(cellVert[cidx(...cells[0])] * 3, cellVert[cidx(...cells[0])] * 3 + 3);
            const p1 = verts.slice(cellVert[cidx(...cells[1])] * 3, cellVert[cidx(...cells[1])] * 3 + 3);
            const p2 = verts.slice(cellVert[cidx(...cells[2])] * 3, cellVert[cidx(...cells[2])] * 3 + 3);
            const nrm = norm(add(cross(sub(p1, p0), sub(p2, p0)), [0, 0, 0]));
            pushQuad(cells, dot(nrm, g) < 0);
          }
        }
        if (j < ny - 1) {
          const v1 = at(i, j + 1, k);
          if ((v0 < 0) !== (v1 < 0) && i > 0 && k > 0) {
            const cells = [[i - 1, j, k - 1], [i - 1, j, k], [i, j, k], [i, j, k - 1]];
            const g = grad(i, j, k);
            const p0 = verts.slice(cellVert[cidx(...cells[0])] * 3, cellVert[cidx(...cells[0])] * 3 + 3);
            const p1 = verts.slice(cellVert[cidx(...cells[1])] * 3, cellVert[cidx(...cells[1])] * 3 + 3);
            const p2 = verts.slice(cellVert[cidx(...cells[2])] * 3, cellVert[cidx(...cells[2])] * 3 + 3);
            const nrm = norm(cross(sub(p1, p0), sub(p2, p0)));
            pushQuad(cells, dot(nrm, g) < 0);
          }
        }
        if (k < nz - 1) {
          const v1 = at(i, j, k + 1);
          if ((v0 < 0) !== (v1 < 0) && i > 0 && j > 0) {
            const cells = [[i - 1, j - 1, k], [i, j - 1, k], [i, j, k], [i - 1, j, k]];
            const g = grad(i, j, k);
            const p0 = verts.slice(cellVert[cidx(...cells[0])] * 3, cellVert[cidx(...cells[0])] * 3 + 3);
            const p1 = verts.slice(cellVert[cidx(...cells[1])] * 3, cellVert[cidx(...cells[1])] * 3 + 3);
            const p2 = verts.slice(cellVert[cidx(...cells[2])] * 3, cellVert[cidx(...cells[2])] * 3 + 3);
            const nrm = norm(cross(sub(p1, p0), sub(p2, p0)));
            pushQuad(cells, dot(nrm, g) < 0);
          }
        }
      }
    }
  }
  let nanV = 0;
  for (let i = 0; i < verts.length; i++) if (!Number.isFinite(verts[i])) nanV++;
  let nanF = 0, undefF = 0;
  for (let i = 0; i < faces.length; i++) { if (!Number.isFinite(faces[i])) nanF++; if (faces[i] === undefined) undefF++; if (faces[i] < 0 || faces[i] >= verts.length / 3) undefF++; }
  console.log('    raw check: nanVerts', nanV, 'badIdx', nanF, undefF);
  return { verts: new Float32Array(verts), faces: new Uint32Array(faces) };
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

/* ------------------------------------------------ smoothing + normals */
function smoothVertices(verts, faces, iterations = 2, amount = 0.45) {
  const n = verts.length / 3;
  const adj = Array.from({ length: n }, () => new Set());
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    adj[a].add(b); adj[a].add(c); adj[b].add(a); adj[b].add(c); adj[c].add(a); adj[c].add(b);
  }
  const lists = adj.map((s) => Int32Array.from(s));
  let src = verts;
  for (let it = 0; it < iterations; it++) {
    const out = new Float32Array(src);
    for (let i = 0; i < n; i++) {
      const l = lists[i];
      if (!l.length) continue;
      let ax = 0, ay = 0, az = 0;
      for (const j of l) { ax += src[j * 3]; ay += src[j * 3 + 1]; az += src[j * 3 + 2]; }
      ax /= l.length; ay /= l.length; az /= l.length;
      out[i * 3] += (ax - src[i * 3]) * amount;
      out[i * 3 + 1] += (ay - src[i * 3 + 1]) * amount;
      out[i * 3 + 2] += (az - src[i * 3 + 2]) * amount;
    }
    src = out;
  }
  return src;
}

function gradientNormals(verts) {
  const n = verts.length / 3;
  const out = new Float32Array(n * 3);
  const e = 0.0012;
  for (let i = 0; i < n; i++) {
    const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
    const gx = sdRabbit([x + e, y, z]) - sdRabbit([x - e, y, z]);
    const gy = sdRabbit([x, y + e, z]) - sdRabbit([x, y - e, z]);
    const gz = sdRabbit([x, y, z + e]) - sdRabbit([x, y, z - e]);
    const l = Math.hypot(gx, gy, gz) || 1;
    out[i * 3] = gx / l; out[i * 3 + 1] = gy / l; out[i * 3 + 2] = gz / l;
  }
  return out;
}

/* ---------------------------------------------------------------- palette */
const C = {
  furRoot: [0.20, 0.145, 0.105],
  fur: [0.395, 0.295, 0.215],
  furLight: [0.60, 0.48, 0.355],
  cream: [0.86, 0.79, 0.66],
  creamDark: [0.70, 0.61, 0.48],
  earPink: [0.68, 0.44, 0.40],
  dark: [0.145, 0.10, 0.075],
  tail: [0.90, 0.86, 0.77],
};
const EAR_FC = { x: 0.118, z: 0.585, y: 1.2 };
function earMask(p, n) {
  // distance to the left ear curve in xz and height
  let best = 1e9, bestT = 0;
  for (let i = 0; i < EAR_L.length - 1; i++) {
    const a = EAR_L[i], b = EAR_L[i + 1];
    for (let s = 0; s <= 4; s++) {
      const t = s / 4;
      const q = mix(a.p, b.p, t);
      const d = Math.hypot(p[0] - q[0], (p[1] - q[1]) * 0.7, p[2] - q[2]);
      if (d < best) { best = d; bestT = (i + t) / (EAR_L.length - 1); }
    }
  }
  return { d: best, t: bestT };
}

function vertexData(p, n) {
  const [x, y, z] = p;
  const side = x >= 0 ? 1 : -1;
  const ear = earMask([Math.abs(x), y, z], n);
  const earRegion = ear.d < 0.085 && y > 0.94;
  const noseD = Math.hypot(x * 1.1, (y - 0.735) * 1.25, z - 0.858);
  const eyeDL = Math.hypot(x - 0.108, y - 0.825, z - 0.723);
  const eyeDR = Math.hypot(x + 0.108, y - 0.825, z - 0.723);
  const eyeD = Math.min(eyeDL, eyeDR);

  const grain = fbm2(x * 26 + 4.2, y * 26 + z * 17, 3);
  let coat = mixc(C.fur, C.furLight, clamp(grain * 1.15 - 0.15, 0, 1));
  coat = mixc(coat, C.furRoot, 0.22);

  // countershading: pale belly, chest and underside
  const under = smoothstep(0.2, -0.4, n[1]) * smoothstep(0.62, 0.30, y);
  const belly = clamp(under * 1.2 + smoothstep(0.42, 0.30, y) * smoothstep(0.12, 0.30, z) * 0.75, 0, 1);
  coat = mixc(coat, C.creamDark, belly * 0.85);

  // pale muzzle / chin / throat
  const muzzleMask = smoothstep(0.66, 0.78, z) * smoothstep(0.82, 0.70, y) * (1 - smoothstep(0.10, 0.17, Math.abs(x)));
  coat = mixc(coat, C.cream, muzzleMask * 0.9);
  const chin = smoothstep(0.70, 0.78, z) * smoothstep(0.72, 0.64, y);
  coat = mixc(coat, C.cream, chin * 0.55);

  // paws
  const paw = smoothstep(0.15, 0.03, y) * (smoothstep(0.42, 0.5, z) + 0.6 * smoothstep(0.02, 0.16, z));
  coat = mixc(coat, C.creamDark, clamp(paw, 0, 1) * 0.8);

  // tail
  const tailD = Math.hypot(x, y - 0.505, z + 0.425);
  const tail = smoothstep(0.16, 0.09, tailD);
  coat = mixc(coat, C.tail, tail * 0.95);

  // eye ring / eyeliner
  coat = mixc(coat, C.dark, smoothstep(0.062, 0.035, eyeD) * 0.9);

  // ear interior + rim + tips
  if (earRegion) {
    const inner = smoothstep(0.055, 0.012, ear.d) * smoothstep(0.05, 0.28, n[2]) * smoothstep(1.0, 1.13, y);
    coat = mixc(coat, C.earPink, inner * 0.9);
    const rim = smoothstep(0.095, 0.06, ear.d) * (1 - inner);
    coat = mixc(coat, C.creamDark, rim * 0.35);
    const tip = smoothstep(1.30, 1.40, y) * smoothstep(1.40, 1.30, y) * 0;
    const darkTip = smoothstep(1.27, 1.40, y);
    coat = mixc(coat, C.dark, darkTip * 0.55);
    coat = mixc(coat, C.earPink, tip);
  }

  // inner ear color also on the dish facing forward
  if (y > 1.02 && Math.abs(z - 0.56) < 0.09 && Math.abs(Math.abs(x) - 0.12) < 0.045 && n[2] > 0.15) {
    coat = mixc(coat, C.earPink, 0.35);
  }

  // nose tip
  coat = mixc(coat, [0.52, 0.28, 0.27], smoothstep(0.05, 0.015, noseD) * 0.9);

  // per-vertex grain variation
  const g2 = (fbm2(x * 73 + 11, z * 67 + y * 41, 2) - 0.5) * 0.09;
  coat = [clamp(coat[0] + g2, 0, 1), clamp(coat[1] + g2 * 0.95, 0, 1), clamp(coat[2] + g2 * 0.9, 0, 1)];

  let furLen = 0.030;
  furLen *= 0.85 + grain * 0.35;
  furLen = mix(furLen, 0.012, muzzleMask);
  furLen = mix(furLen, 0.016, clamp(belly * 0.8, 0, 1));
  furLen = mix(furLen, 0.010, clamp(paw, 0, 1));
  furLen = mix(furLen, 0.055, tail);
  furLen = mix(furLen, 0.016, earRegion ? 0.55 : 0);
  furLen = mix(furLen, 0.008, smoothstep(0.06, 0.03, eyeD));
  if (earRegion) furLen = 0.018;
  if (tail > 0.4) furLen = 0.062;
  if (tail > 0.4) furLen = 0.055;
  // cheek fluff
  const cheek = smoothstep(0.06, 0.12, y) * smoothstep(0.86, 0.72, y) * smoothstep(0.60, 0.72, z) * smoothstep(0.17, 0.09, Math.abs(x));
  furLen = Math.max(furLen, cheek * 0.042);

  const lin = (c) => Math.pow(clamp(c, 0, 1), 2.2);
  return { color: [lin(coat[0]), lin(coat[1]), lin(coat[2])], furLen };
}

/* ---------------------------------------------------------------- rig */
const BONES = [
  ['root', null, [0, 0, 0]],
  ['hips', 'root', [0, 0.40, -0.06]],
  ['spine', 'hips', [0, 0.47, 0.16]],
  ['chest', 'spine', [0, 0.53, 0.34]],
  ['neck', 'chest', [0, 0.66, 0.48]],
  ['head', 'neck', [0, 0.80, 0.585]],
  ['earL0', 'head', [0.072, 0.945, 0.545]],
  ['earL1', 'earL0', [0.106, 1.145, 0.525]],
  ['earL2', 'earL1', [0.135, 1.325, 0.46]],
  ['earL3', 'earL2', [0.152, 1.425, 0.40]],
  ['earR0', 'head', [-0.072, 0.945, 0.545]],
  ['earR1', 'earR0', [-0.106, 1.145, 0.525]],
  ['earR2', 'earR1', [-0.135, 1.325, 0.46]],
  ['earR3', 'earR2', [-0.152, 1.425, 0.40]],
  ['tail', 'hips', [0, 0.50, -0.40]],
  ['thighL', 'hips', [0.175, 0.28, 0.02]],
  ['footL', 'thighL', [0.172, 0.08, 0.30]],
  ['thighR', 'hips', [-0.175, 0.28, 0.02]],
  ['footR', 'thighR', [-0.172, 0.08, 0.30]],
  ['armL', 'chest', [0.128, 0.34, 0.37]],
  ['pawL', 'armL', [0.128, 0.06, 0.44]],
  ['armR', 'chest', [-0.128, 0.34, 0.37]],
  ['pawR', 'armR', [-0.128, 0.06, 0.44]],
];
const boneIndex = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const boneWorld = BONES.map(([, , p]) => p);
const boneParent = BONES.map((b) => (b[1] ? boneIndex[b[1]] : -1));
const bindMat = boneWorld.map(invertTRS);
function invertTRS(pos) {
  // bones have no rest rotation, so inverse bind is a translation
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -pos[0], -pos[1], -pos[2], 1];
}
// segment for weighting (parent world -> bone world)
const boneSegments = BONES.map((b, i) => {
  const parent = boneParent[i];
  const a = parent >= 0 ? boneWorld[parent] : boneWorld[i];
  return { a, b: boneWorld[i], name: b[0] };
});

function skinWeights(p) {
  const absX = Math.abs(p[0]);
  const ear = earMask([absX, p[1], p[2]]);
  const isEar = ear.d < 0.095 && p[1] > 0.92;
  const candidates = [];
  if (isEar) {
    const side = p[0] >= 0 ? 'L' : 'R';
    const t = clamp(ear.t, 0, 1);
    // spread across the four ear joints
    const idx = t * 3.15;
    const base = Math.floor(idx), frac = idx - base;
    for (let j = 0; j < 4; j++) {
      let w = 0;
      if (j === base) w = 1 - frac;
      if (j === base + 1) w = frac;
      if (j === 3 && base >= 3) w = 1;
      if (w > 0.001) candidates.push([boneIndex[`ear${side}${j}`], w * (0.35 + 0.65 * smoothstep(0.92, 1.02, p[1]))]);
    }
    const headW = 1 - smoothstep(0.94, 1.02, p[1]);
    if (headW > 0.001) candidates.push([boneIndex.head, headW * 1.4]);
  }
  // nearest-segment weights for everything else
  for (let i = 1; i < BONES.length; i++) {
    const seg = boneSegments[i];
    const ab = sub(seg.b, seg.a);
    const t = clamp(dot(sub(p, seg.a), ab) / (dot(ab, ab) || 1), 0, 1);
    const q = add(seg.a, mul(ab, t));
    const dist = len(sub(p, q));
    let w = 1 / Math.pow(dist + 0.028, 5.5);
    if (isEar && /^ear/.test(seg.name)) w *= 1.7;
    if (p[1] < 0.28 && /^(foot|paw|arm)/.test(seg.name)) w *= 2.2;
    if (p[1] > 0.70 && seg.name === 'head') w *= 1.25;
    candidates.push([i, w]);
  }
  candidates.sort((a, b) => b[1] - a[1]);
  const top = candidates.slice(0, 4);
  const total = top.reduce((s, c) => s + c[1], 0) || 1;
  return top.map(([i, w]) => [i, w / total]);
}

/* ---------------------------------------------------------------- geometry build */
function buildMesh(res, bounds, smoothIters) {
  console.log(`  meshing ${res.join('x')} ...`);
  const t = performance.now();
  const raw = surfaceNets(bounds, res);
  console.log(`    ${raw.verts.length / 3} verts, ${raw.faces.length / 3} tris in ${((performance.now() - t) / 1000).toFixed(1)}s`);
  const verts = smoothVertices(raw.verts, raw.faces, smoothIters, 0.5);
  const normals = gradientNormals(verts);
  const count = verts.length / 3;
  const colors = new Float32Array(count * 3);
  const fur = new Float32Array(count);
  const uv = new Float32Array(count * 2);
  const joints = new Uint8Array(count * 4);
  const weights = new Float32Array(count * 4);
  const minY = bounds[0][1], maxY = bounds[1][1];
  let tris = raw.faces;
  for (let i = 0; i < count; i++) {
    const p = [verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]];
    const n = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
    const d = vertexData(p, n);
    colors[i * 3] = d.color[0]; colors[i * 3 + 1] = d.color[1]; colors[i * 3 + 2] = d.color[2];
    fur[i] = d.furLen;
    const ang = Math.atan2(p[0], p[2]);
    uv[i * 2] = ang / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = (p[1] - minY) / (maxY - minY);
    const sw = skinWeights(p);
    for (let s = 0; s < 4; s++) {
      joints[i * 4 + s] = sw[s] ? sw[s][0] : 0;
      weights[i * 4 + s] = sw[s] ? sw[s][1] : 0;
    }
  }
  return { verts, normals, colors, fur, uv, joints, weights, faces: tris };
}

/* ---------------------------------------------------------------- fur texture */
function makeFurTexture(size = 512) {
  const px = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // long, fine strands running down the V axis
      const wobble = (fbm2(u * 14.0, v * 3.2, 3) - 0.5) * 0.05;
      const line = Math.sin((u + wobble) * Math.PI * 2 * 116.0);
      const fiber = Math.pow(Math.abs(line), 2.6);
      const clump = fbm2(u * 5.5 + 2.2, v * 2.4 + 7.7, 4);
      const fine = vnoise2(u * 260, v * 64);
      let val = 0.30 + fiber * 0.44 + (clump - 0.5) * 0.45 + (fine - 0.5) * 0.12;
      val = clamp(val, 0, 1);
      const g = Math.round(val * 255);
      const i = (y * size + x) * 3;
      px[i] = g; px[i + 1] = g; px[i + 2] = g;
    }
  }
  return encodePNG(size, size, px, 3);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 4, 'ascii');
  data.copy(b, 8);
  b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return b;
}
function encodePNG(w, h, data, channels) {
  const stride = w * channels;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- simple glTF primitives */
function buildSphere(radius, seg = 24, rings = 16) {
  const pos = [], nrm = [], idx = [];
  for (let j = 0; j <= rings; j++) {
    const v = j / rings, phi = v * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const u = i / seg, theta = u * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(theta);
      pos.push(x * radius, y * radius, z * radius);
      nrm.push(x, y, z);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint32Array(idx) };
}
function buildWhisker(a, b, r0, r1, seg = 4) {
  const pos = [], nrm = [], idx = [];
  const dir = norm(sub(b, a));
  const up = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = norm(cross(dir, up));
  const t2 = cross(dir, t1);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = mix(a, b, t);
    const r = r0 + (r1 - r0) * t;
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      const nx = t1[0] * Math.cos(ang) + t2[0] * Math.sin(ang);
      const ny = t1[1] * Math.cos(ang) + t2[1] * Math.sin(ang);
      const nz = t1[2] * Math.cos(ang) + t2[2] * Math.sin(ang);
      pos.push(c[0] + nx * r, c[1] + ny * r, c[2] + nz * r);
      nrm.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < 6; k++) {
      const a0 = i * 6 + k, a1 = i * 6 + (k + 1) % 6;
      const b0 = a0 + 6, b1 = a1 + 6;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint32Array(idx) };
}

/* ---------------------------------------------------------------- GLB assembly */
class GlbBuilder {
  constructor() {
    this.json = {
      asset: { version: '2.0', generator: 'Clover Meadow procedural rabbit builder' },
      scene: 0,
      scenes: [{ name: 'Rabbit', nodes: [] }],
      nodes: [], meshes: [], materials: [], skins: [], accessors: [], bufferViews: [], textures: [], images: [], samplers: [], buffers: [{ byteLength: 0 }],
    };
    this.bin = [];
    this.byteLength = 0;
  }
  push(buf, target) {
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) { this.bin.push(Buffer.alloc(pad)); this.byteLength += pad; }
    const offset = this.byteLength;
    const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    this.bin.push(b);
    this.byteLength += b.length;
    const view = { buffer: 0, byteOffset: offset, byteLength: b.length };
    if (target) view.target = target;
    this.json.bufferViews.push(view);
    return this.json.bufferViews.length - 1;
  }
  accessor(typed, type, componentType, count, opts = {}) {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const view = this.push(buf, opts.target);
    const acc = { bufferView: view, componentType, count, type };
    if (opts.normalized) acc.normalized = true;
    if (opts.minmax) {
      acc.min = opts.minmax[0]; acc.max = opts.minmax[1];
    }
    if (opts.name) acc.name = opts.name;
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }
  addBufferViews() { /* handled in push */ }
  finish() {
    let binBuf = Buffer.concat(this.bin);
    const binPad = (4 - (binBuf.length % 4)) % 4;
    if (binPad) binBuf = Buffer.concat([binBuf, Buffer.alloc(binPad)]);
    this.json.buffers[0].byteLength = binBuf.length;
    const jsonStr = JSON.stringify(this.json);
    const jsonBuf = Buffer.from(jsonStr, 'utf8');
    const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
    const jsonChunk = Buffer.concat([jsonBuf, Buffer.from(' '.repeat(jsonPad))]);
    const total = 12 + 8 + jsonChunk.length + 8 + binBuf.length;
    const out = Buffer.alloc(total);
    out.write('glTF', 0, 4, 'ascii');
    out.writeUInt32LE(2, 4);
    out.writeUInt32LE(total, 8);
    out.writeUInt32LE(jsonChunk.length, 12);
    out.write('JSON', 16, 4, 'ascii');
    jsonChunk.copy(out, 20);
    let o = 20 + jsonChunk.length;
    out.writeUInt32LE(binBuf.length, o); o += 4;
    out.write('BIN\0', o, 4, 'ascii'); o += 4;
    binBuf.copy(out, o);
    return out;
  }
}

function addSkinMesh(gb, mesh, name, materialIdx, skinIdx, opts = {}) {
  const pos = mesh.verts;
  const idx = mesh.faces;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pos[i + a]); max[a] = Math.max(max[a], pos[i + a]); }
  }
  // quantized attributes keep the asset mobile-friendly
  const n = pos.length / 3;
  const nrmQ = new Int8Array(n * 3);
  const colQ = new Uint8Array(n * 4);
  const uvQ = new Uint16Array(n * 2);
  const furQ = new Uint8Array(n);
  const weightQ = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) nrmQ[i * 3 + a] = Math.round(clamp(mesh.normals[i * 3 + a], -1, 1) * 127);
    for (let a = 0; a < 3; a++) colQ[i * 4 + a] = Math.round(clamp(mesh.colors[i * 3 + a], 0, 1) * 255);
    colQ[i * 4 + 3] = 255;
    uvQ[i * 2] = Math.round(clamp(mesh.uv[i * 2], 0, 1) * 65535);
    uvQ[i * 2 + 1] = Math.round(clamp(mesh.uv[i * 2 + 1], 0, 1) * 65535);
    furQ[i] = Math.round(clamp(mesh.fur[i] / 0.08, 0, 1) * 255);
    let sum = 0;
    for (let a = 0; a < 4; a++) { const w = Math.round(clamp(mesh.weights[i * 4 + a], 0, 1) * 255); weightQ[i * 4 + a] = w; sum += w; }
    if (sum > 0 && sum !== 255) {
      // renormalize the largest weight so the sum is exactly 255
      let big = 0;
      for (let a = 1; a < 4; a++) if (weightQ[i * 4 + a] > weightQ[i * 4 + big]) big = a;
      weightQ[i * 4 + big] = clamp(weightQ[i * 4 + big] + (255 - sum), 0, 255);
    }
  }
  const posAcc = gb.accessor(pos, 'VEC3', 5126, n, { minmax: [min, max], name: `${name}_POSITION` });
  const nrmAcc = gb.accessor(nrmQ, 'VEC3', 5120, n, { normalized: true, name: `${name}_NORMAL` });
  const colAcc = gb.accessor(colQ, 'VEC4', 5121, n, { normalized: true, name: `${name}_COLOR` });
  const uvAcc = gb.accessor(uvQ, 'VEC2', 5123, n, { normalized: true, name: `${name}_TEXCOORD` });
  const furAcc = gb.accessor(furQ, 'SCALAR', 5121, n, { normalized: true, name: `${name}_FURLEN` });
  const jointAcc = gb.accessor(mesh.joints, 'VEC4', 5121, n, { name: `${name}_JOINTS` });
  const weightAcc = gb.accessor(weightQ, 'VEC4', 5121, n, { normalized: true, name: `${name}_WEIGHTS` });
  const idxAcc = gb.accessor(idx, 'SCALAR', 5125, idx.length, { target: 34963, name: `${name}_INDEX` });
  gb.json.meshes.push({
    name,
    primitives: [{
      attributes: { POSITION: posAcc, NORMAL: nrmAcc, COLOR_0: colAcc, TEXCOORD_0: uvAcc, JOINTS_0: jointAcc, WEIGHTS_0: weightAcc, _FURLEN: furAcc },
      indices: idxAcc,
      material: materialIdx,
    }],
  });
  const meshNode = gb.json.nodes.length;
  gb.json.nodes.push({
    name, mesh: gb.json.meshes.length - 1, skin: skinIdx,
    extras: { furLengthAttribute: '_FURLEN' },
  });
  return meshNode;
}

function addSimpleMesh(gb, geo, name, materialIdx, color) {
  const posAcc = gb.accessor(geo.pos, 'VEC3', 5126, geo.pos.length / 3, {});
  const nrmAcc = gb.accessor(geo.nrm, 'VEC3', 5126, geo.nrm.length / 3, {});
  const idxAcc = gb.accessor(geo.idx, 'SCALAR', 5125, geo.idx.length, { target: 34963 });
  const attrs = { POSITION: posAcc, NORMAL: nrmAcc };
  if (color) {
    const col = new Float32Array((geo.pos.length / 3) * 3);
    for (let i = 0; i < col.length; i += 3) { col[i] = color[0]; col[i + 1] = color[1]; col[i + 2] = color[2]; }
    attrs.COLOR_0 = gb.accessor(col, 'VEC3', 5126, col.length / 3, {});
  }
  gb.json.meshes.push({ name, primitives: [{ attributes: attrs, indices: idxAcc, material: materialIdx }] });
  const node = gb.json.nodes.length;
  gb.json.nodes.push({ name, mesh: gb.json.meshes.length - 1 });
  return node;
}

/* ---------------------------------------------------------------- main */
console.log('Building rabbit...');
const BOUNDS = [[-0.46, -0.012, -0.66], [0.46, 1.50, 1.02]];
const hi = buildMesh([100, 198, 138], BOUNDS, 2);
const lo = buildMesh([52, 102, 72], BOUNDS, 1);
console.log('  hi tris:', hi.faces.length / 3, ' lo tris:', lo.faces.length / 3);

const furPng = makeFurTexture(512);
console.log('  fur texture bytes:', furPng.length);

const gb = new GlbBuilder();
// texture + material
const imgView = gb.push(furPng);
gb.json.images.push({ bufferView: imgView, mimeType: 'image/png', name: 'FurDensity' });
gb.json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
gb.json.textures.push({ sampler: 0, source: 0, name: 'FurDensity' });
const coatMat = {
  name: 'RabbitCoat',
  pbrMetallicRoughness: {
    baseColorFactor: [1, 1, 1, 1],
    baseColorTexture: { index: 0 },
    metallicFactor: 0,
    roughnessFactor: 0.86,
  },
  doubleSided: false,
  extensions: { KHR_materials_sheen: { sheenColorFactor: [0.55, 0.45, 0.34], sheenRoughnessFactor: 0.65 } },
};
gb.json.materials.push(coatMat);
gb.json.extensionsUsed = ['KHR_materials_sheen'];

// skeleton nodes
gb.json.nodes.push({ name: 'RabbitRoot', children: [] });
const rootNode = gb.json.nodes.length - 1;
gb.json.scenes[0].nodes.push(rootNode);
const jointNodes = [];
for (let i = 0; i < BONES.length; i++) {
  const [name, parent, pos] = BONES[i];
  const ppos = parent ? boneWorld[boneIndex[parent]] : [0, 0, 0];
  const local = sub(pos, ppos);
  const node = {
    name,
    translation: local,
  };
  if (i === 0) node.translation = [0, 0, 0];
  jointNodes.push(gb.json.nodes.length);
  gb.json.nodes.push(node);
}
for (let i = 0; i < BONES.length; i++) {
  const parent = boneParent[i];
  if (parent >= 0) {
    const pn = gb.json.nodes[jointNodes[parent]];
    (pn.children ||= []).push(jointNodes[i]);
  }
}
gb.json.nodes[rootNode].children.push(jointNodes[0]);

// skin
const ibm = new Float32Array(16 * BONES.length);
for (let i = 0; i < BONES.length; i++) ibm.set(bindMat[i], i * 16);
const ibmAcc = gb.accessor(ibm, 'MAT4', 5126, BONES.length, {});
gb.json.skins.push({
  name: 'RabbitSkin',
  joints: jointNodes,
  inverseBindMatrices: ibmAcc,
  skeleton: jointNodes[0],
});
const skinIdx = 0;

const coatNode = addSkinMesh(gb, hi, 'RabbitCoat', 0, skinIdx, {});
const shellNode = addSkinMesh(gb, lo, 'RabbitFurShells', 0, skinIdx, {});
gb.json.nodes[rootNode].children.push(coatNode, shellNode);

// eyes (glossy, parented to head joint)
gb.json.materials.push({
  name: 'RabbitEye',
  pbrMetallicRoughness: { baseColorFactor: [0.0018, 0.0009, 0.0007, 1], metallicFactor: 0, roughnessFactor: 0.08 },
  extensions: { KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatRoughnessFactor: 0.03 }, KHR_materials_ior: { ior: 1.5 } },
});
gb.json.extensionsUsed.push('KHR_materials_clearcoat', 'KHR_materials_ior');
const eyeMat = gb.json.materials.length - 1;
const eyeGeo = buildSphere(0.035, 32, 22);
for (const s of [1, -1]) {
  const node = addSimpleMesh(gb, eyeGeo, `Eye${s > 0 ? 'L' : 'R'}`, eyeMat);
  const headLocal = sub([0.098 * s, 0.828, 0.728], boneWorld[boneIndex.head]);
  gb.json.nodes[node].translation = headLocal;
  gb.json.nodes[node].scale = [1, 1.08, 0.92];
  (gb.json.nodes[jointNodes[boneIndex.head]].children ||= []).push(node);
}
// nose
gb.json.materials.push({
  name: 'RabbitNose',
  pbrMetallicRoughness: { baseColorFactor: [0.21, 0.057, 0.053, 1], metallicFactor: 0, roughnessFactor: 0.42 },
  extensions: { KHR_materials_clearcoat: { clearcoatFactor: 0.4, clearcoatRoughnessFactor: 0.3 } },
});
const noseMat = gb.json.materials.length - 1;
const noseNode = addSimpleMesh(gb, buildSphere(1, 28, 18), 'Nose', noseMat);
gb.json.nodes[noseNode].translation = sub([0, 0.740, 0.866], boneWorld[boneIndex.head]);
gb.json.nodes[noseNode].scale = [0.021, 0.0145, 0.015];
(gb.json.nodes[jointNodes[boneIndex.head]].children ||= []).push(noseNode);

// whiskers
gb.json.materials.push({
  name: 'RabbitWhisker',
  pbrMetallicRoughness: { baseColorFactor: [0.64, 0.55, 0.43, 1], metallicFactor: 0, roughnessFactor: 0.5 },
});
const whiskerMat = gb.json.materials.length - 1;
for (const s of [1, -1]) {
  for (let w = 0; w < 5; w++) {
    const y = 0.705 + w * 0.010;
    const spread = 0.085 + w * 0.022;
    const a = [0.070 * s, y, 0.800];
    const b = [s * (0.175 + w * 0.030), y + 0.035 - w * 0.014, 0.73 + spread * 0.36];
    const node = addSimpleMesh(gb, buildWhisker(a, b, 0.0018, 0.0004, 4), `Whisker${s > 0 ? 'L' : 'R'}${w}`, whiskerMat);
    (gb.json.nodes[jointNodes[boneIndex.head]].children ||= []).push(node);
  }
}

// Whisker geometry was authored in world coordinates; rewrite positions relative to head.
{
  const headPos = boneWorld[boneIndex.head];
  for (const mesh of gb.json.meshes) {
    if (!/^Whisker/.test(mesh.name)) continue;
    const posAcc = gb.json.accessors[mesh.primitives[0].attributes.POSITION];
    const view = gb.json.bufferViews[posAcc.bufferView];
    const buf = Buffer.concat(gb.bin);
    const base = view.byteOffset;
    for (let i = 0; i < posAcc.count; i++) {
      const o = base + i * 12;
      buf.writeFloatLE(buf.readFloatLE(o) - headPos[0], o);
      buf.writeFloatLE(buf.readFloatLE(o + 4) - headPos[1], o + 4);
      buf.writeFloatLE(buf.readFloatLE(o + 8) - headPos[2], o + 8);
    }
    // write back into the bin chunk
    gb.bin = [buf];
  }
}

// Keep the coat texture UVs at a sensible scale.
gb.json.meshes.forEach((m) => { if (m.primitives[0].attributes._FURLEN !== undefined) m.extras = { fur: true }; });

const glb = gb.finish();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, glb);
console.log(`Wrote ${OUT} (${(glb.length / 1024 / 1024).toFixed(2)} MB) in ${((performance.now() - T0) / 1000).toFixed(1)}s`);
