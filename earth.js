import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;

// ── SHADERS ───────────────────────────────────────────────────────────────────
// Night-only view — city lights always on, subtle atmosphere
const VERT_SHADER = `
varying vec2 vUv;
varying vec3 vWorldNormal;
void main() {
  vUv          = uv;
  vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG_SHADER = `
uniform sampler2D uNight;
uniform vec3      uSunDir;
varying vec2 vUv;
varying vec3 vWorldNormal;

void main() {
  vec3 n      = normalize(vWorldNormal);
  vec4 night  = texture2D(uNight, vUv);

  // Subtle terminator: slightly dim the deep-night side vs twilight
  float NdotL  = dot(n, normalize(uSunDir));
  float dimMix = smoothstep(-1.0, 0.2, NdotL) * 0.35;
  vec3 col     = night.rgb * (1.0 + dimMix) * 1.5;

  // Atmospheric rim glow
  vec3 camDir = normalize(cameraPosition);
  float rim   = 1.0 - max(0.0, dot(n, camDir));
  col += vec3(0.02, 0.06, 0.18) * pow(rim, 4.0);

  gl_FragColor = vec4(col, 1.0);
}
`;

// ── DASHED LINE SHADER (animated marching ants) ────────────────────────────
const DASH_VERT = `
attribute float lineDistance;
varying float vLineDistance;
varying vec3 vWorldNormal;
void main() {
  vLineDistance = lineDistance;
  vWorldNormal  = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  gl_Position   = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DASH_FRAG = `
uniform float uDashSize;
uniform float uGapSize;
uniform float uOffset;
uniform vec3  uColor;
uniform float uOpacity;
varying float vLineDistance;

void main() {
  float d = mod(vLineDistance + uOffset, uDashSize + uGapSize);
  if(d > uDashSize) discard;
  gl_FragColor = vec4(uColor, uOpacity);
}
`;

// ── HELPERS ───────────────────────────────────────────────────────────────────
function sunDirection(date = new Date()) {
  const JD     = date / 86400000 + 2440587.5;
  const n      = JD - 2451545.0;
  const L      = (280.46 + 0.9856474 * n) * DEG2RAD;
  const g      = (357.528 + 0.9856003 * n) * DEG2RAD;
  const lambda = L + 1.915 * DEG2RAD * Math.sin(g) + 0.020 * DEG2RAD * Math.sin(2 * g);
  const eps    = 23.439 * DEG2RAD;
  return new THREE.Vector3(Math.cos(lambda), Math.sin(lambda) * Math.sin(eps), Math.sin(lambda) * Math.cos(eps)).normalize();
}

function latLngToVec3(lat, lng, r = 1.0) {
  const phi   = (90 - lat) * DEG2RAD;
  const theta = (lng + 180) * DEG2RAD;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );
}

function makeStarfield() {
  const COUNT = 8000, R = 90;
  const pos = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const theta = Math.random() * 2 * Math.PI;
    const phi   = Math.acos(2 * Math.random() - 1);
    pos[i*3]   = R * Math.sin(phi) * Math.cos(theta);
    pos[i*3+1] = R * Math.sin(phi) * Math.sin(theta);
    pos[i*3+2] = R * Math.cos(phi);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geom, new THREE.PointsMaterial({
    color: 0xCCDDFF, size: 0.15, sizeAttenuation: true, transparent: true, opacity: 0.8
  }));
}

async function buildBorders(r = 1.002) {
  const resp      = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
  const topo      = await resp.json();
  const countries = topojson.feature(topo, topo.objects.countries);
  const positions = [];
  function addRing(coords) {
    for (let i = 0; i < coords.length - 1; i++) {
      const a = latLngToVec3(coords[i][1],   coords[i][0],   r);
      const b = latLngToVec3(coords[i+1][1], coords[i+1][0], r);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  for (const f of countries.features) {
    const { type, coordinates } = f.geometry;
    if (type === 'Polygon')      coordinates.forEach(addRing);
    if (type === 'MultiPolygon') coordinates.forEach(p => p.forEach(addRing));
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return new THREE.LineSegments(geom, new THREE.LineBasicMaterial({
    color: 0x1A4A6A, transparent: true, opacity: 0.4
  }));
}

// Compute cumulative distances for dashed line shader
function addLineDistances(pts) {
  const n    = pts.length;
  const dist = new Float32Array(n);
  dist[0]    = 0;
  for (let i = 1; i < n; i++) dist[i] = dist[i-1] + pts[i].distanceTo(pts[i-1]);
  return dist;
}

// ── MARKER LAYER (with pulsing glow) ─────────────────────────────────────────
class MarkerLayer {
  constructor(scene, overlay) {
    this._scene = scene; this._overlay = overlay; this._items = [];
  }
  set(markers, onClick) {
    this._items.forEach(({ mesh, el }) => { this._scene.remove(mesh); el.remove(); });
    this._items = [];
    for (const m of markers) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.01, 4, 4),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      mesh.position.copy(latLngToVec3(m.lat, m.lng, 1.02));
      this._scene.add(mesh);

      const el = document.createElement('div');
      el.innerHTML  = m.html || '';
      el.style.cssText = 'position:absolute;pointer-events:none;transform:translate(-50%,-100%);display:none;';
      if (m.clickable) {
        el.style.pointerEvents = 'auto';
        el.style.cursor        = 'pointer';
        el.addEventListener('click', () => onClick && onClick(m.id));
      }
      this._overlay.appendChild(el);
      // Store pulse phase per marker for staggered animation
      this._items.push({ mesh, el, pos: mesh.position.clone(), phase: Math.random() * Math.PI * 2, color: m.color || '#00CCCC' });
    }
  }

  update(camera, W, H, t) {
    const camPos = camera.position.clone().normalize();
    for (const { pos, el, phase, color } of this._items) {
      if (pos.clone().normalize().dot(camPos) < 0.1) { el.style.display = 'none'; continue; }
      const proj = pos.clone().project(camera);
      el.style.display = 'block';
      el.style.left    = ((proj.x * 0.5 + 0.5) * W) + 'px';
      el.style.top     = ((-proj.y * 0.5 + 0.5) * H) + 'px';

      // Pulse the inner SVG glow via filter
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.0 + phase);
      const blur  = 2 + pulse * 4;
      const svg   = el.querySelector('svg');
      if (svg) svg.style.filter = `drop-shadow(0 0 ${blur}px ${color})`;
    }
  }

  clear() {
    this._items.forEach(({ mesh, el }) => { this._scene.remove(mesh); el.remove(); });
    this._items = [];
  }
}

// ── ANIMATED DASHED PATH LAYER ────────────────────────────────────────────────
class PathLayer {
  constructor(scene) { this._scene = scene; this._lines = []; }

  set(paths) {
    this._lines.forEach(({ line }) => this._scene.remove(line));
    this._lines = [];
    for (const path of paths) {
      const pts  = path.pnts.map(([lat, lng, alt]) => latLngToVec3(lat, lng, 1.0 + (alt || 0.015)));
      const dist = addLineDistances(pts);
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      geom.setAttribute('lineDistance', new THREE.BufferAttribute(dist, 1));

      const m    = (path.color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      const col  = m ? new THREE.Color(+m[1]/255, +m[2]/255, +m[3]/255) : new THREE.Color('#00CCCC');
      const op   = parseFloat((path.color || '').match(/[\d.]+\)$/)?.[0] || '0.8');
      const isDashed = path.dashed === true;

      let line;
      if (isDashed) {
        const mat = new THREE.ShaderMaterial({
          uniforms: {
            uDashSize: { value: 0.03 },
            uGapSize:  { value: 0.03 },
            uOffset:   { value: 0 },
            uColor:    { value: col },
            uOpacity:  { value: op },
          },
          vertexShader:   DASH_VERT,
          fragmentShader: DASH_FRAG,
          transparent: true,
        });
        line = new THREE.Line(geom, mat);
        this._lines.push({ line, animated: true, mat, speed: 0.015 });
      } else {
        line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op }));
        this._lines.push({ line, animated: false });
      }
      this._scene.add(line);
    }
  }

  update(dt) {
    for (const { animated, mat, speed } of this._lines) {
      if (animated) mat.uniforms.uOffset.value += speed;
    }
  }

  clear() {
    this._lines.forEach(({ line }) => this._scene.remove(line));
    this._lines = [];
  }
}

// ── ANIMATED ARC LAYER ────────────────────────────────────────────────────────
class ArcLayer {
  constructor(scene) { this._scene = scene; this._arcs = []; }

  set(arcs) {
    this._arcs.forEach(({ line }) => this._scene.remove(line));
    this._arcs = [];
    for (const arc of arcs) {
      const pts = [];
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        pts.push(latLngToVec3(
          arc.startLat + (arc.endLat - arc.startLat) * t,
          arc.startLng + (arc.endLng - arc.startLng) * t,
          1.0 + 0.05 * Math.sin(Math.PI * t)
        ));
      }
      const dist = addLineDistances(pts);
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      geom.setAttribute('lineDistance', new THREE.BufferAttribute(dist, 1));

      const m   = (arc.color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      const col = m ? new THREE.Color(+m[1]/255, +m[2]/255, +m[3]/255) : new THREE.Color('#E04444');
      const op  = parseFloat((arc.color || '').match(/[\d.]+\)$/)?.[0] || '0.75');

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uDashSize: { value: 0.025 },
          uGapSize:  { value: 0.025 },
          uOffset:   { value: 0 },
          uColor:    { value: col },
          uOpacity:  { value: op },
        },
        vertexShader:   DASH_VERT,
        fragmentShader: DASH_FRAG,
        transparent: true,
      });
      const line = new THREE.Line(geom, mat);
      this._scene.add(line);
      this._arcs.push({ line, mat });
    }
  }

  update() {
    for (const { mat } of this._arcs) mat.uniforms.uOffset.value += 0.02;
  }

  clear() {
    this._arcs.forEach(({ line }) => this._scene.remove(line));
    this._arcs = [];
  }
}

// ── MAIN RENDERER ─────────────────────────────────────────────────────────────
export class EarthRenderer {
  constructor(container, { onReady, onClick } = {}) {
    this._container  = container;
    this._onReady    = onReady;
    this._onClick    = onClick;
    this._pov        = { lat: 20, lng: -30, altitude: 2.5 };
    this._autoRotate = true;
    this._clock      = new THREE.Clock();
    this._animId     = null;
    this._init();
  }

  async _init() {
    const W = this._container.clientWidth;
    const H = this._container.clientHeight;

    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(W, H);
    this._renderer.setClearColor(0x000005, 1);
    this._container.appendChild(this._renderer.domElement);

    this._scene  = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 500);
    this._updateCamera();

    this._scene.add(makeStarfield());

    // Night-only texture
    const nightTex = await new THREE.TextureLoader().loadAsync('textures/earth_night.jpg');
    this._sunUniform = { value: sunDirection() };

    this._earth = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 128, 128),
      new THREE.ShaderMaterial({
        uniforms: { uNight: { value: nightTex }, uSunDir: this._sunUniform },
        vertexShader: VERT_SHADER, fragmentShader: FRAG_SHADER,
      })
    );
    this._scene.add(this._earth);

    try { this._scene.add(await buildBorders()); }
    catch(e) { console.warn('Borders failed:', e); }

    // CSS overlay for markers
    this._overlay = document.createElement('div');
    this._overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    this._container.style.position = 'relative';
    this._container.appendChild(this._overlay);

    this._markers = new MarkerLayer(this._scene, this._overlay);
    this._paths   = new PathLayer(this._scene);
    this._arcs    = new ArcLayer(this._scene);

    this._setupControls();
    new ResizeObserver(() => this._onResize()).observe(this._container);
    this._loop();
    this._onReady && this._onReady(this);
  }

  _setupControls() {
    const el = this._renderer.domElement;
    let drag = false, lx = 0, ly = 0;
    el.addEventListener('mousedown', e => { drag = true; lx = e.clientX; ly = e.clientY; this._autoRotate = false; });
    window.addEventListener('mouseup', () => { drag = false; });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      this._pov.lng -= (e.clientX - lx) * 0.3;
      this._pov.lat  = Math.max(-85, Math.min(85, this._pov.lat + (e.clientY - ly) * 0.3));
      lx = e.clientX; ly = e.clientY;
      this._updateCamera();
    });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this._pov.altitude = Math.max(0.5, Math.min(8, this._pov.altitude + e.deltaY * 0.003));
      this._updateCamera();
    }, { passive: false });

    // Resume auto-rotate after 5s idle
    let idleTimer;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { this._autoRotate = true; }, 5000);
    };
    el.addEventListener('mousedown', resetIdle);
    el.addEventListener('wheel', resetIdle);
  }

  _updateCamera() {
    const { lat, lng, altitude } = this._pov;
    const phi   = (90 - lat) * DEG2RAD;
    const theta = (lng + 180) * DEG2RAD;
    const r     = 1.0 + altitude;
    this._camera.position.set(
      -r * Math.sin(phi) * Math.cos(theta),
       r * Math.cos(phi),
       r * Math.sin(phi) * Math.sin(theta)
    );
    this._camera.lookAt(0, 0, 0);
  }

  _onResize() {
    const W = this._container.clientWidth;
    const H = this._container.clientHeight;
    this._camera.aspect = W / H;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(W, H);
  }

  _loop() {
    this._animId  = requestAnimationFrame(() => this._loop());
    const elapsed = this._clock.getElapsedTime();

    if (this._autoRotate) {
      this._pov.lng -= 0.035;
      this._updateCamera();
    }

    this._sunUniform.value.copy(sunDirection());
    this._paths.update();
    this._arcs.update();

    const W = this._container.clientWidth;
    const H = this._container.clientHeight;
    this._markers.update(this._camera, W, H, elapsed);

    this._renderer.render(this._scene, this._camera);
  }

  // ── PUBLIC API ──────────────────────────────────────────────────────────────
  setLayers({ vehicles = [], groundStations = [], paths = [], arcs = [] } = {}) {
    this._markers.set([...vehicles, ...groundStations], this._onClick);
    this._paths.set(paths);
    this._arcs.set(arcs);
  }

  pointOfView({ lat, lng, altitude }, ms = 900) {
    const start = { ...this._pov };
    const t0    = performance.now();
    const ease  = t => t < 0.5 ? 2*t*t : -1 + (4 - 2*t) * t;
    this._autoRotate = false;
    const step = now => {
      const t = Math.min(1, (now - t0) / ms);
      this._pov.lat      = start.lat      + (lat      - start.lat)      * ease(t);
      this._pov.lng      = start.lng      + (lng      - start.lng)      * ease(t);
      this._pov.altitude = start.altitude + (altitude - start.altitude) * ease(t);
      this._updateCamera();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  resumeRotation() { this._autoRotate = true; }

  destroy() {
    cancelAnimationFrame(this._animId);
    this._renderer.dispose();
    this._renderer.domElement.remove();
    this._overlay.remove();
  }
}
