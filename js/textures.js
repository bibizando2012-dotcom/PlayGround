import * as THREE from '../vendor/three.module.js';

/** Small deterministic RNG so every player gets the same vale. */
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

function makeTexture(width, height, draw, { repeat = 1, colorSpace = true, anisotropy = 4 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = anisotropy;
  if (colorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function fillNoise(ctx, width, height, base, rng, variance = 18) {
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rng() - 0.5) * 2 * variance;
    data[i] = Math.max(0, Math.min(255, base[0] + n));
    data[i + 1] = Math.max(0, Math.min(255, base[1] + n));
    data[i + 2] = Math.max(0, Math.min(255, base[2] + n * 0.8));
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

export function makeGroundTexture() {
  const rng = mulberry32(77219);
  return makeTexture(512, 512, (ctx, w, h) => {
    fillNoise(ctx, w, h, [53, 55, 43], rng, 15);

    // Broad damp patches and moss.
    for (let i = 0; i < 70; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = 12 + rng() * 80;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      const green = rng() > 0.55;
      grad.addColorStop(0, green ? 'rgba(44, 53, 34, 0.36)' : 'rgba(20, 18, 13, 0.42)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Scattered dead leaves and twigs.
    for (let i = 0; i < 2400; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const a = rng() * Math.PI * 2;
      const len = 1 + rng() * 5;
      ctx.strokeStyle = rng() > 0.7
        ? `rgba(${92 + rng() * 38 | 0}, ${65 + rng() * 25 | 0}, ${35 + rng() * 18 | 0}, ${0.14 + rng() * 0.26})`
        : `rgba(${16 + rng() * 20 | 0}, ${18 + rng() * 17 | 0}, ${12 + rng() * 12 | 0}, ${0.2 + rng() * 0.3})`;
      ctx.lineWidth = 0.7 + rng() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.55);
      ctx.stroke();
    }

    // Bone-white flecks: stones and old ash.
    for (let i = 0; i < 180; i++) {
      ctx.fillStyle = `rgba(${120 + rng() * 50 | 0}, ${118 + rng() * 40 | 0}, ${102 + rng() * 34 | 0}, ${0.05 + rng() * 0.12})`;
      const r = rng() * 1.8;
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: 26 });
}

/** Packed earth for the shrine trails: lighter and more worn than the forest floor. */
export function makePathTexture() {
  const rng = mulberry32(55102);
  return makeTexture(512, 512, (ctx, w, h) => {
    fillNoise(ctx, w, h, [80, 75, 59], rng, 17);

    // Broad damp hollows and scuffed earth.
    for (let i = 0; i < 34; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = 16 + rng() * 64;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${34 + rng() * 22 | 0}, ${31 + rng() * 18 | 0}, ${23 + rng() * 12 | 0}, ${0.18 + rng() * 0.18})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Damp wheel-rut shadows running through the track.
    for (let i = 0; i < 24; i++) {
      const y = rng() * h;
      const grad = ctx.createLinearGradient(0, y - 10, 0, y + 18);
      grad.addColorStop(0, 'rgba(30, 24, 16, 0)');
      grad.addColorStop(0.5, `rgba(28, 23, 15, ${0.16 + rng() * 0.16})`);
      grad.addColorStop(1, 'rgba(30, 24, 16, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - 10, w, 28);
    }

    // Small embedded stones and bone chips.
    for (let i = 0; i < 900; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = 0.5 + rng() * 2.2;
      const pale = rng() > 0.72;
      ctx.fillStyle = pale
        ? `rgba(${120 + rng() * 40 | 0}, ${116 + rng() * 34 | 0}, ${98 + rng() * 26 | 0}, ${0.16 + rng() * 0.24})`
        : `rgba(${38 + rng() * 26 | 0}, ${33 + rng() * 20 | 0}, ${22 + rng() * 14 | 0}, ${0.18 + rng() * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fallen leaves and twigs.
    for (let i = 0; i < 280; i++) {
      const x = rng() * w;
      const y = rng() * h;
      ctx.strokeStyle = rng() > 0.5
        ? `rgba(${96 + rng() * 42 | 0}, ${66 + rng() * 26 | 0}, ${34 + rng() * 18 | 0}, ${0.18 + rng() * 0.24})`
        : `rgba(26, 22, 14, ${0.16 + rng() * 0.22})`;
      ctx.lineWidth = 0.6 + rng() * 1.1;
      const a = rng() * Math.PI * 2;
      const len = 3 + rng() * 9;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.6);
      ctx.stroke();
    }
  }, { repeat: 1 });
}

export function makeStoneTexture() {
  const rng = mulberry32(9007);
  return makeTexture(256, 256, (ctx, w, h) => {
    fillNoise(ctx, w, h, [79, 80, 73], rng, 21);

    for (let i = 0; i < 26; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = 10 + rng() * 45;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${40 + rng() * 30 | 0}, ${43 + rng() * 26 | 0}, ${38 + rng() * 20 | 0}, 0.18)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    ctx.strokeStyle = 'rgba(24, 25, 22, 0.48)';
    for (let i = 0; i < 16; i++) {
      ctx.lineWidth = 0.5 + rng() * 1.3;
      ctx.beginPath();
      let x = rng() * w;
      let y = rng() * h;
      ctx.moveTo(x, y);
      for (let s = 0; s < 5; s++) {
        x += (rng() - 0.5) * 34;
        y += (rng() - 0.5) * 34;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(${85 + rng() * 30 | 0}, ${98 + rng() * 32 | 0}, ${70 + rng() * 22 | 0}, ${0.05 + rng() * 0.15})`;
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, 1 + rng() * 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: 2 });
}

export function makeBarkTexture() {
  const rng = mulberry32(44118);
  return makeTexture(128, 256, (ctx, w, h) => {
    fillNoise(ctx, w, h, [39, 34, 27], rng, 15);
    for (let i = 0; i < 70; i++) {
      const x = rng() * w;
      const shade = rng() > 0.5 ? 15 : 62;
      ctx.strokeStyle = `rgba(${shade}, ${shade - 5}, ${shade - 12}, ${0.12 + rng() * 0.3})`;
      ctx.lineWidth = 0.6 + rng() * 2.6;
      ctx.beginPath();
      ctx.moveTo(x, -10);
      ctx.bezierCurveTo(x + (rng() - 0.5) * 16, h * 0.3, x + (rng() - 0.5) * 18, h * 0.7, x + (rng() - 0.5) * 13, h + 10);
      ctx.stroke();
    }
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(104, 96, 74, ${0.04 + rng() * 0.1})`;
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, 1 + rng() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: 1 });
}

export function makeGrassTexture() {
  const rng = mulberry32(2031);
  return makeTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 34; i++) {
      const x = 18 + rng() * (w - 36);
      const height = 24 + rng() * 72;
      const lean = (rng() - 0.5) * 26;
      ctx.strokeStyle = `rgba(${92 + rng() * 28 | 0}, ${98 + rng() * 28 | 0}, ${67 + rng() * 20 | 0}, ${0.55 + rng() * 0.35})`;
      ctx.lineWidth = 1 + rng() * 2.2;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.quadraticCurveTo(x + lean * 0.25, h - height * 0.6, x + lean, h - height);
      ctx.stroke();
    }
  }, { repeat: 1 });
}

export function makeGlowTexture() {
  return makeTexture(128, 128, (ctx, w, h) => {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.18, 'rgba(255, 255, 255, 0.82)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: 1 });
}

export function makeFlameTexture() {
  return makeTexture(64, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createRadialGradient(w / 2, h * 0.62, 0, w / 2, h * 0.62, w * 0.46);
    grad.addColorStop(0, 'rgba(255, 245, 214, 1)');
    grad.addColorStop(0.25, 'rgba(255, 191, 110, 0.95)');
    grad.addColorStop(0.6, 'rgba(219, 95, 43, 0.28)');
    grad.addColorStop(1, 'rgba(80, 30, 5, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.62, w * 0.3, h * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    // bright core
    const core = ctx.createRadialGradient(w / 2, h * 0.68, 0, w / 2, h * 0.68, w * 0.14);
    core.addColorStop(0, 'rgba(255, 255, 240, 1)');
    core.addColorStop(1, 'rgba(255, 210, 130, 0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: 1 });
}

export function makeFogTexture() {
  const rng = mulberry32(6612);
  return makeTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 11; i++) {
      const x = w * (0.28 + rng() * 0.44);
      const y = h * (0.32 + rng() * 0.36);
      const r = w * (0.16 + rng() * 0.24);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.12 + rng() * 0.1})`);
      grad.addColorStop(0.62, `rgba(255,255,255,${0.04 + rng() * 0.05})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }, { repeat: 1, colorSpace: false });
}

export function makeRuneTexture() {
  const rng = mulberry32(33577);
  return makeTexture(512, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255, 202, 135, 0.92)';
    ctx.shadowColor = 'rgba(255, 160, 70, 0.9)';
    ctx.shadowBlur = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let x = 24;
    for (let g = 0; g < 12; g++) {
      const glyphW = 15 + rng() * 12;
      const glyphH = 22 + rng() * 40;
      const y = h / 2 - glyphH / 2;
      ctx.lineWidth = 1.4 + rng() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y + glyphH);
      ctx.lineTo(x, y);
      const branches = 2 + (rng() * 3 | 0);
      for (let b = 0; b < branches; b++) {
        const by = y + rng() * glyphH * 0.8;
        const bd = (rng() > 0.5 ? 1 : -1) * (4 + rng() * glyphW);
        ctx.moveTo(x, by);
        ctx.lineTo(x + bd, by + (rng() - 0.2) * 18);
      }
      ctx.moveTo(x + 3, y + 4);
      ctx.lineTo(x + glyphW * 0.7, y + glyphH * 0.55);
      ctx.stroke();
      x += glyphW + 12 + rng() * 12;
    }
  }, { repeat: 1 });
}

export function makeAshTexture() {
  const rng = mulberry32(8821);
  return makeTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 200; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = rng() * 1.4;
      ctx.fillStyle = `rgba(255, 235, 200, ${0.08 + rng() * 0.35})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: 1, colorSpace: false });
}
