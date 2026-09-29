// src/model/types.ts
//
// RopeFlow graph document model.
//
// A rig is a GRAPH, not geometry: nodes are physical rigging points (anchors,
// pulleys, carabiners, belay devices, loads, hauling points) and edges are
// rope segments that connect them and carry tension. The same model feeds
// BOTH the canvas renderer and the force solver, so what you draw is exactly
// what gets solved — the "hand in hand" that makes RopeFlow feel alive.

export interface Point2 {
  x: number;
  y: number;
}

/** Gear that a rope can connect to or run through. */
export type NodeKind =
  | 'ANCHOR'   // fixed structure/anchor point: supplies reaction force
  | 'PULLEY'   // redirects rope with friction; may be movable
  | 'CARABINER'// redirects rope with higher friction than a pulley
  | 'BELAY'    // belay / descender device: models device friction + MA
  | 'LOAD'     // a mass hanging on the rope (kN)
  | 'HAUL'     // point where hauling force is applied
  | 'EDGE'     // rope over an edge (e.g. an I-beam), modelled as a capstan wrap
  | 'TERMINAL' // plain fixed rope termination / dead-end (just an anchor)

/** Physics + rating of a node. kN throughout. */
export interface NodeSpec {
  /** Coefficient of friction (capstan model) for redirecting nodes. */
  friction?: number;
  /** Rope contact angle at this node, radians (0..2π). Direction of wrap. */
  wrapAngle?: number;
  /** Breaking strength of the gear/component, kN. */
  breakingStrength?: number;
  /** Static weight of the node itself, kN (defaults 0). */
  weight?: number;
  /** Required safety factor; overload flagged when tension/reaction exceeds breakingStrength/safetyFactor. */
  safetyFactor?: number;
  /** For LOAD nodes, the hanging mass in kN. */
  load?: number;
}

export interface RigNode {
  id: string;
  kind: NodeKind;
  position: Point2;
  label?: string;
  spec: NodeSpec;
}

/** A rope segment joining two node ids. */
export interface RigEdge {
  id: string;
  a: string;
  b: string;
  /** Rope breaking strength, kN (for the whole length). */
  breakingStrength?: number;
  /** Connector (rope) colour, hex. Defaults to the renderer's rope colour when unset. */
  color?: string;
}

// ---------------------------------------------------------------------------
// Rope model — a rope is a ROUTE WITH ATTRIBUTES, not a bare segment.
//
// A single physical rope travels an ordered `path` of nodes (reusing the
// existing path topology) and carries an ordered list of `events` describing
// what it does at each station: terminate through a knot into an anchor/load,
// run THROUGH a device (carabiner/pulley/belay — friction, and pulley gives
// mechanical advantage), or run OVER an edge (capstan friction). Each knot
// derates the rope's safe working load. Effective strength = nominal rating
// × the worst knot's SWL derating along the route.
// ---------------------------------------------------------------------------

/** Knots RopeFlow understands, each with its own SWL derating on the rope. */
export type KnotKind =
  | 'FIG8'         // figure-8 end knot
  | 'FIG8_BIGHT'   // figure-8 on a bight (loop)
  | 'BARREL'       // barrel / identity end knot
  | 'BOWLINE'      // bowline loop knot
  | 'CLOVE'        // clove hitch (attach to a spar / object)
  | 'BUTTERFLY'    // alpine butterfly — in-line midline knot
  | 'PRUSIK'       // prusik friction hitch — grips under load
  | 'MUNTER'       // munter hitch — rappel / belay friction hitch
  | 'OVERHAND';    // overhand / bight stopper

export interface KnotTemplate {
  kind: KnotKind;
  name: string;
  /**
   * Safe-working-load derating (0..1). Effective rope strength multiplies by
   * this: a FIG8 at 0.70 knocks a 30 kN rope to ~21 kN effective. Indicative —
   * verify against rope + knot manufacturer data before live use.
   */
  swl: number;
  /** Extra rope friction a friction-hitch introduces (capstan mu). */
  friction?: number;
  /** Where the knot is valid: rope-end (termination) vs mid-rope (inline). */
  placement: 'termination' | 'inline' | 'both';
  note: string;
}

/** A specific knot placed on a rope. */
export interface RopeKnot {
  kind: KnotKind;
  /** Node this knot is tied to / around (anchor, load, carabiner, spar). */
  atNodeId?: string;
}

export type RopeEventType = 'terminate' | 'run-through' | 'run-over' | 'knot-inline';

export interface RopeEvent {
  type: RopeEventType;
  /** Node involved, if any. */
  nodeId?: string;
  /** Knot for terminate / knot-inline events. */
  knot?: RopeKnot;
  /**
   * Mechanical advantage when the rope runs a pulley/belay FOR advantage
   * (e.g. 2 = 2:1). Divide the required haul force by this. Indicative —
   * real block-and-tackle MA depends on number of moving sheaves and
   * redirects; flagged as a planning approximation.
   */
  ma?: number;
}

export interface Rope {
  id: string;
  name: string;
  /** Rope colour (hex) for the renderer. */
  color?: string;
  /** Nominal rope breaking strength, kN (the whole rope, no knots). */
  rating: number;
  /** Ordered node route this rope travels (reuses path topology). */
  path: string[];
  /** Ordered attributes / stations along the route. */
  events: RopeEvent[];
}

/** Optional ordered rope path: an explicit sequence of node ids a single rope travels. */
export interface RigPathNode {
  nodeId: string;
}

/**
 * A complete rig document. Edges define topology; `paths` optionally define
 * explicit rope runs (one rope through several nodes) which the solver walks
 * to propagate tension. If `paths` is empty, every edge is treated as an
 * independent two-node rope.
 */
export interface RigDocument {
  version: string;
  units: 'kN' | 'kg' | 'lb';
  nodes: RigNode[];
  edges: RigEdge[];
  paths: RigPathNode[][];
  /** Optional high-level rope routes with attributes (knots, terminations, MA). */
  ropes?: Rope[];
}

export function createEmptyRig(): RigDocument {
  return { version: '0.1', units: 'kN', nodes: [], edges: [], paths: [], ropes: [] };
}

let _gid = 0;
export const genId = (p = 'n'): string =>
  `${p}_${Date.now().toString(36)}_${(_gid++).toString(36)}`;

export function makeNode(
  kind: NodeKind,
  position: Point2,
  spec: NodeSpec = {},
  label?: string,
): RigNode {
  return { id: genId(kind.toLowerCase()), kind, position, spec, label };
}
