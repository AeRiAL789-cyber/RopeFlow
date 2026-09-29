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
] as const;

TOOLS.forEach(([id, tool]) => {
  const btn = document.getElementById(id) as HTMLButtonElement;
  btn.addEventListener('click', () => {
    store.getState().setTool(tool as never);
    btn.classList.add('active');
    TOOLS.forEach(([oid]) => {
      if (oid !== id) (document.getElementById(oid) as HTMLButtonElement).classList.remove('active');
    });
  });
});

document.getElementById('btn-run')!.addEventListener('click', () => store.getState().recompute());
document.getElementById('btn-demo')!.addEventListener('click', () => store.getState().loadDemo());
store.getState().loadDemo(); // start with a demo rig on screen

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

canvas.addEventListener('pointerdown', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  const s = store.getState();
  if (s.tool !== 'SELECT') {
    const pos = s2w(p);
    const kind = s.tool.replace('ADD_', '') as never;
    s.placeNode(kind, pos);
    s.setTool('SELECT');
    TOOLS.forEach(([id]) => (document.getElementById(id) as HTMLButtonElement).classList.remove('active'));
    return;
  }
  const hit = hitTest(p);
  if (hit) {
    dragging = hit;
    s.setGrabNode(hit);
    s.select(hit);
    canvas.setPointerCapture(e.pointerId);
  } else {
    s.clearSelection();
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
  ctx.strokeStyle = '#9ecbff';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (const path of s.doc.paths) {
    ctx.beginPath();
    let started = false;
    for (const pn of path) {
      const nn = nodeById.get(pn.nodeId);
      if (!nn) continue;
      const sp = w2s(nn.position);
      if (!started) { ctx.moveTo(sp.x, sp.y); started = true; } else ctx.lineTo(sp.x, sp.y);
    }
    ctx.stroke();
  }
  // edges not part of any path
  const inPath = new Set(s.doc.paths.flat().map((p) => p.nodeId));
  ctx.strokeStyle = 'rgba(158,203,255,0.4)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (const edge of s.doc.edges) {
    const na = nodeById.get(edge.a);
    const nb = nodeById.get(edge.b);
    if (!na || !nb) continue;
    if (inPath.has(edge.a) && inPath.has(edge.b)) continue;
    const a = w2s(na.position), b = w2s(nb.position);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // nodes
  const nodeForce = new Map((result?.nodes ?? []).map((nf) => [nf.nodeId, nf]));
  for (const n of s.doc.nodes) {
    drawNode(n, s.selection === n.id, nodeForce.get(n.id)?.status ?? 'OK');
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

// animation loop
function loop() {
  render();
  requestAnimationFrame(loop);
}
loop();
