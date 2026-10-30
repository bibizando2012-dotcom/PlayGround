import * as THREE from 'three'

const vertexShader = /* glsl */ `
  attribute float aShell;

  uniform float uTime;
  uniform float uWind;
  uniform float uFurLength;
  uniform float uShellCount;

  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vLocal;
  varying float vShell;
  varying float vViewZ;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float lengthFactor() {
    return fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec3 local = position;
    vec3 n = normalize(normal);
    float shell = aShell;
    float s = clamp(shell, 0.0, 1.0);

    float jitter = 0.76 + 0.34 * hash13(local * 31.0);
    float lengthOffset = uFurLength * (0.58 + 0.42 * lengthFactor());
    vec3 displaced = local + n * lengthOffset * s * jitter;

    // A little natural droop and breeze, strongest at the tips.
    vec4 rootWorld = modelMatrix * vec4(local, 1.0);
    float phase = rootWorld.x * 2.7 + rootWorld.z * 2.1 - rootWorld.y * 1.2;
    float breeze = uWind * (0.55 + 0.45 * sin(uTime * 0.7 + rootWorld.x * 0.35));
    displaced.x += sin(uTime * 1.9 + phase) * 0.0045 * s * s * breeze;
    displaced.z += cos(uTime * 1.55 + phase * 1.2) * 0.003 * s * s * breeze;
    displaced.y -= 0.012 * s * s;

    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * n);
    vLocal = local;
    vShell = s;
    vec4 view = viewMatrix * world;
    vViewZ = -view.z;
    gl_Position = projectionMatrix * view;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uRootColor;
  uniform vec3 uTipColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uDensity;
  uniform float uTime;

  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vLocal;
  varying float vShell;
  varying float vViewZ;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uSunDir);
    float shell = vShell;

    // A stable coat-space cell pattern. The same cell is used on every shell,
    // so the hairs read as individual tapered strands instead of screen noise.
    vec3 an = abs(N);
    vec2 p = mix(vLocal.xy, vLocal.xz, smoothstep(0.35, 0.65, an.y));
    p += vec2(vLocal.z * 0.81, vLocal.z * 0.47);
    vec2 cell = p * (118.0 + uDensity * 52.0);
    float seed = hash21(floor(cell));
    float clump = hash21(floor(cell * 0.19) + 19.2);
    float strandLength = 0.40 + 0.60 * seed;

    // Discard the tips of shorter hairs. The tiny noise term breaks up the
    // grid at silhouette edges without making the coat shimmer.
    float edgeNoise = (hash21(gl_FragCoord.xy * 0.7) - 0.5) * 0.10;
    if (shell > strandLength + edgeNoise) discard;

    float keep = smoothstep(strandLength + 0.12, strandLength - 0.20, shell);
    float rootOcclusion = mix(0.22, 1.0, pow(shell, 0.55));
    vec3 base = mix(uRootColor, uTipColor, pow(shell, 1.15));
    base *= 0.88 + clump * 0.24;

    // Wrapped diffuse + cool sky bounce. The wrap softens the terminator so
    // the coat reads as velvet rather than plastic.
    float wrap = clamp((dot(N, L) + 0.42) / 1.42, 0.0, 1.0);
    float skyMix = N.y * 0.5 + 0.5;
    vec3 ambient = mix(uGroundColor, uSkyColor, skyMix) * 0.52;
    vec3 diffuse = base * (ambient + uSunColor * wrap * 0.92) * rootOcclusion;

    // Fur is strongest in the fuzz at grazing angles.
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
    float back = pow(clamp(dot(-V, L), 0.0, 1.0), 2.1);
    vec3 scatter = uTipColor * (rim * 0.34 + back * 0.72) * (0.25 + shell * 0.75);
    vec3 color = diffuse + scatter;

    float alpha = (0.09 + 0.42 * keep) * (0.65 + 0.35 * clump);
    alpha *= smoothstep(0.0, 0.09, shell + 0.025);
    if (alpha < 0.015) discard;

    float fog = 1.0 - exp(-uFogDensity * uFogDensity * vViewZ * vViewZ);
    color = mix(color, uFogColor, clamp(fog, 0.0, 0.9));

    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export class FurCoat {
  constructor(renderer, quality = 1) {
    this.renderer = renderer
    this.quality = quality
    this.meshes = []
    this.materials = []
    this.uniforms = {
      uTime: { value: 0 },
      uWind: { value: 1 },
      uSunColor: { value: new THREE.Color('#ffd8a0') },
      uSunDir: { value: new THREE.Vector3(-0.55, 0.78, -0.3).normalize() },
      uSkyColor: { value: new THREE.Color('#9bc8de') },
      uGroundColor: { value: new THREE.Color('#6e6039') },
      uFogColor: { value: new THREE.Color('#d7d7b3') },
      uFogDensity: { value: 0.028 },
    }
  }

  attach(model, { maxShells = 1 } = {}) {
    const added = []
    model.traverse((child) => {
      if (!child.isMesh || !child.userData?.fur) return
      const fur = child.userData.fur
      const source = child.geometry
      const shellCount = Math.max(6, Math.round((fur.shells || 26) * maxShells * this.quality))

      const inst = new THREE.InstancedBufferGeometry()
      inst.index = source.index
      for (const [name, attr] of Object.entries(source.attributes)) {
        inst.setAttribute(name, attr)
      }
      const aShell = new Float32Array(shellCount)
      for (let i = 0; i < shellCount; i++) aShell[i] = i / Math.max(1, shellCount - 1)
      inst.setAttribute('aShell', new THREE.InstancedBufferAttribute(aShell, 1))
      inst.instanceCount = shellCount
      if (source.boundingSphere) {
        inst.boundingSphere = source.boundingSphere.clone()
        inst.boundingSphere.radius += fur.length * 1.2
      }

      const uniforms = {
        ...this.uniforms,
        uRootColor: { value: new THREE.Color(fur.root) },
        uTipColor: { value: new THREE.Color(fur.tip) },
        uFurLength: { value: fur.length },
        uDensity: { value: fur.density ?? 0.9 },
        uShellCount: { value: shellCount },
      }
      const material = new THREE.ShaderMaterial({
        name: `FurShell_${child.name}`,
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        toneMapped: true,
      })
      material.extensions = { derivatives: true }

      const coat = new THREE.Mesh(inst, material)
      coat.name = `${child.name}_Shells`
      coat.position.copy(child.position)
      coat.quaternion.copy(child.quaternion)
      coat.scale.copy(child.scale)
      coat.frustumCulled = false
      coat.renderOrder = 4
      child.parent.add(coat)

      // The undercoat is a darker, smoother mattress for the hair roots.
      if (child.material) {
        child.material.color = new THREE.Color(fur.root).multiplyScalar(1.4)
        child.material.roughness = Math.max(0.82, fur.roughness ?? 0.8)
        child.material.needsUpdate = true
      }
      child.castShadow = false
      child.receiveShadow = false
      this.meshes.push(coat)
      this.materials.push(material)
      added.push(coat)
    })
    return added
  }

  setEnvironment({ sunColor, sunDir, skyColor, groundColor, fogColor, fogDensity }) {
    for (const u of [this.uniforms, ...this.materials.map((m) => m.uniforms)]) {
      if (sunColor !== undefined) u.uSunColor.value.copy(sunColor)
      if (sunDir !== undefined) u.uSunDir.value.copy(sunDir)
      if (skyColor !== undefined) u.uSkyColor.value.copy(skyColor)
      if (groundColor !== undefined) u.uGroundColor.value.copy(groundColor)
      if (fogColor !== undefined) u.uFogColor.value.copy(fogColor)
      if (fogDensity !== undefined) u.uFogDensity.value = fogDensity
    }
  }

  update(dt, time, wind = 1) {
    this.uniforms.uTime.value = time
    this.uniforms.uWind.value = wind
    for (const m of this.materials) {
      m.uniforms.uTime.value = time
      m.uniforms.uWind.value = wind
    }
    void dt
  }

  setQuality(quality) {
    this.quality = quality
    for (const m of this.materials) {
      const max = m.uniforms.uShellCount.value
      const next = Math.max(8, Math.round(max * quality))
      const geo = m.userData.geometry
      if (geo) geo.instanceCount = next
    }
  }
}
