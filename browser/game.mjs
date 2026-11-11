import * as THREE from 'three';
import { OrbitControls } from './node_modules/three/examples/jsm/controls/OrbitControls.js';
import { IsoReader } from './iso-reader.mjs';
import { initializeDiscTable } from './disc-loader.mjs';
import { readSkyGeometry, readSkyTextures } from './sky-geometry.mjs';
import { loadPlanetCore, VELDIN_ARCHIVE, initializePlanetCollision } from './level-loader.mjs';
import { readTerrainGeometry, readTerrainTextures, readMobyTextures } from './terrain-geometry.mjs';
import { readMobyGeometry } from './moby-geometry.mjs';
import { HeroSwingState, readHeroAnimationRig, sampleHeroAnimationFrame } from './moby-animation.mjs';

const canvas = document.querySelector('canvas');
const status = document.querySelector('#status');
const disc = document.querySelector('#disc');
const scene = new THREE.Scene();
const skyScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.001, 1000);
camera.up.set(0, 0, 1);
camera.position.set(0, -0.01, 0);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x070a0c);
renderer.autoClear = false;
const controls = new OrbitControls(camera, canvas);
controls.enablePan = false;
controls.enableZoom = false;
controls.enableDamping = true;
controls.rotateSpeed = 0.45;
const skyGroup = new THREE.Group();
const terrainGroup = new THREE.Group();
const characterGroup = new THREE.Group();
skyScene.add(skyGroup);
scene.add(terrainGroup, characterGroup);
let api;
let decoder;
let planetDecoder;
let collision;
let currentJob;
let textures = [];
let terrainRadius = 0;
let heroActive = false;
let previousTime;
let tickRemainder = 0;
let jumpQueued = false;
let swingRequested = false;
let heroAnimation;
const keys = new Set();
const touchKeys = new Map();
const spawn = new THREE.Vector3();
const movement = new THREE.Vector3();
const forward = new THREE.Vector3();
const followDelta = new THREE.Vector3();
const controlKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft',
  'ArrowDown', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyR', 'KeyF',
  'KeyC', 'ControlLeft', 'ControlRight']);

function releaseInput() {
  keys.clear();
  touchKeys.clear();
  heroAnimation?.swing.reset();
  collision?.runtime_hero_control_slam(0);
  collision?.runtime_hero_control_crouch(0);
  collision?.runtime_hero_control_jump_release();
  jumpQueued = false;
  swingRequested = false;
  tickRemainder = 0;
  previousTime = undefined;
}

addEventListener('keydown', event => {
  if (!heroActive || !controlKeys.has(event.code) || event.target !== canvas &&
      event.target instanceof Element && event.target.closest('input, button, select, textarea')) return;
  event.preventDefault();
  if (event.code === 'Space' && !event.repeat) jumpQueued = true;
  if (event.code === 'KeyF' && !event.repeat) requestSwing();
  if (event.code === 'KeyR' && !event.repeat) resetHero();
  keys.add(event.code);
});
addEventListener('keyup', event => {
  keys.delete(event.code);
  if (event.code === 'Space' && !pressed('Space')) collision?.runtime_hero_control_jump_release();
  if (heroActive && controlKeys.has(event.code)) event.preventDefault();
});
addEventListener('blur', releaseInput);
document.addEventListener('visibilitychange', releaseInput);
canvas.tabIndex = 0;
canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));
for (const button of document.querySelectorAll('[data-control]')) {
  button.addEventListener('pointerdown', event => {
    if (!heroActive) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    button.setPointerCapture(event.pointerId);
    const code = button.dataset.control;
    touchKeys.set(event.pointerId, code);
    if (code === 'Space') jumpQueued = true;
    if (code === 'KeyF') requestSwing();
    if (code === 'KeyR') resetHero();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(name, event => {
      const code = touchKeys.get(event.pointerId);
      touchKeys.delete(event.pointerId);
      if (code === 'Space' && !pressed('Space')) collision?.runtime_hero_control_jump_release();
    });
  }
}

function pressed(code) { return keys.has(code) || [...touchKeys.values()].includes(code); }

function requestSwing() {
  swingRequested = true;
}

function resetHero() {
  releaseInput();
  if (heroAnimation) {
    heroAnimation.mixer.stopAllAction();
    heroAnimation.sequence = undefined;
  }
  const result = collision.runtime_hero_control_reset(spawn.x, spawn.y, spawn.z);
  if (result !== 0) throw new Error(`Native hero reset failed (${result}).`);
  syncHero();
}

function syncHero() {
  movement.set(...[0, 1, 2].map(axis => collision.runtime_hero_collision_position(axis)));
  followDelta.copy(movement).sub(characterGroup.position);
  characterGroup.position.copy(movement);
  characterGroup.rotation.z = collision.runtime_hero_locomotion_yaw();
  camera.position.add(followDelta);
  controls.target.add(followDelta);
}

export function readHeroState() {
  return { active: heroActive, position: characterGroup.position.toArray(),
    yaw: characterGroup.rotation.z, grounded: Boolean(collision?.runtime_hero_control_grounded()),
    crouched: Boolean(collision?.runtime_hero_control_crouched()),
    jumps: collision?.runtime_hero_control_jump_count() ?? 0,
    verticalSpeed: collision?.runtime_hero_locomotion_velocity(2) ?? 0,
    animation: heroAnimation ? { sequence: heroAnimation.sequence,
      time: heroAnimation.actions.get(heroAnimation.sequence)?.time,
      sourceFrame: heroAnimation.frames.has(heroAnimation.sequence) ? sampleHeroAnimationFrame(
        heroAnimation.frames.get(heroAnimation.sequence), heroAnimation.actions.get(heroAnimation.sequence).time).sourceFrame : null,
      swing: heroAnimation.swing.sequence ?? null, queued: heroAnimation.swing.queued,
      pose: heroAnimation.bones[8].quaternion.toArray() } : null,
    camera: camera.position.toArray(), target: controls.target.toArray() };
}

function updateHero(time) {
  if (previousTime === undefined) previousTime = time;
  const elapsed = Math.min(Math.max((time - previousTime) / 1000, 0), 0.1);
  previousTime = time;
  if (!heroActive || document.hidden) { tickRemainder = 0; return; }
  tickRemainder += elapsed;
  camera.getWorldDirection(forward);
  forward.z = 0;
  if (forward.lengthSq() > 0.0001) forward.normalize();
  else forward.set(-1, 0, 0);
  const horizontal = Number(pressed('KeyD') || pressed('ArrowRight')) -
    Number(pressed('KeyA') || pressed('ArrowLeft'));
  const vertical = Number(pressed('KeyW') || pressed('ArrowUp')) -
    Number(pressed('KeyS') || pressed('ArrowDown'));
  const inputX = forward.x * vertical + forward.y * horizontal;
  const inputY = forward.y * vertical - forward.x * horizontal;
  const inputLength = Math.max(Math.hypot(inputX, inputY), 1);
  while (tickRemainder >= 1 / 60) {
    const jump = jumpQueued || pressed('Space');
    const crouch = pressed('KeyC') || pressed('ControlLeft') || pressed('ControlRight');
    const stance = collision.runtime_hero_control_crouch(Number(crouch && heroAnimation?.swing.sequence !== 43));
    if (stance !== 0) throw new Error(`Native crouch input failed (${stance}).`);
    if (jump && heroAnimation?.swing.sequence !== 43) heroAnimation?.swing.reset();
    heroAnimation?.swing.update(Boolean(collision.runtime_hero_control_grounded()));
    const movementScale = heroAnimation?.swing.sequence === undefined ? 1 : 0;
    const result = collision.runtime_hero_control_step(inputX / inputLength * movementScale, inputY / inputLength * movementScale,
      Number(jump), Number(keys.has('ShiftLeft') || keys.has('ShiftRight')));
    jumpQueued = false;
    if (result !== 0) throw new Error(`Native hero step failed (${result}).`);
    const grounded = Boolean(collision.runtime_hero_control_grounded());
    heroAnimation?.swing.update(grounded);
    if (swingRequested) {
      if (heroAnimation?.swing.request(grounded, Boolean(collision.runtime_hero_control_crouched())) && !grounded) {
        const slam = collision.runtime_hero_control_slam(1);
        if (slam !== 0) throw new Error(`Native hero slam failed (${slam}).`);
      }
      swingRequested = false;
    }
    tickRemainder -= 1 / 60;
  }
  syncHero();
  updateHeroAnimation(elapsed);
  if (characterGroup.position.z < spawn.z - 40) resetHero();
}

function updateHeroAnimation(elapsed) {
  if (!heroAnimation) return;
  const speed = collision.runtime_hero_locomotion_speed() * 60;
  const grounded = collision.runtime_hero_control_grounded();
  const crouched = collision.runtime_hero_control_crouched();
  heroAnimation.swing.update(Boolean(grounded));
  let sequence;
  if (heroAnimation.swing.sequence !== undefined) sequence = heroAnimation.swing.sequence;
  else if (crouched) sequence = 13;
  else if (grounded) {
    if (speed > 0.1) sequence = 4;
    else sequence = 0;
  } else {
    if (collision.runtime_hero_control_jump_count() === 2) sequence = 22;
    else sequence = 7;
  }
  const { mixer, actions } = heroAnimation;
  const action = actions.get(sequence);
  if (heroAnimation.sequence !== sequence) {
    actions.get(heroAnimation.sequence)?.fadeOut(0.12);
    action.reset().fadeIn(0.12).play();
    heroAnimation.sequence = sequence;
  }
  action.timeScale = sequence === 4 ? Math.max(0.35, speed / 5.7) : 1;
  if (sequence === 7 || sequence === 22) {
    const pose = sampleHeroAnimationFrame(heroAnimation.frames.get(sequence), action.time);
    const rate = collision.runtime_hero_jump_animation_speed(pose.sourceFrame, pose.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid native jump animation speed.');
    action.timeScale = rate;
  }
  if (sequence === 43) {
    const pose = sampleHeroAnimationFrame(heroAnimation.frames.get(sequence), action.time);
    const rate = collision.runtime_hero_slam_animation_speed(pose.sourceFrame, pose.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid native slam animation speed.');
    action.timeScale = rate;
  }
  mixer.update(elapsed);
}

function createHeroAnimation(rig) {
  const bones = Array.from({ length: rig.jointCount }, (_, joint) => {
    const bone = new THREE.Bone();
    bone.name = `hero_joint_${joint}`;
    bone.position.fromArray(rig.bindPositions, joint * 3);
    return bone;
  });
  for (let joint = 1; joint < bones.length; joint++) bones[rig.parents[joint]].add(bones[joint]);
  bones[0].updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  skeleton.calculateInverses();
  const mixer = new THREE.AnimationMixer(characterGroup);
  const actions = new Map();
  for (const [id, frames] of rig.clips) {
    const tracks = [], times = [0];
    for (let frame = 1; frame < frames.length; frame++) times.push(times[frame - 1] + 1 / (60 * frames[frame - 1].rate));
    if (id === 0 || id === 4 || id === 13) times.push(times.at(-1) + 1 / (60 * frames.at(-1).rate));
    for (let joint = 0; joint < bones.length; joint++) {
      for (const [property, field, width, Track] of [
        ['position', 'positions', 3, THREE.VectorKeyframeTrack],
        ['quaternion', 'rotations', 4, THREE.QuaternionKeyframeTrack],
        ['scale', 'scales', 3, THREE.VectorKeyframeTrack],
      ]) {
        const values = [];
        for (let frame = 0; frame < times.length; frame++) {
          values.push(...frames[frame % frames.length][field].subarray(joint * width, (joint + 1) * width));
        }
        tracks.push(new Track(`${bones[joint].name}.${property}`, times, values));
      }
    }
    const clip = new THREE.AnimationClip(`hero_${id}`, -1, tracks);
    actions.set(id, { clip });
  }
  const swing = new HeroSwingState();
  mixer.addEventListener('finished', event => {
    const sequence = Number(event.action.getClip().name.slice(5));
    if (sequence >= 23 && sequence <= 26 || sequence === 43) {
      swing.finish(sequence, Boolean(collision.runtime_hero_control_grounded()));
    }
  });
  return { bones, skeleton, mixer, actions, swing, frames: rig.clips, sequence: undefined };
}

function fitTerrainCamera() {
  if (!terrainRadius) return;
  const halfAngle = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(camera.aspect, 1));
  const direction = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(direction, terrainRadius * 1.05 / Math.sin(halfAngle));
}

function resize() {
  const width = innerWidth;
  const height = innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  fitTerrainCamera();
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

function clearTerrain() {
  heroActive = false;
  if (heroAnimation) {
    heroAnimation.mixer.stopAllAction();
    heroAnimation.mixer.uncacheRoot(characterGroup);
    heroAnimation.skeleton.dispose();
    heroAnimation = undefined;
  }
  releaseInput();
  terrainRadius = 0;
  collision?.runtime_collision_reset();
  delete document.body.dataset.collisionCells;
  delete document.body.dataset.collisionFaces;
  delete document.body.dataset.characterTriangles;
  for (const mesh of [...terrainGroup.children, ...characterGroup.children]) {
    mesh.geometry.dispose();
    mesh.material.map?.dispose();
    mesh.material.dispose();
    mesh.removeFromParent();
  }
  characterGroup.position.set(0, 0, 0);
  characterGroup.rotation.set(0, 0, 0);
}

function showRatchet(planet) {
  const model = readMobyGeometry(planet);
  heroAnimation = createHeroAnimation(readHeroAnimationRig(planet));
  const images = readMobyTextures(planet);
  for (const batch of model.batches) {
    const image = images[model.textures[batch.material]];
    if (!image) throw new Error('Ratchet material references an absent image.');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(batch.positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(batch.uvs, 2));
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(batch.joints, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(batch.weights, 4));
    const texture = new THREE.DataTexture(image.rgba, image.width, image.height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, alphaTest: 0.1 });
    const mesh = new THREE.SkinnedMesh(geometry, material);
    if (characterGroup.children.length === 0) mesh.add(heroAnimation.bones[0]);
    mesh.bind(heroAnimation.skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false;
    characterGroup.add(mesh);
  }
  for (const [id, { clip }] of heroAnimation.actions) {
    const action = heroAnimation.mixer.clipAction(clip);
    if (id !== 0 && id !== 4 && id !== 13) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    heroAnimation.actions.set(id, action);
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(145, 140, 100), new THREE.Vector3(0, 0, -1));
  const ground = ray.intersectObjects(terrainGroup.children, false)[0];
  if (!ground) throw new Error('Ratchet visual placement has no terrain surface.');
  characterGroup.position.copy(ground.point);
  spawn.copy(ground.point);
  controls.target.copy(ground.point).add(new THREE.Vector3(0, 0, 0.8));
  terrainRadius = 1.15;
  camera.position.copy(controls.target).add(new THREE.Vector3(3, -1, 0.8));
  controls.minDistance = 1.8;
  controls.maxDistance = 25;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.enablePan = false;
  fitTerrainCamera();
  controls.update();
  resetHero();
  heroActive = true;
  document.body.dataset.characterTriangles = String(model.triangles);
}

function showTerrain(planet) {
  const terrain = readTerrainGeometry(planet);
  clearTerrain();
  clearSky();
  const images = readTerrainTextures(planet);
  for (const batch of terrain.batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(batch.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(batch.colours, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(batch.uvs, 2));
    const image = images[batch.material];
    if (!image) throw new Error('Terrain material references an absent image.');
    const texture = new THREE.DataTexture(image.rgba, image.width, image.height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.1 });
    terrainGroup.add(new THREE.Mesh(geometry, material));
  }
  const bounds = new THREE.Box3().setFromObject(terrainGroup);
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
  terrainRadius = radius;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.minDistance = 0.5;
  controls.maxDistance = radius * 5;
  controls.target.copy(centre);
  camera.position.copy(centre).add(new THREE.Vector3(0.7, -1.5, 1).normalize().multiplyScalar(radius * 1.8));
  camera.near = 0.05;
  camera.far = radius * 20;
  camera.updateProjectionMatrix();
  fitTerrainCamera();
  controls.update();
  const header = new DataView(planet.header.buffer, planet.header.byteOffset, planet.header.byteLength);
  const skyOffset = header.getUint32(16, true);
  const skyEnd = header.getUint32(20, true);
  const skyBytes = skyEnd - skyOffset;
  if (skyBytes <= 0 || skyBytes > api.runtime_sky_capacity() || skyEnd > planet.core.length) {
    throw new Error('Planet sky exceeds native staging capacity.');
  }
  api.runtime_sky_reset();
  new Uint8Array(api.memory.buffer, api.runtime_sky_stage_address(), skyBytes).set(planet.core.subarray(skyOffset, skyEnd));
  if (api.runtime_sky_load(skyBytes, 0) !== 1) throw new Error('Native planet sky relocation failed.');
  showSky({ bytes: skyBytes, header: { skyOffset: 0 } });
  skyGroup.scale.setScalar(radius * 4);
  document.body.dataset.triangles = String(terrain.triangles);
  document.body.dataset.fragments = String(terrain.fragments);
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
  clearTerrain();
  skyGroup.scale.setScalar(1);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.target.set(0, 0, 0);
  camera.position.set(0, -0.01, 0);
  camera.near = 0.001;
  camera.far = 1000;
  camera.updateProjectionMatrix();
  renderer.setClearColor(0x070a0c);
  document.body.dataset.state = 'loading';
  status.textContent = 'Loading disc...';
  try {
    const reader = new IsoReader(file);
    await reader.open(job.signal);
    const table = await initializeDiscTable(api, reader, job.signal, decoder);
    job.signal.throwIfAborted();
    if (currentJob !== job) return;
    showSky(table.residentArchive);
    status.textContent = 'Loading Veldin...';
    await new Promise(resolve => setTimeout(resolve, 0));
    const planet = await loadPlanetCore(reader, planetDecoder, VELDIN_ARCHIVE, job.signal);
    job.signal.throwIfAborted();
    if (currentJob !== job) return;
    showTerrain(planet);
    const world = initializePlanetCollision(planet, collision);
    showRatchet(planet);
    document.body.dataset.collisionCells = String(world.cells);
    document.body.dataset.collisionFaces = String(world.faces);
    document.body.dataset.state = 'rendering';
    status.textContent = 'Veldin / Ratchet';
    canvas.focus({ preventScroll: true });
  } catch (error) {
    if (currentJob !== job) return;
    clearSky();
    clearTerrain();
    document.body.dataset.state = 'error';
    status.textContent = error.message;
    console.error(error);
  }
});

try {
  [api, decoder, planetDecoder, collision] = await Promise.all([
    loadWasm('runtime'), loadWasm('wad'), loadWasm('planet-wad'), loadWasm('hero-locomotion'),
  ]);
  if (api.runtime_init() !== 0) throw new Error('Native initialization failed.');
  disc.disabled = false;
  document.body.dataset.state = 'ready';
  status.textContent = 'No disc selected';
  renderer.setAnimationLoop(time => {
    api.runtime_step(Math.round(time * 1000));
    try {
      updateHero(time);
    } catch (error) {
      clearTerrain();
      document.body.dataset.state = 'error';
      status.textContent = error.message;
      console.error(error);
    }
    controls.update();
    skyGroup.position.copy(camera.position);
    renderer.clear();
    renderer.render(skyScene, camera);
    renderer.clearDepth();
    renderer.render(scene, camera);
  });
} catch (error) {
  document.body.dataset.state = 'error';
  status.textContent = error.message;
  console.error(error);
}