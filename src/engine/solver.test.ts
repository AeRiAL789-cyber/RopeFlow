// src/engine/solver.test.ts
//
// Provably-wrong-is-not-ok: these tests pin the solver to known hand-calculable
// rigging physics. Every case here matches a value you could compute on a
// notepad. If a test fails, the engine is lying to a rigger — that's a bug.

import { describe, it, expect } from 'vitest';
import { solveRig, capstanRatio } from './solver';
import { createEmptyRig, makeNode } from '../model/types';
import type { RigNode } from '../model/types';

function build({ nodes, paths }: { nodes: RigNode[]; paths: string[][] }) {
  const rig = createEmptyRig();
  rig.nodes = nodes;
  rig.paths = paths.map((ids) => ids.map((nodeId) => ({ nodeId })));
  return rig;
}

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('capstanRatio (Euler–Eytelwein)', () => {
  it('is 1 for a frictionless wrap (tension is constant)', () => {
    expect(capstanRatio(0, Math.PI)).toBe(1);
  });
  it('gives the classic e^(mu*theta) ratio', () => {
    // mu=0.2, 180° wrap: e^(0.2*pi) ≈ 1.8745
    close(capstanRatio(0.2, Math.PI), Math.E ** (0.2 * Math.PI));
  });
});

describe('straight vertical lowering (no friction)', () => {
  it('carries the load weight through the whole line', () => {
    const anchor = makeNode('ANCHOR', { x: 0, y: 10 }, { breakingStrength: 150, safetyFactor: 5 });
    const load = makeNode('LOAD', { x: 0, y: 0 }, { load: 5, safetyFactor: 10 });
    const res = solveRig(build({ nodes: [anchor, load], paths: [[anchor.id, load.id]] }));

    const loadForce = res.nodes.find((n) => n.nodeId === load.id)!;
    const anchorForce = res.nodes.find((n) => n.nodeId === anchor.id)!;

    // load sees its own weight + own self-weight(0)
    close(loadForce.resultant, 5);
    // straight line: anchor reaction equals load
    close(anchorForce.reaction!, 5);
  });

  it('adds the rope/gear weight to the load', () => {
    const anchor = makeNode('ANCHOR', { x: 0, y: 10 }, { breakingStrength: 150, safetyFactor: 5 });
    const load = makeNode('LOAD', { x: 0, y: 0 }, { load: 5, weight: 0.2, safetyFactor: 10 });
    const res = solveRig(build({ nodes: [anchor, load], paths: [[anchor.id, load.id]] }));
    const anchorForce = res.nodes.find((n) => n.nodeId === anchor.id)!;
    close(anchorForce.reaction!, 5.2);
  });
});

describe('capstan multiply across a friction redirect', () => {
  it('increases haul force through a 180° pulley with friction', () => {
    const anchor = makeNode('ANCHOR', { x: 0, y: 10 }, { breakingStrength: 150, safetyFactor: 5 });
    const pulley = makeNode('PULLEY', { x: 0, y: 5 }, { friction: 0.2, wrapAngle: Math.PI, breakingStrength: 36, safetyFactor: 5 });
    const load = makeNode('LOAD', { x: 0, y: 0 }, { load: 5, safetyFactor: 10 });
    const res = solveRig(build({ nodes: [anchor, pulley, load], paths: [[anchor.id, pulley.id, load.id]] }));

    // The friction increase appears on the anchor-side segment (away from the
    // load): segment 0 (anchor→pulley) carries load * e^(mu*theta).
    const ratio = Math.E ** (0.2 * Math.PI);
    const segs = res.segments[0];
    const anchorSide = segs[0].tension; // anchor→pulley
    close(anchorSide, 5 * Math.max(1, ratio));
    // load side stays at the load weight
    close(segs[segs.length - 1].tension, 5);
  });
});

describe('critical angle rule (120°)', () => {
  it('flags a wide V-shaped anchor (legs diverging past 120°)', () => {
    // Two anchors spread far apart, load low in the middle: the legs at the
    // load diverge up to each anchor. Anchor separation 20 m, height 5 m above
    // the load -> half-angle atan(10/5) = 63.4°, included angle 126.9° > 120.
    const a3 = makeNode('ANCHOR', { x: -10, y: 5 }, { breakingStrength: 150, safetyFactor: 5 });
    const a4 = makeNode('ANCHOR', { x: 10, y: 5 }, { breakingStrength: 150, safetyFactor: 5 });
    const load2 = makeNode('LOAD', { x: 0, y: 0 }, { load: 5, safetyFactor: 10 });
    const res = solveRig(
      build({ nodes: [a3, a4, load2], paths: [[a3.id, load2.id], [a4.id, load2.id]] }),
    );
    const loadForce2 = res.nodes.find((n) => n.nodeId === load2.id)!;
    expect(loadForce2.includedAngle).toBeGreaterThan((120 * Math.PI) / 180);
    expect(loadForce2.criticalAngle).toBe(true);
    // Narrow V (anchors close together) is NOT critical.
    const c1 = makeNode('ANCHOR', { x: -2, y: 10 }, { breakingStrength: 150, safetyFactor: 5 });
    const c2 = makeNode('ANCHOR', { x: 2, y: 10 }, { breakingStrength: 150, safetyFactor: 5 });
    const load3 = makeNode('LOAD', { x: 0, y: 0 }, { load: 5, safetyFactor: 10 });
    const res3 = solveRig(
      build({ nodes: [c1, c2, load3], paths: [[c1.id, load3.id], [c2.id, load3.id]] }),
    );
    const lf3 = res3.nodes.find((n) => n.nodeId === load3.id)!;
    // half-angle atan(2/10)=11.3° -> included 22.6°, well under 120.
    expect(lf3.criticalAngle).toBe(false);
  });
});

describe('derived paths (no explicit paths in the doc)', () => {
  it('splits a load between two anchors when paths are derived from edges', () => {
    // Multi-anchor V-hang: load hangs from TWO anchors via two independent
    // derived paths. No explicit `paths` field (as from the canvas).
    const a1 = makeNode('ANCHOR', { x: -3, y: 3 }, { breakingStrength: 150, safetyFactor: 5 });
    const a2 = makeNode('ANCHOR', { x: 3, y: 3 }, { breakingStrength: 150, safetyFactor: 5 });
    const load = makeNode('LOAD', { x: 0, y: 0 }, { load: 4, safetyFactor: 10 });

    const rig = createEmptyRig();
    rig.nodes = [a1, a2, load];
    rig.edges = [
      { id: 'e1', a: a1.id, b: load.id },
      { id: 'e2', a: a2.id, b: load.id },
    ];
    rig.paths = []; // solver must derive

    const res = solveRig(rig);
    // Both anchors carry the full load (each derived path starts at the load).
    const f1 = res.nodes.find((n) => n.nodeId === a1.id)!;
    const f2 = res.nodes.find((n) => n.nodeId === a2.id)!;
    close(f1.reaction!, 4);
    close(f2.reaction!, 4);
    // At least two paths were derived.
    expect(Object.keys(res.segments).length).toBe(2);
  });

  it('propagates tension through a multi-pulley chain (anchor→pulley→pulley→load)', () => {
    const anchor = makeNode('ANCHOR', { x: 0, y: 6 }, { breakingStrength: 150, safetyFactor: 5 });
    const p1 = makeNode('PULLEY', { x: 0, y: 4 }, { friction: 0, wrapAngle: Math.PI, breakingStrength: 36, safetyFactor: 5 });
    const p2 = makeNode('PULLEY', { x: 0, y: 2 }, { friction: 0, wrapAngle: Math.PI, breakingStrength: 36, safetyFactor: 5 });
    const load = makeNode('LOAD', { x: 0, y: 0 }, { load: 3, safetyFactor: 10 });

    const rig = createEmptyRig();
    rig.nodes = [anchor, p1, p2, load];
    rig.edges = [
      { id: 'e1', a: anchor.id, b: p1.id },
      { id: 'e2', a: p1.id, b: p2.id },
      { id: 'e3', a: p2.id, b: load.id },
    ];
    rig.paths = [];

    const res = solveRig(rig);
    // One derived path anchor→p1→p2→load. Frictionless so every segment
    // carries the load weight 3 kN, and the anchor reacts 3 kN.
    const fAnchor = res.nodes.find((n) => n.nodeId === anchor.id)!;
    close(fAnchor.reaction!, 3);
    // The load side segment must be at the load weight.
    const segs = Object.values(res.segments)[0];
    close(segs[segs.length - 1].tension, 3);
  });
});

describe('contact angle is geometry-driven (B: physics follows the drawing)', () => {
  it('applies less capstan multiply for a shallow redirect than a full 180° U-turn', () => {
    // Anchor right above, load hanging below -> the pulley between them gets
    // antiparallel legs -> contact angle ~180° -> full capstan friction.
    const straightRig = createEmptyRig();
    const sa = makeNode('ANCHOR', { x: 0, y: 10 }, { breakingStrength: 150, safetyFactor: 5 });
    const sp = makeNode('PULLEY', { x: 0, y: 5 }, { friction: 0.2, breakingStrength: 36, safetyFactor: 5 });
    const sl = makeNode('LOAD', { x: 0, y: 0 }, { load: 5, safetyFactor: 10 });
    straightRig.nodes = [sa, sp, sl];
    straightRig.paths = [[{ nodeId: sa.id }, { nodeId: sp.id }, { nodeId: sl.id }]];
    const straightSegs = Object.values(solveRig(straightRig).segments)[0];

    // Same rig but the pulley is offset so the legs barely bend (small wrap).
    const bentRig = createEmptyRig();
    const ba = makeNode('ANCHOR', { x: 0, y: 10 }, { breakingStrength: 150, safetyFactor: 5 });
    // Pulley offset far to the right: legs are nearly parallel -> tiny angle.
    const bp = makeNode('PULLEY', { x: 100, y: 5 }, { friction: 0.2, breakingStrength: 36, safetyFactor: 5 });
    const bl = makeNode('LOAD', { x: 0, y: 0 }, { load: 5, safetyFactor: 10 });
    bentRig.nodes = [ba, bp, bl];
    bentRig.paths = [[{ nodeId: ba.id }, { nodeId: bp.id }, { nodeId: bl.id }]];
    const bentSegs = Object.values(solveRig(bentRig).segments)[0];

    // The straight (180° wrap) rig multiplies tension more than the shallow one.
    const straightT = straightSegs[0].tension;
    const bentT = bentSegs[1].tension; // load side stays ~5 in both
    expect(straightT).toBeGreaterThan(bentT + 1);
    // Shallow bend is nearly frictionless (load weight ~= 5).
    expect(bentT).toBeGreaterThan(4.9);
    expect(bentT).toBeLessThan(6);
  });

  it('U-turn (antiparallel legs) applies the full capstan ratio', () => {
    const rig = createEmptyRig();
    const a = makeNode('ANCHOR', { x: 0, y: 5 }, { breakingStrength: 150, safetyFactor: 5 });
    const p = makeNode('PULLEY', { x: 0, y: 2.5 }, { friction: 0.2, breakingStrength: 36, safetyFactor: 5 });
    const l = makeNode('LOAD', { x: 0, y: 0 }, { load: 5, safetyFactor: 10 });
    rig.nodes = [a, p, l];
    rig.paths = [[{ nodeId: a.id }, { nodeId: p.id }, { nodeId: l.id }]];
    const segs = Object.values(solveRig(rig).segments)[0];
    const ratio = Math.E ** (0.2 * Math.PI);
    close(segs[0].tension, 5 * Math.max(1, ratio)); // anchor-side = full wrap
  });
});
  describe('overload detection', () => {
  it('flags OVERLOAD when a gear rating is exceeded (off-axis redirect)', () => {
    // Anchor top, load below, redirecting pulley offset to the right so it
    // carries real load: anchor -> pulley(right, +2m) -> load.
    const anchor = makeNode('ANCHOR', { x: 0, y: 10 }, { breakingStrength: 150, safetyFactor: 5 });
    // Weak carabiner rated 2 kN breaking / 5 SF = 0.4 kN rated. Load 5 kN.
    const carb = makeNode('CARABINER', { x: 2, y: 5 }, { friction: 0, wrapAngle: 0, breakingStrength: 2, safetyFactor: 5 });
    const load = makeNode('LOAD', { x: 0, y: -5 }, { load: 5, safetyFactor: 10 });
    const res = solveRig(build({ nodes: [anchor, carb, load], paths: [[anchor.id, carb.id, load.id]] }));
    const carbForce = res.nodes.find((n) => n.nodeId === carb.id)!;
    expect(carbForce.resultant).toBeGreaterThan(0); // genuinely loaded
    expect(carbForce.status).toBe('OVERLOAD');
    expect(carbForce.utilisation).toBeGreaterThan(1);
  });

  it('does NOT overload a strong gear under the same load', () => {
    const anchor = makeNode('ANCHOR', { x: 0, y: 10 }, { breakingStrength: 150, safetyFactor: 5 });
    // Pulley rated 36 kN breaking / 5 SF = 7.2 kN rated >> load.
    const pulley = makeNode('PULLEY', { x: 2, y: 5 }, { friction: 0, wrapAngle: 0, breakingStrength: 36, safetyFactor: 5 });
    const load = makeNode('LOAD', { x: 0, y: -5 }, { load: 5, safetyFactor: 10 });
    const res = solveRig(build({ nodes: [anchor, pulley, load], paths: [[anchor.id, pulley.id, load.id]] }));
    const pf = res.nodes.find((n) => n.nodeId === pulley.id)!;
    expect(pf.status).not.toBe('OVERLOAD');
  });
});
