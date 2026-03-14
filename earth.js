import * as THREE from 'three';
/**
 * WARDEN Earth Renderer — ES Module
 */

const DEG2RAD = Math.PI / 180;

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
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform vec3      uSunDir;

varying vec2 vUv;
varying vec3 vWorldNormal;

void main() {
  vec3 n      = normalize(vWorldNormal);
  vec3 sun    = normalize(uSunDir);
  float NdotL = dot(n, sun);
  float dayMix = smoothstep(-0.12, 0.12, NdotL);

  vec4 dayCol   = texture2D(uDay,   vUv);
  vec4 nightCol = texture2D(uNight, vUv);
  vec3 night    = nightCol.rgb * 1.6;
  vec3 col      = mix(night, dayCol.rgb, dayMix);

  // Atmospheric rim
  vec3 camDir = normalize(cameraPosition);
  float rim   = 1.0 - max(0.0, dot(n, camDir));
  col += vec3(0.04, 0.10, 0.22) * pow(rim, 3.5) * (dayMix * 0.7 + 0.3);

  gl_FragColor = vec4(col, 1.0);
}
`;

function sunDirection(date = new Date()) {
  const JD     = date / 86400000 + 2440587.5;
  const n      = JD - 2451545.0;
  const L      = (280.46 + 0.9856474 * n) * DEG2RAD;
  const g      = (357.528 + 0.9856003 * n) * DEG2RAD;
  const lambda = L + 1.915 * DEG2RAD * Math.sin(g) + 0.020 * DEG2RAD * Math.sin(2 * g);
  const eps    = 23.439 * DEG2RAD;
  return new THREE.Vector3(
    Math.cos(lambda),
    Math.sin(lambda) * Math.sin(eps),
    Math.sin(lambda) * Math.cos(eps)
  ).normalize();
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
  const COUNT = 7000;
  const pos   = new Float32Array(COUNT * 3);
  const R     = 90;
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
    color: 0xCCDDFF, size: 0.18, sizeAttenuation: true,
    transparent: true, opacity: 0.75
  }));
}

async function buildBorders(r = 1.002) {
  const resp     = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
  const topo     = await resp.json();
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
    color: 0x3A8FAA, transparent: true, opacity: 0.5
  }));
}

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
      el.className  = 'earth-marker';
      el.innerHTML  = m.html || '';
      el.style.cssText = 'position:absolute;pointer-events:none;transform:translate(-50%,-100%);display:none;';
      if (m.clickable) {
        el.style.pointerEvents = 'auto';
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => onClick && onClick(m.id));
      }
      this._overlay.appendChild(el);
      this._items.push({ mesh, el, pos: mesh.position.clone() });
    }
  }
  update(camera, W, H) {
    const camPos = camera.position.clone().normalize();
    for (const { pos, el } of this._items) {
      if (pos.clone().normalize().dot(camPos) < 0.1) { el.style.display = 'none'; continue; }
      const proj = pos.clone().project(camera);
      el.style.display = 'block';
      el.style.left = ((proj.x * 0.5 + 0.5) * W) + 'px';
      el.style.top  = ((-proj.y * 0.5 + 0.5) * H) + 'px';
    }
  }
  clear() {
    this._items.forEach(({ mesh, el }) => { this._scene.remove(mesh); el.remove(); });
    this._items = [];
  }
}

class PathLayer {
  constructor(scene) { this._scene = scene; this._lines = []; }
  set(paths) {
    this._lines.forEach(l => this._scene.remove(l));
    this._lines = [];
    for (const path of paths) {
      const pts  = path.pnts.map(([lat, lng, alt]) => latLngToVec3(lat, lng, 1.0 + (alt || 0.015)));
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const m    = (path.color || '').match(/rgba?\((\d+),(\d+),(\d+)/);
      const col  = m ? new THREE.Color(+m[1]/255, +m[2]/255, +m[3]/255) : new THREE.Color('#00CCCC');
      const op   = parseFloat((path.color || '').match(/[\d.]+\)$/)?.[0] || '0.8');
      const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op }));
      this._scene.add(line);
      this._lines.push(line);
    }
  }
  clear() { this._lines.forEach(l => this._scene.remove(l)); this._lines = []; }
}

class ArcLayer {
  constructor(scene) { this._scene = scene; this._arcs = []; }
  set(arcs) {
    this._arcs.forEach(a => this._scene.remove(a));
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
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: new THREE.Color(arc.color || '#E04444'), transparent: true, opacity: 0.75 })
      );
      this._scene.add(line);
      this._arcs.push(line);
    }
  }
  clear() { this._arcs.forEach(a => this._scene.remove(a)); this._arcs = []; }
}

export class EarthRenderer {
  constructor(container, { onReady, onClick } = {}) {
    this._container  = container;
    this._onReady    = onReady;
    this._onClick    = onClick;
    this._pov        = { lat: 20, lng: -30, altitude: 2.5 };
    this._autoRotate = true;
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

    const loader = new THREE.TextureLoader();
    const [dayTex, nightTex] = await Promise.all([
      loader.loadAsync('Textures/earth_day.jpg'),
      loader.loadAsync('Textures/earth_night.jpg'),
    ]);

    this._sunUniform = { value: sunDirection() };
    this._earth = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 128, 128),
      new THREE.ShaderMaterial({
        uniforms: {
          uDay:    { value: dayTex   },
          uNight:  { value: nightTex },
          uSunDir: this._sunUniform,
        },
        vertexShader:   VERT_SHADER,
        fragmentShader: FRAG_SHADER,
      })
    );
    this._scene.add(this._earth);

    try { this._scene.add(await buildBorders()); }
    catch(e) { console.warn('Borders failed:', e); }

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
    this._animId = requestAnimationFrame(() => this._loop());
    if (this._autoRotate) { this._pov.lng -= 0.035; this._updateCamera(); }
    this._sunUniform.value.copy(sunDirection());
    const W = this._container.clientWidth;
    const H = this._container.clientHeight;
    this._markers.update(this._camera, W, H);
    this._renderer.render(this._scene, this._camera);
  }

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
