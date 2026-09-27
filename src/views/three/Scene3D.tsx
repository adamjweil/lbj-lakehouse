import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PointerLockControls, Sky } from '@react-three/drei';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Design } from '../../model/schema';
import { buildingBounds, deckGeom, footprintBounds, roofFrame, SIDE_NORMAL } from '../../model/geometry';
import { useStore } from '../../editor/store';
import { siteGeom } from '../../model/site';
import { F, House3D, toWorld, worldFrame, type HouseOptions } from './House3D';
import { SiteScene } from './site';

type Preset = 'lake' | 'road' | 'aerial' | 'site' | 'interior';
type Season = 'summer' | 'equinox' | 'winter';
const MAX_ELEV: Record<Season, number> = { summer: 83, equinox: 60, winter: 37 };

/** Optional start-up state from the URL, e.g. `?mode=3d&display=framing&sheathing=1` (used by the snapshots). */
function urlOptions(): { display: HouseOptions['display']; sheathing: boolean } {
  if (typeof location === 'undefined') return { display: 'finished', sheathing: false };
  const params = new URLSearchParams(location.search);
  return {
    display: params.get('display') === 'framing' ? 'framing' : 'finished',
    sheathing: ['1', 'true'].includes(params.get('sheathing') ?? ''),
  };
}

/** Simple sun path for ~30 deg N: sunrise east, noon south, sunset west. */
function sunDirection(hour: number, season: Season) {
  const t = (hour - 6) / 12;
  const az = ((90 + 180 * t) * Math.PI) / 180;
  const el = (Math.max(0.03, Math.sin(Math.PI * Math.min(Math.max(t, 0), 1))) * MAX_ELEV[season] * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

function lakeFrame(design: Design) {
  const n = SIDE_NORMAL[design.meta.lakeSide];
  const side = design.meta.lakeSide === 'east' || design.meta.lakeSide === 'west' ? SIDE_NORMAL.south : SIDE_NORMAL.east;
  return { lake: new THREE.Vector3(n.x, 0, n.y), side: new THREE.Vector3(side.x, 0, side.y) };
}

function cameraFor(design: Design, preset: Preset): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const { lake, side } = lakeFrame(design);
  const rf = roofFrame(design);
  const fr = worldFrame(design);
  // Frame the whole building (house plus garage).
  const bb = buildingBounds(design);
  const span = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * F;
  const center = toWorld(fr, { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 }, 0).setY(0);
  const mid = center.clone().setY((design.levels.floorHeight + rf.ridgeTop * 0.45) * F);
  const from = (l: number, sd: number, y: number) =>
    center.clone().add(lake.clone().multiplyScalar(l * span)).add(side.clone().multiplyScalar(sd * span)).setY(y * span);
  const g = siteGeom(design);
  if (g && preset !== 'interior') {
    // With a site: frame the house together with the dock, and the whole lot.
    const at = (x: number, y: number, h: number) => toWorld(fr, { x, y }, h - design.levels.floorHeight);
    const dockY = g.dock ? g.dock.body.y1 : g.shoreY;
    const cx = g.dock ? g.dock.spec.center : (bb.x0 + bb.x1) / 2;
    const L = g.lotRect;
    const lotC = { x: (L.x0 + L.x1) / 2, y: (L.y0 + L.y1) / 2 };
    switch (preset) {
      case 'lake':
        return { pos: at(cx + 560, dockY + 900, 24 * 12), target: at(cx, (bb.y0 + dockY) / 2, 6 * 12) };
      case 'road':
        // Stand in the front lawn, between the street-side trees and the porch.
        return { pos: at((bb.x0 + bb.x1) / 2 + 60, bb.y0 - 1000, 13 * 12), target: at((bb.x0 + bb.x1) / 2, bb.y0 + 60, 9 * 12) };
      case 'site':
        return { pos: at(lotC.x - 2900, lotC.y + 3400, 330 * 12), target: at(lotC.x, lotC.y + 300, 0) };
      case 'aerial':
        return { pos: from(0.85, 0.85, 1.3), target: center };
    }
  }
  switch (preset) {
    case 'site':
    case 'lake':
      return { pos: from(2.2, 0.8, 0.24), target: mid };
    case 'road':
      return { pos: from(-1.6, -0.9, 0.34), target: mid };
    case 'aerial':
      return { pos: from(0.85, 0.85, 1.3), target: center };
    case 'interior': {
      // Stand in the land-side corner of the main room and look diagonally toward the lake.
      const great = design.rooms.find((r) => r.type === 'living') ?? design.rooms[0];
      const pts = great?.polygon ?? [{ x: fr.cx, y: fr.cy }];
      const c = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 });
      const along = (v: THREE.Vector3) => pts.map((p) => p.x * v.x + p.y * v.z);
      const halfDepth = (Math.max(...along(lake)) - Math.min(...along(lake))) / 2;
      const halfWidth = (Math.max(...along(side)) - Math.min(...along(side))) / 2;
      const at = (dl: number, ds: number, h: number) =>
        new THREE.Vector3((c.x - fr.cx) * F, (fr.base + h) * F, (c.y - fr.cy) * F)
          .addScaledVector(lake, dl * halfDepth * F)
          .addScaledVector(side, ds * halfWidth * F);
      return { pos: at(-0.85, 0.85, 64), target: at(0.7, -0.5, 40) };
    }
  }
}

/** Soft image-based lighting generated locally (no HDR download). */
function Environment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.6;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function CameraRig({ design, preset, nonce, controls }: { design: Design; preset: Preset; nonce: number; controls: React.RefObject<OrbitImpl | null> }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const { pos, target } = cameraFor(design, preset);
    camera.position.copy(pos);
    camera.lookAt(target);
    if (controls.current) {
      controls.current.target.copy(target);
      controls.current.update();
    }
    // Only when a preset is chosen, not on every design edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, nonce]);
  return null;
}

function WalkControls({ floorY }: { floorY: number }) {
  const camera = useThree((s) => s.camera);
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const down = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    camera.position.y = floorY + 64 * F;
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [camera, floorY]);
  useFrame((_, dt) => {
    const k = keys.current;
    const speed = (k.ShiftLeft ? 12 : 5) * dt;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    if (k.KeyW || k.ArrowUp) camera.position.addScaledVector(fwd, speed);
    if (k.KeyS || k.ArrowDown) camera.position.addScaledVector(fwd, -speed);
    if (k.KeyA || k.ArrowLeft) camera.position.addScaledVector(right, -speed);
    if (k.KeyD || k.ArrowRight) camera.position.addScaledVector(right, speed);
  });
  return <PointerLockControls />;
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True when a world point would block one of the camera presets' lines of sight. */
function sightBlocker(design: Design) {
  const lines = (['lake', 'road', 'aerial', 'site'] as Preset[]).map((p) => cameraFor(design, p));
  return (p: THREE.Vector3) =>
    lines.some(({ pos: a, target: b }) => {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)) < 16;
    });
}

function Site({ design }: { design: Design }) {
  const { lake } = lakeFrame(design);
  const fb = footprintBounds(design);
  const dg = deckGeom(design);
  const halfDepth = (['north', 'south'].includes(design.meta.lakeSide) ? fb.y1 - fb.y0 : fb.x1 - fb.x0) * F * 0.5;
  // Keep the shoreline clear of a lake-side deck and its stairs.
  const lakeDeck = dg && dg.side === design.meta.lakeSide ? design.deck.depth + (dg.stairs ? dg.stairs.treads * dg.stairs.tread : 0) : 0;
  const shore = halfDepth + lakeDeck * F + 22;
  const rotY = Math.atan2(lake.x, lake.z);
  // Keep the lines of sight from the camera presets clear of trees (in world coordinates).
  const blocker = useMemo(() => sightBlocker(design), [design]);
  const trees = useMemo(() => {
    const rnd = mulberry(7);
    const c = Math.cos(rotY);
    const sn = Math.sin(rotY);
    const blocked = (x: number, z: number) => blocker(new THREE.Vector3(x * c + z * sn, 0, -x * sn + z * c));
    const out: { x: number; z: number; s: number; kind: number }[] = [];
    while (out.length < 46) {
      const x = (rnd() - 0.5) * 220;
      const z = -rnd() * 160 + shore - 12;
      if (Math.hypot(x, z) < 34) continue;
      // Keep the lake-side views open.
      if (z > -10 && Math.abs(x) < 90) continue;
      if (blocked(x, z)) continue;
      out.push({ x, z, s: 0.7 + rnd() * 0.7, kind: rnd() < 0.6 ? 0 : 1 });
    }
    return out;
  }, [shore, blocker, rotY]);
  return (
    <group rotation={[0, rotY, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, shore - 200]} receiveShadow>
        <planeGeometry args={[600, 400]} />
        <meshStandardMaterial color="#7d8b5a" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2 + 0.12, 0, 0]} position={[0, -0.9, shore + 7.4]} receiveShadow>
        <planeGeometry args={[600, 15]} />
        <meshStandardMaterial color="#b7a47f" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, shore + 250]}>
        <planeGeometry args={[1200, 500]} />
        <meshStandardMaterial color="#3f6f86" roughness={0.12} metalness={0.35} />
      </mesh>
      {/* Dock */}
      <mesh position={[0, -0.6, shore + 16]} castShadow receiveShadow>
        <boxGeometry args={[6, 0.4, 30]} />
        <meshStandardMaterial color={design.materials.deck} roughness={0.9} />
      </mesh>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} scale={t.s}>
          <mesh position={[0, 4, 0]} castShadow>
            <cylinderGeometry args={[0.5, 0.8, 8, 8]} />
            <meshStandardMaterial color="#5b4a3a" roughness={1} />
          </mesh>
          {t.kind === 0 ? (
            <mesh position={[0, 12, 0]} castShadow>
              <icosahedronGeometry args={[7, 1]} />
              <meshStandardMaterial color="#4f6b3a" roughness={1} flatShading />
            </mesh>
          ) : (
            <mesh position={[0, 13, 0]} castShadow>
              <coneGeometry args={[4, 18, 8]} />
              <meshStandardMaterial color="#3e5a36" roughness={1} flatShading />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

export function Scene3D({ design }: { design: Design }) {
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const [preset, setPreset] = useState<Preset>('lake');
  const [nonce, setNonce] = useState(0);
  const [hour, setHour] = useState(16);
  const [season, setSeason] = useState<Season>('summer');
  const [showRoof, setShowRoof] = useState(true);
  const [showFurniture, setShowFurniture] = useState(true);
  const [display, setDisplay] = useState(() => urlOptions().display);
  const [showSheathing, setShowSheathing] = useState(() => urlOptions().sheathing);
  const framing = display === 'framing';
  const [walk, setWalk] = useState(false);
  const [showLot, setShowLot] = useState(true);
  const [showTrees, setShowTrees] = useState(true);
  const site = useMemo(() => siteGeom(design), [design]);
  const frame = useMemo(() => worldFrame(design), [design]);
  const blocker = useMemo(() => sightBlocker(design), [design]);
  const controls = useRef<OrbitImpl | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const sun = sunDirection(hour, season);
  const sunPos = sun.clone().multiplyScalar(120);
  // Shadows cover the whole lot when there is a site.
  const shadowExtent = site ? 180 : 70;
  const lightPos = sun.clone().multiplyScalar(site ? 500 : 120);

  const choose = (p: Preset) => {
    setWalk(false);
    setPreset(p);
    setNonce((n) => n + 1);
  };

  const screenshot = () => {
    const url = glRef.current?.domElement.toDataURL('image/png');
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `lbj-lakehouse-${preset}.png`;
    a.click();
  };

  return (
    <div className="scene">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ fov: 45, near: 0.1, far: 20000, position: [60, 30, 60] }}
        onCreated={({ gl }) => {
          glRef.current = gl;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
        }}
        data-testid="scene"
      >
        <Sky sunPosition={sunPos} turbidity={6} rayleigh={1.2} />
        <Environment />
        <hemisphereLight args={['#dfe9f3', '#6f6a55', 0.9]} />
        {site && <fog attach="fog" args={['#d9e3ea', 600, 6000]} />}
        <directionalLight
          key={shadowExtent}
          position={lightPos}
          intensity={0.6 + Math.max(0, sun.y) * 2.6}
          castShadow
          shadow-mapSize={[4096, 4096]}
          shadow-camera-left={-shadowExtent}
          shadow-camera-right={shadowExtent}
          shadow-camera-top={shadowExtent}
          shadow-camera-bottom={-shadowExtent}
          shadow-camera-far={site ? 1200 : 400}
          shadow-bias={-0.0004}
          shadow-normalBias={0.04}
        />
        {site ? (
          <SiteScene design={design} fr={frame} g={site} options={{ showLot, showTrees }} avoid={blocker} />
        ) : (
          <Site design={design} />
        )}
        <House3D design={design} selection={selection} onPick={walk ? undefined : select} options={{ showRoof, showFurniture, display, showSheathing }} />
        {walk ? (
          <WalkControls floorY={design.levels.floorHeight * F} />
        ) : (
          <OrbitControls ref={controls} makeDefault maxPolarAngle={Math.PI / 2 - 0.02} minDistance={3} maxDistance={2500} />
        )}
        <CameraRig design={design} preset={preset} nonce={nonce} controls={controls} />
      </Canvas>

      <div className="scene-toolbar">
        <div className="seg">
          {((site ? ['lake', 'road', 'aerial', 'site', 'interior'] : ['lake', 'road', 'aerial', 'interior']) as Preset[]).map((p) => (
            <button key={p} className={preset === p && !walk ? 'on' : ''} onClick={() => choose(p)}>
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={showRoof ? 'on' : ''} onClick={() => setShowRoof((v) => !v)}>Roof</button>
          <button className={showFurniture ? 'on' : ''} onClick={() => setShowFurniture((v) => !v)} disabled={framing}>Furniture</button>
          <button
            className={framing ? 'on' : ''}
            onClick={() => setDisplay((d) => (d === 'framing' ? 'finished' : 'framing'))}
            title="Show the stick frame in place of the finished house"
          >
            Framing
          </button>
          {framing && (
            <button
              className={showSheathing ? 'on' : ''}
              onClick={() => setShowSheathing((v) => !v)}
              title="Wall, roof, and floor sheathing, and the deck boards"
            >
              Sheathing
            </button>
          )}
          {site && (
            <>
              <button className={showTrees ? 'on' : ''} onClick={() => setShowTrees((v) => !v)}>Trees</button>
              <button className={showLot ? 'on' : ''} onClick={() => setShowLot((v) => !v)}>Lot lines</button>
            </>
          )}
          <button
            className={walk ? 'on' : ''}
            onClick={() => {
              if (!walk) {
                setPreset('interior');
                setNonce((n) => n + 1);
              }
              setWalk((v) => !v);
            }}
            title="Click the view to look around; WASD to move, Shift to run, Esc to release"
          >
            Walk
          </button>
        </div>
        <label className="sun">
          <span>Sun {formatHour(hour)}</span>
          <input type="range" min={6} max={20} step={0.25} value={hour} onChange={(e) => setHour(+e.target.value)} />
        </label>
        <select value={season} onChange={(e) => setSeason(e.target.value as Season)} aria-label="Season">
          <option value="summer">Summer</option>
          <option value="equinox">Spring / fall</option>
          <option value="winter">Winter</option>
        </select>
        <button onClick={screenshot}>Save PNG</button>
      </div>
      {walk && <div className="scene-hint">Click the view to look around · WASD to move · Shift to run · Esc to release</div>}
    </div>
  );
}

const PRESET_LABELS: Record<Preset, string> = {
  lake: 'Lake view',
  road: 'Road view',
  aerial: 'Aerial',
  site: 'Site',
  interior: 'Interior',
};

function formatHour(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const ampm = hh >= 12 ? 'pm' : 'am';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
}
