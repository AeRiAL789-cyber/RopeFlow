// src/state/rigStore.ts
//
// Zustand store for the rig document. Holds the graph model, the live solve
// result, and the tool/draft state for the canvas. Mirror of CADFlow's store
// discipline (typed, single source of truth) but for a force-carrying graph.

import { create } from 'zustand';
import type { RigDocument, RigNode, Point2, NodeKind, RigEdge } from '../model/types';
import { createEmptyRig, genId, makeNode } from '../model/types';
import { solveRig, type SolveResult } from '../engine/solver';
import { DEFAULT_SAFETY_FACTOR } from '../gear/catalog';

export type Tool = 'SELECT' | 'ADD_ANCHOR' | 'ADD_PULLEY' | 'ADD_CARABINER' | 'ADD_BELAY' | 'ADD_LOAD' | 'ADD_EDGE';

interface RigState {
  doc: RigDocument;
  tool: Tool;
  selection: string | null;
  /** Node currently being dragged. */
  grabNodeId: string | null;
  /** Last connected node id (for auto-wire on placement). */
  lastNodeId: string | null;
  result: SolveResult | null;

  setTool: (t: Tool) => void;
  select: (id: string | null) => void;
  placeNode: (kind: NodeKind, pos: Point2, label?: string) => void;
  addNode: (n: RigNode) => void;
  moveNode: (id: string, pos: Point2) => void;
  setGrabNode: (id: string | null) => void;
  rewire: (a: string, b: string) => void;
  clearSelection: () => void;
  loadDemo: () => void;
  recompute: () => void;
  moveNodeAndSolve: (id: string, pos: Point2) => void;
}

function makeDefaultSpec(kind: NodeKind) {
  switch (kind) {
    case 'PULLEY': return { friction: 0.06, wrapAngle: Math.PI, breakingStrength: 36, safetyFactor: DEFAULT_SAFETY_FACTOR };
    case 'CARABINER': return { friction: 0.2, wrapAngle: Math.PI, breakingStrength: 25, safetyFactor: DEFAULT_SAFETY_FACTOR };
    case 'BELAY': return { friction: 0.5, wrapAngle: (200 * Math.PI) / 180, breakingStrength: 20, safetyFactor: DEFAULT_SAFETY_FACTOR };
    case 'LOAD': return { load: 1.2, safetyFactor: 10 };
    case 'EDGE': return { friction: 0.25, wrapAngle: Math.PI / 2, breakingStrength: 150, safetyFactor: DEFAULT_SAFETY_FACTOR };
    case 'ANCHOR': return { breakingStrength: 150, safetyFactor: DEFAULT_SAFETY_FACTOR };
    default: return { safetyFactor: DEFAULT_SAFETY_FACTOR };
  }
}

export const useRigStore = create<RigState>((set, get) => ({
  doc: createEmptyRig(),
  tool: 'SELECT',
  selection: null,
  grabNodeId: null,
  lastNodeId: null,
  result: null,

  setTool: (tool) => set({ tool }),
  select: (selection) => set({ selection }),
  clearSelection: () => set({ selection: null }),
  setGrabNode: (grabNodeId) => set({ grabNodeId }),

  addNode: (n) =>
    set((s) => ({
      doc: { ...s.doc, nodes: [...s.doc.nodes, n] },
      selection: n.id,
      lastNodeId: n.id,
    })),

  placeNode: (kind, pos, label) => {
    const n = makeNode(kind, pos, makeDefaultSpec(kind), label ?? kind.toUpperCase());
    set((s) => {
      const nodes = [...s.doc.nodes, n];
      let edges = s.doc.edges;
      // Auto-wire the new node to the previously placed node.
      if (s.lastNodeId && s.lastNodeId !== n.id) {
        const edgeId = genId('e');
        edges = [...edges, { id: edgeId, a: s.lastNodeId, b: n.id }];
      }
      return {
        doc: { ...s.doc, nodes, edges },
        selection: n.id,
        lastNodeId: n.id,
        tool: 'SELECT',
      };
    });
    get().recompute();
  },

  moveNode: (id, pos) =>
    set((s) => ({
      doc: {
        ...s.doc,
        nodes: s.doc.nodes.map((n) => (n.id === id ? { ...n, position: pos } : n)),
      },
    })),

  moveNodeAndSolve: (id, pos) => {
    get().moveNode(id, pos);
    get().recompute();
  },

  rewire: (a, b) =>
    set((s) => {
      const already = s.doc.edges.some(
        (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a),
      );
      if (already) return s;
      return {
        doc: { ...s.doc, edges: [...s.doc.edges, { id: genId('e'), a, b }] },
      };
    }),

  recompute: () => {
    try {
      const result = solveRig(get().doc);
      set({ result });
    } catch (err) {
      // Keep old result; do not crash the editor on a bad doc.
      console.error('solve failed', err);
    }
  },

  loadDemo: () => {
    // A simple lowering rig: anchor → edge → pulley redirect → load.
    // Coordinates are in METRES; 1 m = 40 px on screen.
    const anchor = makeNode('ANCHOR', { x: -3, y: 2.5 }, makeDefaultSpec('ANCHOR'), 'MAIN ANCHOR');
    const edge = makeNode('EDGE', { x: -3, y: 0.5 }, makeDefaultSpec('EDGE'), 'EDGE / BEAM');
    const belay = makeNode('BELAY', { x: 2.5, y: 1 }, makeDefaultSpec('BELAY'), 'BELAY');
    const load = makeNode('LOAD', { x: 0, y: -2.5 }, makeDefaultSpec('LOAD'), 'LOAD');
    const n = [anchor, edge, belay, load];

    // Two rope paths: anchor→edge→load (load line) and edge→belay (control line).
    const edges: RigEdge[] = [
      { id: genId('e'), a: anchor.id, b: edge.id },
      { id: genId('e'), a: edge.id, b: load.id },
      { id: genId('e'), a: edge.id, b: belay.id },
    ];
    const paths = [
      [{ nodeId: anchor.id }, { nodeId: edge.id }, { nodeId: load.id }],
    ];
    set({
      doc: { version: '0.1', units: 'kN', nodes: n, edges, paths },
      selection: load.id,
      lastNodeId: load.id,
      tool: 'SELECT',
    });
    get().recompute();
  },
}));
