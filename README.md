# RopeFlow

Web-based rope rigging design, rescue planning, and force calculation.
A web-native successor to desktop rigging tools like vRigger — the sketch
and the force engine share one document model, so what you draw is exactly
what gets solved.

## Status

v0.1 — engine proof-of-concept. The graph model and a planar force solver
are working and unit-tested against hand-calculable rigging physics. A
minimal drag-and-drop canvas shows the "draw it, see the forces" core loop.

## Architecture

The design philosophy: **a rig is a force-carrying graph, not geometry.**
CADFlow-style geometric entities don't model "this rope carries 12 kN" —
RopeFlow's model does.

- `src/model/types.ts` — the graph document model: `RigNode` (anchors,
  pulleys, carabiners, belay devices, loads, edges) + `RigEdge` (ropes).
  This model feeds BOTH the renderer and the solver.
- `src/engine/solver.ts` — path-tension propagation with the Euler–Eytelwein
  capstan equation (friction at pulleys/belays/edges), mechanical advantage,
  the 120° critical-angle rule, and per-gear safety-factor overload checks.
  Units are kN. Angles in radians.
- `src/gear/catalog.ts` — starter gear catalogue, and the foundation for the
  Gear Builder (add your own gear: image, weight, breaking strength, friction).
- `src/state/rigStore.ts` — Zustand store (the live solve re-runs on every
  drag / structural change).
- `src/main.ts` + `index.html` — the minimal live canvas harness.

## Physics correctness

Unit tests in `src/engine/solver.test.ts` pin the solver to known physics:

- Capstan ratio `T2/T1 = e^(µθ)` for friction wraps (Euler–Eytelwein).
- Straight lowering: tension = load weight throughout; gear weight adds on.
- Friction redirect raises the haul/tight-side tension by the capstan ratio.
- Included-angle detection flags the 120° critical-angle rule.
- Overload vs breaking strength / safety factor is detected and reported.

## Run

```
npm install
npm test        # verify the physics
npm run dev     # open the live canvas harness
npm run build   # production build (out: dist/)
```

## Notes / next steps

- Built-in gear values are INDICATIVE; verify against manufacturer ratings.
- Multi-rope mechanical-advantage (block & tackle) is structurally representable
  but the solver's MA calc is not yet wired end-to-end.
- No cloud/accounts yet — that's the planned differentiator (shared projects,
  team gear catalogues, PDF/SVG export for method statements).
