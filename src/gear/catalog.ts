// src/gear/catalog.ts
//
// Starter gear catalog. **Basis for the Gear Builder → a differentiator.** Each
// entry is the data model for a component: ratings, friction, and how ropes
// connect. Real-world values are indicative and must be verified against the
// manufacturer's published ratings before use on a live job (labelling unsafe
// assumptions, not hard engineering data).

import type { NodeKind, NodeSpec, KnotTemplate, KnotKind } from '../model/types';

export interface GearTemplate {
  id: string;
  name: string;
  kind: NodeKind;
  spec: NodeSpec;
  /** Short note for the gear panel. */
  note?: string;
}

export const DEFAULT_SAFETY_FACTOR = 5;

/**
 * Knot library. Each knot has an SWL DERATING multiplier applied to the rope's
 * nominal rating → the rope's EFFECTIVE strength. Indicative values — a knot
 * typically reduces rope strength to roughly 60–77% of nominal depending on
 * type; MUST be verified against the rope + knot manufacturer's data before
 * live use (labelled unsafe assumptions, not hard engineering data).
 */
export const KNOT_CATALOG: KnotTemplate[] = [
  { kind: 'FIG8', name: 'Figure-eight', swl: 0.70, placement: 'termination', note: 'Standard end/loop knot.' },
  { kind: 'FIG8_BIGHT', name: 'Figure-eight on a bight', swl: 0.72, placement: 'termination', note: 'Loop knot; slightly stronger.' },
  { kind: 'BARREL', name: 'Barrel knot', swl: 0.60, placement: 'termination', note: 'End knot; heavy derating.' },
  { kind: 'BOWLINE', name: 'Bowline', swl: 0.65, placement: 'both', note: 'Loop knot; watch torque under load.' },
  { kind: 'CLOVE', name: 'Clove hitch', swl: 0.60, placement: 'termination', note: 'Attach to a spar/object.' },
  { kind: 'BUTTERFLY', name: 'Alpine butterfly', swl: 0.75, placement: 'inline', note: 'In-line midline knot.' },
  { kind: 'PRUSIK', name: 'Prusik', swl: 0.65, friction: 0.25, placement: 'inline', note: 'Friction hitch — grips under load.' },
  { kind: 'MUNTER', name: 'Münter hitch', swl: 0.65, friction: 0.40, placement: 'inline', note: 'Friction hitch / belay knot.' },
  { kind: 'OVERHAND', name: 'Overhand / stopper', swl: 0.60, placement: 'both', note: 'Stopper knot.' },
];

export function knotById(kind: KnotKind): KnotTemplate | undefined {
  return KNOT_CATALOG.find((k) => k.kind === kind);
}

/** Worst (lowest) SWL derating across a set of knots on a rope — the weakest knot governs. */
export function worstKnotDerate(knots: readonly KnotKind[]): number {
  if (!knots.length) return 1;
  return knots.reduce((worst, k) => {
    const t = knotById(k);
    return Math.min(worst, t?.swl ?? 1);
  }, 1);
}

export const GEAR_CATALOG: GearTemplate[] = [
  {
    id: 'anchor-ota',
    name: 'Anchor (Qty 5 load path)',
    kind: 'ANCHOR',
    spec: { breakingStrength: 150, safetyFactor: 5 },
    note: 'Generic structural anchor. DERIVE rating from actual anchor.',
  },
  {
    id: 'pulley-petzl',
    name: 'Pulley (low friction)',
    kind: 'PULLEY',
    spec: { friction: 0.06, wrapAngle: Math.PI, breakingStrength: 36, safetyFactor: 5 },
    note: 'Rolling pulley, ~6% friction at 180° wrap.',
  },
  {
    id: 'carabiner-hel',
    name: 'Carabiner / redirect',
    kind: 'CARABINER',
    spec: { friction: 0.2, wrapAngle: Math.PI, breakingStrength: 25, safetyFactor: 5 },
    note: 'Rope friction higher than a pulley.',
  },
  {
    id: 'belay-reverso',
    name: 'Belay / descender device',
    kind: 'BELAY',
    spec: { friction: 0.5, wrapAngle: (200 * Math.PI) / 180, breakingStrength: 20, safetyFactor: 5 },
    note: 'Multi-wrap device: significant friction / MA.',
  },
  {
    id: 'load-person',
    name: 'Load — person (rescue)',
    kind: 'LOAD',
    spec: { load: 1.2, safetyFactor: 10 },
    note: '120 kg including kit; rescue safety factor 10:1.',
  },
  {
    id: 'load-equipment',
    name: 'Load — equipment',
    kind: 'LOAD',
    spec: { load: 0.5, safetyFactor: 5 },
    note: '500 kg equipment bag; rigging SF 5:1.',
  },
  {
    id: 'edge-ibeam',
    name: 'Edge / I-beam wrap',
    kind: 'EDGE',
    spec: { friction: 0.25, wrapAngle: Math.PI / 2, breakingStrength: 150, safetyFactor: 5 },
    note: 'Rope over a structural edge. Capstan friction applies.',
  },
];

export function gearById(id: string): GearTemplate | undefined {
  return GEAR_CATALOG.find((g) => g.id === id);
}
