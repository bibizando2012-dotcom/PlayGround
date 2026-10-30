import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, damp, terrainHeight } from './utils.js';

function makeContactShadow() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(16, 20, 12, .5)');
  gradient.addColorStop(0.34, 'rgba(16, 20, 12, .25)');
  gradient.addColorStop(0.7, 'rgba(16, 20, 12, .07)');
  gradient.addColorStop(1, 'rgba(16, 20, 12, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: 0.38,
    toneMapped: false,
  });
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.name = 'Rabbit contact shadow';
  return mesh;
}

function createFurMaterial(baseMaterial, layer, totalLayers, timeUniform, furLength) {
  const material = baseMaterial.clone();
  const mixValue = layer / totalLayers;
  const layerNumber = mixValue.toFixed(4);
  const lengthNumber = furLength.toFixed(5);

  material.name = `Rabbit fur shell ${layer}`;
  material.roughness = Math.min(1, baseMaterial.roughness + 0.03);
  material.metalness = 0;
  material.envMapIntensity = 0.42;
  material.shadowSide = THREE.FrontSide;
  material.customProgramCacheKey = () => `rabbit-fur-${layer}-${totalLayers}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFurTime = timeUniform;

    shader.vertexShader = `
      uniform float uFurTime;
      varying vec2 vFurUv;
      varying float vFurLayer;
      varying float vFurLocalY;
    ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
        #include <begin_vertex>
        float furShell = ${layerNumber};
        float furLen = ${lengthNumber};
        // The face and ear tips use shorter guard hairs than the body.
        float upperHead = smoothstep(23.0, 36.0, position.y);
        furLen *= mix(1.0, 0.48, upperHead);
        vec3 furNormal = normalize(objectNormal);
        transformed += furNormal * furLen * furShell;
        // A whisper of movement in the longest guard hairs.
        transformed.x += sin(uFurTime * 1.05 + position.z * 14.0 + position.y * 8.0) * furLen * 0.08 * furShell;
        transformed.y += cos(uFurTime * 0.86 + position.x * 12.0) * furLen * 0.035 * furShell;
        vFurUv = uv;
        vFurLayer = furShell;
        vFurLocalY = position.y;
      `
    );

    shader.fragmentShader = `
      varying vec2 vFurUv;
      varying float vFurLayer;
      varying float vFurLocalY;
      float furHash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `
        #include <normal_fragment_begin>

        // A chain of tapered shells. Each successive shell keeps only the
        // densest strands, producing a soft, broken silhouette instead of a
        // solid inflated copy of the rabbit.
        vec2 furCell = vFurUv * vec2(190.0, 280.0);
        float strand = furHash(floor(furCell));
        float clump = furHash(floor(furCell * 0.17 + 31.7));
        float density = strand * 0.52 + clump * 0.48;
        float threshold = 0.02 + vFurLayer * 0.84;
        if (density < threshold) discard;

        // Each strand catches the light a little differently, and the tips are
        // paler than the deep, shaded coat.
        float strandShade = 0.88 + strand * 0.24;
        diffuseColor.rgb *= strandShade * mix(0.66, 1.16, vFurLayer);
        diffuseColor.rgb += vec3(0.13, 0.104, 0.075) * vFurLayer * (0.5 + strand * 0.5);
        float sheenFresnel = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.1);
        diffuseColor.rgb += vec3(0.19, 0.145, 0.1) * sheenFresnel * (0.2 + vFurLayer * 0.4);
      `
    );
  };
  return material;
}

export async function loadRabbit({ scene, manager, quality }) {
  const loader = new GLTFLoader(manager);
  const gltf = await loader.loadAsync('/models/rabbit.glb');
  const model = gltf.scene;
  model.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = false;
      object.receiveShadow = true;
      object.frustumCulled = false;
      if (object.material) {
        object.material.roughness = 0.88;
        object.material.metalness = 0;
        object.material.envMapIntensity = 0.5;
        object.material.needsUpdate = true;
      }
    }
  });

  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const targetHeight = 0.54;
  const scale = targetHeight / size.y;
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);

  const scaledBounds = new THREE.Box3().setFromObject(model);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= scaledBounds.min.y;
  model.updateMatrixWorld(true);

  const player = new THREE.Group();
  player.name = 'The rabbit';
  const visual = new THREE.Group();
  visual.add(model);
  player.add(visual);
  scene.add(player);

  const contactShadow = makeContactShadow();
  scene.add(contactShadow);

  const clips = Object.fromEntries(gltf.animations.map((clip) => [clip.name, clip]));
  const idleClip = gltf.animations.find((clip) => /idle/i.test(clip.name)) ?? gltf.animations[0];
  const walkClip = gltf.animations.find((clip) => /walk/i.test(clip.name)) ?? gltf.animations[0];
  const mixer = new THREE.AnimationMixer(model);
  const idle = mixer.clipAction(idleClip);
  const walk = mixer.clipAction(walkClip);
  idle.play();
  idle.time = 0.8;
  walk.enabled = false;

  const timeUniform = { value: 0 };
  const furMaterials = [];
  const shells = [];
  let baseMaterial = null;
  let baseMesh = null;

  model.traverse((object) => {
    if (!object.isMesh || baseMaterial) return;
    baseMaterial = object.material;
    baseMesh = object;
  });

  if (baseMesh) {
    const MAX_LAYERS = 9;
    const furLength = 0.032;
    for (let layer = 1; layer <= MAX_LAYERS; layer += 1) {
      const clone = baseMesh.clone();
      clone.geometry = baseMesh.geometry;
      clone.material = createFurMaterial(baseMaterial, layer, MAX_LAYERS, timeUniform, furLength);
      clone.castShadow = false;
      clone.receiveShadow = true;
      clone.renderOrder = 1 + layer;
      clone.frustumCulled = false;
      clone.name = `Rabbit fur shell ${layer}`;
      baseMesh.parent.add(clone);
      furMaterials.push(clone.material);
      shells.push(clone);
    }
  }

  let furVisible = Math.max(2, quality.furLayers ?? 8);
  const applyFurVisibility = () => {
    shells.forEach((shell, index) => {
      shell.visible = index < furVisible;
    });
  };
  applyFurVisibility();

  const state = {
    player,
    visual,
    model,
    mixer,
    idle,
    walk,
    idleClip,
    walkClip,
    shells,
    furMaterials,
    contactShadow,
    onGround: true,
    jumpVelocity: 0,
    jumpHeight: 0,
    landingSquash: 0,
    stepClock: 0,
    speed: 0,
    moving: false,
    dustRequests: [],
    setFurLayers(count) {
      furVisible = clamp(Math.round(count), 0, shells.length);
      applyFurVisibility();
    },
    getFurLayers() {
      return furVisible;
    },
    hop() {
      if (!this.onGround) return false;
      this.onGround = false;
      this.jumpVelocity = 2.15;
      this.landingSquash = 0;
      return true;
    },
    update(dt, elapsed, movement, groundY) {
      timeUniform.value = elapsed;
      this.mixer.update(dt);
      this.speed = movement.length();
      this.moving = this.speed > 0.055;

      if (this.moving) {
        walk.enabled = true;
        walk.setEffectiveWeight(damp(walk.getEffectiveWeight(), 1, 8, dt));
        idle.setEffectiveWeight(damp(idle.getEffectiveWeight(), 0, 8, dt));
        walk.timeScale = 0.9 + this.speed * 0.55;
      } else {
        walk.setEffectiveWeight(damp(walk.getEffectiveWeight(), 0, 6, dt));
        idle.setEffectiveWeight(damp(idle.getEffectiveWeight(), 1, 4, dt));
        if (!walk.isRunning()) walk.enabled = false;
      }

      if (!this.onGround) {
        this.jumpVelocity -= 10.6 * dt;
        this.jumpHeight += this.jumpVelocity * dt;
        if (this.jumpHeight <= 0) {
          this.jumpHeight = 0;
          this.jumpVelocity = 0;
          this.onGround = true;
          this.landingSquash = 1;
          this.dustRequests.push({ strength: 1, x: 0, z: 0 });
        }
      }

      this.landingSquash = damp(this.landingSquash, 0, 7, dt);
      const stretch = clamp(this.jumpVelocity * 0.018, -0.045, 0.06);
      const squash = this.landingSquash * 0.1;
      this.visual.scale.set(1 + squash * 0.55 - stretch * 0.4, 1 - squash + stretch, 1 + squash * 0.55 - stretch * 0.4);
      this.visual.position.y = this.jumpHeight;

      const headingTilt = clamp(this.speed * 0.045, 0, 0.075);
      this.visual.rotation.x = damp(this.visual.rotation.x, -headingTilt + (this.onGround ? 0 : -this.jumpVelocity * 0.018), 8, dt);

      const x = player.position.x;
      const z = player.position.z;
      const ground = groundY ?? terrainHeight(x, z);
      player.position.y = ground;
      contactShadow.position.set(x, ground + 0.018, z);
      const shadowScale = 0.5 + this.jumpHeight * 0.9;
      contactShadow.scale.setScalar(shadowScale);
      contactShadow.material.opacity = 0.38 * clamp(1 - this.jumpHeight * 2.1, 0.18, 1);
      contactShadow.rotation.y = player.rotation.y;

      if (this.moving && this.onGround) {
        this.stepClock += dt * (1.9 + this.speed * 1.2);
        if (this.stepClock > 0.29) {
          this.stepClock = 0;
          this.dustRequests.push({ strength: 0.32, x: 0, z: 0 });
        }
      }

      if (this.dustRequests.length > 5) this.dustRequests.splice(0, this.dustRequests.length - 5);
    },
    takeDustRequests() {
      const requests = this.dustRequests;
      this.dustRequests = [];
      return requests;
    },
  };

  return state;
}
