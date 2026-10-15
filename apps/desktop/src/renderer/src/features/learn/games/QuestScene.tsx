import { memo, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';
import {
  GROUND_Y,
  MONSTER_X,
  VIEW_H,
  VIEW_W,
  WORLD_W,
  cameraX,
  walkPose,
  type HeroState,
  type WalkPose,
} from './quest';

/**
 * Monster Quest's side-scrolling scene, drawn as one SVG: a parallax valley
 * (sky, drifting clouds, mountains, two hill bands, trees, ground), the knight
 * with a jointed walk cycle, and the monster in front of its lair.
 *
 * Every color is a design token (`fill-primary`, `fill-success/40`, …) so the
 * scene follows the light and dark themes. Static scenery layers are memoized
 * and only their camera offset changes per frame. Ambient motion (clouds,
 * breathing, blinking, idle bob) is CSS, so it obeys the app's reduced-motion
 * policy and needs no render loop.
 */

/** Per-frame effect values for the hero, computed by the game from its clock. */
export interface HeroFx {
  /** px toward the facing direction (attack lunge). */
  lunge: number;
  /** px away from the facing direction (taking a hit). */
  recoil: number;
  /** Extra forward degrees on the sword arm (attack chop). */
  swing: number;
  /** 0..1 hit flash. */
  flash: number;
  /** 0..1 knocked-over progress. */
  fall: number;
  /** Sword raised in a battle stance. */
  ready: boolean;
  /** Victory hop. */
  cheer: boolean;
  /** 0..1 progress of the "!" shown when the monster appears (1 = hidden). */
  alert: number;
}

export interface MonsterFx {
  /** px toward the hero (attack lunge). */
  lunge: number;
  /** Degrees the near claw swipes during an attack. */
  swipe: number;
  /** px away from the hero (taking a hit). */
  recoil: number;
  flash: number;
  /** 0 → 1 as the monster is defeated and vanishes. */
  gone: number;
  /** 0..1 swell when it first appears. */
  roar: number;
  /** Health bar fill, or null to hide the bar. */
  hpPct: number | null;
}

export interface ScenePopup {
  id: number;
  target: 'hero' | 'monster';
  text: string;
  /** 0..1 rise-and-fade progress; only popups strictly inside (0, 1) are drawn. */
  progress: number;
}

export interface QuestSceneProps {
  hero: HeroState;
  heroFx: HeroFx;
  monsterFx: MonsterFx;
  popups: ScenePopup[];
  monsterName: string;
  label: string;
}

/**
 * Scene text is drawn in viewBox units, so it shrinks with the scene on narrow
 * screens. Labels scale back up below this rendered width (px) to stay readable.
 */
const LABEL_REF_PX = 620;
const MAX_LABEL_SCALE = 2.2;

/** Round to one decimal so path strings and transforms stay short. */
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Small seeded PRNG so the scenery is identical on every render and every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Width a layer must span so it still fills the view at the far end of the world. */
const layerWidth = (factor: number) => VIEW_W + (WORLD_W - VIEW_W) * factor;

const PARALLAX = { sun: 0.05, clouds: 0.1, mountains: 0.2, hillsBack: 0.4, hillsFront: 0.6, trees: 0.75 };
/** Cloud strip width; it is drawn twice and drifts by exactly this much per loop. */
const CLOUD_TILE = 900;

type Pt = [number, number];

function mountainShapes(): { body: string; caps: string[] } {
  const rand = seeded(7);
  const width = layerWidth(PARALLAX.mountains);
  const pts: Pt[] = [[-20, 200]];
  let x = -20;
  let peak = true;
  while (x < width + 40) {
    x += 70 + rand() * 70;
    pts.push([x, peak ? 104 + rand() * 50 : 172 + rand() * 30]);
    peak = !peak;
  }
  const body = `M-20 ${VIEW_H} L${pts.map(([px, py]) => `${r1(px)} ${r1(py)}`).join(' L')} L${r1(x)} ${VIEW_H} Z`;

  const caps: string[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i]!;
    const [lx, ly] = pts[i - 1]!;
    const [rx, ry] = pts[i + 1]!;
    if (py > ly || py > ry) continue; // valleys get no snow
    const left: Pt = [px + (lx - px) * 0.24, py + (ly - py) * 0.24];
    const right: Pt = [px + (rx - px) * 0.24, py + (ry - py) * 0.24];
    const dip = (a: Pt, b: Pt, t: number, dy: number) =>
      `${r1(a[0] + (b[0] - a[0]) * t)} ${r1(a[1] + (b[1] - a[1]) * t + dy)}`;
    caps.push(
      `M${r1(px)} ${r1(py)} L${r1(right[0])} ${r1(right[1])} L${dip(right, left, 0.33, 6)} L${dip(right, left, 0.66, -2)} L${r1(left[0])} ${r1(left[1])} Z`,
    );
  }
  return { body, caps };
}

function hillPath(seed: number, factor: number, baseY: number, amp: number, step: number): string {
  const rand = seeded(seed);
  const width = layerWidth(factor);
  const pts: Pt[] = [];
  for (let x = -step; x <= width + step * 2; x += step * (0.7 + rand() * 0.6)) {
    pts.push([x, baseY - rand() * amp]);
  }
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  let d = `M${r1(first[0])} ${VIEW_H} L${r1(first[0])} ${r1(first[1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    d += ` Q${r1(x)} ${r1(y)} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`;
  }
  return `${d} L${r1(last[0])} ${r1(last[1])} L${r1(last[0])} ${VIEW_H} Z`;
}

interface Tree {
  x: number;
  scale: number;
  kind: 'pine' | 'round';
}

function treeLayout(): Tree[] {
  const rand = seeded(23);
  const width = layerWidth(PARALLAX.trees);
  const trees: Tree[] = [];
  for (let x = 20 + rand() * 40; x < width + 40; x += 70 + rand() * 90) {
    trees.push({ x: r1(x), scale: r1(0.75 + rand() * 0.5), kind: rand() > 0.45 ? 'pine' : 'round' });
  }
  return trees;
}

const FLOWER_COLORS = ['fill-rose', 'fill-gold', 'fill-sky', 'fill-white'] as const;

interface GroundBits {
  grass: string;
  tufts: string;
  flowers: { x: number; color: (typeof FLOWER_COLORS)[number] }[];
  rocks: { x: number; rx: number; ry: number }[];
  pebbles: { x: number; y: number; rx: number }[];
}

function groundLayout(): GroundBits {
  const rand = seeded(41);
  let grass = `M0 ${GROUND_Y + 7} L0 ${GROUND_Y - 4}`;
  for (let x = 0; x < WORLD_W; x += 24) {
    grass += ` Q${x + 12} ${r1(GROUND_Y - 6 - rand() * 4)} ${x + 24} ${r1(GROUND_Y - 3 - rand() * 2)}`;
  }
  grass += ` L${WORLD_W + 24} ${GROUND_Y + 7} Z`;

  let tufts = '';
  const flowers: GroundBits['flowers'] = [];
  const rocks: GroundBits['rocks'] = [];
  for (let x = 10 + rand() * 20; x < WORLD_W; x += 26 + rand() * 46) {
    const y = GROUND_Y - 3;
    const t = r1(x);
    tufts += `M${t - 5} ${y} L${t - 3} ${y - 9} L${t - 1} ${y} M${t - 1} ${y} L${t + 1} ${y - 12} L${t + 3} ${y} M${t + 3} ${y} L${t + 6} ${y - 8} L${t + 7} ${y} `;
    const roll = rand();
    if (roll < 0.28) flowers.push({ x: r1(x + 14), color: FLOWER_COLORS[Math.floor(rand() * FLOWER_COLORS.length)]! });
    else if (roll > 0.9) rocks.push({ x: r1(x + 18), rx: r1(9 + rand() * 7), ry: r1(5 + rand() * 3) });
  }

  const pebbles: GroundBits['pebbles'] = [];
  for (let x = rand() * 30; x < WORLD_W; x += 22 + rand() * 40) {
    pebbles.push({ x: r1(x), y: r1(GROUND_Y + 14 + rand() * (VIEW_H - GROUND_Y - 22)), rx: r1(1.5 + rand() * 2.5) });
  }
  return { grass, tufts, flowers, rocks, pebbles };
}

const MOUNTAINS = mountainShapes();
const HILLS_BACK = hillPath(11, PARALLAX.hillsBack, 214, 36, 130);
const HILLS_FRONT = hillPath(17, PARALLAX.hillsFront, 238, 30, 105);
const TREES = treeLayout();
const GROUND = groundLayout();

function Cloud({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} className="fill-white/70">
      <ellipse cx={0} cy={0} rx={34} ry={14} />
      <ellipse cx={-24} cy={4} rx={22} ry={11} />
      <ellipse cx={26} cy={3} rx={24} ry={12} />
      <ellipse cx={4} cy={-10} rx={20} ry={13} />
    </g>
  );
}

const CLOUD_ROW = [
  { x: 90, y: 58, s: 1 },
  { x: 330, y: 92, s: 0.7 },
  { x: 560, y: 46, s: 1.15 },
  { x: 780, y: 84, s: 0.85 },
];

const Sky = memo(function Sky() {
  return (
    <>
      <circle cx={655} cy={72} r={58} className="fill-gold/15" />
      <circle cx={655} cy={72} r={34} className="fill-gold/90" />
    </>
  );
});

const Clouds = memo(function Clouds() {
  return (
    <g className="animate-quest-drift">
      {[0, CLOUD_TILE].map((offset) => (
        <g key={offset} transform={`translate(${offset} 0)`}>
          {CLOUD_ROW.map((c) => (
            <Cloud key={c.x} {...c} />
          ))}
        </g>
      ))}
    </g>
  );
});

const Mountains = memo(function Mountains() {
  return (
    <>
      <path d={MOUNTAINS.body} className="fill-primary/30" />
      {MOUNTAINS.caps.map((d) => (
        <path key={d} d={d} className="fill-white/55" />
      ))}
    </>
  );
});

const HillsBack = memo(function HillsBack() {
  return <path d={HILLS_BACK} className="fill-success/25" />;
});

const HillsFront = memo(function HillsFront() {
  return <path d={HILLS_FRONT} className="fill-success/40" />;
});

const Trees = memo(function Trees() {
  return (
    <>
      {TREES.map((t) => (
        <g key={t.x} transform={`translate(${t.x} ${GROUND_Y - 2}) scale(${t.scale})`}>
          {t.kind === 'pine' ? (
            <>
              <rect x={-3.5} y={-16} width={7} height={16} className="fill-bronze/80" />
              <path d="M0 -78 L-18 -44 L18 -44 Z M0 -62 L-24 -26 L24 -26 Z M0 -46 L-30 -12 L30 -12 Z" className="fill-success/75" />
              <path d="M0 -78 L18 -44 L0 -44 Z M0 -62 L24 -26 L0 -26 Z M0 -46 L30 -12 L0 -12 Z" className="fill-black/15" />
            </>
          ) : (
            <>
              <rect x={-4} y={-26} width={8} height={26} className="fill-bronze/80" />
              <g className="fill-success/65">
                <circle cx={0} cy={-46} r={20} />
                <circle cx={-15} cy={-34} r={13} />
                <circle cx={15} cy={-36} r={14} />
              </g>
              <circle cx={-6} cy={-52} r={7} className="fill-white/15" />
            </>
          )}
        </g>
      ))}
    </>
  );
});

/** The monster's cave and the glowing mushrooms around it. */
function Lair() {
  return (
    <>
      <g transform={`translate(1322 ${GROUND_Y})`}>
        <path d="M-112 4 C-106 -70 -62 -118 0 -120 C66 -118 108 -70 114 4 Z" className="fill-silver/60" />
        <path d="M30 -116 C80 -100 108 -60 114 4 L70 4 C76 -40 64 -86 30 -116 Z" className="fill-black/15" />
        <path d="M-56 4 C-54 -46 -30 -74 0 -76 C30 -74 54 -46 56 4 Z" className="fill-black/55" />
        <ellipse cx={-90} cy={-2} rx={14} ry={8} className="fill-silver" />
        <ellipse cx={86} cy={0} rx={18} ry={9} className="fill-silver" />
      </g>
      {[
        { x: 1146, s: 1 },
        { x: 1162, s: 0.7 },
        { x: 1388, s: 1.1 },
      ].map((m) => (
        <g key={m.x} transform={`translate(${m.x} ${GROUND_Y - 1}) scale(${m.s})`}>
          <rect x={-2.5} y={-11} width={5} height={11} rx={2} className="fill-white/75" />
          <path d="M-10 -10 C-10 -20 10 -20 10 -10 Z" className="fill-accent" />
          <circle cx={-3} cy={-14} r={1.6} className="fill-white/80" />
          <circle cx={4} cy={-13} r={1.2} className="fill-white/80" />
        </g>
      ))}
    </>
  );
}

const Ground = memo(function Ground() {
  return (
    <>
      <rect x={0} y={GROUND_Y} width={WORLD_W} height={VIEW_H - GROUND_Y} className="fill-bronze/50" />
      <rect x={0} y={VIEW_H - 18} width={WORLD_W} height={18} className="fill-black/10" />
      {GROUND.pebbles.map((p) => (
        <ellipse key={p.x} cx={p.x} cy={p.y} rx={p.rx} ry={p.rx * 0.6} className="fill-black/15" />
      ))}
      <path d={GROUND.grass} className="fill-success" />

      {/* Signpost near the start. */}
      <g transform={`translate(230 ${GROUND_Y - 2})`}>
        <rect x={-3} y={-46} width={6} height={46} className="fill-bronze" />
        <rect x={-31} y={-52} width={62} height={20} rx={3} className="fill-bronze" />
        <rect x={-31} y={-40} width={62} height={8} rx={3} className="fill-black/15" />
        <text x={0} y={-38} textAnchor="middle" fontSize={11} fontWeight={700} letterSpacing={1} className="fill-black/70">
          LAIR →
        </text>
      </g>

      <Lair />

      {GROUND.rocks.map((k) => (
        <g key={k.x}>
          <ellipse cx={k.x} cy={GROUND_Y - 1} rx={k.rx} ry={k.ry} className="fill-silver" />
          <ellipse cx={k.x - k.rx * 0.3} cy={GROUND_Y - 1 - k.ry * 0.35} rx={k.rx * 0.4} ry={k.ry * 0.35} className="fill-white/30" />
        </g>
      ))}
      <path d={GROUND.tufts} className="fill-success" />
      {GROUND.flowers.map((f) => (
        <g key={f.x}>
          <path d={`M${f.x} ${GROUND_Y - 2} V${GROUND_Y - 12}`} className="stroke-success" strokeWidth={1.5} />
          <circle cx={f.x} cy={GROUND_Y - 13} r={3} className={f.color} />
          <circle cx={f.x} cy={GROUND_Y - 13} r={1.1} className="fill-black/30" />
        </g>
      ))}
    </>
  );
});

/** One leg, pivoting at the hip. `angle` is forward degrees (see {@link WalkPose}). */
function Leg({ hipX, angle, shade }: { hipX: number; angle: number; shade?: boolean }) {
  const parts = (cls: string) => (
    <g className={cls}>
      <rect x={hipX - 4.5} y={-32} width={9} height={25} rx={4} />
      <rect x={hipX - 5.5} y={-9} width={14} height={9} rx={3} />
    </g>
  );
  return (
    <g transform={`rotate(${r1(-angle)} ${hipX} -31)`}>
      <rect x={hipX - 4.5} y={-32} width={9} height={25} rx={4} className="fill-silver" />
      <rect x={hipX - 5.5} y={-9} width={14} height={9} rx={3} className="fill-bronze" />
      {shade && parts('fill-black/25')}
    </g>
  );
}

/** One arm, pivoting at the shoulder; `children` are held in the hand. */
function Arm({ shoulderX, angle, shade, children }: { shoulderX: number; angle: number; shade?: boolean; children?: ReactNode }) {
  return (
    <g transform={`rotate(${r1(-angle)} ${shoulderX} -55)`}>
      <rect x={shoulderX - 4} y={-57} width={8} height={21} rx={4} className="fill-silver" />
      {children}
      <circle cx={shoulderX} cy={-35} r={4.6} className="fill-silver" />
      {shade && (
        <g className="fill-black/25">
          <rect x={shoulderX - 4} y={-57} width={8} height={21} rx={4} />
          <circle cx={shoulderX} cy={-35} r={4.6} />
        </g>
      )}
    </g>
  );
}

function Sword({ x }: { x: number }) {
  return (
    <g>
      <path d={`M${x + 6} -37.4 L${x + 34} -37.4 L${x + 41} -35 L${x + 34} -32.6 L${x + 6} -32.6 Z`} className="fill-white/90" />
      <path d={`M${x + 8} -35 H${x + 34}`} className="stroke-silver" strokeWidth={1} />
      <rect x={x + 2.5} y={-42} width={3.5} height={14} rx={1.5} className="fill-gold" />
      <circle cx={x - 3.5} cy={-35} r={2.2} className="fill-gold" />
    </g>
  );
}

function Shield({ x }: { x: number }) {
  return (
    <g>
      <ellipse cx={x - 6} cy={-41} rx={9} ry={12} className="fill-gold" />
      <ellipse cx={x - 6} cy={-41} rx={6} ry={8.5} className="fill-bronze/50" />
      <circle cx={x - 6} cy={-41} r={2.2} className="fill-gold" />
    </g>
  );
}

interface HeroSpriteProps {
  pose: WalkPose;
  facing: 1 | -1;
  walking: boolean;
  fx: HeroFx;
}

/**
 * The knight. Local origin is between the feet, facing right; `facing = -1`
 * mirrors it. Legs and arms rotate from the walk pose, the body bobs, and the
 * cape and plume trail further the faster the stride.
 */
function HeroSprite({ pose, facing, walking, fx }: HeroSpriteProps) {
  const trail = walking ? 3 + Math.abs(pose.frontLeg) / 7 : 1;
  const frontArm = pose.frontArm + (fx.ready ? 22 : 8) + fx.swing;
  const idle = !walking && fx.fall === 0 && !fx.cheer;
  return (
    <g transform={`scale(${facing} 1)`}>
      <ellipse cx={0} cy={1} rx={19} ry={4} className="fill-black/25" />
      <g
        transform={`rotate(${r1(-fx.fall * 84)} -9 0)`}
        style={fx.flash > 0 ? { filter: `brightness(${r1(1 + fx.flash * 1.3)})` } : undefined}
      >
        <g className={cn(idle && 'animate-quest-idle', fx.cheer && 'animate-quest-hop')}>
          <g transform={`translate(0 ${r1(pose.bob)})`}>
            {/* Cape, behind everything else. */}
            <path d={`M-8 -58 C-16 -46 ${r1(-19 - trail)} -32 ${r1(-21 - trail)} -20 L-3 -25 Z`} className="fill-primary" />
            <path d={`M-12 -46 C-15 -38 ${r1(-18 - trail)} -28 ${r1(-21 - trail)} -20 L-10 -22 Z`} className="fill-black/20" />

            <Arm shoulderX={-3} angle={pose.backArm} shade>
              <Shield x={-3} />
            </Arm>
            <Leg hipX={-3} angle={pose.backLeg} shade />
            <Leg hipX={4} angle={pose.frontLeg} />

            {/* Tunic, book crest and belt. */}
            <rect x={-12} y={-60} width={24} height={31} rx={9} className="fill-sky" />
            <path d="M-12 -51 C-12 -57 -8 -60 -4 -60 L-4 -29 L-6 -29 C-10 -29 -12 -32 -12 -36 Z" className="fill-black/15" />
            <rect x={-1} y={-53} width={9} height={7} rx={1.2} className="fill-white/85" />
            <path d="M3.5 -53 V-46" className="stroke-sky" strokeWidth={1} />
            <rect x={-12.5} y={-35} width={25} height={5} rx={2} className="fill-bronze" />
            <rect x={2} y={-35.6} width={5} height={6.2} rx={1.2} className="fill-gold" />

            {/* Helmet with a glowing visor and a plume. */}
            <path
              d={`M0 -86 C-6 -97 ${r1(-17 - trail)} -95 ${r1(-24 - trail)} -85 C-16 -88 -8 -86 -3 -82 Z`}
              className="fill-rose"
            />
            <circle cx={1} cy={-73} r={14} className="fill-silver" />
            <ellipse cx={-4} cy={-80} rx={6} ry={3.5} className="fill-white/40" />
            <rect x={-1} y={-77} width={17} height={8.5} rx={4.25} className="fill-black/75" />
            <circle cx={7} cy={-72.8} r={1.7} className="fill-accent" />
            <circle cx={12.2} cy={-72.8} r={1.7} className="fill-accent" />

            <Arm shoulderX={3} angle={frontArm}>
              <Sword x={3} />
            </Arm>
          </g>
        </g>
      </g>
    </g>
  );
}

/**
 * The Muddlebeast. Local origin is between its feet, facing left toward the
 * hero. It breathes and blinks on CSS timers, swells when it first appears,
 * flashes when hit, and shrinks away when defeated.
 */
function MonsterSprite({ fx }: { fx: MonsterFx }) {
  const squash = 1 - fx.gone * 0.75;
  const swell = 1 + fx.roar * 0.08;
  return (
    <g style={{ opacity: r1(1 - fx.gone) }}>
      <ellipse cx={0} cy={2} rx={58} ry={7} className="fill-black/25" />
      <g
        transform={`scale(${r1(swell * (1 + fx.gone * 0.2))} ${r1(swell * squash)})`}
        style={fx.flash > 0 ? { filter: `brightness(${r1(1 + fx.flash * 1.4)})` } : undefined}
      >
        <g className="origin-bottom animate-quest-breathe [transform-box:fill-box]">
          {/* Feet and far arm. */}
          <g className="fill-primary">
            <ellipse cx={-30} cy={-7} rx={17} ry={9} />
            <ellipse cx={28} cy={-7} rx={17} ry={9} />
            <ellipse cx={60} cy={-50} rx={10} ry={16} transform="rotate(-20 60 -50)" />
          </g>
          <g className="fill-black/25">
            <ellipse cx={28} cy={-7} rx={17} ry={9} />
            <ellipse cx={60} cy={-50} rx={10} ry={16} transform="rotate(-20 60 -50)" />
          </g>

          {/* Body. */}
          <path d="M-58 -16 C-68 -62 -42 -110 0 -110 C42 -110 68 -62 58 -16 C38 -2 -38 -2 -58 -16 Z" className="fill-primary" />
          <path d="M20 -108 C52 -100 70 -60 58 -16 C50 -10 40 -7 30 -6 C48 -40 46 -80 20 -108 Z" className="fill-black/15" />
          <ellipse cx={-26} cy={-92} rx={14} ry={7} transform="rotate(-25 -26 -92)" className="fill-white/20" />
          <g className="fill-accent/40">
            <circle cx={30} cy={-82} r={7} />
            <circle cx={42} cy={-58} r={4.5} />
            <circle cx={34} cy={-36} r={5.5} />
            <circle cx={-44} cy={-58} r={4} />
          </g>
          <ellipse cx={-8} cy={-36} rx={30} ry={20} className="fill-white/15" />

          {/* Horns. */}
          <g className="fill-gold">
            <path d="M-34 -96 C-46 -108 -54 -122 -50 -140 C-40 -124 -28 -114 -18 -104 Z" />
            <path d="M34 -96 C46 -108 54 -122 50 -140 C40 -124 28 -114 18 -104 Z" />
          </g>
          <path d="M34 -96 C46 -108 54 -122 50 -140 C46 -120 40 -110 30 -100 Z" className="fill-black/15" />

          {/* Angry brows and blinking eyes. */}
          <g className="fill-black/70">
            <path d="M-38 -90 L-10 -83 L-11 -78 L-37 -84 Z" />
            <path d="M22 -89 L0 -82 L1 -77 L21 -83 Z" />
          </g>
          <g className="origin-center animate-quest-blink [transform-box:fill-box]">
            <circle cx={-22} cy={-71} r={11} className="fill-white" />
            <circle cx={10} cy={-73} r={10} className="fill-white" />
            <circle cx={-27} cy={-70} r={5.5} className="fill-black/85" />
            <circle cx={5} cy={-72} r={5} className="fill-black/85" />
            <circle cx={-29} cy={-72} r={1.6} className="fill-white" />
            <circle cx={3} cy={-74} r={1.5} className="fill-white" />
          </g>

          {/* Toothy grin. */}
          <path d="M-40 -46 Q-10 -14 26 -46 Q-8 -38 -40 -46 Z" className="fill-black/75" />
          <ellipse cx={-8} cy={-32} rx={12} ry={4} className="fill-rose/80" />
          <path
            d="M-34 -45 L-26 -44 L-30 -37 Z M-22 -43 L-12 -42 L-17 -31 Z M-6 -42 L2 -42.4 L-2 -36 Z M8 -43 L16 -44 L12 -37 Z"
            className="fill-white"
          />

          {/* Near arm, which swipes at the hero. */}
          <g transform={`rotate(${r1(fx.swipe)} -54 -60)`}>
            <ellipse cx={-64} cy={-46} rx={10} ry={17} transform="rotate(18 -64 -46)" className="fill-primary" />
            <path d="M-76 -34 L-72 -26 L-69 -33 Z M-69 -31 L-64 -23 L-62 -31 Z M-62 -30 L-56 -24 L-55 -32 Z" className="fill-white" />
          </g>
        </g>
      </g>
    </g>
  );
}

/** Golden burst shown as the monster vanishes. */
function Puff({ progress }: { progress: number }) {
  if (progress <= 0 || progress >= 1) return null;
  return (
    <g style={{ opacity: r1(1 - progress) }}>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        const d = 18 + progress * 76;
        return (
          <circle
            key={i}
            cx={r1(Math.cos(a) * d)}
            cy={r1(-60 + Math.sin(a) * d * 0.8)}
            r={r1(7 * (1 - progress) + 2)}
            className={i % 2 === 0 ? 'fill-gold' : 'fill-white'}
          />
        );
      })}
    </g>
  );
}

export function QuestScene({ hero, heroFx, monsterFx, popups, monsterName, label }: QuestSceneProps) {
  const skyId = `quest-sky-${useId().replace(/:/g, '')}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const [labelScale, setLabelScale] = useState(1);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const update = () => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) setLabelScale(r1(Math.min(MAX_LABEL_SCALE, Math.max(1, LABEL_REF_PX / width))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const cam = cameraX(hero.x);
  const layer = (factor: number) => `translate(${r1(-cam * factor)} 0)`;
  const pose = walkPose(hero.walkPhase, hero.walking);
  const heroX = r1(hero.x - cam + (heroFx.lunge - heroFx.recoil) * hero.facing);
  const monsterX = r1(MONSTER_X - cam - monsterFx.lunge + monsterFx.recoil);
  const puff = monsterFx.gone > 0 ? Math.min(1, monsterFx.gone * 1.15) : 0;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label={label}
      className="block h-auto w-full select-none"
    >
      <defs>
        <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'rgb(var(--sb-sky))', stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--sb-accent))', stopOpacity: 0.12 }} />
        </linearGradient>
      </defs>

      <rect width={VIEW_W} height={VIEW_H} className="fill-bg" />
      <rect width={VIEW_W} height={VIEW_H} fill={`url(#${skyId})`} />

      <g transform={layer(PARALLAX.sun)}>
        <Sky />
      </g>
      <g transform={layer(PARALLAX.clouds)}>
        <Clouds />
      </g>
      <g transform={layer(PARALLAX.mountains)}>
        <Mountains />
      </g>
      <g transform={layer(PARALLAX.hillsBack)}>
        <HillsBack />
      </g>
      <g transform={layer(PARALLAX.hillsFront)}>
        <HillsFront />
      </g>
      <g transform={layer(PARALLAX.trees)}>
        <Trees />
      </g>
      <g transform={layer(1)}>
        <Ground />
      </g>

      <g transform={`translate(${monsterX} ${GROUND_Y})`}>
        {monsterFx.gone < 1 && <MonsterSprite fx={monsterFx} />}
        <Puff progress={puff} />
        {monsterFx.hpPct !== null && monsterFx.gone === 0 && (
          <g transform={`translate(0 -146) scale(${labelScale})`}>
            {/* Nameplate on its own backing so clouds and the sun never wash it out. */}
            <rect x={-52} y={-32} width={104} height={32} rx={8} className="fill-black/45" />
            <text y={-18} textAnchor="middle" fontSize={11.5} fontWeight={600} className="fill-white">
              {monsterName}
            </text>
            <rect x={-42} y={-11} width={84} height={7} rx={3.5} className="fill-white/20" />
            <rect
              x={-42}
              y={-11}
              width={r1(84 * Math.max(0, monsterFx.hpPct))}
              height={7}
              rx={3.5}
              className="fill-rose"
            />
          </g>
        )}
      </g>

      <g transform={`translate(${heroX} ${GROUND_Y})`}>
        <HeroSprite pose={pose} facing={hero.facing} walking={hero.walking} fx={heroFx} />
        {heroFx.alert > 0 && heroFx.alert < 1 && (
          <g transform={`translate(0 ${r1(-104 - heroFx.alert * 8)}) scale(${labelScale})`}>
            <text
              textAnchor="middle"
              fontSize={26}
              fontWeight={800}
              className="fill-amber"
              style={{ opacity: r1(1 - heroFx.alert ** 3) }}
            >
              !
            </text>
          </g>
        )}
      </g>

      {popups.map((p) => {
        if (p.progress <= 0 || p.progress >= 1) return null;
        const x = p.target === 'monster' ? monsterX - 62 - 24 * (labelScale - 1) : heroX;
        const y = GROUND_Y - (p.target === 'monster' ? 104 : 108) - p.progress * 28;
        return (
          <g key={p.id} transform={`translate(${r1(x)} ${r1(y)}) scale(${labelScale})`}>
            <text
              textAnchor="middle"
              fontSize={18}
              fontWeight={800}
              strokeWidth={4}
              className={cn('stroke-black/70', p.target === 'monster' ? 'fill-gold' : 'fill-rose')}
              style={{ opacity: r1(1 - p.progress), paintOrder: 'stroke' }}
            >
              {p.text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
