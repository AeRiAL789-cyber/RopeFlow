// src/state/rigStore.ts
//
// Zustand store for the rig document. Holds the graph model, the live solve
// result, and the tool/draft state for the canvas. Mirror of CADFlow's store
// discipline (typed, single source of truth) but for a force-carrying graph.

import { create } from 'zustand';
import type { RigDocument, Point2, NodeKind, RigEdge } from '../model/types';
import { createEmptyRig, genId, makeNode } from '../model/types';
import { solveRig, type SolveResult } from '../engine/solver';
import { DEFAULT_SAFETY_FACTOR } from '../gear/catalog';

export type Tool =
  | 'SELECT'
  | 'ADD_ANCHOR'
  | 'ADD_PULLEY'
  | 'ADD_CARABINER'
  | 'ADD_BELAY'
  | 'ADD_LOAD'
  | 'ADD_EDGE'
  | 'CONNECT';

interface RigState {
  doc: RigDocument;
  tool: Tool;
  selection: string | null;
  /** Node currently being dragged. */
  grabNodeId: string | null;
  /** First node chosen in CONNECT mode (roped to the second click). */
  connectFrom: string | null;
  result: SolveResult | null;

  setTool: (t: Tool) => void;
  select: (id: string | null) => void;
  placeNode: (kind: NodeKind, pos: Point2, label?: string) => void;
  moveNode: (id: string, pos: Point2) => void;
  setGrabNode: (id: string | null) => void;
  /** CONNECT-mode: set the first endpoint. */
  beginConnect: (id: string) => void;
  /** CONNECT-mode: rope connectFrom -> b (or b -> connectFrom). */
  connectNodes: (b: string) => void;
  deleteSelected: () => void;
  addEdge: (a: string, b: string) => void;
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
  connectFrom: null,
  result: null,

  setTool: (tool) => set({ tool, connectFrom: null }),

  select: (selection) => set({ selection }),
  clearSelection: () => set({ selection: null }),
  setGrabNode: (grabNodeId) => set({ grabNodeId }),

  beginConnect: (id) => set({ connectFrom: id, selection: id, tool: 'CONNECT' }),

  placeNode: (kind, pos, label) => {
    const n = makeNode(kind, pos, makeDefaultSpec(kind), label ?? kind.toUpperCase());
    set((s) => ({
      doc: { ...s.doc, nodes: [...s.doc.nodes, n] },
      selection: n.id,
      // Stay in the current ADD tool so several of the same kind can be
      // dropped in a row (e.g. multiple pulleys). Switch by picking a
      // different tool or SELECT.
    }));
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

  addEdge: (a, b) =>
    set((s) => {
      if (a === b) return s;
      const already = s.doc.edges.some(
        (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a),
      );
      if (already) return s;
      return { doc: { ...s.doc, edges: [...s.doc.edges, { id: genId('e'), a, b }] } };
    }),

  connectNodes: (b) => {
    const from = get().connectFrom;
    if (!from || from === b) {
      set({ connectFrom: null, tool: 'SELECT' });
      return;
    }
    get().addEdge(from, b);
    set({ connectFrom: null, tool: 'SELECT', selection: b });
    get().recompute();
  },

  deleteSelected: () =>
    set((s) => {
      const sel = s.selection;
      if (!sel) return s;
      return {
        doc: {
          ...s.doc,
          nodes: s.doc.nodes.filter((n) => n.id !== sel),
          edges: s.doc.edges.filter((e) => e.a !== sel && e.b !== sel),
        },
        selection: null,
        connectFrom: null,
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
    // A lowering rig with TWO anchors to show multi-anchor branching:
    // anchor1 -> edge -> load, and anchor2 -> load (a V-hang), plus a belay leg.
    const anchor1 = makeNode('ANCHOR', { x: -3, y: 2.5 }, makeDefaultSpec('ANCHOR'), 'ANCHOR 1');
    const anchor2 = makeNode('ANCHOR', { x: 3, y: 2.5 }, makeDefaultSpec('ANCHOR'), 'ANCHOR 2');
    const edge = makeNode('EDGE', { x: -1.5, y: 0.5 }, makeDefaultSpec('EDGE'), 'EDGE / BEAM');
    const belay = makeNode('BELAY', { x: 2.5, y: 1 }, makeDefaultSpec('BELAY'), 'BELAY');
    const load = makeNode('LOAD', { x: 0, y: -2.5 }, makeDefaultSpec('LOAD'), 'LOAD');
    const n = [anchor1, anchor2, edge, belay, load];

    // Two anchors share the load: anchor1->edge->load and anchor2->load,
    // plus a control leg to the belay device.
    const edges: RigEdge[] = [
      { id: genId('e'), a: anchor1.id, b: edge.id },
      { id: genId('e'), a: edge.id, b: load.id },
      { id: genId('e'), a: anchor2.id, b: load.id },
      { id: genId('e'), a: edge.id, b: belay.id },
    ];
    set({
      doc: { version: '0.1', units: 'kN', nodes: n, edges, paths: [] },
      selection: load.id,
      tool: 'SELECT',
      connectFrom: null,
    });
    get().recompute();
  },
}));
