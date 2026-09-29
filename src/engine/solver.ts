// src/engine/solver.ts
//
// Planar rope-rigging force solver.
//
// The approach is path-tension propagation: each ordered rope path is walked
// from a known anchor (the load weight) to the haul/terminal end, and tension
// is propagated across each redirecting node with the Euler–Eytelwein capstan
// equation. Node reactions are then assembled from the incident rope tensions
// and checked against gear ratings and the 120° critical-angle rule.
//
// Units: kN throughout. Angles in radians.

import type { RigDocument, RigNode, NodeKind } from '../model/types';

export interface SegmentForce {
  /** Index of this segment within its path. */
  seg: number;
  /** Tension carried by the rope segment, kN. */
  tension: number;
  /** CAPSTAN = tension changed across a friction node; CONSTANT = straight/ideal run. */
  relation: 'CAPSTAN' | 'CONSTANT';
}

export interface NodeForce {
  nodeId: string;
  kind: NodeKind;
  /** Resultant force applied to the node by all incident rope tensions, kN. */
  resultant: number;
  /** Direction (unit vector) of the resultant. */
  resultantDir: { x: number; y: number };
  /** For ANCHOR nodes: the reaction force the structure must supply, kN. */
  reaction?: number;
  /** Included angle between the two rope legs at this node, radians (0 when fewer than 2 legs). */
  includedAngle?: number;
  /** true when included angle exceeds 120° (critical-angle rule). */
  criticalAngle?: boolean;
  /** Utilisation = peak tension/reaction over rated strength. */
  utilisation: number;
  /** Current working tension / reaction in kN. */
  working: number;
  /** Overload status vs the gear rating. */
  status: 'OK' | 'WARN' | 'OVERLOAD';
}

export interface SolveResult {
  /** Per-path segment tensions. Keyed by path index. */
  segments: Record<number, SegmentForce[]>;
  /** Per-node assembled forces. */
  nodes: NodeForce[];
  /** Human-warnings collected during the solve. */
  warnings: string[];
  /** The force required at the haul end for each path, kN. */
  haulForce: Record<number, number>;
}

const CRITICAL_ANGLE = (120 * Math.PI) / 180; // 120° in radians

function unit(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

/**
 * Capstan ratio across a friction node with coefficient mu and wrap angle theta.
 * Returns the multiplier such that T_exit = T_enter * ratio. For frictionless
 * sets ratio = 1 (tension constant).
 */
export function capstanRatio(mu: number, theta: number): number {
  return Math.exp(mu * Math.abs(theta));
}

/**
 * Propagate tension along a single rope path, walking in the specified
 * direction (true = index ascending toward the haul end, starting from the
 * load). Returns the tension at every contact node plus the final haul force.
 */
function propagatePath(
  rig: RigDocument,
  pathIds: string[],
  knownTension: number,
  ascend: boolean,
): { tensions: Map<string, number>; haulForce: number } {
  const nodes = new Map(rig.nodes.map((n) => [n.id, n]));
  const tensions = new Map<string, number>();

  // The known end carries `knownTension`. Propagate node-by-node.
  let t = knownTension;
  const ids = ascend ? pathIds : [...pathIds].reverse();
  for (const id of ids) {
    tensions.set(id, t);
    const node = nodes.get(id);
    if (!node) continue;
    // Crossing a redirecting node: tension multiplies by the capstan ratio,
    // always growing in the direction the rope tightens (the haul side). For a
    // static worst-case bound we grow tension through friction nodes regardless
    // of raising/lowering direction.
    const mu = node.spec.friction ?? 0;
    const theta = node.spec.wrapAngle ?? 0;
    t = t * Math.max(1, capstanRatio(mu, theta));
  }
  return { tensions, haulForce: t };
}

/** Resolve the load weight (kN) attached to a LOAD node. */
function nodeLoad(node: RigNode): number {
  return node.spec.load ?? 0;
}

/**
 * Solve a rig document for forces.
 *
 * Strategy per ordered `paths` entry:
 *   1. Find a LOAD node in the path; that leg's rope tension starts at the load
 *      weight (plus that node's own weight).
 *   2. Walk the path toward the haul/terminal end, multiplying through capstan
 *      friction at each redirecting node.
 *   3. The final value is the required haul force / reaction at the far end.
 *   4. Assemble node resultants from all incident rope tensions and check
 *      against ratings + critical angle.
 */
export function solveRig(rig: RigDocument): SolveResult {
  const nodes = new Map(rig.nodes.map((n) => [n.id, n]));
  const warnings: string[] = [];
  const segments: Record<number, SegmentForce[]> = {};
  const haulForce: Record<number, number> = {};

  // Map each node -> incident rope runs (list of {dir, tension}) for the
  // resultant, plus the leg direction vectors for the included-angle rule.
  const nodeForce: Map<string, { fx: number; fy: number; legs: { dx: number; dy: number; tension: number }[] }> = new Map();
  const init = () => ({ fx: 0, fy: 0, legs: [] });

  const paths = rig.paths.length
    ? rig.paths.map((p) => p.map((pn) => pn.nodeId))
    // No explicit paths: treat each edge as an isolated two-node rope.
    : rig.edges.map((e) => [e.a, e.b]);

  paths.forEach((pathIds, pathIndex) => {
    const segs: SegmentForce[] = [];
    // Determine start tension: prefer a LOAD node in this path; else the rope
    // is a fixed/support line with zero external load (reaction from anchors).
    let loadNodeId: string | null = null;
    for (const id of pathIds) {
      const n = nodes.get(id);
      if (n && n.kind === 'LOAD') loadNodeId = id;
    }

    if (loadNodeId) {
      const loadNode = nodes.get(loadNodeId)!;
      const startTension = nodeLoad(loadNode) + (loadNode.spec.weight ?? 0);
      // Direction: if the load sits mid-path, propagate toward both ends.
      const li = pathIds.indexOf(loadNodeId);
      const tensionsAsc = propagatePath(rig, pathIds, startTension, true);
      const tensionsDesc =
        li > 0 ? propagatePath(rig, pathIds, startTension, false) : tensionsAsc;

      for (let s = 0; s < pathIds.length - 1; s++) {
        const a = pathIds[s];
        const b = pathIds[s + 1];
        const ta = li <= s ? tensionsAsc.tensions.get(a)! : tensionsDesc.tensions.get(a)!;
        const tb = li <= s ? tensionsAsc.tensions.get(b)! : tensionsDesc.tensions.get(b)!;
        segs.push({
          seg: s,
          tension: Math.max(ta, tb),
          relation: Math.abs(ta - tb) > 1e-9 ? 'CAPSTAN' : 'CONSTANT',
        });
      }
      haulForce[pathIndex] = tensionsAsc.haulForce;
    } else {
      // No load: rope is a pure structural line; tension 0 for now (anchors
      // must supply reactions from other paths).
      for (let s = 0; s < pathIds.length - 1; s++) {
        segs.push({ seg: s, tension: 0, relation: 'CONSTANT' });
      }
      haulForce[pathIndex] = 0;
    }

    // Accumulate node forces from segment tensions.
    segs.forEach((seg) => {
      const a = pathIds[seg.seg];
      const b = pathIds[seg.seg + 1];
      const na = nodes.get(a);
      const nb = nodes.get(b);
      if (!na || !nb) return;
      const u = unit(na.position, nb.position);

      let fa = nodeForce.get(a) ?? init();
      let fb = nodeForce.get(b) ?? init();
      // a pulls toward b (+u), b pulls toward a (-u).
      // A leg at node X has direction X→neighbour.
      fa.fx += seg.tension * u.x; fa.fy += seg.tension * u.y;
      fa.legs.push({ dx: u.x, dy: u.y, tension: seg.tension });
      fb.fx -= seg.tension * u.x; fb.fy -= seg.tension * u.y;
      fb.legs.push({ dx: -u.x, dy: -u.y, tension: seg.tension });
      nodeForce.set(a, fa);
      nodeForce.set(b, fb);
    });

    segments[pathIndex] = segs;
  });

  // Assemble per-node output, compute reaction/included angle/check ratings.
  const nodesOut: NodeForce[] = rig.nodes.map((n) => {
    const f = nodeForce.get(n.id) ?? init();
    const resultant = Math.hypot(f.fx, f.fy);
    const dir = resultant > 1e-9 ? { x: f.fx / resultant, y: f.fy / resultant } : { x: 0, y: -1 };

    const rating = n.spec.breakingStrength;
    const sf = n.spec.safetyFactor ?? 5; // default rigging safety factor
    const rated = rating ? rating / sf : null;

    // Included angle between the two legs at a redirecting/load node: the angle
    // between the two highest-tension incident leg vectors (directions X→neighbour).
    const working = resultant;
    let includedAngle: number | undefined;
    let criticalAngle = false;
    if (f.legs.length >= 2 && working > 1e-9) {
      const sorted = [...f.legs].sort((x, y) => y.tension - x.tension);
      const [l1, l2] = sorted;
      const dotd = l1.dx * l2.dx + l1.dy * l2.dy;
      const m1 = Math.hypot(l1.dx, l1.dy);
      const m2 = Math.hypot(l2.dx, l2.dy);
      const cosTheta = Math.max(-1, Math.min(1, dotd / (m1 * m2 || 1)));
      includedAngle = Math.acos(cosTheta);
      criticalAngle = includedAngle > CRITICAL_ANGLE;
      if (criticalAngle) {
        warnings.push(`${n.label ?? n.id}: included angle ${(
          (includedAngle * 180) / Math.PI
        ).toFixed(0)}° exceeds 120° critical angle (anchor force exceeds rope load).`);
      }
    }

    let status: 'OK' | 'WARN' | 'OVERLOAD';
    let utilisation = 0;
    if (rated) {
      utilisation = working / rated;
      if (utilisation > 1) {
        status = 'OVERLOAD';
        warnings.push(
          `${n.label ?? n.id}: working ${working.toFixed(2)} kN exceeds rated ${rated.toFixed(2)} kN (${(
            utilisation * 100
          ).toFixed(0)}% of capacity).`,
        );
      } else if (utilisation > 0.8) {
        status = 'WARN';
      } else {
        status = 'OK';
      }
    } else {
      // No gear rating. Only load-carrying gear should warn when unrated;
      // a LOAD being pulled or an ANCHOR are not "gear" in this sense.
      utilisation = 0;
      const isGear = ['PULLEY', 'CARABINER', 'BELAY', 'EDGE'].includes(n.kind);
      status = isGear && working > 1e-9 ? 'WARN' : 'OK';
    }

    return {
      nodeId: n.id,
      kind: n.kind,
      resultant,
      resultantDir: dir,
      reaction: n.kind === 'ANCHOR' || n.kind === 'TERMINAL' ? resultant : undefined,
      includedAngle,
      criticalAngle,
      utilisation,
      working,
      status,
    };
  });

  return { segments, nodes: nodesOut, warnings, haulForce };
}

/** Convenience: maximum resultant across all nodes. */
export function maxNodeForce(res: SolveResult): number {
  return res.nodes.reduce((m, n) => Math.max(m, n.resultant), 0);
}
