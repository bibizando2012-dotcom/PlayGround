import * as THREE from 'three';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

export function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return lerp(
    lerp(hash2(xi, yi), hash2(xi + 1, yi), u),
    lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u),
    v
  );
}

export function fbm(x, y, octaves = 4) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i += 1) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

/**
 * The game's single source of truth for ground elevation. The terrain mesh,
 * every planted object, and the rabbit all sample this function.
 */
export function terrainHeight(x, z) {
  const bowl = -0.17 * Math.exp(-(x * x + z * z) / 150);
  const broad = 0.22 * Math.sin(x * 0.135 + 0.8) * Math.cos(z * 0.155 - 0.4);
  const mid = 0.1 * Math.sin(x * 0.32 - 1.4) * Math.sin(z * 0.25 + 0.7);
  const fine = 0.032 * Math.cos(x * 0.71 - z * 0.53);
  const edgeRise = 0.006 * Math.max(0, Math.hypot(x, z) - 22);
  return bowl + broad + mid + fine + edgeRise;
}

export function terrainNormal(x, z, e = 0.35) {
  const hL = terrainHeight(x - e, z);
  const hR = terrainHeight(x + e, z);
  const hD = terrainHeight(x, z - e);
  const hU = terrainHeight(x, z + e);
  return new THREE.Vector3(hL - hR, 2 * e, hD - hU).normalize();
}

export function makeRng(seed) {
  const random = mulberry32(seed);
  return {
    random,
    range: (a, b) => a + (b - a) * random(),
    int: (a, b) => Math.floor(a + (b - a + 1) * random()),
    pick: (array) => array[Math.floor(random() * array.length)],
    chance: (p) => random() < p,
  };
}

export function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function formatNumber(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

export function disposeObject(root) {
  root.traverse((object) => {
    if (object.geometry) object.geometry.dispose?.();
    if (object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value && value.isTexture) value.dispose?.();
        }
        material.dispose?.();
      }
    }
  });
}
