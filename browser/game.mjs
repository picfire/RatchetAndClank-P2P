import * as THREE from 'three';
import { OrbitControls } from './node_modules/three/examples/jsm/controls/OrbitControls.js';
import { IsoReader } from './iso-reader.mjs';
import { initializeDiscTable } from './disc-loader.mjs';
import { readSkyGeometry, readSkyTextures } from './sky-geometry.mjs';

const canvas = document.querySelector('canvas');
const status = document.querySelector('#status');
const disc = document.querySelector('#disc');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.001, 1000);
camera.up.set(0, 0, 1);
camera.position.set(0, -0.01, 0);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x070a0c);
const controls = new OrbitControls(camera, canvas);
controls.enablePan = false;
controls.enableZoom = false;
controls.enableDamping = true;
controls.rotateSpeed = 0.45;
const skyGroup = new THREE.Group();
scene.add(skyGroup);
let api;
let decoder;
let currentJob;
let textures = [];

function resize() {
  const width = innerWidth;
  const height = innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function clearSky() {
  for (const mesh of [...skyGroup.children]) {
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    skyGroup.remove(mesh);
  }
  for (const texture of textures) texture.dispose();
  textures = [];
}

function showSky(archive) {
  clearSky();
  const base = api.runtime_sky_stage_address();
  const bytes = new Uint8Array(api.memory.buffer, base, archive.bytes);
  const shells = readSkyGeometry(bytes, archive.header.skyOffset, base);
  textures = readSkyTextures(bytes, archive.header.skyOffset, base).map(image => {
    const texture = new THREE.DataTexture(image.rgba, image.width, image.height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  });
  for (const shell of shells) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(shell.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(shell.colours, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(shell.uvs, 2));
    const material = shell.coloured
      ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthWrite: false })
      : textures.map(texture => new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    if (!shell.coloured) {
      let start = 0;
      for (let triangle = 1; triangle <= shell.materials.length; triangle++) {
        if (triangle === shell.materials.length || shell.materials[triangle] !== shell.materials[start]) {
          const index = shell.materials[start];
          if (index >= textures.length) throw new Error('Sky triangle references an absent texture.');
          geometry.addGroup(start * 3, (triangle - start) * 3, index);
          start = triangle;
        }
      }
    }
    const mesh = new THREE.Mesh(geometry, material);
    const scales = [1, 3, 2.5, 2, 1.5, 1.25];
    mesh.scale.setScalar(scales[shell.index] ?? 1);
    mesh.rotation.z = shell.index ? shell.index * 1.256637 - Math.PI : 0;
    mesh.renderOrder = shell.index;
    skyGroup.add(mesh);
  }
  document.body.dataset.triangles = String(shells.reduce((sum, shell) => sum + shell.materials.length, 0));
}

async function loadWasm(name) {
  const response = await fetch(`./${name}.wasm`);
  if (!response.ok) throw new Error(`Native module unavailable: ${name}`);
  const module = await WebAssembly.compile(await response.arrayBuffer());
  if (WebAssembly.Module.imports(module).length) throw new Error('Unexpected native runtime imports.');
  const instance = await WebAssembly.instantiate(module, {});
  instance.exports._initialize();
  return instance.exports;
}

disc.addEventListener('change', async () => {
  const file = disc.files[0];
  if (!file) return;
  currentJob?.abort();
  const job = new AbortController();
  currentJob = job;
  clearSky();
  document.body.dataset.state = 'loading';
  status.textContent = 'Loading disc...';
  try {
    const reader = new IsoReader(file);
    await reader.open(job.signal);
    const table = await initializeDiscTable(api, reader, job.signal, decoder);
    job.signal.throwIfAborted();
    if (currentJob !== job) return;
    showSky(table.residentArchive);
    document.body.dataset.state = 'rendering';
    status.textContent = 'Transition sky';
  } catch (error) {
    if (currentJob !== job) return;
    clearSky();
    document.body.dataset.state = 'error';
    status.textContent = error.message;
    console.error(error);
  }
});

try {
  [api, decoder] = await Promise.all([loadWasm('runtime'), loadWasm('wad')]);
  if (api.runtime_init() !== 0) throw new Error('Native initialization failed.');
  disc.disabled = false;
  document.body.dataset.state = 'ready';
  status.textContent = 'No disc selected';
  renderer.setAnimationLoop(time => {
    api.runtime_step(Math.round(time * 1000));
    controls.update();
    renderer.render(scene, camera);
  });
} catch (error) {
  document.body.dataset.state = 'error';
  status.textContent = error.message;
  console.error(error);
}