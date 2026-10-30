import * as THREE from 'three'
import { canvas2d, mulberry32, hash2, valueNoise2, fbm2, clamp, lerp } from './rng.js'

/* ------------------------------------------------------------------ */
/*  Fur strand atlas                                                   */
/* ------------------------------------------------------------------ */

function strand(ctx, size, x, y, len, width, lean, color, alpha, rnd, phase) {
  const steps = 5
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    pts.push([
      x + lean * t * t + Math.sin(t * 2.4 + phase) * (0.35 + t * 0.8),
      y + len * t
    ])
  }

  // Only draw wrapped copies when the fibre actually crosses a tile edge.
  const margin = len + Math.abs(lean) + width + 3
  const oxs = x < margin || x > size - margin ? [-size, 0, size] : [0]
  const oys = y < margin || y > size - margin ? [-size, 0, size] : [0]

  for (const ox of oxs) {
    for (const oy of oys) {
      ctx.beginPath()
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const w = Math.max(0.1, width * Math.pow(1 - t, 0.62) * (0.8 + 0.2 * Math.sin(t * 8 + phase)))
        const px = pts[i][0] + ox
        const py = pts[i][1] + oy
        if (i === 0) ctx.moveTo(px - w * 0.5, py)
        else ctx.lineTo(px - w * 0.5, py)
      }
      for (let i = steps; i >= 0; i--) {
        const t = i / steps
        const w = Math.max(0.1, width * Math.pow(1 - t, 0.62) * (0.8 + 0.2 * Math.sin(t * 8 + phase)))
        ctx.lineTo(pts[i][0] + ox + w * 0.5, pts[i][1] + oy)
      }
      ctx.closePath()
      ctx.globalAlpha = alpha * (0.6 + rnd() * 0.4)
      ctx.fillStyle = color
      ctx.fill()
    }
  }
}

/**
 * A tileable, high-density atlas of tapered, slightly curling fur strands.
 * RGB stays in a tight warm-cream range; per-vertex colour tints each part.
 */
export function createFurTexture(size = 1024, seed = 20261030) {
  const { canvas, ctx } = canvas2d(size)
  const rnd = mulberry32(seed)
  ctx.clearRect(0, 0, size, size)

  // Near-white fibres. The coat's colour lives in the per-vertex tint, so the
  // atlas carries only soft value variation instead of painted-in stripes.
  const palette = ['#e8dfce', '#e0d6c4', '#d8ccb8', '#f2ebdd', '#cbbda6', '#e4dac9', '#c1b098', '#ded3c1']
  const pick = () => palette[(rnd() * palette.length) | 0]

  // Downy underhairs: short, dense and almost directionless.
  for (let i = 0; i < 52000; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const len = size * (0.006 + rnd() * 0.013)
    const width = 0.85 + rnd() * 0.7
    const lean = (rnd() - 0.5) * 4.6
    strand(ctx, size, x, y, len, width, lean, pick(), 0.82 + rnd() * 0.18, rnd, rnd() * 6.28)
  }

  // Mid-length fibres soften the surface without forming brush strokes.
  for (let i = 0; i < 14000; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const len = size * (0.018 + rnd() * 0.024)
    const width = 0.65 + rnd() * 0.44
    const lean = (rnd() - 0.5) * 7.5
    strand(ctx, size, x, y, len, width, lean, pick(), 0.68 + rnd() * 0.24, rnd, rnd() * 6.28)
  }

  // Rare guard hairs break the silhouette.
  for (let i = 0; i < 3200; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const len = size * (0.06 + rnd() * 0.055)
    const width = 0.42 + rnd() * 0.34
    const lean = (rnd() - 0.5) * 11
    strand(ctx, size, x, y, len, width, lean, pick(), 0.5 + rnd() * 0.3, rnd, rnd() * 6.28)
  }

  // Agouti banding: a minority of darker and brighter fibres give the coat
  // depth instead of one flat felted value.
  const dark = ['#8a765d', '#7a654c', '#9b8468', '#6f5b44']
  const light = ['#fbf6ec', '#f2eadb', '#fffaf1']
  for (let i = 0; i < 7000; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const len = size * (0.014 + rnd() * 0.04)
    const width = 0.45 + rnd() * 0.5
    const lean = (rnd() - 0.5) * 7.6
    const c = dark[(rnd() * dark.length) | 0]
    strand(ctx, size, x, y, len, width, lean, c, 0.45 + rnd() * 0.4, rnd, rnd() * 6.28)
  }
  for (let i = 0; i < 4200; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const len = size * (0.012 + rnd() * 0.032)
    const width = 0.4 + rnd() * 0.45
    const lean = (rnd() - 0.5) * 6.8
    const c = light[(rnd() * light.length) | 0]
    strand(ctx, size, x, y, len, width, lean, c, 0.5 + rnd() * 0.4, rnd, rnd() * 6.28)
  }

  // A whisper of downy fuzz near the roots.
  ctx.globalAlpha = 0.18
  for (let i = 0; i < 4200; i++) {
    ctx.fillStyle = pick()
    const x = rnd() * size
    const y = rnd() * size
    ctx.beginPath()
    ctx.arc(x, y, 0.4 + rnd() * 1.1, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  tex.name = 'FurStrands'
  return tex
}

/** Dark, opaque undercoat seen between strands. */
export function createUndercoatTexture(size = 512, seed = 91) {
  const { canvas, ctx } = canvas2d(size)
  const rnd = mulberry32(seed)
  ctx.fillStyle = '#9d8e78'
  ctx.fillRect(0, 0, size, size)

  // Dense, soft fluff: lighter tips, slightly darker roots, very low contrast.
  for (let i = 0; i < 52000; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const l = 0.6 + rnd() * 3.4
    const a = 0.05 + rnd() * 0.13
    const warm = rnd() > 0.46
    ctx.strokeStyle = warm ? `rgba(92,74,54,${a})` : `rgba(214,198,170,${a})`
    ctx.lineWidth = 0.3 + rnd() * 0.5
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rnd() - 0.5) * 1.6, y + l)
    ctx.stroke()
  }

  // only the faintest large-scale variation, so gaps read as depth
  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm2(x / 80, y / 80, 2) - 0.5
      const i = (y * size + x) * 4
      d[i] = clamp(d[i] + n * 10, 0, 255)
      d[i + 1] = clamp(d[i + 1] + n * 9, 0, 255)
      d[i + 2] = clamp(d[i + 2] + n * 8, 0, 255)
    }
  }
  ctx.putImageData(img, 0, 0)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  tex.name = 'Undercoat'
  return tex
}

/**
 * Long, sparse guard hairs for a second shell layer. Keeping these on their
 * own sparse atlas means the wispy silhouette fibres don't thicken the
 * undercoat into felt.
 */
export function createGuardHairTexture(size = 1024, seed = 777) {
  const { canvas, ctx } = canvas2d(size)
  const rnd = mulberry32(seed)
  ctx.clearRect(0, 0, size, size)

  const light = ['#f6efe2', '#ece2d1', '#ddcfba', '#fff9f0']
  const dark = ['#8d7659', '#75604a', '#a58c6c', '#6a563f']
  for (let i = 0; i < 3400; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const len = size * (0.018 + rnd() * 0.034)
    const width = 0.45 + rnd() * 0.44
    const lean = (rnd() - 0.5) * 12
    const c = rnd() > 0.26
      ? light[(rnd() * light.length) | 0]
      : dark[(rnd() * dark.length) | 0]
    strand(ctx, size, x, y, len, width, lean, c, 0.5 + rnd() * 0.35, rnd, rnd() * 6.28)
  }

  // A handful of longer fibres carry the silhouette.
  for (let i = 0; i < 520; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const len = size * (0.045 + rnd() * 0.04)
    const width = 0.36 + rnd() * 0.32
    const lean = (rnd() - 0.5) * 14
    const c = rnd() > 0.38
      ? light[(rnd() * light.length) | 0]
      : dark[(rnd() * dark.length) | 0]
    strand(ctx, size, x, y, len, width, lean, c, 0.38 + rnd() * 0.34, rnd, rnd() * 6.28)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  tex.name = 'GuardHairs'
  return tex
}

/** Soft pink skin for the inner ear and nose. */
export function createSkinTexture(size = 256, seed = 303) {
  const { canvas, ctx } = canvas2d(size)
  const rnd = mulberry32(seed)
  ctx.fillStyle = '#e2b2aa'
  ctx.fillRect(0, 0, size, size)

  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm2(x / 22 + 3, y / 22 + 8, 3) - 0.5
      const i = (y * size + x) * 4
      d[i] = clamp(d[i] + n * 26, 0, 255)
      d[i + 1] = clamp(d[i + 1] + n * 20, 0, 255)
      d[i + 2] = clamp(d[i + 2] + n * 18, 0, 255)
    }
  }
  ctx.putImageData(img, 0, 0)

  // Faint capillaries.
  ctx.lineCap = 'round'
  for (let i = 0; i < 90; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const len = 8 + rnd() * 30
    const a = rnd() * Math.PI * 2
    ctx.strokeStyle = `rgba(154,84,86,${0.05 + rnd() * 0.09})`
    ctx.lineWidth = 0.5 + rnd() * 0.9
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(
      x + Math.cos(a + 0.5) * len * 0.6,
      y + Math.sin(a + 0.5) * len * 0.6,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len
    )
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  tex.name = 'Skin'
  return tex
}

/* ------------------------------------------------------------------ */
/*  Meadow floor                                                        */
/* ------------------------------------------------------------------ */

export function createGroundTexture(size = 1024, seed = 7) {
  const { canvas, ctx } = canvas2d(size)
  const rnd = mulberry32(seed)
  ctx.fillStyle = '#547a36'
  ctx.fillRect(0, 0, size, size)

  const greens = ['#3c6329', '#48702f', '#588138', '#65903f', '#6f9a48', '#7da752', '#2f5423', '#5b8a3d']
  const wrapDraw = (draw) => {
    const oxs = [0]
    const oys = [0]
    for (const ox of oxs) for (const oy of oys) draw(ox, oy)
  }

  // clumpy grass strokes
  for (let i = 0; i < 14000; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const len = 3 + rnd() * 14
    const lean = (rnd() - 0.5) * 7
    ctx.strokeStyle = greens[(rnd() * greens.length) | 0]
    ctx.globalAlpha = 0.18 + rnd() * 0.4
    ctx.lineWidth = 0.6 + rnd() * 1.4
    const wrap = (dx, dy) => {
      ctx.beginPath()
      ctx.moveTo(x + dx, y + dy)
      ctx.quadraticCurveTo(x + dx + lean * 0.4, y + dy + len * 0.55, x + dx + lean, y + dy + len)
      ctx.stroke()
    }
    wrapDraw(wrap)
    if (x < 20) wrap(-size, 0)
    if (x > size - 20) wrap(size, 0)
    if (y < 20) wrap(0, -size)
    if (y > size - 20) wrap(0, size)
  }
  ctx.globalAlpha = 1

  // little clover leaves
  for (let i = 0; i < 320; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const r = 2 + rnd() * 5
    const dark = rnd() > 0.5
    ctx.fillStyle = dark ? '#2e5526' : '#3f6c2c'
    ctx.globalAlpha = 0.35 + rnd() * 0.4
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + rnd()
      ctx.beginPath()
      ctx.ellipse(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, r * 0.55, r * 0.42, a, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // tiny dry flecks and soil
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rnd() > 0.5 ? '#8a7a4c' : '#6d5c37'
    ctx.globalAlpha = 0.08 + rnd() * 0.2
    ctx.beginPath()
    ctx.arc(rnd() * size, rnd() * size, 0.5 + rnd() * 2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  tex.name = 'MeadowGround'
  return tex
}

/* ------------------------------------------------------------------ */
/*  Water + sky helpers                                                 */
/* ------------------------------------------------------------------ */

export function createWaterNormalTexture(size = 256, seed = 3) {
  const rnd = mulberry32(seed)
  const height = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2
      const v = (y / size) * Math.PI * 2
      height[y * size + x] =
        Math.sin(u * 3 + Math.cos(v * 2) * 1.2) * 0.45 +
        Math.sin(v * 5 + Math.sin(u * 3) * 0.8) * 0.3 +
        valueNoise2(x / 18, y / 18) * 0.35
    }
  }
  const { canvas, ctx } = canvas2d(size)
  const img = ctx.createImageData(size, size)
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 1.2
      const dy = (at(x, y + 1) - at(x, y - 1)) * 1.2
      const nx = -dx
      const ny = -dy
      const nz = 1
      const l = Math.hypot(nx, ny, nz)
      const i = (y * size + x) * 4
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255
      img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.name = 'WaterNormals'
  return tex
}

export function createSoftSpriteTexture(size = 256, inner = 'rgba(255,255,255,0.95)', outer = 'rgba(255,255,255,0)') {
  const { canvas, ctx } = canvas2d(size)
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, inner)
  g.addColorStop(0.45, inner.replace(/0\.\d+\)/, '0.45)'))
  g.addColorStop(1, outer)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.name = 'SoftGlow'
  return tex
}

export function createCloudTexture(size = 256, seed = 12) {
  const { canvas, ctx } = canvas2d(size)
  const rnd = mulberry32(seed)
  ctx.clearRect(0, 0, size, size)
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 26; i++) {
    const x = size * (0.22 + rnd() * 0.56)
    const y = size * (0.38 + rnd() * 0.28)
    const r = size * (0.06 + rnd() * 0.14)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(255,255,255,0.30)')
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  ctx.globalCompositeOperation = 'source-over'
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.name = 'Cloud'
  return tex
}

/** A tileable normal-ish grain used on stone and bark. */
export function createGrainTexture(size = 256, seed = 44) {
  const { canvas, ctx } = canvas2d(size)
  const rnd = mulberry32(seed)
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm2(x / 26, y / 26, 4)
      const i = (y * size + x) * 4
      img.data[i] = 120 + n * 90
      img.data[i + 1] = 115 + n * 85
      img.data[i + 2] = 105 + n * 80
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.name = 'Grain'
  return tex
}

export { clamp, lerp, hash2, valueNoise2, fbm2 }
