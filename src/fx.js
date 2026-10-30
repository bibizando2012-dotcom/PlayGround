import * as THREE from 'three'

function makeTexture(kind = 'dust') {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, 128, 128)
  if (kind === 'heart') {
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.moveTo(64, 111)
    ctx.bezierCurveTo(54, 99, 17, 72, 17, 45)
    ctx.bezierCurveTo(17, 23, 45, 16, 64, 38)
    ctx.bezierCurveTo(83, 16, 111, 23, 111, 45)
    ctx.bezierCurveTo(111, 72, 74, 99, 64, 111)
    ctx.fill()
  } else if (kind === 'petal') {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 58)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.85)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(64, 64, 52, 29, 0.5, 0, Math.PI * 2)
    ctx.fill()
  } else {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62)
    g.addColorStop(0, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.5)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(64, 64, 62, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class Particles {
  constructor(scene, { count = 64, kind = 'dust', color = '#e8d9ba', size = 0.08, gravity = 1.2, drag = 1.5 } = {}) {
    this.scene = scene
    this.count = count
    this.cursor = 0
    this.gravity = gravity
    this.drag = drag
    this.positions = new Float32Array(count * 3)
    this.velocities = new Float32Array(count * 3)
    this.life = new Float32Array(count)
    this.maxLife = new Float32Array(count)
    this.sizes = new Float32Array(count)
    this.rotations = new Float32Array(count)
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1))
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1))
    this.geometry.setAttribute('aRot', new THREE.BufferAttribute(this.rotations, 1))
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: makeTexture(kind) },
        uColor: { value: new THREE.Color(color) },
        uSize: { value: size },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute float aSize;
        attribute float aRot;
        uniform float uSize;
        varying float vLife;
        varying float vRot;
        void main() {
          vLife = aLife;
          vRot = aRot;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * aSize * (300.0 / max(0.1, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying float vLife;
        varying float vRot;
        void main() {
          if (vLife <= 0.0) discard;
          vec2 uv = gl_PointCoord - 0.5;
          float c = cos(vRot);
          float s = sin(vRot);
          uv = mat2(c, -s, s, c) * uv + 0.5;
          vec4 tex = texture2D(uMap, uv);
          if (tex.a < 0.01) discard;
          gl_FragColor = vec4(uColor, tex.a * vLife);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 10
    scene.add(this.points)
  }

  burst(position, { count = 10, speed = 0.5, up = 0.6, spread = 0.4, size = 1, life = 1.2 } = {}) {
    for (let i = 0; i < count; i++) {
      const idx = this.cursor
      this.cursor = (this.cursor + 1) % this.count
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * spread
      this.positions[idx * 3] = position.x + Math.cos(a) * r
      this.positions[idx * 3 + 1] = position.y + (Math.random() - 0.2) * spread * 0.7
      this.positions[idx * 3 + 2] = position.z + Math.sin(a) * r
      this.velocities[idx * 3] = Math.cos(a) * speed * (0.4 + Math.random() * 0.8)
      this.velocities[idx * 3 + 1] = up * (0.5 + Math.random() * 0.9)
      this.velocities[idx * 3 + 2] = Math.sin(a) * speed * (0.4 + Math.random() * 0.8)
      this.maxLife[idx] = life * (0.65 + Math.random() * 0.7)
      this.life[idx] = 1
      this.sizes[idx] = size * (0.55 + Math.random() * 0.85)
      this.rotations[idx] = Math.random() * Math.PI * 2
    }
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.aLife.needsUpdate = true
    this.geometry.attributes.aSize.needsUpdate = true
    this.geometry.attributes.aRot.needsUpdate = true
  }

  update(dt) {
    let changed = false
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt / this.maxLife[i]
      if (this.life[i] <= 0) {
        this.life[i] = 0
        changed = true
        continue
      }
      const damp = Math.exp(-this.drag * dt)
      this.velocities[i * 3] *= damp
      this.velocities[i * 3 + 1] = this.velocities[i * 3 + 1] * damp - this.gravity * dt
      this.velocities[i * 3 + 2] *= damp
      this.positions[i * 3] += this.velocities[i * 3] * dt
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt
      this.rotations[i] += dt * 1.8
      changed = true
    }
    if (changed) {
      this.geometry.attributes.position.needsUpdate = true
      this.geometry.attributes.aLife.needsUpdate = true
      this.geometry.attributes.aRot.needsUpdate = true
    }
  }
}
