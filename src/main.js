import * as THREE from 'three';
import './style.css';

const canvas = document.querySelector('#world');
const isCoarse = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || innerWidth < 760;
document.body.classList.toggle('touch', isCoarse);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isCoarse ? 1.9 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02040b);
scene.fog = new THREE.FogExp2(0x050711, 0.018);

const camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.08, 150);
const clock = new THREE.Clock();
const WORLD = 68;
const HALF = WORLD / 2;
const GRID = isCoarse ? 112 : 128;
const CELLS = GRID * GRID;

// Reality is a small evolving medium: chemistry makes form, waves keep it moving,
// and memory refuses to reset after the player leaves.
let u = new Float32Array(CELLS).fill(1);
let v = new Float32Array(CELLS);
let u2 = new Float32Array(CELLS);
let v2 = new Float32Array(CELLS);
let wake = new Float32Array(CELLS);
let wakeVelocity = new Float32Array(CELLS);
let memory = new Float32Array(CELLS);
let visits = new Float32Array(CELLS);
const pixels = new Uint8Array(CELLS * 4);
const stateTexture = new THREE.DataTexture(pixels, GRID, GRID, THREE.RGBAFormat, THREE.UnsignedByteType);
stateTexture.wrapS = stateTexture.wrapT = THREE.ClampToEdgeWrapping;
stateTexture.magFilter = THREE.LinearFilter;
stateTexture.minFilter = THREE.LinearFilter;
stateTexture.needsUpdate = true;

const terrainUniforms = {
  stateMap: { value: stateTexture },
  time: { value: 0 },
  velocity: { value: 0 },
};

const terrain = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD, WORLD, isCoarse ? 132 : 152, isCoarse ? 132 : 152).rotateX(-Math.PI / 2),
  new THREE.ShaderMaterial({
    uniforms: terrainUniforms,
    vertexShader: `
      uniform sampler2D stateMap;
      uniform float time;
      uniform float velocity;
      varying vec4 vState;
      varying float vHeight;
      varying vec3 vPos;
      void main() {
        vState = texture2D(stateMap, uv);
        float chemistry = vState.r;
        float pulse = (vState.g - .5) * 2.;
        float memory = vState.b;
        float visits = vState.a;
        vec3 p = position;
        float base = sin(p.x * .17) * .32 + sin(p.z * .145 + 1.7) * .3;
        float living = sin(time * 1.65 + p.x * .47 - p.z * .31) * chemistry * 1.45;
        float folds = pow(max(0., chemistry), 1.55) * 8.2 + pulse * 4.6 + pow(memory, 1.7) * 3.4;
        p.x += sin(p.z * .38 + time * .6 + visits * 8.) * chemistry * 1.25;
        p.z += cos(p.x * .33 - time * .48 + memory * 9.) * chemistry * 1.25;
        p.y += base + folds + living;
        vHeight = p.y;
        vPos = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec4 vState;
      varying float vHeight;
      varying vec3 vPos;
      void main() {
        float chemistry = vState.r;
        float pulse = abs((vState.g - .5) * 2.);
        float memory = vState.b;
        float visits = vState.a;
        vec3 abyss = vec3(.015, .028, .065);
        vec3 cyan = vec3(.07, .93, 1.0);
        vec3 orchid = vec3(.86, .12, .72);
        vec3 amber = vec3(1.0, .48, .12);
        float contour = .5 + .5 * sin(vHeight * 2.3 - time * .7 + memory * 13.);
        float vein = smoothstep(.67, .98, sin(vPos.x * .7 + sin(vPos.z * .43 + time) * 2.4) * .5 + .5);
        vec3 col = abyss;
        col = mix(col, cyan * (1.15 + contour * .4), chemistry);
        col = mix(col, orchid * (1.1 + pulse), visits * .82);
        col += amber * pulse * .75;
        col += cyan * vein * chemistry * .35;
        col += vec3(.025, .045, .08) * contour;
        float edge = smoothstep(31., 26., length(vPos.xz));
        gl_FragColor = vec4(col * edge, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  })
);
scene.add(terrain);

const hemi = new THREE.HemisphereLight(0x7defff, 0x160525, 1.6);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0xd4faff, 2.2);
moon.position.set(-12, 30, 8);
scene.add(moon);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(100, 32, 18),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { time: terrainUniforms.time },
    vertexShader: `varying vec3 p; void main(){p=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `
      uniform float time; varying vec3 p;
      void main(){
        vec3 d=normalize(p); float horizon=pow(1.-abs(d.y),3.);
        float aurora=pow(max(0.,sin(d.x*9.+sin(d.z*7.+time*.12)*2.)),7.)*horizon;
        vec3 c=mix(vec3(.004,.007,.025),vec3(.025,.02,.085),horizon);
        c+=aurora*vec3(.02,.16,.19);
        gl_FragColor=vec4(c,1.);
      }`,
  })
);
scene.add(sky);

function mulberry32(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const random = mulberry32(71289);

// These organisms are landmarks first and instruments second. Circling them
// changes their future response instead of playing a fixed animation.
const sentinels = [];
const stoneMat = new THREE.MeshStandardMaterial({
  color: 0x102439,
  emissive: 0x052a38,
  roughness: .38,
  metalness: .25,
  flatShading: true,
});

for (let i = 0; i < 22; i++) {
  const a = random() * Math.PI * 2;
  const radius = 8 + random() * 22;
  const x = Math.cos(a) * radius;
  const z = Math.sin(a) * radius;
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const lobes = 2 + Math.floor(random() * 3);
  for (let j = 0; j < lobes; j++) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(.75 + random() * .55, 1), stoneMat.clone());
    mesh.scale.set(.65 + random() * .5, 1.5 + random() * 2.5, .65 + random() * .5);
    mesh.position.y = 1.1 + j * 1.18;
    mesh.rotation.set(random(), random() * Math.PI, random() * .25);
    group.add(mesh);
  }
  scene.add(group);
  sentinels.push({ group, x, z, seed: random() * 10, activation: 0, winding: 0, lastAngle: null, field: 0 });
}

// A fractured rim gives the morphing floor scale and makes lateral warping readable.
const rimGeo = new THREE.CylinderGeometry(.25, .75, 1, 5, 1);
const rimMat = stoneMat.clone();
rimMat.color.set(0x0c192d);
for (let i = 0; i < 52; i++) {
  const a = i / 52 * Math.PI * 2;
  const h = 2.5 + random() * 8;
  const m = new THREE.Mesh(rimGeo, rimMat);
  m.position.set(Math.cos(a) * 32, h * .5 - .6, Math.sin(a) * 32);
  m.scale.y = h;
  m.rotation.y = -a + random() * .25;
  m.rotation.z = (random() - .5) * .32;
  scene.add(m);
}

const player = new THREE.Group();
const core = new THREE.Mesh(
  new THREE.IcosahedronGeometry(.62, 2),
  new THREE.MeshStandardMaterial({ color: 0xc8ffff, emissive: 0x37eaff, emissiveIntensity: 3.4, roughness: .18 })
);
const shell = new THREE.Mesh(
  new THREE.IcosahedronGeometry(.94, 1),
  new THREE.MeshBasicMaterial({ color: 0x70f6ff, wireframe: true, transparent: true, opacity: .6 })
);
const halo = new THREE.Mesh(
  new THREE.TorusGeometry(1.05, .045, 8, 48),
  new THREE.MeshBasicMaterial({ color: 0xf3ffff, transparent: true, opacity: .7 })
);
halo.rotation.x = Math.PI / 2;
player.add(core, shell, halo);
const playerLight = new THREE.PointLight(0x4deaff, 18, 13, 2);
player.add(playerLight);
scene.add(player);

const playerPos = new THREE.Vector3(0, 0, 0);
const playerVelocity = new THREE.Vector3();
let playerFacing = 0;
let cameraYaw = Math.PI * .18;
let cameraPitch = .7;
let cameraDistance = isCoarse ? 14.5 : 16.5;
const cameraPos = new THREE.Vector3(0, 12, 14);
const lookTarget = new THREE.Vector3();
const smoothedLookTarget = new THREE.Vector3();
let playerRenderY = 1.15;
let playerVerticalVelocity = 0;
const keys = new Set();
let movedYet = false;
let simAccumulator = 0;
let lastDeposit = new THREE.Vector3();

addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));

const stick = document.querySelector('#stick');
const nub = document.querySelector('#nub');
const joystick = new THREE.Vector2();
let stickPointer = null;
function updateStick(e) {
  const r = stick.getBoundingClientRect();
  const x = e.clientX - (r.left + r.width / 2);
  const y = e.clientY - (r.top + r.height / 2);
  const len = Math.hypot(x, y);
  const max = r.width * .35;
  const s = Math.min(1, max / Math.max(max, len));
  joystick.set(x / max * s, y / max * s);
  nub.style.transform = `translate3d(${x*s}px,${y*s}px,0)`;
}
stick.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  stickPointer = e.pointerId;
  stick.setPointerCapture(e.pointerId);
  updateStick(e);
});
stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickPointer) updateStick(e); });
function releaseStick(e) {
  if (e.pointerId !== stickPointer) return;
  stickPointer = null; joystick.set(0, 0); nub.style.transform = 'translate3d(0,0,0)';
}
stick.addEventListener('pointerup', releaseStick);
stick.addEventListener('pointercancel', releaseStick);
stick.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
stick.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

let lookPointer = null;
let fieldMovePointer = null;
const fieldMoveOrigin = new THREE.Vector2();
let lastLookX = 0;
let lastLookY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (isCoarse && e.clientX < innerWidth * .62 && e.clientY > innerHeight * .24) {
    e.preventDefault();
    fieldMovePointer = e.pointerId;
    fieldMoveOrigin.set(e.clientX, e.clientY);
    joystick.set(0, 0);
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  lookPointer = e.pointerId; lastLookX = e.clientX; lastLookY = e.clientY; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === fieldMovePointer) {
    e.preventDefault();
    const dx = e.clientX - fieldMoveOrigin.x;
    const dy = e.clientY - fieldMoveOrigin.y;
    const max = 52;
    const len = Math.hypot(dx, dy);
    const s = Math.min(1, max / Math.max(max, len));
    joystick.set(dx / max * s, dy / max * s);
    nub.style.transform = `translate3d(${dx*s}px,${dy*s}px,0)`;
    return;
  }
  if (e.pointerId !== lookPointer) return;
  const dx = e.clientX - lastLookX;
  const dy = e.clientY - lastLookY;
  cameraYaw -= dx * .006;
  cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * .0035, .46, 1.02);
  lastLookX = e.clientX; lastLookY = e.clientY;
});
const releaseLook = (e) => {
  if (e.pointerId === fieldMovePointer) {
    fieldMovePointer = null;
    joystick.set(0, 0);
    nub.style.transform = 'translate3d(0,0,0)';
  }
  if (e.pointerId === lookPointer) lookPointer = null;
};
canvas.addEventListener('pointerup', releaseLook);
canvas.addEventListener('pointercancel', releaseLook);

const MAX_PATH = 6000;
const pathPositions = new Float32Array(MAX_PATH * 3);
const pathGeometry = new THREE.BufferGeometry();
pathGeometry.setAttribute('position', new THREE.BufferAttribute(pathPositions, 3));
pathGeometry.setDrawRange(0, 0);
const pathLine = new THREE.Line(pathGeometry, new THREE.LineBasicMaterial({ color: 0x74f7ff, transparent: true, opacity: .48, blending: THREE.AdditiveBlending }));
scene.add(pathLine);
const trail = [];
let trailCount = 0;
let lastTrailPoint = new THREE.Vector3(0, 0, 0);
let anomalyCooldown = 0;
const anomalies = [];

function gridIndex(x, z) {
  const gx = THREE.MathUtils.clamp(Math.floor((x / WORLD + .5) * GRID), 0, GRID - 1);
  const gz = THREE.MathUtils.clamp(Math.floor((z / WORLD + .5) * GRID), 0, GRID - 1);
  return gz * GRID + gx;
}

function sampleField(x, z, array = v) {
  const fx = THREE.MathUtils.clamp((x / WORLD + .5) * (GRID - 1), 0, GRID - 1);
  const fz = THREE.MathUtils.clamp((z / WORLD + .5) * (GRID - 1), 0, GRID - 1);
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(GRID - 1, x0 + 1), z1 = Math.min(GRID - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const top = THREE.MathUtils.lerp(array[z0 * GRID + x0], array[z0 * GRID + x1], tx);
  const bottom = THREE.MathUtils.lerp(array[z1 * GRID + x0], array[z1 * GRID + x1], tx);
  return THREE.MathUtils.lerp(top, bottom, tz);
}

function terrainHeight(x, z) {
  const base = Math.sin(x * .17) * .32 + Math.sin(z * .145 + 1.7) * .3;
  const chemistry = sampleField(x, z, v);
  const pulse = sampleField(x, z, wake);
  const remembered = sampleField(x, z, memory);
  return base + chemistry * 8.2 + pulse * 4.6 + Math.pow(remembered, 1.7) * 3.4;
}

function injectPoint(x, z, power, radius = 2) {
  const gx = Math.floor((x / WORLD + .5) * GRID);
  const gz = Math.floor((z / WORLD + .5) * GRID);
  const rr = Math.max(2, Math.floor(radius / WORLD * GRID));
  for (let dz = -rr; dz <= rr; dz++) {
    for (let dx = -rr; dx <= rr; dx++) {
      const xx = gx + dx, zz = gz + dz;
      if (xx < 1 || zz < 1 || xx >= GRID - 1 || zz >= GRID - 1) continue;
      const d = Math.hypot(dx, dz) / rr;
      if (d > 1) continue;
      const falloff = (1 - d) * power;
      const i = zz * GRID + xx;
      v[i] = Math.max(v[i], .42 + falloff * .5);
      u[i] = Math.min(u[i], .5 - falloff * .12);
      memory[i] = Math.min(1, memory[i] + falloff * .24);
      visits[i] = Math.min(1, visits[i] + falloff * .13);
      wakeVelocity[i] += falloff * .38;
    }
  }
}

function injectSegment(a, b, power, radius) {
  const dist = a.distanceTo(b);
  const steps = Math.max(1, Math.ceil(dist / .38));
  for (let i = 0; i <= steps; i++) injectPoint(THREE.MathUtils.lerp(a.x, b.x, i / steps), THREE.MathUtils.lerp(a.z, b.z, i / steps), power, radius);
}

function simulate() {
  const feed = .027;
  const kill = .057;
  for (let z = 1; z < GRID - 1; z++) {
    for (let x = 1; x < GRID - 1; x++) {
      const i = z * GRID + x;
      const l = i - 1, r = i + 1, t = i - GRID, b = i + GRID;
      const lapU = (u[l] + u[r] + u[t] + u[b]) * .2 + (u[t-1] + u[t+1] + u[b-1] + u[b+1]) * .05 - u[i];
      const lapV = (v[l] + v[r] + v[t] + v[b]) * .2 + (v[t-1] + v[t+1] + v[b-1] + v[b+1]) * .05 - v[i];
      const reaction = u[i] * v[i] * v[i];
      u2[i] = THREE.MathUtils.clamp(u[i] + .92 * (.19 * lapU - reaction + feed * (1 - u[i])), 0, 1);
      v2[i] = THREE.MathUtils.clamp(v[i] + .92 * (.095 * lapV + reaction - (feed + kill) * v[i]), 0, 1);
      const lapW = wake[l] + wake[r] + wake[t] + wake[b] - wake[i] * 4;
      wakeVelocity[i] = (wakeVelocity[i] + lapW * .105 - wake[i] * .014) * .982;
      wake[i] = THREE.MathUtils.clamp(wake[i] + wakeVelocity[i], -.72, .72);
      const spread = Math.max(memory[i], (memory[l] + memory[r] + memory[t] + memory[b]) * .249 * .996);
      memory[i] = Math.min(1, spread * .99998);
      visits[i] *= .999995;
    }
  }
  [u, u2] = [u2, u];
  [v, v2] = [v2, v];
  for (let i = 0, p = 0; i < CELLS; i++, p += 4) {
    pixels[p] = Math.min(255, v[i] * 390);
    pixels[p + 1] = Math.floor((wake[i] * .5 + .5) * 255);
    pixels[p + 2] = Math.floor(memory[i] * 255);
    pixels[p + 3] = Math.floor(visits[i] * 255);
  }
  stateTexture.needsUpdate = true;
}

function addTrailPoint() {
  const groundY = terrainHeight(playerPos.x, playerPos.z) + .18;
  if (trailCount < MAX_PATH) {
    const p = trailCount * 3;
    pathPositions[p] = playerPos.x; pathPositions[p + 1] = groundY; pathPositions[p + 2] = playerPos.z;
    trailCount++;
    pathGeometry.setDrawRange(0, trailCount);
    pathGeometry.attributes.position.needsUpdate = true;
  }
  trail.push({ x: playerPos.x, z: playerPos.z, t: terrainUniforms.time.value });
  if (trail.length > MAX_PATH) trail.shift();

  if (anomalyCooldown <= 0 && trail.length > 42) {
    let match = -1;
    let best = 1.15;
    for (let i = Math.max(0, trail.length - 900); i < trail.length - 34; i += 2) {
      const d = Math.hypot(trail[i].x - playerPos.x, trail[i].z - playerPos.z);
      if (d < best) { best = d; match = i; }
    }
    if (match >= 0) {
      const section = trail.slice(match);
      let cx = 0, cz = 0;
      for (const p of section) { cx += p.x; cz += p.z; }
      cx /= section.length; cz /= section.length;
      let extent = 0;
      for (const p of section) extent = Math.max(extent, Math.hypot(p.x - cx, p.z - cz));
      const loopish = section.length > 65 && extent > 2.2;
      spawnAnomaly(loopish ? cx : playerPos.x, loopish ? cz : playerPos.z, THREE.MathUtils.clamp(extent * .72, 2.2, 6.7), loopish ? 'membrane' : 'seam');
      anomalyCooldown = 2.6;
    }
  }
  lastTrailPoint.copy(playerPos);
}

function spawnAnomaly(x, z, radius, kind = 'seam') {
  if (anomalies.length >= 14) {
    const old = anomalies.shift();
    scene.remove(old.group);
    old.group.traverse(o => { o.geometry?.dispose?.(); if (o.material && o.material !== stoneMat) o.material.dispose?.(); });
  }
  const group = new THREE.Group();
  group.position.set(x, terrainHeight(x, z) + .2, z);
  group.scale.setScalar(.01);
  const color = kind === 'membrane' ? 0x74ffff : 0xff4fd8;

  const membraneUniforms = { time: terrainUniforms.time, birth: { value: terrainUniforms.time.value }, color: { value: new THREE.Color(color) } };
  const membrane = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 56, 0, Math.PI * 2),
    new THREE.ShaderMaterial({
      uniforms: membraneUniforms,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float time; uniform float birth; varying float edge; varying float ripple;
        void main(){
          vec3 p=position; float r=length(p.xy); edge=r/max(0.001,length(position.xy)+.001);
          float age=max(0.,time-birth);
          ripple=sin(r*2.4-time*2.1)+sin(atan(p.y,p.x)*3.+time*.7)*.45;
          p.z += ripple*(.35+.25*sin(age)) + sin(r*.8-time)*.3;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
        }`,
      fragmentShader: `uniform vec3 color; varying float ripple; void main(){float a=.16+.13*(ripple*.5+.5); gl_FragColor=vec4(color*(1.1+abs(ripple)*.35),a);}`,
    })
  );
  membrane.rotation.x = -Math.PI / 2;
  group.add(membrane);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * .7, kind === 'membrane' ? .18 : .28, 10, 72),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .72, blending: THREE.AdditiveBlending })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const arms = kind === 'membrane' ? 5 : 3;
  for (let i = 0; i < arms; i++) {
    const a = i / arms * Math.PI * 2 + random();
    const points = [];
    for (let j = 0; j < 5; j++) {
      const f = j / 4;
      points.push(new THREE.Vector3(Math.cos(a + f * 1.3) * radius * f, Math.sin(f * Math.PI) * radius * .55, Math.sin(a + f * 1.3) * radius * f));
    }
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 28, .055 + radius * .012, 5, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .66, blending: THREE.AdditiveBlending })
    );
    group.add(tube);
  }
  scene.add(group);
  anomalies.push({ group, x, z, radius, kind, born: terrainUniforms.time.value, spin: (random() - .5) * .35 });
  for (let a = 0; a < Math.PI * 2; a += .18) injectPoint(x + Math.cos(a) * radius, z + Math.sin(a) * radius, .9, 1.2);
  injectPoint(x, z, 1.8, radius * .65);
  playStrike(kind === 'membrane' ? 190 : 285);
}

function updateSentinels(time, dt) {
  for (const s of sentinels) {
    s.field = sampleField(s.x, s.z) + sampleField(s.x, s.z, memory) * .8;
    const dist = Math.hypot(playerPos.x - s.x, playerPos.z - s.z);
    const targetScale = 1 + s.field * 1.8 + s.activation * .5;
    s.group.scale.y += (targetScale - s.group.scale.y) * Math.min(1, dt * 2.2);
    s.group.scale.x = s.group.scale.z = 1 + s.field * .3;
    s.group.rotation.y += dt * (.08 + s.field * .65 + s.activation * .12);
    s.group.rotation.z = Math.sin(time * .7 + s.seed) * (.035 + s.field * .18);
    s.group.position.y = terrainHeight(s.x, s.z);
    s.group.children.forEach((m, j) => {
      m.rotation.x += dt * (.05 + s.field * .25) * (j % 2 ? -1 : 1);
      m.material.emissiveIntensity = .8 + s.field * 4 + s.activation;
      m.material.emissive.setHSL(.52 + s.activation * .04, .75, .08 + s.field * .18);
    });
    if (dist < 6.4) {
      const angle = Math.atan2(playerPos.z - s.z, playerPos.x - s.x);
      if (s.lastAngle !== null) {
        let delta = angle - s.lastAngle;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        s.winding += delta * THREE.MathUtils.clamp((6.4 - dist) / 3, .15, 1);
      }
      s.lastAngle = angle;
      if (Math.abs(s.winding) > Math.PI * 1.82) {
        s.activation = Math.min(4, s.activation + 1);
        s.winding = 0;
        spawnAnomaly(s.x, s.z, 2.4 + s.activation * .65, 'membrane');
      }
    } else {
      s.lastAngle = null;
      s.winding *= Math.pow(.985, dt * 60);
    }
  }
}

function updateAnomalies(time, dt) {
  for (const a of anomalies) {
    const age = time - a.born;
    const grow = Math.min(1, age / 1.35);
    const pulse = 1 + Math.sin(time * 1.4 + a.radius) * .08;
    a.group.scale.setScalar((1 - Math.pow(1 - grow, 3)) * pulse);
    a.group.rotation.y += a.spin * dt;
    const proximity = THREE.MathUtils.clamp(1 - Math.hypot(playerPos.x - a.x, playerPos.z - a.z) / (a.radius * 2.2), 0, 1);
    a.group.position.y = terrainHeight(a.x, a.z) + .22 + Math.sin(time + a.radius) * .18;
    if (proximity > .1 && Math.random() < dt * proximity * 3) injectPoint(a.x, a.z, .35 + proximity * .5, a.radius * .35);
  }
}

let audio = null;
let soundOn = false;
const soundButton = document.querySelector('#sound');
function createAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 500; filter.Q.value = 6; filter.connect(master);
  const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 80; osc.connect(filter); osc.start();
  const overtone = ctx.createOscillator(); overtone.type = 'triangle'; overtone.frequency.value = 121; const overGain = ctx.createGain(); overGain.gain.value = .2; overtone.connect(overGain).connect(filter); overtone.start();
  return { ctx, master, filter, osc, overtone };
}
soundButton.addEventListener('click', async () => {
  audio ??= createAudio();
  await audio.ctx.resume();
  soundOn = !soundOn;
  soundButton.textContent = soundOn ? 'sound on' : 'sound off';
});
function updateAudio(speed, field) {
  if (!audio) return;
  const t = audio.ctx.currentTime;
  audio.master.gain.setTargetAtTime(soundOn ? .012 + speed * .002 : 0, t, .08);
  audio.osc.frequency.setTargetAtTime(58 + speed * 8 + field * 105, t, .08);
  audio.overtone.frequency.setTargetAtTime(91 + speed * 11 + field * 173, t, .12);
  audio.filter.frequency.setTargetAtTime(260 + speed * 72 + field * 1200, t, .1);
}
function playStrike(frequency) {
  if (!audio || !soundOn) return;
  const o = audio.ctx.createOscillator();
  const g = audio.ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(frequency, audio.ctx.currentTime); o.frequency.exponentialRampToValueAtTime(frequency * .48, audio.ctx.currentTime + 1.2);
  g.gain.setValueAtTime(.08, audio.ctx.currentTime); g.gain.exponentialRampToValueAtTime(.0001, audio.ctx.currentTime + 1.6);
  o.connect(g).connect(audio.master); o.start(); o.stop(audio.ctx.currentTime + 1.7);
}

function updatePlayer(dt) {
  const input = new THREE.Vector2(
    (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joystick.x,
    (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) + joystick.y
  );
  if (input.length() > 1) input.normalize();
  const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
  const right = new THREE.Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
  const desired = forward.multiplyScalar(-input.y).add(right.multiplyScalar(input.x));
  const hasInput = desired.lengthSq() > .015;
  const surge = keys.has('ShiftLeft') || keys.has('ShiftRight') || joystick.length() > .94;
  const maxSpeed = surge ? 12.8 : 8.2;
  if (hasInput) {
    desired.normalize().multiplyScalar(maxSpeed);
    const response = 1 - Math.exp(-dt * (surge ? 4.6 : 6.7));
    playerVelocity.lerp(desired, response);
    if (!movedYet) { movedYet = true; document.body.classList.add('moving'); }
  } else {
    playerVelocity.multiplyScalar(Math.exp(-dt * 5.2));
  }
  playerPos.addScaledVector(playerVelocity, dt);
  const radial = Math.hypot(playerPos.x, playerPos.z);
  if (radial > 30.7) {
    const scale = 30.7 / radial;
    playerPos.x *= scale; playerPos.z *= scale;
    const normal = new THREE.Vector3(playerPos.x, 0, playerPos.z).normalize();
    playerVelocity.addScaledVector(normal, -Math.max(0, playerVelocity.dot(normal)) * 1.7);
  }
  const speed = playerVelocity.length();
  if (speed > .25) {
    playerFacing = Math.atan2(playerVelocity.x, playerVelocity.z);
    injectSegment(lastDeposit, playerPos, .45 + speed / 18, 1.25 + speed * .09);
    lastDeposit.copy(playerPos);
    if (playerPos.distanceTo(lastTrailPoint) > .48) addTrailPoint();
  }
  const targetY = terrainHeight(playerPos.x, playerPos.z) + 1.15;
  playerVerticalVelocity += (targetY - playerRenderY) * 58 * dt;
  playerVerticalVelocity *= Math.exp(-dt * 13.5);
  playerRenderY += playerVerticalVelocity * dt;
  player.position.set(playerPos.x, playerRenderY, playerPos.z);
  player.rotation.y = playerFacing;
  core.rotation.x += dt * (1.2 + speed * .12);
  core.rotation.z += dt * .75;
  shell.rotation.y -= dt * (1.3 + speed * .18);
  halo.rotation.z += dt * (1 + speed * .1);
  const bob = Math.sin(terrainUniforms.time.value * 4.5) * (.06 + speed * .009);
  core.position.y = shell.position.y = halo.position.y = bob;
  player.scale.setScalar(1 + speed * .008);
  terrainUniforms.velocity.value = speed;
  updateAudio(speed, sampleField(playerPos.x, playerPos.z) + sampleField(playerPos.x, playerPos.z, visits));
  return speed;
}

function updateCamera(dt, speed) {
  const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
  const horizontal = Math.cos(cameraPitch) * cameraDistance;
  const vertical = Math.sin(cameraPitch) * cameraDistance;
  const desired = player.position.clone().add(new THREE.Vector3(-forward.x * horizontal, vertical, -forward.z * horizontal));
  desired.addScaledVector(playerVelocity, -.14);
  cameraPos.lerp(desired, 1 - Math.exp(-dt * 3.4));
  camera.position.copy(cameraPos);
  lookTarget.copy(player.position).addScaledVector(playerVelocity, .48).add(new THREE.Vector3(0, .4, 0));
  smoothedLookTarget.lerp(lookTarget, 1 - Math.exp(-dt * 6.2));
  camera.lookAt(smoothedLookTarget);
  camera.fov += ((54 + speed * .65) - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(.033, clock.getDelta());
  const time = clock.elapsedTime;
  terrainUniforms.time.value = time;
  anomalyCooldown -= dt;
  const speed = updatePlayer(dt);
  simAccumulator += dt;
  const tick = 1 / 30;
  while (simAccumulator >= tick) {
    simulate();
    simAccumulator -= tick;
  }
  updateSentinels(time, dt);
  updateAnomalies(time, dt);
  updateCamera(dt, speed);
  renderer.render(scene, camera);
}

lastDeposit.copy(playerPos);
injectPoint(0, 0, .55, 1.5);
for (let i = 0; i < 18; i++) simulate();
updateCamera(1, 0);
animate();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, isCoarse ? 1.9 : 2));
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
