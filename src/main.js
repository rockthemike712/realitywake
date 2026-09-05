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
const targetPixels = new Uint8Array(CELLS * 4);
const flowingPixels = new Float32Array(CELLS * 4);
const stateTexture = new THREE.DataTexture(pixels, GRID, GRID, THREE.RGBAFormat, THREE.UnsignedByteType);
stateTexture.wrapS = stateTexture.wrapT = THREE.ClampToEdgeWrapping;
stateTexture.magFilter = THREE.LinearFilter;
stateTexture.minFilter = THREE.LinearFilter;
stateTexture.needsUpdate = true;

const terrainUniforms = {
  folds: { value: Array.from({length:12},()=>new THREE.Vector4(0,0,1,0)) },
  foldRules: { value: Array.from({length:12},()=>new THREE.Vector4()) },
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
      uniform vec4 folds[12];
      uniform vec4 foldRules[12];
      varying vec4 vState;
      varying float vHeight;
      varying vec3 vPos;
      void main() {
        vState = texture2D(stateMap, position.xz / 68. + .5);
        float chemistry = vState.r;
        float pulse = (vState.g - .5) * 2.;
        float memory = vState.b;
        float visits = vState.a;
        vec3 p = position;
        float base = sin(p.x * .17) * .32 + sin(p.z * .145 + 1.7) * .3;
        float living = sin(time * 1.65 + p.x * .47 - p.z * .31) * chemistry * 1.45;
        float relief = pow(max(0., chemistry), 1.55) * 5.2 + pulse * 2.2 + pow(memory, 1.7) * 2.;
        p.y += base + relief + living * .45;
        for(int i=0;i<12;i++){
          vec2 q=(p.xz-folds[i].xy)/folds[i].z;
          float d=length(q);
          float envelope=pow(max(0.,1.-d*d),2.);
          vec4 rule=foldRules[i];
          float along=q.x*cos(rule.y)+q.y*sin(rule.y);
          float across=-q.x*sin(rule.y)+q.y*cos(rule.y);
          float form=rule.x < .5 ? 1.-2.3*d*d : sin(along*3.4)*exp(-across*across*7.);
          p.y+=folds[i].w*envelope*form;
        }
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
        vec3 normal=normalize(cross(dFdx(vPos),dFdy(vPos)));
        float light=.4+.6*abs(dot(normal,normalize(vec3(-.4,1.,.3))));
        col=mix(vec3(.095,.12,.13),col,.65)*light;
        gl_FragColor = vec4(col, 1.0);
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
// An enclosed, misty material world, not a planetary horizon.
scene.background.set(0x182227);
scene.fog = new THREE.FogExp2(0x182227, .024);

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
  flatShading: false,
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
    const sheet=new THREE.PlaneGeometry(1.8,2.8,10,16);
    const vertices=sheet.attributes.position;
    for(let k=0;k<vertices.count;k++){
      const x=vertices.getX(k),y=vertices.getY(k);
      vertices.setXYZ(k,x+Math.sin(y*1.4+j)*.55,y,Math.sin(x*2+y*.8)*.6);
    }
    sheet.computeVertexNormals();
    const material=stoneMat.clone(); material.side=THREE.DoubleSide;
    const mesh = new THREE.Mesh(sheet, material);
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
  new THREE.OctahedronGeometry(.65, 1),
  new THREE.MeshStandardMaterial({ color: 0xffebd1, emissive: 0x86613e, emissiveIntensity: .7, roughness: .65 })
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
player.add(core);
core.scale.set(.55,1.25,.7);
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
const RIBBON_WIDTH = 9;
const ribbonPositions=new Float32Array(MAX_PATH*RIBBON_WIDTH*3);
const ribbonGeometry=new THREE.BufferGeometry();
ribbonGeometry.setAttribute('position',new THREE.BufferAttribute(ribbonPositions,3));
const ribbonIndices=[];
for(let i=0;i<MAX_PATH-1;i++) for(let k=0;k<RIBBON_WIDTH-1;k++){
  const j=i*RIBBON_WIDTH+k;
  ribbonIndices.push(j,j+1,j+RIBBON_WIDTH,j+1,j+RIBBON_WIDTH+1,j+RIBBON_WIDTH);
}
ribbonGeometry.setIndex(ribbonIndices);
ribbonGeometry.setDrawRange(0,0);
const ribbon=new THREE.Mesh(ribbonGeometry,new THREE.ShaderMaterial({
  side:THREE.DoubleSide,
  vertexShader:`varying vec3 point; void main(){ point=position;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader:`varying vec3 point; void main(){
    vec3 n=normalize(cross(dFdx(point),dFdy(point)));
    float light=.28+.72*abs(dot(n,normalize(vec3(-.6,1.,.4))));
    float grain=.5+.5*sin(point.y*1.6+point.x*.22+point.z*.18);
    vec3 color=mix(vec3(.12,.38,.39),vec3(.52,.88,.76),grain*.7);
    gl_FragColor=vec4(color*light,1.);
  }`
}));
ribbon.frustumCulled=false;
scene.add(ribbon);
const trail = [];
let trailCount = 0;
let lastTrailPoint = new THREE.Vector3(0, 0, 0);
let anomalyCooldown = 0;
const anomalies = [];
const floorFolds = [];
const bridges = [];
let ridingBridge = null;

function liftWake(index,angle,speed,age) {
  const center=trail[index];
  const existing=bridges.find(b=>Math.hypot(b.x-center.x,b.z-center.z)<4);
  if(existing){
    existing.visits++;
    existing.target=existing.visits%2 ? 3.2 : 9+Math.min(4,existing.visits);
    existing.twist+=.7;
    growFold(center.x,center.z,5,1,existing.twist);
    return;
  }
  if(bridges.length>=10) return;
  const startIndex=Math.max(0,index-12);
  const points=trail.slice(startIndex,Math.min(trail.length-20,index+13))
    .map(p=>({x:p.x,z:p.z}));
  if(points.length<10) return;
  const geometry=new THREE.BufferGeometry();
  const positions=new Float32Array(points.length*2*3);
  const indices=[];
  for(let i=0;i<points.length-1;i++){const j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2);}
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setIndex(indices);
  const material=new THREE.MeshStandardMaterial({color:0x78c4bb,emissive:0x193d3c,
    emissiveIntensity:.6,metalness:.12,roughness:.45,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.frustumCulled=false;
  scene.add(mesh);
  bridges.push({x:center.x,z:center.z,points,mesh,positions,height:0,startIndex,
    target:5+angle*4+Math.min(3,speed*.2),width:.65+Math.min(1.2,age/35),
    twist:angle*1.4,visits:0,inside:true,time:0});
  playStrike(100+speed*12+angle*90);
}

function bridgeSurface(b,x,z) {
  let best=null;
  for(let i=0;i<b.points.length-1;i++){
    const a=b.points[i],c=b.points[i+1];
    const dx=c.x-a.x,dz=c.z-a.z,l2=dx*dx+dz*dz;
    const t=THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/Math.max(.0001,l2),0,1);
    const d=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);
    if(d>b.width || (best && d>=best.distance))continue;
    const progress=(i+t)/(b.points.length-1);
    best={distance:d,progress,y:terrainHeight(x,z)+Math.sin(progress*Math.PI)*b.height+.2};
  }
  return best;
}

function evolveBridges(dt){
  for(const b of bridges){
    b.time+=dt;
    const proximity=Math.hypot(playerPos.x-b.x,playerPos.z-b.z);
    if(proximity>5) b.inside=false;
    if(!b.inside && proximity<2.2 && b.time>4){
      b.inside=true;b.visits++;b.twist+=.4;
      b.target=b.visits%3===0?3.2:7+Math.min(5,b.visits);
      playStrike(140+b.visits*19);
    }
    b.height+=(b.target+Math.sin(b.time*.65)*.3-b.height)*(1-Math.exp(-dt*.85));
    for(let i=0;i<b.points.length;i++){
      const p=b.points[i], a=b.points[Math.max(0,i-1)], c=b.points[Math.min(b.points.length-1,i+1)];
      const length=Math.max(.001,Math.hypot(c.x-a.x,c.z-a.z));
      const nx=-(c.z-a.z)/length,nz=(c.x-a.x)/length;
      const t=i/(b.points.length-1);
      // The two banks continually part and rejoin, while remaining a solid deck.
      const width=b.width*(1+.3*Math.sin(t*12+b.twist+b.time*.4)*Math.sin(t*Math.PI));
      for(let side=0;side<2;side++){
        const sign=side?1:-1,x=p.x+nx*width*sign,z=p.z+nz*width*sign;
        const at=(i*2+side)*3;
        b.positions[at]=x;
        b.positions[at+1]=terrainHeight(x,z)+Math.sin(t*Math.PI)*b.height+.2;
        b.positions[at+2]=z;
      }
    }
    b.mesh.geometry.attributes.position.needsUpdate=true;
    b.mesh.geometry.computeVertexNormals();
    b.mesh.material.roughness=.3+Math.sin(b.time*.3+b.visits)*.2;
  }
}

function foldHeight(x,z) {
  let height=0;
  for(const f of floorFolds){
    const qx=(x-f.x)/f.radius, qz=(z-f.z)/f.radius;
    const d2=qx*qx+qz*qz;
    if(d2>=1) continue;
    const along=qx*Math.cos(f.angle)+qz*Math.sin(f.angle);
    const across=-qx*Math.sin(f.angle)+qz*Math.cos(f.angle);
    const form=f.kind===0 ? 1-2.3*d2 : Math.sin(along*3.4)*Math.exp(-across*across*7);
    height+=f.height*(1-d2)*(1-d2)*form;
  }
  return height;
}

function growFold(x,z,radius,kind,angle=0) {
  const existing=floorFolds.find(f=>Math.hypot(f.x-x,f.z-z)<Math.min(radius,f.radius)*.65);
  if(existing){
    existing.target=-Math.sign(existing.target||1)*Math.min(11,Math.abs(existing.target)+1.2);
    existing.angle+=.55;
    existing.revisits++;
    return;
  }
  if(floorFolds.length>=12) return; // Preserve old ground, never silently delete it.
  floorFolds.push({x,z,radius,kind,angle,height:0,target:kind===0?7:10,
    revisits:0,inside:true,age:0,phase:0,turned:false});
  playStrike(kind===0?150:230);
}

function evolveFloor(dt) {
  floorFolds.forEach((f,i)=>{
    f.age+=dt;
    if(f.kind===0 && f.age>9 && !f.turned){
      f.turned=true;
      f.target=-Math.abs(f.target);
    }
    const distance=Math.hypot(playerPos.x-f.x,playerPos.z-f.z);
    const inside=distance<f.radius*.68;
    if(!f.inside && inside && f.age>4){
      f.revisits++;
      f.target=-Math.sign(f.target)*Math.min(12,Math.abs(f.target)+.7);
      f.angle+=.32;
      playStrike(130+f.revisits*23);
    }
    if(distance>f.radius*.94) f.inside=false;
    else if(inside) f.inside=true;
    f.phase+=dt*(.55+f.revisits*.07);
    const breathing=Math.sin(f.phase)*Math.min(1.1,.25+f.revisits*.2);
    f.height+=(f.target+breathing-f.height)*(1-Math.exp(-dt*.7));
    terrainUniforms.folds.value[i].set(f.x,f.z,f.radius,f.height);
    terrainUniforms.foldRules.value[i].set(f.kind,f.angle,0,0);
  });
}

function gridIndex(x, z) {
  const gx = THREE.MathUtils.clamp(Math.floor((x / WORLD + .5) * GRID), 0, GRID - 1);
  const gz = THREE.MathUtils.clamp(Math.floor((z / WORLD + .5) * GRID), 0, GRID - 1);
  return gz * GRID + gx;
}

function sampleField(x, z, array = v, channel = -1) {
  const fx = THREE.MathUtils.clamp((x / WORLD + .5) * GRID - .5, 0, GRID - 1);
  const fz = THREE.MathUtils.clamp((z / WORLD + .5) * GRID - .5, 0, GRID - 1);
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(GRID - 1, x0 + 1), z1 = Math.min(GRID - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const get=(i)=>channel<0?array[i]:pixels[i*4+channel]/255;
  const top = THREE.MathUtils.lerp(get(z0 * GRID + x0), get(z0 * GRID + x1), tx);
  const bottom = THREE.MathUtils.lerp(get(z1 * GRID + x0), get(z1 * GRID + x1), tx);
  return THREE.MathUtils.lerp(top, bottom, tz);
}

function terrainHeight(x, z) {
  const base = Math.sin(x * .17) * .32 + Math.sin(z * .145 + 1.7) * .3;
  const chemistry = sampleField(x,z,v,0);
  const pulse = sampleField(x,z,v,1)*2-1;
  const remembered = sampleField(x,z,v,2);
  const living=Math.sin(terrainUniforms.time.value*1.65+x*.47-z*.31)*chemistry*1.45;
  return base + Math.pow(chemistry,1.55)*5.2 + pulse*2.2 +
    Math.pow(remembered,1.7)*2 + living*.45 + foldHeight(x,z);
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
    targetPixels[p] = Math.min(255, v[i] * 390);
    targetPixels[p + 1] = Math.floor((wake[i] * .5 + .5) * 255);
    targetPixels[p + 2] = Math.floor(memory[i] * 255);
    targetPixels[p + 3] = Math.floor(visits[i] * 255);
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
      let area=0;
      for(let j=0;j<section.length;j++){
        const a=section[j], b=section[(j+1)%section.length];
        area+=a.x*b.z-b.x*a.z;
      }
      area=Math.abs(area)*.5;
      const loopish=area>12 && area>extent*extent*.65;
      const older=trail[Math.min(match+3,trail.length-1)];
      const old=trail[Math.max(0,match-3)];
      const ox=older.x-old.x, oz=older.z-old.z;
      const cross=Math.abs(ox*playerVelocity.z-oz*playerVelocity.x) /
        Math.max(.01,Math.hypot(ox,oz)*playerVelocity.length());
      if(loopish){
        growFold(cx,cz,THREE.MathUtils.clamp(Math.sqrt(area/Math.PI)*1.1,3,10),0);
        anomalyCooldown=3;
      }
      if(cross>.55 && terrainUniforms.time.value-trail[match].t>3){
        const age=terrainUniforms.time.value-trail[match].t;
        liftWake(match,cross,playerVelocity.length(),age);
        // Older, harder wakes buckle the floor too; fresh strands stay pliable.
        if(age>12) growFold(playerPos.x,playerPos.z,6.5,1,Math.atan2(oz,ox));
        anomalyCooldown=2;
      }
    }
  }
  lastTrailPoint.copy(playerPos);
}

function spawnAnomaly(x,z,radius,kind='seam') {
  growFold(x,z,Math.max(4,radius),kind==='membrane'?0:1);
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
  const surge = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const strength=input.length();
  const maxSpeed = surge ? 12.8 : joystick.length()>.01 ? 12.2*strength : 8.8;
  if (hasInput) {
    desired.normalize().multiplyScalar(maxSpeed);
    const response = 1 - Math.exp(-dt * 7.2);
    playerVelocity.lerp(desired, response);
    if (!movedYet) { movedYet = true; document.body.classList.add('moving'); }
  } else {
    playerVelocity.multiplyScalar(Math.exp(-dt * 4.4));
  }
  // Sloped ground changes the route. Revisited folds acquire an uphill pull
  // and a circulating current; steering remains stronger than either force.
  const sx=(foldHeight(playerPos.x+.3,playerPos.z)-foldHeight(playerPos.x-.3,playerPos.z))/.6;
  const sz=(foldHeight(playerPos.x,playerPos.z+.3)-foldHeight(playerPos.x,playerPos.z-.3))/.6;
  let gravity=1;
  for(const f of floorFolds){
    const dx=playerPos.x-f.x,dz=playerPos.z-f.z;
    const influence=Math.max(0,1-Math.hypot(dx,dz)/f.radius);
    if(f.revisits%2) gravity-=1.8*influence;
    if(f.revisits){
      const spin=Math.min(3,f.revisits)*influence;
      playerVelocity.x-=dz*spin*dt;
      playerVelocity.z+=dx*spin*dt;
    }
  }
  const slopeScale=4*gravity/Math.sqrt(1+sx*sx+sz*sz);
  playerVelocity.x-=sx*slopeScale*dt;
  playerVelocity.z-=sz*slopeScale*dt;
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
  let supportY=terrainHeight(playerPos.x,playerPos.z);
  if(ridingBridge){
    const surface=bridgeSurface(ridingBridge,playerPos.x,playerPos.z);
    if(surface) supportY=Math.max(supportY,surface.y);
    else ridingBridge=null;
  }
  if(!ridingBridge){
    for(const b of bridges){
      const surface=bridgeSurface(b,playerPos.x,playerPos.z);
      // Approach a strand's roots to climb; crossing its middle stays underneath.
      if(surface && (surface.progress<.14 || surface.progress>.86) &&
          surface.y<playerRenderY+.65){
        ridingBridge=b; supportY=Math.max(supportY,surface.y); break;
      }
    }
  }
  const targetY = supportY + 1.35;
  // Exact critically damped spring: consistent at 30/60/120 Hz, no floor snap.
  const omega=12, offset=playerRenderY-targetY;
  const impulse=playerVerticalVelocity+omega*offset, decay=Math.exp(-omega*dt);
  playerRenderY=targetY+(offset+impulse*dt)*decay;
  playerVerticalVelocity=(playerVerticalVelocity-omega*impulse*dt)*decay;
  player.position.set(playerPos.x, playerRenderY, playerPos.z);
  player.rotation.y += Math.atan2(Math.sin(playerFacing-player.rotation.y),
    Math.cos(playerFacing-player.rotation.y))*(1-Math.exp(-dt*10));
  player.rotation.z+=(-Math.atan(sx)*.45-player.rotation.z)*(1-Math.exp(-dt*6));
  player.rotation.x+=(Math.atan(sz)*.45-player.rotation.x)*(1-Math.exp(-dt*6));
  core.rotation.x = -speed * .018;
  core.rotation.z = Math.sin(terrainUniforms.time.value * 2.) * speed * .004;
  core.scale.set(.5+Math.sin(terrainUniforms.time.value*1.3)*.1,
    1.15+Math.sin(terrainUniforms.time.value*1.8)*.15,.65);
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
  desired.addScaledVector(playerVelocity, .16);
  desired.y=Math.max(desired.y,terrainHeight(desired.x,desired.z)+3);
  cameraPos.x+=(desired.x-cameraPos.x)*(1-Math.exp(-dt*4.5));
  cameraPos.z+=(desired.z-cameraPos.z)*(1-Math.exp(-dt*4.5));
  cameraPos.y+=(desired.y-cameraPos.y)*(1-Math.exp(-dt*2.2));
  camera.position.copy(cameraPos);
  lookTarget.copy(player.position).addScaledVector(playerVelocity, .32).add(new THREE.Vector3(0, .4, 0));
  smoothedLookTarget.lerp(lookTarget, 1 - Math.exp(-dt * 3.8));
  camera.lookAt(smoothedLookTarget);
  camera.fov += ((54 + speed * .32) - camera.fov) * (1-Math.exp(-dt*2));
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(.05, clock.getDelta());
  const time = terrainUniforms.time.value + dt;
  terrainUniforms.time.value = time;
  anomalyCooldown -= dt;
  simAccumulator += dt;
  const tick = 1 / 30;
  while (simAccumulator >= tick) {
    simulate();
    simAccumulator -= tick;
  }
  const blend=1-Math.exp(-dt*7);
  for(let i=0;i<pixels.length;i++){
    flowingPixels[i]+=(targetPixels[i]-flowingPixels[i])*blend;
    pixels[i]=Math.round(flowingPixels[i]);
  }
  stateTexture.needsUpdate=true;
  evolveFloor(dt);
  evolveBridges(dt);
  const speed = updatePlayer(dt);
  updateSentinels(time, dt);
  // The visible wake is embedded in the current ground, including old segments.
  for(let i=0;i<trailCount;i++){
    const p=i*3;
    pathPositions[p+1]=terrainHeight(pathPositions[p],pathPositions[p+2])+.12;
    for(const b of bridges){
      const t=(i-b.startIndex)/(b.points.length-1);
      if(t>=0 && t<=1) pathPositions[p+1]+=Math.sin(t*Math.PI)*b.height+.2;
    }
    const prev=Math.max(0,i-1)*3,next=Math.min(trailCount-1,i+1)*3;
    const dx=pathPositions[next]-pathPositions[prev],dz=pathPositions[next+2]-pathPositions[prev+2];
    const length=Math.max(.001,Math.hypot(dx,dz));
    const age=time-(trail[i]?.t??time);
    const history=sampleField(pathPositions[p],pathPositions[p+2],visits);
    const maturity=1-Math.exp(-Math.max(0,age)*.22);
    const tip=Math.min(1,(trailCount-1-i)/8);
    const unfurl=maturity*tip;
    const phase=i*.085-time*.32+history*4;
    const curl=unfurl*(1.1+history*1.8+.65*Math.sin(phase));
    const radius=1.1+unfurl*(1.7+history*2.1);
    for(let k=0;k<RIBBON_WIDTH;k++){
      const s=k/(RIBBON_WIDTH-1)*2-1,at=(i*RIBBON_WIDTH+k)*3;
      const theta=Math.abs(s)*curl;
      // Flat wake rolls into two scrolls, then folds back over its own center.
      const lateral=Math.sign(s)*radius*Math.sin(theta)/Math.max(.2,curl);
      const spread=lateral+ s*.22;
      ribbonPositions[at]=pathPositions[p]-dz/length*spread;
      ribbonPositions[at+1]=pathPositions[p+1]+radius*(1-Math.cos(theta))*unfurl;
      ribbonPositions[at+2]=pathPositions[p+2]+dx/length*spread;
    }
  }
  ribbonGeometry.setDrawRange(0,Math.max(0,trailCount-1)*(RIBBON_WIDTH-1)*6);
  ribbonGeometry.attributes.position.needsUpdate=true;
  pathGeometry.attributes.position.needsUpdate=true;
  updateCamera(dt, speed);
  renderer.render(scene, camera);
}

lastDeposit.copy(playerPos);
injectPoint(0, 0, .55, 1.5);
for (let i = 0; i < 18; i++) simulate();
pixels.set(targetPixels);
flowingPixels.set(targetPixels);
updateCamera(1, 0);
animate();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, isCoarse ? 1.9 : 2));
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
