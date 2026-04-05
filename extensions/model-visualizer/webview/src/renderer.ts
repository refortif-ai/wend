/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import dagre from 'dagre';

// ---- Types (mirrors common/modelVisualizer.ts) ----

interface IPort {
	side: 'top' | 'bottom' | 'left' | 'right';
	shape: number[];
}

interface IGraphNode {
	id: string;
	parent: string | null;
	children: string[];
	order: number;
	name: string;
	class_name: string;
	module_type: string;
	input_shapes: number[][];
	output_shapes: number[][];
	repeat_group: string | null;
	repeat_count: number | null;
	is_canonical: boolean;
	traceable: boolean;
	operations: string[];
	ports: Record<string, IPort>;
}

interface IEdgeEndpoint {
	node: string;
	port: string;
}

interface IEdge {
	id: string;
	type: 'flow' | 'cross';
	source: IEdgeEndpoint;
	target: IEdgeEndpoint;
	shape: number[];
	label: string | null;
	operation?: string;
}

interface IGraphDocument {
	version: string;
	model_name: string;
	model_class: string;
	nodes: Record<string, IGraphNode>;
	edges: IEdge[];
	root: string;
	meta: { input_shapes: number[][]; framework: string; partial: boolean };
}

interface VsCodeApi {
	postMessage(msg: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// ---- Constants ----

const ACCENT: Record<string, string> = {
	container: '#6c7086',
	attention: '#89b4fa',
	feedforward: '#a6e3a1',
	normalization: '#cba6f7',
	loss: '#fab387',
	embedding: '#f9e2af',
	linear: '#74c7ec',
	activation: '#f38ba8',
	dropout: '#9399b2',
	pooling: '#94e2d5',
	other: '#6c7086',
};

const NODE_W = 260;
const NODE_H = 72;

// ---- State ----

const vscode = acquireVsCodeApi();
let doc: IGraphDocument | null = null;
let currentParentId: string = '';
let viewBox = { x: 0, y: 0, w: 800, h: 600 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let searchQuery = '';

// ---- DOM refs ----

const emptyState = document.getElementById('emptyState')!;
const toolbar = document.getElementById('toolbar')!;
const breadcrumb = document.getElementById('breadcrumb')!;
const modelBadge = document.getElementById('modelBadge')!;
const searchBar = document.getElementById('searchBar')!;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const graphSvg = document.getElementById('graphSvg')!;
const viewport = document.getElementById('viewport')!;
const minimapDiv = document.getElementById('minimap')!;
const minimapSvg = document.getElementById('minimapSvg')!;

// ---- Communication ----

vscode.postMessage({ type: 'ready' });

window.addEventListener('message', (ev) => {
	const msg = ev.data;
	if (msg.type === 'load_graph') {
		if (msg.data) {
			doc = msg.data as IGraphDocument;
			currentParentId = doc.root;
			showGraph();
		} else {
			doc = null;
			showEmpty();
		}
	}
});

function showEmpty(): void {
	emptyState.style.display = 'flex';
	toolbar.style.display = 'none';
	graphSvg.style.display = 'none';
	minimapDiv.style.display = 'none';
	modelBadge.style.display = 'none';
}

function showGraph(): void {
	emptyState.style.display = 'none';
	toolbar.style.display = 'flex';
	graphSvg.style.display = 'block';
	minimapDiv.style.display = 'block';
	modelBadge.style.display = 'block';
	modelBadge.textContent = doc!.model_name + (doc!.meta.partial ? ' (partial)' : '');
	render();
}

// ---- Dagre Layout ----

interface LayoutNode {
	id: string;
	node: IGraphNode;
	x: number;
	y: number;
	w: number;
	h: number;
}

interface LayoutEdge {
	edge: IEdge;
	points: Array<{ x: number; y: number }>;
}

function computeLayout(): { nodes: LayoutNode[]; flowEdges: LayoutEdge[]; crossEdges: IEdge[] } {
	if (!doc) { return { nodes: [], flowEdges: [], crossEdges: [] }; }

	const parentNode = doc.nodes[currentParentId];
	if (!parentNode) { return { nodes: [], flowEdges: [], crossEdges: [] }; }

	// Get canonical children sorted by order
	const childIds = parentNode.children
		.filter(cid => {
			const c = doc!.nodes[cid];
			return c && c.is_canonical;
		})
		.sort((a, b) => (doc!.nodes[a].order) - (doc!.nodes[b].order));

	if (childIds.length === 0) {
		return { nodes: [], flowEdges: [], crossEdges: [] };
	}

	// Build Dagre graph
	const g = new dagre.graphlib.Graph();
	g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60, marginx: 40, marginy: 40 });
	g.setDefaultEdgeLabel(() => ({}));

	const childIdSet = new Set(childIds);

	for (const cid of childIds) {
		g.setNode(cid, { width: NODE_W, height: NODE_H });
	}

	// Add flow edges between children of this parent
	const flowEdgesForLevel: IEdge[] = [];
	const crossEdgesForLevel: IEdge[] = [];

	for (const edge of doc.edges) {
		const srcInLevel = childIdSet.has(edge.source.node);
		const tgtInLevel = childIdSet.has(edge.target.node);

		if (edge.type === 'flow' && srcInLevel && tgtInLevel) {
			g.setEdge(edge.source.node, edge.target.node);
			flowEdgesForLevel.push(edge);
		} else if (edge.type === 'cross' && srcInLevel && tgtInLevel) {
			crossEdgesForLevel.push(edge);
		}
	}

	dagre.layout(g);

	// Extract positions
	const layoutNodes: LayoutNode[] = [];
	for (const cid of childIds) {
		const dagreNode = g.node(cid);
		layoutNodes.push({
			id: cid,
			node: doc.nodes[cid],
			x: dagreNode.x - NODE_W / 2,
			y: dagreNode.y - NODE_H / 2,
			w: NODE_W,
			h: NODE_H,
		});
	}

	// Extract edge points
	const layoutEdges: LayoutEdge[] = [];
	for (const edge of flowEdgesForLevel) {
		const dagreEdge = g.edge(edge.source.node, edge.target.node);
		if (dagreEdge && dagreEdge.points) {
			layoutEdges.push({ edge, points: dagreEdge.points });
		}
	}

	return { nodes: layoutNodes, flowEdges: layoutEdges, crossEdges: crossEdgesForLevel };
}

// ---- SVG helpers ----

function svgE(tag: string, attrs?: Record<string, string | number>): SVGElement {
	const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
	if (attrs) {
		for (const k in attrs) {
			el.setAttribute(k, '' + attrs[k]);
		}
	}
	return el;
}

function shapeStr(s: number[]): string {
	return '[' + s.join(', ') + ']';
}

// ---- Render ----

function render(): void {
	if (!doc) { return; }
	viewport.innerHTML = '';

	const { nodes, flowEdges, crossEdges } = computeLayout();
	if (nodes.length === 0) {
		// No children — show parent info
		renderLeafView();
		return;
	}

	// Add drop shadow filter
	const defs = svgE('defs');
	const filter = svgE('filter', { id: 'blockShadow', x: '-10%', y: '-10%', width: '130%', height: '140%' });
	const feFlood = svgE('feFlood', { 'flood-color': 'rgba(0,0,0,0.35)', result: 'flood' });
	const feComposite = svgE('feComposite', { in: 'flood', in2: 'SourceGraphic', operator: 'in', result: 'shadow' });
	const feOffset = svgE('feOffset', { in: 'shadow', dx: '0', dy: '3', result: 'offsetShadow' });
	const feBlur = svgE('feGaussianBlur', { in: 'offsetShadow', stdDeviation: '4', result: 'blurShadow' });
	const feMerge = svgE('feMerge');
	feMerge.appendChild(svgE('feMergeNode', { in: 'blurShadow' }));
	feMerge.appendChild(svgE('feMergeNode', { in: 'SourceGraphic' }));
	filter.appendChild(feFlood);
	filter.appendChild(feComposite);
	filter.appendChild(feOffset);
	filter.appendChild(feBlur);
	filter.appendChild(feMerge);
	defs.appendChild(filter);

	// Arrowhead marker
	const marker = svgE('marker', { id: 'arrow', markerWidth: '10', markerHeight: '8', refX: '9', refY: '4', orient: 'auto' });
	marker.appendChild(svgE('path', { d: 'M 0 0 L 10 4 L 0 8 L 3 4 Z', fill: '#585870' }));
	defs.appendChild(marker);

	viewport.appendChild(defs);

	// Render flow edges (behind blocks)
	for (const le of flowEdges) {
		viewport.appendChild(renderFlowEdge(le));
	}

	// Render blocks
	for (const ln of nodes) {
		viewport.appendChild(renderBlock(ln));
	}

	// Render cross edges (on top)
	for (const ce of crossEdges) {
		viewport.appendChild(renderCrossEdge(ce, nodes));
	}

	// Update viewBox to fit content
	fitViewBox(nodes);
	updateBreadcrumb();
	renderMinimap(nodes);
}

function renderBlock(ln: LayoutNode): SVGElement {
	const n = ln.node;
	const { x, y, w, h } = ln;
	const accent = ACCENT[n.module_type] || ACCENT.other;
	const hasChildren = n.children.length > 0;

	const g = svgE('g');
	g.setAttribute('class', 'block');

	// Search match/dim
	if (searchQuery) {
		const q = searchQuery.toLowerCase();
		const match = n.name.toLowerCase().includes(q) || n.class_name.toLowerCase().includes(q) ||
			n.id.toLowerCase().includes(q) || n.module_type.toLowerCase().includes(q);
		if (!match) { g.setAttribute('class', 'block search-dimmed'); }
		else { g.setAttribute('class', 'block search-match'); }
	}

	// Repeat shadows
	if (n.repeat_count && n.repeat_count > 1) {
		g.appendChild(svgE('rect', { x: x + 5, y: y - 5, width: w, height: h, rx: '8', ry: '8', fill: '#22223a', opacity: '0.4' }));
		g.appendChild(svgE('rect', { x: x + 3, y: y - 3, width: w, height: h, rx: '8', ry: '8', fill: '#26263d', opacity: '0.5' }));
	}

	// Main block rect
	g.appendChild(svgE('rect', {
		x, y, width: w, height: h,
		rx: '8', ry: '8',
		fill: '#2a2a3e',
		stroke: '#3a3a50',
		'stroke-width': '1',
		filter: 'url(#blockShadow)',
		class: 'block-rect',
	}));

	// Colored header bar
	g.appendChild(svgE('rect', { x, y, width: w, height: '5', rx: '8', ry: '8', fill: accent }));
	// Cover bottom corners of header (so only top is rounded)
	g.appendChild(svgE('rect', { x, y: y + 3, width: w, height: '3', fill: accent }));

	// Name
	const nameEl = svgE('text', { x: x + 14, y: y + 26, fill: '#e0e0f0', 'font-size': '13', 'font-weight': '600', 'font-family': "'JetBrains Mono', 'Fira Code', Consolas, monospace" });
	nameEl.textContent = n.name;
	g.appendChild(nameEl);

	// Class name
	const classEl = svgE('text', { x: x + 14, y: y + 41, fill: '#8888a8', 'font-size': '11', 'font-family': "'JetBrains Mono', 'Fira Code', Consolas, monospace" });
	classEl.textContent = n.class_name;
	g.appendChild(classEl);

	// Shape pills
	if (n.input_shapes.length > 0) {
		const inStr = shapeStr(n.input_shapes[0]);
		const px = x + 14;
		const py = y + 56;
		const pw = inStr.length * 6.5 + 12;
		g.appendChild(svgE('rect', { x: px, y: py - 9, width: pw, height: '17', rx: '8', ry: '8', fill: '#353550' }));
		const pt = svgE('text', { x: px + pw / 2, y: py, fill: '#b0b0cc', 'font-size': '10', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': "'JetBrains Mono', monospace" });
		pt.textContent = inStr;
		g.appendChild(pt);

		if (n.output_shapes.length > 0) {
			const outStr = shapeStr(n.output_shapes[0]);
			const arrowX = px + pw + 5;
			const at = svgE('text', { x: arrowX, y: py, fill: '#6c6c8a', 'font-size': '11', 'dominant-baseline': 'central', 'font-family': "monospace" });
			at.textContent = '\u2192';
			g.appendChild(at);
			const opx = arrowX + 14;
			const opw = outStr.length * 6.5 + 12;
			g.appendChild(svgE('rect', { x: opx, y: py - 9, width: opw, height: '17', rx: '8', ry: '8', fill: '#353550' }));
			const opt = svgE('text', { x: opx + opw / 2, y: py, fill: '#b0b0cc', 'font-size': '10', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': "'JetBrains Mono', monospace" });
			opt.textContent = outStr;
			g.appendChild(opt);
		}
	}

	// Drill-down chevron for containers
	if (hasChildren) {
		const chevG = svgE('g', { class: 'chevron-btn' });
		chevG.appendChild(svgE('circle', { cx: x + w - 18, cy: y + 24, r: '10', fill: '#353550', stroke: '#4a4a65', 'stroke-width': '1' }));
		const chevText = svgE('text', { x: x + w - 18, y: y + 25, fill: '#b0b0cc', 'font-size': '11', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
		chevText.textContent = '\u25B6';
		chevG.appendChild(chevText);
		chevG.style.cursor = 'pointer';
		chevG.addEventListener('click', (e) => {
			e.stopPropagation();
			drillDown(ln.id);
		});
		g.appendChild(chevG);
	}

	// Repeat badge
	if (n.repeat_count && n.repeat_count > 1) {
		const badgeX = x + w - (hasChildren ? 42 : 14);
		const badgeText = '\u00D7' + n.repeat_count;
		const badgeW = badgeText.length * 8 + 10;
		g.appendChild(svgE('rect', { x: badgeX - badgeW + 4, y: y + 15, width: badgeW, height: '18', rx: '9', ry: '9', fill: '#89b4fa22', stroke: '#89b4fa44', 'stroke-width': '1' }));
		const badge = svgE('text', { x: badgeX - badgeW / 2 + 4, y: y + 25, fill: '#89b4fa', 'font-size': '11', 'font-weight': '700', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': "'JetBrains Mono', monospace" });
		badge.textContent = badgeText;
		g.appendChild(badge);
	}

	// Untraceable badge
	if (!n.traceable) {
		const warn = svgE('text', { x: x + w - 16, y: y + 42, fill: '#fab387', 'font-size': '14' });
		warn.textContent = '\u26A0';
		g.appendChild(warn);
	}

	// Click entire block to drill down (if container)
	if (hasChildren) {
		g.style.cursor = 'pointer';
		g.addEventListener('click', () => drillDown(ln.id));
	}

	return g;
}

function renderFlowEdge(le: LayoutEdge): SVGElement {
	const g = svgE('g');
	const pts = le.points;

	if (pts.length < 2) { return g; }

	// Build smooth cubic bezier path through dagre points
	let d = `M ${pts[0].x} ${pts[0].y}`;
	if (pts.length === 2) {
		d += ` L ${pts[1].x} ${pts[1].y}`;
	} else {
		// Use catmull-rom-like bezier through dagre control points
		for (let i = 1; i < pts.length; i++) {
			const prev = pts[i - 1];
			const curr = pts[i];
			const cpY = (prev.y + curr.y) / 2;
			d += ` C ${prev.x} ${cpY}, ${curr.x} ${cpY}, ${curr.x} ${curr.y}`;
		}
	}

	g.appendChild(svgE('path', {
		d,
		fill: 'none',
		stroke: '#585870',
		'stroke-width': '1.5',
		'marker-end': 'url(#arrow)',
		opacity: '0.6',
	}));

	// Shape pill at midpoint
	if (le.edge.shape && le.edge.shape.length > 0) {
		const midIdx = Math.floor(pts.length / 2);
		const mid = pts[midIdx];
		const st = shapeStr(le.edge.shape);
		const sw = st.length * 5.5 + 10;
		g.appendChild(svgE('rect', { x: mid.x + 10, y: mid.y - 8, width: sw, height: '15', rx: '7', ry: '7', fill: '#2a2a3e', stroke: '#3a3a50', 'stroke-width': '0.5', opacity: '0.9' }));
		const stxt = svgE('text', { x: mid.x + 10 + sw / 2, y: mid.y, fill: '#7a7a98', 'font-size': '9', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': "'JetBrains Mono', monospace" });
		stxt.textContent = st;
		g.appendChild(stxt);
	}

	return g;
}

function renderCrossEdge(edge: IEdge, nodes: LayoutNode[]): SVGElement {
	const g = svgE('g');

	const srcNode = nodes.find(n => n.id === edge.source.node);
	const tgtNode = nodes.find(n => n.id === edge.target.node);
	if (!srcNode || !tgtNode || !doc) { return g; }

	const srcPort = doc.nodes[edge.source.node].ports[edge.source.port];
	const tgtPort = doc.nodes[edge.target.node].ports[edge.target.port];
	if (!srcPort || !tgtPort) { return g; }

	const src = portCoords(srcNode, srcPort.side);
	const tgt = portCoords(tgtNode, tgtPort.side);

	const bulge = Math.max(70, Math.abs(tgt.y - src.y) * 0.4);
	let cpx1 = src.x, cpy1 = src.y;
	let cpx2 = tgt.x, cpy2 = tgt.y;

	if (srcPort.side === 'left' || srcPort.side === 'right') {
		cpx1 = src.x + (srcPort.side === 'right' ? bulge : -bulge);
	} else {
		cpy1 = src.y + (srcPort.side === 'bottom' ? bulge : -bulge);
	}
	if (tgtPort.side === 'left' || tgtPort.side === 'right') {
		cpx2 = tgt.x + (tgtPort.side === 'right' ? bulge : -bulge);
	} else {
		cpy2 = tgt.y + (tgtPort.side === 'bottom' ? bulge : -bulge);
	}

	const strokeColor = edge.label === 'residual' ? '#a6e3a1' : '#89b4fa';
	g.appendChild(svgE('path', {
		d: `M ${src.x} ${src.y} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${tgt.x} ${tgt.y}`,
		fill: 'none',
		stroke: strokeColor,
		'stroke-width': '1.5',
		'stroke-dasharray': '6 4',
		opacity: '0.5',
	}));

	if (edge.label) {
		const lx = (src.x + tgt.x) / 2 + (srcPort.side === 'right' || srcPort.side === 'left' ? bulge * 0.3 : 0);
		const ly = (src.y + tgt.y) / 2;
		const lbl = svgE('text', { x: lx, y: ly - 6, fill: strokeColor, opacity: '0.7', 'font-size': '10', 'font-family': "'JetBrains Mono', monospace" });
		lbl.textContent = edge.label;
		g.appendChild(lbl);
	}

	return g;
}

function portCoords(ln: LayoutNode, side: string): { x: number; y: number } {
	switch (side) {
		case 'top':    return { x: ln.x + ln.w / 2, y: ln.y };
		case 'bottom': return { x: ln.x + ln.w / 2, y: ln.y + ln.h };
		case 'left':   return { x: ln.x,            y: ln.y + ln.h / 2 };
		case 'right':  return { x: ln.x + ln.w,     y: ln.y + ln.h / 2 };
		default:       return { x: ln.x + ln.w / 2, y: ln.y + ln.h };
	}
}

function renderLeafView(): void {
	if (!doc) { return; }
	const node = doc.nodes[currentParentId];
	if (!node) { return; }

	// Show a single centered block with more detail
	const x = 40, y = 40, w = 320, h = 100;
	const accent = ACCENT[node.module_type] || ACCENT.other;

	viewport.appendChild(svgE('rect', { x, y, width: w, height: h, rx: '8', ry: '8', fill: '#2a2a3e', stroke: '#3a3a50', 'stroke-width': '1' }));
	viewport.appendChild(svgE('rect', { x, y, width: w, height: '5', rx: '8', ry: '8', fill: accent }));
	viewport.appendChild(svgE('rect', { x, y: y + 3, width: w, height: '3', fill: accent }));

	const nameEl = svgE('text', { x: x + 14, y: y + 28, fill: '#e0e0f0', 'font-size': '14', 'font-weight': '600', 'font-family': "'JetBrains Mono', monospace" });
	nameEl.textContent = node.name;
	viewport.appendChild(nameEl);

	const classEl = svgE('text', { x: x + 14, y: y + 46, fill: '#8888a8', 'font-size': '12', 'font-family': "'JetBrains Mono', monospace" });
	classEl.textContent = node.class_name + ' \u2022 ' + node.module_type;
	viewport.appendChild(classEl);

	if (node.input_shapes.length > 0 && node.output_shapes.length > 0) {
		const shapeText = shapeStr(node.input_shapes[0]) + ' \u2192 ' + shapeStr(node.output_shapes[0]);
		const st = svgE('text', { x: x + 14, y: y + 66, fill: '#b0b0cc', 'font-size': '11', 'font-family': "'JetBrains Mono', monospace" });
		st.textContent = shapeText;
		viewport.appendChild(st);
	}

	if (node.operations.length > 0) {
		const opsText = 'ops: ' + node.operations.join(', ');
		const ops = svgE('text', { x: x + 14, y: y + 84, fill: '#7a7a98', 'font-size': '10', 'font-family': "'JetBrains Mono', monospace" });
		ops.textContent = opsText;
		viewport.appendChild(ops);
	}

	viewBox = { x: 0, y: 0, w: 400, h: 180 };
	applyViewBox();
	updateBreadcrumb();
	renderMinimap([]);
}

// ---- Drill-down navigation ----

function drillDown(nodeId: string): void {
	currentParentId = nodeId;
	searchQuery = '';
	searchInput.value = '';
	searchBar.classList.remove('visible');
	render();
}

function navigateTo(nodeId: string): void {
	currentParentId = nodeId;
	searchQuery = '';
	searchInput.value = '';
	searchBar.classList.remove('visible');
	render();
}

function updateBreadcrumb(): void {
	if (!doc) { return; }
	breadcrumb.innerHTML = '';

	// Build path from root to current
	const path: string[] = [];
	let cur = currentParentId;
	while (cur) {
		path.unshift(cur);
		const node = doc.nodes[cur];
		if (!node || !node.parent) { break; }
		cur = node.parent;
	}

	for (let i = 0; i < path.length; i++) {
		const nodeId = path[i];
		const node = doc.nodes[nodeId];
		if (!node) { continue; }

		if (i > 0) {
			const sep = document.createElement('span');
			sep.className = 'breadcrumb-sep';
			sep.textContent = ' / ';
			breadcrumb.appendChild(sep);
		}

		const btn = document.createElement('span');
		btn.className = 'breadcrumb-item' + (i === path.length - 1 ? ' breadcrumb-current' : '');
		btn.textContent = node.name;
		if (i < path.length - 1) {
			btn.style.cursor = 'pointer';
			const targetId = nodeId;
			btn.addEventListener('click', () => navigateTo(targetId));
		}
		breadcrumb.appendChild(btn);
	}
}

// ---- ViewBox / Zoom / Pan ----

function fitViewBox(nodes: LayoutNode[]): void {
	if (nodes.length === 0) {
		viewBox = { x: 0, y: 0, w: 400, h: 300 };
		applyViewBox();
		return;
	}
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const n of nodes) {
		minX = Math.min(minX, n.x);
		minY = Math.min(minY, n.y);
		maxX = Math.max(maxX, n.x + n.w);
		maxY = Math.max(maxY, n.y + n.h);
	}
	const pad = 60;
	viewBox = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
	applyViewBox();
}

function applyViewBox(): void {
	graphSvg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

function fitToView(): void {
	const { nodes } = computeLayout();
	fitViewBox(nodes);
	renderMinimap(nodes);
}

// Zoom
graphSvg.addEventListener('wheel', (e) => {
	e.preventDefault();
	const scale = e.deltaY > 0 ? 1.1 : 0.9;
	const rect = graphSvg.getBoundingClientRect();
	const mx = (e.clientX - rect.left) / rect.width;
	const my = (e.clientY - rect.top) / rect.height;
	const nw = viewBox.w * scale, nh = viewBox.h * scale;
	viewBox.x += (viewBox.w - nw) * mx;
	viewBox.y += (viewBox.h - nh) * my;
	viewBox.w = nw;
	viewBox.h = nh;
	applyViewBox();
}, { passive: false });

// Pan
graphSvg.addEventListener('mousedown', (e) => {
	const target = e.target as Element;
	if (target === graphSvg || target.id === 'viewport' || target.tagName === 'svg') {
		isPanning = true;
		panStart = { x: e.clientX, y: e.clientY };
	}
});
window.addEventListener('mousemove', (e) => {
	if (!isPanning) { return; }
	const rect = graphSvg.getBoundingClientRect();
	viewBox.x -= (e.clientX - panStart.x) * (viewBox.w / rect.width);
	viewBox.y -= (e.clientY - panStart.y) * (viewBox.h / rect.height);
	panStart = { x: e.clientX, y: e.clientY };
	applyViewBox();
});
window.addEventListener('mouseup', () => { isPanning = false; });

// Fit button
document.getElementById('fitBtn')!.addEventListener('click', fitToView);

// ---- Search ----

window.addEventListener('keydown', (e) => {
	if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
		e.preventDefault();
		searchBar.classList.toggle('visible');
		if (searchBar.classList.contains('visible')) { searchInput.focus(); }
		else { searchQuery = ''; render(); }
	}
	if (e.key === 'Escape') {
		searchBar.classList.remove('visible');
		searchQuery = '';
		render();
	}
});
searchInput.addEventListener('input', () => {
	searchQuery = searchInput.value;
	render();
});

// ---- Minimap ----

function renderMinimap(nodes: LayoutNode[]): void {
	minimapSvg.innerHTML = '';
	if (nodes.length === 0) { return; }

	let maxX = 0, maxY = 0;
	for (const n of nodes) {
		maxX = Math.max(maxX, n.x + n.w);
		maxY = Math.max(maxY, n.y + n.h);
	}
	minimapSvg.setAttribute('viewBox', `0 0 ${maxX + 20} ${maxY + 20}`);
	for (const n of nodes) {
		minimapSvg.appendChild(svgE('rect', {
			x: n.x, y: n.y, width: n.w, height: n.h,
			rx: '3', fill: ACCENT[n.node.module_type] || ACCENT.other, opacity: '0.6',
		}));
	}
	minimapSvg.appendChild(svgE('rect', {
		x: viewBox.x, y: viewBox.y, width: viewBox.w, height: viewBox.h,
		fill: 'none', stroke: '#89b4fa', 'stroke-width': '2', opacity: '0.6',
	}));
}

minimapDiv.addEventListener('click', (e) => {
	const rect = minimapSvg.getBoundingClientRect();
	const rx = (e.clientX - rect.left) / rect.width;
	const ry = (e.clientY - rect.top) / rect.height;
	const vb = minimapSvg.getAttribute('viewBox');
	if (!vb) { return; }
	const parts = vb.split(' ').map(Number);
	viewBox.x = rx * parts[2] - viewBox.w / 2;
	viewBox.y = ry * parts[3] - viewBox.h / 2;
	applyViewBox();
});
