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
}

export function createEmptyRig(): RigDocument {
  return { version: '0.1', units: 'kN', nodes: [], edges: [], paths: [] };
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
