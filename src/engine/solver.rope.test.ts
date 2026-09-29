import { describe, it, expect } from 'vitest';
import { solveRig } from './solver';
import { makeNode, type RigDocument, type Rope } from '../model/types';
import { knotById, worstKnotDerate, KNOT_CATALOG } from '../gear/catalog';

/** Build a simple ANCHOR→LOAD rig plus an empty rope we attach events to. */
function ropeRig(rating: number) {
  const anchor = makeNode('ANCHOR', { x: 0, y: 0 }, { breakingStrength: 150, safetyFactor: 5 }, 'ANCHOR');
  const load = makeNode('LOAD', { x: 0, y: -10 }, { load: 5, safetyFactor: 5 }, 'LOAD');
  const rope: Rope = {
    id: 'rope1',
    name: 'Main line',
    rating,
    path: [anchor.id, load.id],
    events: [],
  };
  const doc: RigDocument = {
    version: '0.1',
    units: 'kN',
    nodes: [anchor, load],
    edges: [{ id: 'e1', a: anchor.id, b: load.id }],
    paths: [],
    ropes: [rope],
  };
  return { doc, rope, anchorId: anchor.id, loadId: load.id };
}

describe('per-rope analysis — SWL derating, terminations & MA', () => {
  it('has no rope results when the rig has no ropes', () => {
    const { doc } = ropeRig(30);
    delete (doc as any).ropes;
    expect(solveRig(doc).ropes).toEqual([]);
  });

  it('effective strength = rating × worst knot SWL derating (30 kN fig-8 → ~21 kN)', () => {
    const { doc, rope, anchorId } = ropeRig(30);
    rope.events = [{ type: 'terminate', nodeId: anchorId, knot: { kind: 'FIG8' } }];
    const rr = solveRig(doc).ropes[0];
    const fig8 = knotById('FIG8')!;
    expect(rr.nominal).toBe(30);
    expect(rr.effective).toBeCloseTo(30 * fig8.swl, 5);
    expect(rr.effective).toBeCloseTo(21, 5);
    expect(rr.worstKnot).toBe('FIG8');
    // rated = effective / safety factor (5)
    expect(rr.rated).toBeCloseTo(21 / 5, 5);
  });

  it('a rope with a rated rope but rated well above load is OK', () => {
    const { doc } = ropeRig(100);
    const rr = solveRig(doc).ropes[0];
    expect(rr.status).toBe('OK');
    expect(rr.utilisation).toBeLessThan(1);
  });

  it('derating can push a rope into OVERLOAD that would pass without knots', () => {
    // Rope rated 6 kN, two fig-8s → effective 4.2 kN, rated(÷5) 0.84. Load is 5 kN.
    const { doc, rope, anchorId, loadId } = ropeRig(6);
    rope.events = [
      { type: 'terminate', nodeId: anchorId, knot: { kind: 'FIG8' } },
      { type: 'terminate', nodeId: loadId, knot: { kind: 'FIG8' } },
    ];
    // effective = 6×0.70 = 4.2; rated=0.84; peak tension ≈5 → OVERLOAD
    const rr = solveRig(doc).ropes[0];
    expect(rr.status).toBe('OVERLOAD');
    expect(rr.peakTension).toBeCloseTo(5, 5);
  });

  it('worst knot governs: a derating barrel knot beats a higher fig-8', () => {
    // BARREL swl 0.60 < FIG8_BIGHT 0.72 → effective = rating × 0.60
    const { doc, rope, anchorId, loadId } = ropeRig(30);
    rope.events = [
      { type: 'terminate', nodeId: anchorId, knot: { kind: 'FIG8_BIGHT' } },
      { type: 'terminate', nodeId: loadId, knot: { kind: 'BARREL' } },
    ];
    const rr = solveRig(doc).ropes[0];
    expect(rr.worstKnot).toBe('BARREL');
    expect(rr.effective).toBeCloseTo(30 * 0.6, 5); // 18
  });

  it('mechanical advantage divides the required haul force', () => {
    // 2:1 advantage through a pulley → haul force halves.
    const { doc, rope, anchorId } = ropeRig(100);
    rope.events = [{ type: 'run-through', nodeId: anchorId, ma: 2 }];
    const rr = solveRig(doc).ropes[0];
    // peak tension ~5 kN, MA 2 → haul force ~2.5
    expect(rr.haulForce).toBeCloseTo(5 / 2, 2);
  });

  it('knot library has deratings in the expected ballpark (SWL 0.60–0.77)', () => {
    for (const k of KNOT_CATALOG) {
      expect(k.swl).toBeGreaterThanOrEqual(0.6);
      expect(k.swl).toBeLessThanOrEqual(0.77);
      expect(['termination', 'inline', 'both']).toContain(k.placement);
    }
  });

  it('worstKnotDerate returns 1 (no derating) for no knots and the min for many', () => {
    expect(worstKnotDerate([])).toBe(1);
    expect(worstKnotDerate(['FIG8', 'BARREL'])).toBe(knotById('BARREL')!.swl);
    expect(worstKnotDerate(['BUTTERFLY'])).toBe(knotById('BUTTERFLY')!.swl);
  });
});