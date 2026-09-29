// src/main.ts
//
// Live canvas harness: the minimal editor that proves the "draw it, see the
// forces" core loop. Drag any node and the HUD re-solves in real time.

import './legacy.css';
import { useRigStore } from './state/rigStore';
import type { RigNode } from './model/types';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const statsEl = document.getElementById('hud-stats') as HTMLDivElement;
const reportEl = document.getElementById('hud-report') as HTMLDivElement;

// ---- sizing --------------------------------------------------------------
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// World<->screen: screen origin at bottom of canvas, scale px per unit metre.
// Model coordinates in metres; 1 world unit = 40 px and y flips.
const PX = 40;
function w2s(p: { x: number; y: number }) {
  return { x: window.innerWidth / 2 + p.x * PX, y: window.innerHeight / 2 - p.y * PX };
}
function s2w(p: { x: number; y: number }) {
  return { x: (p.x - window.innerWidth / 2) / PX, y: (window.innerHeight / 2 - p.y) / PX };
}

const store = useRigStore;

// ---- tool buttons --------------------------------------------------------
const TOOLS = [
  ['btn-add-anchor', 'ADD_ANCHOR'],
  ['btn-add-pulley', 'ADD_PULLEY'],
  ['btn-add-carabiner', 'ADD_CARABINER'],
  ['btn-add-belay', 'ADD_BELAY'],
  ['btn-add-load', 'ADD_LOAD'],
  ['btn-add-edge', 'ADD_EDGE'],
  ['btn-connect', 'CONNECT'],
] as const;

function deactivateToolbar() {
  TOOLS.forEach(([id]) => (document.getElementById(id) as HTMLButtonElement).classList.remove('active'));
}

TOOLS.forEach(([id, tool]) => {
  const btn = document.getElementById(id) as HTMLButtonElement;
  btn.addEventListener('click', () => {
    deactivateToolbar();
    btn.classList.add('active');
    store.getState().setTool(tool as never);
  });
});

document.getElementById('btn-run')!.addEventListener('click', () => store.getState().recompute());
document.getElementById('btn-demo')!.addEventListener('click', () => {
  deactivateToolbar();
  store.getState().setTool('SELECT');
  store.getState().loadDemo();
});
store.getState().loadDemo(); // start with a demo rig on screen

// Delete key removes the selected node (and its attached edges).
window.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && store.getState().selection) {
    e.preventDefault();
    store.getState().deleteSelected();
  }
  if (e.key === 'Escape') {
    store.getState().setTool('SELECT');
    deactivateToolbar();
  }
});

// ---- pointer interaction -------------------------------------------------
let dragging: string | null = null;

function hitTest(p: { x: number; y: number }): string | null {
  const s = store.getState();
  const SCREEN_TOL = 18;
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of s.doc.nodes) {
    const sp = w2s(n.position);
    const d = Math.hypot(p.x - sp.x, p.y - sp.y);
    if (d < SCREEN_TOL && d < bestD) { bestD = d; best = n.id; }
  }
  return best;
}

/** Distance from point p (screen) to segment ab (screen coords), px. */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-6) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Hit-test a rope: return the edge id whose segment is within tolerance of p. */
function hitEdge(p: { x: number; y: number }): string | null {
  const s = store.getState();
  const TOL = 12;
  const nodeById = new Map(s.doc.nodes.map((n) => [n.id, n]));
  let best: string | null = null;
  let bestD = Infinity;
  for (const e of s.doc.edges) {
    const a = nodeById.get(e.a);
    const b = nodeById.get(e.b);
    if (!a || !b) continue;
    const sa = w2s(a.position), sb = w2s(b.position);
    const d = distToSegment(p.x, p.y, sa.x, sa.y, sb.x, sb.y);
    if (d < TOL && d < bestD) { bestD = d; best = e.id; }
  }
  return best;
}

/** Redirect / passthrough node kinds: these make sense spliced into a rope. */
const REDIRECT_KINDS = new Set(['PULLEY', 'CARABINER', 'BELAY', 'EDGE']);

canvas.addEventListener('pointerdown', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  const s = store.getState();

  // ADD_* tools: drop a standalone node here (can drop several in a row).
  if (s.tool.startsWith('ADD_')) {
    const kind = s.tool.replace('ADD_', '') as never;
    if (REDIRECT_KINDS.has(kind)) {
      // Redirect device: if dropped on a rope, splice it in (rope-in/rope-out);
      // otherwise place it standalone.
      const edgeId = hitEdge(p);
      if (edgeId) { s.spliceIntoEdge(edgeId, kind, s2w(p)); return; }
    }
    s.placeNode(kind, s2w(p));
    return;
  }

  // CONNECT tool: pick first node, then second node to rope them together.
  if (s.tool === 'CONNECT') {
    const hit = hitTest(p);
    if (hit) {
      if (s.connectFrom) {
        s.connectNodes(hit);
        deactivateToolbar();
      } else {
        s.beginConnect(hit);
      }
    } else if (s.connectFrom) {
      // Clicking empty space cancels a pending connect.
      s.setTool('SELECT');
      s.select(null);
      deactivateToolbar();
    }
    return;
  }

  // SELECT tool: drag a node, or click a rope to select/recolour it.
  const hit = hitTest(p);
  if (hit) {
    dragging = hit;
    s.setGrabNode(hit);
    s.select(hit);
    canvas.setPointerCapture(e.pointerId);
  } else {
    const edgeHit = hitEdge(p);
    if (edgeHit) {
      s.selectEdge(edgeHit);
    } else {
      s.clearSelection();
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  const s = store.getState();
  if (dragging) {
    s.moveNodeAndSolve(dragging, s2w({ x: e.clientX, y: e.clientY }));
  } else if (s.selection) {
    // hover snap highlight handled implicitly via redraw on selection
  }
});

canvas.addEventListener('pointerup', () => {
  dragging = null;
  store.getState().setGrabNode(null);
});

// ---- render --------------------------------------------------------------
const NODE_STYLE: Record<string, { color: string; r: number; shape: string }> = {
  ANCHOR: { color: '#a371f7', r: 7, shape: 'square' },
  PULLEY: { color: '#58a6ff', r: 13, shape: 'circle' },
  CARABINER: { color: '#39c5cf', r: 10, shape: 'ring' },
  BELAY: { color: '#f0883e', r: 11, shape: 'hex' },
  LOAD: { color: '#f85149', r: 11, shape: 'box' },
  EDGE: { color: '#e3b341', r: 9, shape: 'diamond' },
  TERMINAL: { color: '#8b949e', r: 6, shape: 'square' },
};

function drawNode(n: RigNode, selected: boolean, status: string) {
  const sp = w2s(n.position);
  const st = NODE_STYLE[n.kind] ?? { color: '#8b949e', r: 8, shape: 'circle' };
  ctx.save();
  // status halo
  if (status === 'OVERLOAD') { ctx.fillStyle = 'rgba(248,81,73,0.25)'; ctx.beginPath(); ctx.arc(sp.x, sp.y, st.r + 8, 0, Math.PI * 2); ctx.fill(); }
  else if (status === 'WARN') { ctx.fillStyle = 'rgba(210,153,34,0.2)'; ctx.beginPath(); ctx.arc(sp.x, sp.y, st.r + 6, 0, Math.PI * 2); ctx.fill(); }

  ctx.strokeStyle = st.color;
  ctx.fillStyle = selected ? st.color : '#0d1117';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (st.shape === 'square') ctx.rect(sp.x - st.r, sp.y - st.r, st.r * 2, st.r * 2);
  else if (st.shape === 'diamond') {
    ctx.moveTo(sp.x, sp.y - st.r); ctx.lineTo(sp.x + st.r, sp.y);
    ctx.lineTo(sp.x, sp.y + st.r); ctx.lineTo(sp.x - st.r, sp.y); ctx.closePath();
  } else if (st.shape === 'hex') {
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 6; i === 0 ? ctx.moveTo(sp.x + st.r * Math.cos(a), sp.y + st.r * Math.sin(a)) : ctx.lineTo(sp.x + st.r * Math.cos(a), sp.y + st.r * Math.sin(a)); }
    ctx.closePath();
  } else {
    ctx.arc(sp.x, sp.y, st.r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  if (st.shape === 'ring') { ctx.beginPath(); ctx.arc(sp.x, sp.y, st.r * 0.5, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();

  // label
  ctx.fillStyle = '#c9d1d9';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(n.label ?? n.kind, sp.x, sp.y - st.r - 6);
}

function render() {
  const s = store.getState();
  const result = s.result;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // subtle grid
  ctx.strokeStyle = 'rgba(110,118,129,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -20; x <= 20; x++) { const sp = w2s({ x, y: 0 }); ctx.moveTo(sp.x, 0); ctx.lineTo(sp.x, window.innerHeight); }
  for (let y = -12; y <= 12; y++) { const sp = w2s({ x: 0, y }); ctx.moveTo(0, sp.y); ctx.lineTo(window.innerWidth, sp.y); }
  ctx.stroke();

  // edges (rope) with live tension
  const nodeById = new Map(s.doc.nodes.map((n) => [n.id, n]));
  // draw rope paths as polylines
  // Edges (ropes) drawn individually so each can have its own colour.
  // Edges inside an explicit path get the path's rope colour or the edge's
  // own colour; edges not in any path are dashed.
  const inPath = new Set<string>();
  for (const path of s.doc.paths) for (const pn of path) inPath.add(pn.nodeId);

  const drawEdge = (edge: typeof s.doc.edges[0], dashed: boolean, selected: boolean) => {
    const na = nodeById.get(edge.a);
    const nb = nodeById.get(edge.b);
    if (!na || !nb) return;
    const a = w2s(na.position), b = w2s(nb.position);
    const col = edge.color ?? '#9ecbff';
    ctx.strokeStyle = col;
    ctx.lineWidth = selected ? 5 : 2.5;
    ctx.lineCap = 'round';
    if (dashed) ctx.setLineDash([5, 4]);
    if (selected) {
      // selection halo
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3.5;
    }
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
  };

  for (const edge of s.doc.edges) {
    const inPathBoth = inPath.has(edge.a) && inPath.has(edge.b);
    drawEdge(edge, !inPathBoth, edge.id === s.selectedEdge);
  }

  // nodes
  const nodeForce = new Map((result?.nodes ?? []).map((nf) => [nf.nodeId, nf]));
  for (const n of s.doc.nodes) {
    drawNode(n, s.selection === n.id, nodeForce.get(n.id)?.status ?? 'OK');
  }
  // Visio-style selection handles on the selected node.
  if (s.selection) {
    const sn = nodeById.get(s.selection);
    if (sn) {
      const sp = w2s(sn.position);
      const st = NODE_STYLE[sn.kind] ?? { r: 9 };
      const hs = st.r + 8; // handle spread
      ctx.strokeStyle = '#58a6ff';
      ctx.fillStyle = '#58a6ff';
      ctx.lineWidth = 1.5;
      const pts = [
        { x: sp.x - hs, y: sp.y - hs }, { x: sp.x + hs, y: sp.y - hs },
        { x: sp.x - hs, y: sp.y },     { x: sp.x + hs, y: sp.y },
        { x: sp.x - hs, y: sp.y + hs }, { x: sp.x + hs, y: sp.y + hs },
      ];
      // bounding square
      ctx.strokeRect(sp.x - hs, sp.y - hs, hs * 2, hs * 2);
      for (const pt of pts) { ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4); }
    }
  }

  // Highlight the pending connect-from endpoint.
  if (s.connectFrom) {
    const cn = nodeById.get(s.connectFrom);
    if (cn) {
      const sp = w2s(cn.position);
      ctx.strokeStyle = '#39c5cf';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#39c5cf';
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('→ choose a node to rope', sp.x, sp.y - 26);
    }
  }

  // Per-edge tension labels.
  ctx.fillStyle = '#8b949e';
  ctx.font = '9px system-ui';
  ctx.textAlign = 'center';
  if (result) {
    // Show each edge's live tension: the lower of the two endpoint resultants
    // (a shared segment carries the same tension through to its weaker end).
    for (const edge of s.doc.edges) {
      const fa = nodeForce.get(edge.a);
      const fb = nodeForce.get(edge.b);
      if (!fa || !fb) continue;
      const na = nodeById.get(edge.a);
      const nb = nodeById.get(edge.b);
      if (!na || !nb) continue;
      const a = w2s(na.position), b = w2s(nb.position);
      const t = Math.min(fa.resultant, fb.resultant);
      if (t < 1e-9) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ctx.fillText(`${t.toFixed(2)} kN`, mx, my - 5);
    }
  }

  // HUD: stats
  if (result && result.nodes.length) {
    const maxN = result.nodes.reduce((m, nf) => (nf.resultant > m.resultant ? nf : m), result.nodes[0]);
    const overloads = result.nodes.filter((nf) => nf.status === 'OVERLOAD').length;
    statsEl.innerHTML = `Max node force: <strong>${maxN.resultant.toFixed(2)} kN</strong> @ ${maxN.kind}${
      overloads ? ` · <span style="color:#f85149">${overloads} overload</span>` : ''
    } · ${result.warnings.length ? `<span style="color:#ffa657">${result.warnings.length} warning</span>` : '<span style="color:#3fb950">all within rating</span>'}`;

    // HUD: per-node report
    let html = '';
    for (const nf of result.nodes) {
      const nn = nodeById.get(nf.nodeId);
      const name = nn?.label ?? nn?.kind ?? nf.nodeId;
      const angleTxt = nf.includedAngle != null ? ` · ${((nf.includedAngle * 180) / Math.PI).toFixed(0)}°` : '';
      html += `<div class="row ${nf.status}"><span>${name}</span><span class="val">${nf.resultant.toFixed(2)} kN${angleTxt} [${nf.status}]</span></div>`;
    }
    html += '<div style="margin-top:6px;color:#8b949e">';
    for (const [pi, hf] of Object.entries(result.haulForce)) html += `<div>Rope path ${pi} haul force: <strong>${hf.toFixed(2)} kN</strong></div>`;
    html += '</div>';
    if (result.warnings.length) html += `<div class="warn">${result.warnings.map((w) => `⚠ ${w}`).join('<br/>')}</div>`;
    else html += '<div class="ok-note">✓ No warnings — forces within ratings.</div>';
    reportEl.innerHTML = html;
  } else {
    statsEl.textContent = 'Place nodes and rope them up — forces appear instantly.';
    reportEl.innerHTML = '';
  }
}

// ---- properties panel (Visio-style) -------------------------------------
const ROPESWATCHES = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#39c5cf', '#e3b341', '#ffffff'];

let propsSig = ''; // last-rendered selection signature to avoid rebuilding on focus

function renderProps() {
  const s = store.getState();
  const propsBody = document.getElementById('props-body') as HTMLDivElement;
  const sig = `${s.selection}|${s.selectedEdge ?? ''}|${s.tool}|${s.doc.nodes.length}|${s.doc.edges.length}|${s.result?.nodes.map((n)=>n.status).join('') ?? ''}`;
  if (sig === propsSig) return;
  propsSig = sig;

  // ---- connector selected ----
  if (s.selectedEdge) {
    const edge = s.doc.edges.find((e) => e.id === s.selectedEdge);
    if (edge) {
      const byId = new Map(s.doc.nodes.map((n) => [n.id, n]));
      const a = byId.get(edge.a), b = byId.get(edge.b);
      const swatches = ROPESWATCHES.map(
        (c) => `<button class="props-swatch" data-color="${c}" title="${c}" style="background:${c}"></button>`,
      ).join('');
      propsBody.innerHTML = `
        <div class="props-row"><label>Connector (rope)</label></div>
        <div class="props-row"><label>Colour</label>
          <span class="props-color"><input type="color" id="clr" value="${edge.color ?? '#9ecbff'}"></span></div>
        <div class="props-swatches">${swatches}</div>
        <div class="props-kv"><span>From</span><b>${a?.label ?? edge.a}</b></div>
        <div class="props-kv"><span>To</span><b>${b?.label ?? edge.b}</b></div>
        <div class="props-hint">Rope colour shows load sharing — give each rope a different colour.</div>`;
      const clr = propsBody.querySelector('#clr') as HTMLInputElement;
      clr?.addEventListener('input', () => s.setEdgeColor(edge.id, clr.value));
      propsBody.querySelectorAll('.props-swatch').forEach((el) =>
        el.addEventListener('click', () => s.setEdgeColor(edge.id, (el as HTMLElement).dataset.color!)));
      return;
    }
    s.selectEdge(null);
    return;
  }

  // ---- node selected ----
  if (s.selection) {
    const node = s.doc.nodes.find((n) => n.id === s.selection);
    if (!node) { propsBody.innerHTML = '<div class="props-empty">Nothing selected.</div>'; return; }
    const spec = node.spec;
    const fmt = (v: number | undefined, d = ''): string => (v ?? d) as string;
    const fields: string[] = [];
    fields.push(labelField(node.label ?? node.kind, node.kind));
    if (node.kind === 'LOAD') {
      fields.push(numField('Weight (kN)', 'load', fmt(spec.load)));
      fields.push(numField('Safety factor', 'safetyFactor', fmt(spec.safetyFactor)));
    } else {
      if (node.kind !== 'ANCHOR' && node.kind !== 'TERMINAL') {
        fields.push(numField('Friction μ', 'friction', fmt(spec.friction)));
        fields.push(numField('Contact angle °', 'wrapDeg', spec.wrapAngle != null ? String((spec.wrapAngle * 180) / Math.PI) : ''));
      }
      fields.push(numField('Breaking (kN)', 'breakingStrength', fmt(spec.breakingStrength)));
      fields.push(numField('Safety factor', 'safetyFactor', fmt(spec.safetyFactor, '5')));
      if (spec.weight) fields.push(numField('Weight (kN)', 'weight', fmt(spec.weight)));
    }
    propsBody.innerHTML = `
      <div class="props-row"><label>${node.kind}</label></div>
      ${fields.join('')}
      <div class="props-hint">Forces recompute as you type. Verify ratings against the manufacturer.</div>`;

    const lbl = propsBody.querySelector('#lbl') as HTMLInputElement;
    lbl?.addEventListener('change', () => s.updateNode(node.id, {}, lbl.value));
    const map = {
      load: 'load', safetyFactor: 'safetyFactor', friction: 'friction',
      wrapDeg: 'wrapAngle', breakingStrength: 'breakingStrength', weight: 'weight',
    } as const;
    (['load', 'safetyFactor', 'friction', 'wrapDeg', 'breakingStrength', 'weight'] as const).forEach((k) => {
      const el = propsBody.querySelector(`#${k}`) as HTMLInputElement;
      if (!el) return;
      el.addEventListener('change', () => {
        const v = Number(el.value);
        if (Number.isNaN(v)) return;
        if (map[k] === 'wrapAngle') { s.updateNode(node.id, { [map[k]]: (v * Math.PI) / 180 }); return; }
        s.updateNode(node.id, { [map[k]]: v });
      });
    });
    return;
  }

  propsBody.innerHTML = '<div class="props-empty">Select a node or rope to edit it.<br/><span class="props-hint">Nodes: drag to move, <b>Del</b> to remove. Ropes: click to recolour.</span></div>';
}

function labelField(value: string, kind: string): string {
  return `<div class="props-row"><label>Label</label><input type="text" id="lbl" value="${value.replace(/"/g, '&quot;')}" datatype="${kind}"></div>`;
}
function numField(label: string, id: string, value: string): string {
  return `<div class="props-row"><label>${label}</label><input type="number" id="${id}" value="${value}" step="any"></div>`;
}

// animation loop
function loop() {
  render();
  renderProps();
  requestAnimationFrame(loop);
}
loop();
