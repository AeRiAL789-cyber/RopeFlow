// src/state/rigStore.ts
//
// Zustand store for the rig document. Holds the graph model, the live solve
// result, and the tool/draft state for the canvas. Mirror of CADFlow's store
// discipline (typed, single source of truth) but for a force-carrying graph.

import { create } from 'zustand';
import type { RigDocument, Point2, NodeKind, RigEdge, NodeSpec } from '../model/types';
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
  /** Selected NODE id (edges use selectedEdge). */
  selection: string | null;
  /** Selected CONNECTOR (rope) id. */
  selectedEdge: string | null;
  /** Node currently being dragged. */
  grabNodeId: string | null;
  /** First node chosen in CONNECT mode (roped to the second click). */
  connectFrom: string | null;
  result: SolveResult | null;

  // ---- undo / redo history ring (industry-standard multi-step) ----
  past: string[];
  future: string[];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // ---- saved scenes (rig/rescue plan milestones) ----
  scenes: SavedScene[];
  saveScene: (name: string) => void;
  loadScene: (id: string) => void;
  deleteScene: (id: string) => void;
  reset: () => void;

  setTool: (t: Tool) => void;
  select: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  /** Edit a node's spec + optional label. */
  updateNode: (id: string, patch: Partial<NodeSpec>, label?: string) => void;
  /** Recolour a connector (rope). */
  setEdgeColor: (id: string, color: string) => void;
  placeNode: (kind: NodeKind, pos: Point2, label?: string) => void;
  /** Insert a redirect node into an existing rope, splitting edge a→b into a→n, n→b. */
  spliceIntoEdge: (edgeId: string, kind: NodeKind, pos: Point2, label?: string) => void;
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
  /** Internal: re-run the solve without recording history. */
  recalc: () => void;
  moveNodeAndSolve: (id: string, pos: Point2) => void;
}

export interface SavedScene {
  id: string;
  name: string;
  /** ISO timestamp — the milestone marker. */
  at: string;
  doc: RigDocument;
}

const HISTORY_MAX = 100;
const SCENES_KEY = 'ropelflow.scenes';

function loadScenesFromDisk(): SavedScene[] {
  try {
    const raw = localStorage.getItem(SCENES_KEY);
    return raw ? (JSON.parse(raw) as SavedScene[]) : [];
  } catch {
    return [];
  }
}
function persistScenes(scenes: SavedScene[]) {
  try { localStorage.setItem(SCENES_KEY, JSON.stringify(scenes)); } catch { /* ignore */ }
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

export const useRigStore = create<RigState>((set, get) => {
  // Snapshot the CURRENT document onto the undo stack before a mutation runs.
  // Called at the head of every committing action; clears the redo stack.
  const recordHistory = () => {
    const s = get();
    set({ past: [...s.past, JSON.stringify(s.doc)].slice(-HISTORY_MAX), future: [], canUndo: true, canRedo: false });
  };

  return {
    doc: createEmptyRig(),
    tool: 'SELECT',
    selection: null,
    selectedEdge: null,
    grabNodeId: null,
    connectFrom: null,
    result: null,
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,
    scenes: loadScenesFromDisk(),

    setTool: (tool) => set({ tool, connectFrom: null }),

    select: (selection) => set({ selection, selectedEdge: null }),
    selectEdge: (id) => set({ selectedEdge: id, selection: null }),
    clearSelection: () => set({ selection: null, selectedEdge: null }),
    // Snapshot once when a drag STARTS (grabNodeId goes null → value) so the
    // whole drag is a single undo step, not one per pointer-move frame.
    setGrabNode: (grabNodeId) => {
      if (grabNodeId && !get().grabNodeId) {
        const s = get();
        set({ past: [...s.past, JSON.stringify(s.doc)].slice(-HISTORY_MAX), future: [], canUndo: true, canRedo: false, grabNodeId });
      } else {
        set({ grabNodeId });
      }
    },

    undo: () => {
      set((s) => {
        if (!s.past.length) return {};
        const prev = s.past[s.past.length - 1];
        return {
          doc: JSON.parse(prev) as RigDocument,
          past: s.past.slice(0, -1),
          future: [JSON.stringify(s.doc), ...s.future].slice(0, HISTORY_MAX),
          canUndo: s.past.length - 1 > 0,
          canRedo: true,
          selection: null,
          selectedEdge: null,
          connectFrom: null,
        };
      });
      get().recalc();
    },

    redo: () => {
      set((s) => {
        if (!s.future.length) return {};
        const next = s.future[0];
        return {
          doc: JSON.parse(next) as RigDocument,
          future: s.future.slice(1),
          past: [...s.past, JSON.stringify(s.doc)].slice(-HISTORY_MAX),
          canRedo: s.future.length - 1 > 0,
          canUndo: true,
          selection: null,
          selectedEdge: null,
          connectFrom: null,
        };
      });
      get().recalc();
    },

    // Refresh the solve whenever the document changes.
    recalc: () => { try { set({ result: solveRig(get().doc) }); } catch { /* keep old */ } },

    updateNode: (id, patch, label) => {
      recordHistory();
      set((s) => ({
        doc: {
          ...s.doc,
          nodes: s.doc.nodes.map((n) =>
            n.id === id
              ? { ...n, spec: { ...n.spec, ...patch }, label: label ?? n.label }
              : n),
        },
      }));
      get().recalc();
    },

    setEdgeColor: (id, color) => {
      recordHistory();
      set((s) => ({
        doc: {
          ...s.doc,
          edges: s.doc.edges.map((e) => (e.id === id ? { ...e, color } : e)),
        },
      }));
    },

    beginConnect: (id) => set({ connectFrom: id, selection: id, selectedEdge: null, tool: 'CONNECT' }),

    placeNode: (kind, pos, label) => {
      recordHistory();
      const n = makeNode(kind, pos, makeDefaultSpec(kind), label ?? kind.toUpperCase());
      set((s) => ({
        doc: { ...s.doc, nodes: [...s.doc.nodes, n] },
        selection: n.id,
        // Stay in the current ADD tool so several of the same kind can be
        // dropped in a row (e.g. multiple pulleys). Switch by picking a
        // different tool or SELECT.
      }));
      get().recalc();
    },

    spliceIntoEdge: (edgeId, kind, pos, label) => {
      const s = get();
      const edge = s.doc.edges.find((e) => e.id === edgeId);
      if (!edge) return;
      recordHistory();
      const n = makeNode(kind, pos, makeDefaultSpec(kind), label ?? kind.toUpperCase());
      // Replace the original single edge with two: a→n and n→b. The new redirect
      // now has a rope in (a→n) and a rope out (n→b), as a passthrough device.
      const edges = s.doc.edges
        .filter((e) => e.id !== edgeId)
        .concat([
          { id: genId('e'), a: edge.a, b: n.id },
          { id: genId('e'), a: n.id, b: edge.b },
        ]);
      set({
        doc: { ...s.doc, nodes: [...s.doc.nodes, n], edges },
        selection: n.id,
        tool: 'SELECT',
        connectFrom: null,
      });
      get().recalc();
    },

    // moveNode is called every frame during a drag — do NOT snapshot per frame.
    // Undo captures the pre-drag state once in moveNodeAndSolve... but the store
    // has no drag-start hook; so we snapshot on setGrabNode when a drag begins.
    moveNode: (id, pos) =>
      set((s) => ({
        doc: {
          ...s.doc,
          nodes: s.doc.nodes.map((n) => (n.id === id ? { ...n, position: pos } : n)),
        },
      })),

    moveNodeAndSolve: (id, pos) => {
      get().moveNode(id, pos);
      get().recalc();
    },

    addEdge: (a, b) => {
      recordHistory();
      set((s) => {
        if (a === b) return s;
        const already = s.doc.edges.some(
          (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a),
        );
        if (already) return s;
        return { doc: { ...s.doc, edges: [...s.doc.edges, { id: genId('e'), a, b }] } };
      });
    },

    connectNodes: (b) => {
      const from = get().connectFrom;
      if (!from || from === b) {
        set({ connectFrom: null, tool: 'SELECT' });
        return;
      }
      get().addEdge(from, b);
      set({ connectFrom: null, tool: 'SELECT', selection: b });
      get().recalc();
    },

    deleteSelected: () => {
      const s = get();
      const sel = s.selection || s.selectedEdge;
      if (!sel) return;
      recordHistory();
      set({
        doc: {
          ...s.doc,
          nodes: s.doc.nodes.filter((n) => n.id !== sel),
          edges: s.doc.edges.filter((e) => e.id !== sel && e.a !== sel && e.b !== sel),
        },
        selection: null,
        selectedEdge: null,
        connectFrom: null,
      });
      get().recalc();
    },

    recompute: () => get().recalc(),

    saveScene: (name) => {
      const scene: SavedScene = {
        id: genId('sc'),
        name: name || `Milestone ${get().scenes.length + 1}`,
        at: new Date().toISOString(),
        doc: JSON.parse(JSON.stringify(get().doc)) as RigDocument,
      };
      const scenes = [scene, ...get().scenes];
      persistScenes(scenes);
      set({ scenes });
    },

    loadScene: (id) => {
      const scene = get().scenes.find((sc) => sc.id === id);
      if (!scene) return;
      recordHistory();
      set({
        doc: JSON.parse(JSON.stringify(scene.doc)) as RigDocument,
        selection: null, selectedEdge: null, connectFrom: null,
      });
      get().recalc();
    },

    deleteScene: (id) => {
      const scenes = get().scenes.filter((sc) => sc.id !== id);
      persistScenes(scenes);
      set({ scenes });
    },

    reset: () => {
      recordHistory();
      set({ doc: createEmptyRig(), selection: null, selectedEdge: null, connectFrom: null });
      get().recalc();
    },

    loadDemo: () => {
      recordHistory();
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
        { id: genId('e'), a: anchor1.id, b: edge.id, color: '#58a6ff' },
        { id: genId('e'), a: edge.id, b: load.id, color: '#58a6ff' },
        { id: genId('e'), a: anchor2.id, b: load.id, color: '#3fb950' },
        { id: genId('e'), a: edge.id, b: belay.id, color: '#d29922' },
      ];
      set({
        doc: { version: '0.1', units: 'kN', nodes: n, edges, paths: [] },
        selection: load.id,
        selectedEdge: null,
        tool: 'SELECT',
        connectFrom: null,
      });
      get().recalc();
    },
  };
});
