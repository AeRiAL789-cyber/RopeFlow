// src/gear/catalog.ts
//
// Starter gear catalog. **Basis for the Gear Builder → a differentiator.** Each
// entry is the data model for a component: ratings, friction, and how ropes
// connect. Real-world values are indicative and must be verified against the
// manufacturer's published ratings before use on a live job (labelling unsafe
// assumptions, not hard engineering data).

import type { NodeKind, NodeSpec } from '../model/types';

export interface GearTemplate {
  id: string;
  name: string;
  kind: NodeKind;
  spec: NodeSpec;
  /** Short note for the gear panel. */
  note?: string;
}

export const DEFAULT_SAFETY_FACTOR = 5;

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
