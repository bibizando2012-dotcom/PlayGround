import * as THREE from 'three';

export class DustField {
  constructor(scene, count = 110) {
    this.count = count;
    this.particles = Array.from({ length: count }, () => ({
      life: 0,
      maxLife: 1,
      velocity: new THREE.Vector3(),
      x: 0,
      y: -100,
      z: 0,
      size: 0.02,
    }));
    this.cursor = 0;

    this.positions = new Float32Array(count * 3);
    this.alphas = new Float32Array(count);
    this.sizes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) this.positions[i * 3 + 1] = -100;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      },
      vertexShader: `
        attribute float aAlpha;
        attribute float aSize;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = aSize * uPixelRatio * (270.0 / max(0.2, -mvPosition.z));
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * vAlpha;
          gl_FragColor = vec4(0.74, 0.65, 0.46, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  spawn(position, strength = 1) {
    const amount = strength > 0.7 ? 9 : 3;
    for (let i = 0; i < amount; i += 1) {
      const p = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % this.count;
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.3 + Math.random() * 0.75) * strength;
      p.life = p.maxLife = 0.55 + Math.random() * 0.8;
      p.velocity.set(Math.cos(angle) * speed, 0.2 + Math.random() * 0.45, Math.sin(angle) * speed);
      p.x = position.x + (Math.random() - 0.5) * 0.28;
      p.y = position.y + 0.025 + Math.random() * 0.08;
      p.z = position.z + (Math.random() - 0.5) * 0.28;
      p.size = (0.018 + Math.random() * 0.03) * (0.6 + strength * 0.5);
    }
  }

  update(dt) {
    const position = this.points.geometry.attributes.position;
    const alpha = this.points.geometry.attributes.aAlpha;
    const size = this.points.geometry.attributes.aSize;

    for (let i = 0; i < this.count; i += 1) {
      const p = this.particles[i];
      if (p.life > 0) {
        p.life -= dt;
        p.velocity.multiplyScalar(Math.exp(-2.7 * dt));
        p.velocity.y -= 0.15 * dt;
        p.x += p.velocity.x * dt;
        p.y += p.velocity.y * dt;
        p.z += p.velocity.z * dt;
        const t = Math.max(0, p.life / p.maxLife);
        this.positions[i * 3] = p.x;
        this.positions[i * 3 + 1] = p.y;
        this.positions[i * 3 + 2] = p.z;
        this.alphas[i] = Math.sin(Math.min(1, (1 - t) * 4) * Math.PI * 0.5) * t * 0.34;
        this.sizes[i] = p.size;
      } else {
        this.alphas[i] = 0;
        this.positions[i * 3 + 1] = -100;
      }
    }
    position.needsUpdate = true;
    alpha.needsUpdate = true;
    size.needsUpdate = true;
  }
}
