import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Rabbit } from './rabbit.js';

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1712);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 50);
camera.position.set(1.4, 1.1, 2.0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.72, 0.05);
controls.enableDamping = true;
controls.minDistance = 0.6;
controls.maxDistance = 5;

const key = new THREE.DirectionalLight(0xfff1dc, 1.7);
key.position.set(2.5, 4, 2.2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -2;
key.shadow.camera.right = 2;
key.shadow.camera.top = 2;
key.shadow.camera.bottom = -2;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.012;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc0ff, 0.65);
rim.position.set(-2, 2.5, -3);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x6b5138, 0.3));

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(6, 64),
  new THREE.MeshStandardMaterial({ color: 0x4b4030, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const gltf = await new GLTFLoader().loadAsync('/models/rabbit.glb');
const rabbit = new Rabbit(gltf, { quality: 20 });
rabbit.root.scale.multiplyScalar(1.0);
scene.add(rabbit.root);

const state = { sitting: false, speed: 0, vertical: 0, grounded: true, turnRate: 0, digging: false };
const clock = new THREE.Clock();
let spin = false;
let furOn = true;
let closeUp = false;

const stats = document.getElementById('stats');
let frames = 0, fpsT = 0;
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  controls.update();
  rabbit.update(dt, state);
  if (spin) rabbit.root.rotation.y += dt * 0.5;
  renderer.render(scene, camera);
  frames++; fpsT += dt;
  if (fpsT > 0.5) { stats.textContent = `${Math.round(frames / fpsT)} fps\n${renderer.info.render.triangles.toLocaleString()} tris\n${renderer.info.render.calls} calls`; frames = 0; fpsT = 0; }
  requestAnimationFrame(animate);
}
animate();

document.querySelectorAll('[data-q]').forEach((b) => {
  b.onclick = () => { rabbit.setQuality(Number(b.dataset.q)); document.querySelectorAll('[data-q]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
});
document.getElementById('toggleFur').onclick = () => {
  furOn = !furOn;
  rabbit.shells.forEach((s) => (s.visible = furOn));
};
document.getElementById('toggleSpin').onclick = () => (spin = !spin);
document.getElementById('toggleCam').onclick = () => {
  closeUp = !closeUp;
  controls.target.set(0, closeUp ? 0.92 : 0.72, 0);
  camera.position.set(closeUp ? 0.55 : 1.4, closeUp ? 1.15 : 1.1, closeUp ? 0.85 : 2.0);
  controls.minDistance = closeUp ? 0.35 : 0.6;
};
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
window.__lab = { rabbit, renderer, scene, camera, controls };
window.__THREE = THREE;
document.body.dataset.ready = '1';
