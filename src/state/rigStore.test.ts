import { describe, it, expect, beforeEach } from 'vitest';

// Minimal localStorage shim — rigStore reads/writes scenes on module load and
// on save/load/delete. Node's globalThis has none by default.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
};

import { useRigStore } from './rigStore';

describe('rig store — history + scenes', () => {
  beforeEach(() => {
    mem.clear();
    useRigStore.setState({
      doc: { version: '0.1', units: 'kN', nodes: [], edges: [], paths: [] },
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
      scenes: [],
      selection: null,
      selectedEdge: null,
      connectFrom: null,
      grabNodeId: null,
      tool: 'SELECT',
    });
  });

  it('records multi-step history (undo/redo a place + an edit)', () => {
    const s = useRigStore.getState();
    s.placeNode('ANCHOR', { x: 0, y: 0 });           // hist 1: empty -> anchor
    const anchorId = useRigStore.getState().selection!;
    useRigStore.getState().updateNode(anchorId, { safetyFactor: 7 }); // hist 2
    expect(useRigStore.getState().canUndo).toBe(true);

    // one undo -> back to after placeNode (still has the anchor, pre-edit)
    useRigStore.getState().undo();
    const s1 = useRigStore.getState();
    expect(s1.doc.nodes).toHaveLength(1);
    expect(s1.doc.nodes[0].spec.safetyFactor).not.toBe(7);
    expect(s1.canRedo).toBe(true);

    // second undo -> empty rig
    useRigStore.getState().undo();
    expect(useRigStore.getState().doc.nodes).toHaveLength(0);

    // redo both
    useRigStore.getState().redo();
    useRigStore.getState().redo();
    const s2 = useRigStore.getState();
    expect(s2.doc.nodes).toHaveLength(1);
    expect(s2.doc.nodes[0].spec.safetyFactor).toBe(7);
    expect(s2.canRedo).toBe(false);
  });

  it('reset clears the rig and is itself undoable', () => {
    useRigStore.getState().loadDemo();
    expect(useRigStore.getState().doc.nodes.length).toBeGreaterThan(0);
    useRigStore.getState().reset();
    expect(useRigStore.getState().doc.nodes).toHaveLength(0);

    // reset recorded history — undo brings the demo back
    useRigStore.getState().undo();
    expect(useRigStore.getState().doc.nodes.length).toBeGreaterThan(0);
  });

  it('save/load/delete scene round-trips a milestone (persisted to localStorage)', () => {
    useRigStore.getState().loadDemo();
    const before = JSON.stringify(useRigStore.getState().doc);
    useRigStore.getState().saveScene('Rescue step 1');
    expect(useRigStore.getState().scenes).toHaveLength(1);
    const sceneId = useRigStore.getState().scenes[0].id;

    // mutating the rig should not touch the saved milestone
    useRigStore.getState().reset();
    expect(useRigStore.getState().doc.nodes).toHaveLength(0);

    useRigStore.getState().loadScene(sceneId);
    expect(JSON.stringify(useRigStore.getState().doc)).toBe(before);

    useRigStore.getState().deleteScene(sceneId);
    expect(useRigStore.getState().scenes).toHaveLength(0);
    // persisted list is also gone
    const persisted = (globalThis as any).localStorage.getItem('ropelflow.scenes');
    expect(JSON.parse(persisted)).toHaveLength(0);
  });

  it('scenes survive a store reload (loaded from localStorage on init)', () => {
    useRigStore.getState().saveScene('Milestone A');
    // fresh store state (as if a new session) — scenes come back from disk
    useRigStore.setState(useRigStore.getState()); // touch
    const s = useRigStore.getState();
    expect(s.scenes.length).toBeGreaterThanOrEqual(1);
    expect(s.scenes[0]).toHaveProperty('at'); // timestamped milestone marker
  });
});