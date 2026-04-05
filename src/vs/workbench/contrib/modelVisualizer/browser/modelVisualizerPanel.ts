/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IModelVisualizerService } from '../common/modelVisualizer.js';
import { IWebviewService, IOverlayWebview } from '../../webview/browser/webview.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { Dimension, getWindow } from '../../../../base/browser/dom.js';

export class ModelVisualizerPanel extends ViewPane {

	private _container: HTMLElement | undefined;
	private readonly _webview = this._register(new MutableDisposable<IOverlayWebview>());
	private _webviewReady = false;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IModelVisualizerService private readonly _modelVisualizerService: IModelVisualizerService,
		@IWebviewService private readonly _webviewService: IWebviewService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this._register(this._modelVisualizerService.onDidUpdateGraph((doc) => {
			this._postMessage({ type: 'load_graph', data: doc ?? null });
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._container = container;
		this._container.classList.add('model-visualizer-panel');
		this._createWebview();

		// Initial layout kick + ResizeObserver for ongoing layout
		const resizeObserver = new ResizeObserver(() => {
			if (this._webview.value && this._container) {
				this._webview.value.layoutWebviewOverElement(this._container, new Dimension(this._container.offsetWidth, this._container.offsetHeight));
			}
		});
		resizeObserver.observe(this._container);
		this._register({ dispose: () => resizeObserver.disconnect() });

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (this._webview.value) {
				if (visible) {
					this._webview.value.claim(this, getWindow(this._container!), undefined);
					this._webview.value.layoutWebviewOverElement(this._container!);
				} else {
					this._webview.value.release(this);
				}
			}
		}));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._webview.value?.layoutWebviewOverElement(this._container!, new Dimension(width, height));
	}

	private _createWebview(): void {
		if (!this._container) {
			return;
		}

		const webview = this._webviewService.createWebviewOverlay({
			providedViewType: 'modelVisualizer',
			title: 'Model Visualizer',
			options: { enableFindWidget: false },
			contentOptions: { allowScripts: true, localResourceRoots: [] },
			extension: undefined,
		});

		this._webview.value = webview;
		webview.setHtml(getWebviewHtml());
		webview.layoutWebviewOverElement(this._container);
		webview.claim(this, getWindow(this._container), undefined);

		this._register(webview.onMessage((e: { readonly message: unknown }) => {
			const msg = e.message as { type: string };
			if (msg.type === 'ready') {
				this._webviewReady = true;
				const graph = this._modelVisualizerService.getGraph();
				this._postMessage({ type: 'load_graph', data: graph ?? null });
			}
		}));
	}

	private _postMessage(message: { type: string; data?: unknown }): void {
		if (this._webviewReady && this._webview.value) {
			this._webview.value.postMessage(message);
		}
	}
}


function getWebviewHtml(): string {
	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<title>Model Visualizer</title>
<style>
:root {
	--surface: #1e1e2e;
	--surface-nested: #262637;
	--surface-nested-2: #2e2e42;
	--pill-bg: #313244;
	--text-primary: #cdd6f4;
	--text-muted: #a6adc8;
	--font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
	--accent-container: #6c7086;
	--accent-attention: #89b4fa;
	--accent-feedforward: #a6e3a1;
	--accent-normalization: #cba6f7;
	--accent-loss: #fab387;
	--accent-embedding: #f9e2af;
	--accent-linear: #74c7ec;
	--accent-activation: #f38ba8;
	--accent-dropout: #9399b2;
	--accent-pooling: #94e2d5;
	--accent-other: #6c7086;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--surface); color: var(--text-primary); font-family: var(--font-mono); overflow: hidden; width: 100vw; height: 100vh; }
#app { width: 100%; height: 100%; position: relative; }

/* Empty state */
.empty-state {
	position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
	text-align: center; color: var(--text-muted); font-size: 13px;
}
/* Toolbar */
.toolbar {
	position: absolute; top: 8px; left: 8px; z-index: 10;
	display: flex; gap: 6px;
}
.tool-btn {
	background: var(--surface-nested); border: 1px solid var(--accent-container);
	border-radius: 4px; color: var(--text-muted); font-family: var(--font-mono);
	font-size: 11px; padding: 4px 8px; cursor: pointer;
}
.tool-btn:hover { color: var(--text-primary); border-color: var(--accent-attention); }

/* Model info badge */
.model-badge {
	position: absolute; top: 8px; right: 8px; z-index: 10;
	background: var(--surface-nested); border: 1px solid var(--accent-container);
	border-radius: 4px; padding: 4px 10px; font-size: 11px; color: var(--text-muted);
}

/* Search */
.search-bar {
	position: absolute; top: 40px; right: 8px; z-index: 10;
	background: var(--surface-nested); border: 1px solid var(--accent-container);
	border-radius: 6px; padding: 6px 10px; display: none;
}
.search-bar.visible { display: flex; }
.search-bar input {
	background: transparent; border: none; color: var(--text-primary);
	font-family: var(--font-mono); font-size: 12px; outline: none; width: 200px;
}

/* SVG */
svg.graph { width: 100%; height: 100%; cursor: grab; }
svg.graph:active { cursor: grabbing; }
.block-rect { rx: 6; ry: 6; }
.block-name { font-size: 13px; font-family: var(--font-mono); font-weight: 600; }
.block-class { font-size: 11px; font-family: var(--font-mono); }
.shape-pill { rx: 10; ry: 10; }
.shape-pill-text { font-size: 11px; font-family: var(--font-mono); text-anchor: middle; dominant-baseline: central; }
.shape-arrow-text { font-size: 12px; font-family: var(--font-mono); text-anchor: middle; dominant-baseline: central; }
.chevron { cursor: pointer; }
.repeat-badge { font-size: 11px; font-weight: 700; font-family: var(--font-mono); }
.repeat-shadow { rx: 6; ry: 6; }
.flow-arrow { fill: none; stroke-width: 1.5; marker-end: url(#arrowhead); }
.cross-edge { fill: none; stroke-width: 1.5; stroke-dasharray: 6 4; }
.cross-label { font-size: 10px; font-family: var(--font-mono); }
.edge-shape-pill { rx: 8; ry: 8; }
.edge-shape-text { font-size: 9px; font-family: var(--font-mono); text-anchor: middle; dominant-baseline: central; }
.search-match .block-rect { stroke: #f9e2af; stroke-width: 2; }
.search-dimmed { opacity: 0.25; }

/* Minimap */
.minimap {
	position: absolute; bottom: 8px; right: 8px; width: 150px; height: 100px;
	background: var(--surface-nested); border: 1px solid var(--accent-container);
	border-radius: 4px; overflow: hidden; z-index: 10; cursor: pointer;
}
.minimap svg { width: 100%; height: 100%; }
.minimap-viewport { fill: none; stroke: var(--accent-attention); stroke-width: 2; opacity: 0.6; }
</style>
</head>
<body>
<div id="app">
	<div class="empty-state" id="emptyState">
		<div style="font-size: 28px; margin-bottom: 8px; opacity: 0.5;">&#9724;</div>
		<div>No architecture detected yet.</div>
		<div style="margin-top: 4px; font-size: 11px;">Place a graph JSON file in <code>.arch/</code> to visualize</div>
	</div>

	<div class="toolbar" id="toolbar" style="display:none;">
		<button class="tool-btn" id="fitBtn" title="Fit to view (F)">Fit</button>
	</div>

	<div class="model-badge" id="modelBadge" style="display:none;"></div>

	<div class="search-bar" id="searchBar">
		<input type="text" id="searchInput" placeholder="Search modules..." />
	</div>

	<svg class="graph" id="graphSvg" style="display:none;">
		<defs>
			<marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
				<polygon points="0 0, 8 3, 0 6" fill="#a6adc8" />
			</marker>
			<marker id="arrowhead-green" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
				<polygon points="0 0, 8 3, 0 6" fill="#a6e3a1" />
			</marker>
		</defs>
		<g id="viewport"></g>
	</svg>

	<div class="minimap" id="minimap" style="display:none;">
		<svg id="minimapSvg"></svg>
	</div>
</div>
<script>
(function() {
var vscode = acquireVsCodeApi();

// ---------- State ----------
var doc = null;        // IGraphDocument
var expanded = {};     // node id -> bool
var viewBox = { x: 0, y: 0, w: 800, h: 600 };
var isPanning = false;
var panStart = { x: 0, y: 0 };
var searchQuery = '';

// ---------- Constants ----------
var BLOCK_W = 260;
var BLOCK_H = 72;
var CHILD_GAP = 10;
var INDENT = 32;
var ACCENT_W = 4;
var ACCENT = {
	container:'#6c7086', attention:'#89b4fa', feedforward:'#a6e3a1',
	normalization:'#cba6f7', loss:'#fab387', embedding:'#f9e2af',
	linear:'#74c7ec', activation:'#f38ba8', dropout:'#9399b2',
	pooling:'#94e2d5', other:'#6c7086'
};

// ---------- DOM refs ----------
var emptyState   = document.getElementById('emptyState');
var toolbar      = document.getElementById('toolbar');
var modelBadge   = document.getElementById('modelBadge');
var graphSvg     = document.getElementById('graphSvg');
var vp           = document.getElementById('viewport');
var fitBtn       = document.getElementById('fitBtn');
var searchBar    = document.getElementById('searchBar');
var searchInput  = document.getElementById('searchInput');
var minimapDiv   = document.getElementById('minimap');
var minimapSvg   = document.getElementById('minimapSvg');

// ---------- Communication ----------
vscode.postMessage({ type: 'ready' });

window.addEventListener('message', function(ev) {
	var msg = ev.data;
	if (msg.type === 'load_graph') {
		doc = msg.data;
		expanded = {};
		onGraphUpdate();
	}
});

function onGraphUpdate() {
	if (!doc) {
		emptyState.style.display = 'flex';
		toolbar.style.display = 'none';
		graphSvg.style.display = 'none';
		minimapDiv.style.display = 'none';
		modelBadge.style.display = 'none';
		return;
	}
	emptyState.style.display = 'none';
	toolbar.style.display = 'flex';
	graphSvg.style.display = 'block';
	minimapDiv.style.display = 'block';
	modelBadge.style.display = 'block';
	modelBadge.textContent = doc.model_name + (doc.meta.partial ? ' (partial)' : '');
	render();
}

// ---------- Layout ----------
// Produces a flat list of { node, id, depth, x, y, w, h, isExpanded, hasChildren }
function computeLayout() {
	if (!doc) return [];
	var entries = [];
	var y = 20;
	var nodes = doc.nodes;
	var rootNode = nodes[doc.root];
	if (!rootNode) return [];

	function walk(nodeId, depth) {
		var node = nodes[nodeId];
		if (!node || !node.is_canonical) return;
		var isExp = !!expanded[nodeId];
		var kids = (node.children || []).filter(function(cid) {
			var c = nodes[cid];
			return c && c.is_canonical;
		}).sort(function(a, b) {
			return (nodes[a].order || 0) - (nodes[b].order || 0);
		});
		var hasChildren = kids.length > 0;
		var x = 20 + depth * INDENT;
		var entry = { node: node, id: nodeId, depth: depth, x: x, y: y, w: BLOCK_W, h: BLOCK_H, isExpanded: isExp, hasChildren: hasChildren };
		entries.push(entry);

		if (isExp && hasChildren) {
			y += BLOCK_H + CHILD_GAP;
			for (var i = 0; i < kids.length; i++) {
				walk(kids[i], depth + 1);
				y += CHILD_GAP;
			}
			entry.h = y - entry.y;
		} else {
			y += BLOCK_H + CHILD_GAP;
		}
	}
	walk(doc.root, 0);
	return entries;
}

// ---------- SVG helpers ----------
function svgE(tag, attrs) {
	var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
	if (attrs) for (var k in attrs) el.setAttribute(k, '' + attrs[k]);
	return el;
}
function shapeStr(s) { return '[' + s.join(', ') + ']'; }

// ---------- Render blocks ----------
function renderBlock(entry) {
	var n = entry.node;
	var x = entry.x, y = entry.y, w = entry.w, h = entry.h;
	var accent = ACCENT[n.module_type] || ACCENT.other;
	var g = svgE('g', {});

	// Search match
	var cls = 'block';
	if (!n.traceable) cls += ' untraceable';
	if (searchQuery) {
		var q = searchQuery.toLowerCase();
		var match = n.name.toLowerCase().indexOf(q) >= 0 || n.class_name.toLowerCase().indexOf(q) >= 0 ||
			n.id.toLowerCase().indexOf(q) >= 0 || n.module_type.toLowerCase().indexOf(q) >= 0;
		cls += match ? ' search-match' : ' search-dimmed';
	}
	g.setAttribute('class', cls);

	// Repeat shadows
	if (n.repeat_count && n.repeat_count > 1) {
		g.appendChild(svgE('rect', { 'class': 'repeat-shadow', x: x+6, y: y-6, width: w, height: BLOCK_H, fill: '#262637', opacity: 0.25 }));
		g.appendChild(svgE('rect', { 'class': 'repeat-shadow', x: x+3, y: y-3, width: w, height: BLOCK_H, fill: '#262637', opacity: 0.35 }));
	}

	// Main rect
	g.appendChild(svgE('rect', { 'class': 'block-rect', x: x, y: y, width: w, height: h, fill: '#262637', stroke: 'none' }));

	// Accent bar
	var accentAttrs = { x: x, y: y, width: ACCENT_W, height: h, rx: 3, ry: 3 };
	if (n.traceable) {
		accentAttrs.fill = accent; accentAttrs.stroke = 'none';
	} else {
		accentAttrs.fill = 'none'; accentAttrs.stroke = accent;
		accentAttrs['stroke-width'] = 2; accentAttrs['stroke-dasharray'] = '4 3';
	}
	g.appendChild(svgE('rect', accentAttrs));

	// Name
	var nameEl = svgE('text', { 'class': 'block-name', x: x+ACCENT_W+10, y: y+20, fill: '#cdd6f4' });
	nameEl.textContent = n.name; g.appendChild(nameEl);

	// Class name
	var classEl = svgE('text', { 'class': 'block-class', x: x+ACCENT_W+10, y: y+35, fill: '#a6adc8' });
	classEl.textContent = n.class_name; g.appendChild(classEl);

	// Shape pills
	if (n.input_shapes && n.input_shapes.length > 0) {
		var inStr = shapeStr(n.input_shapes[0]);
		var px = x + ACCENT_W + 10, py = y + 50;
		var pw = inStr.length * 7 + 10;
		g.appendChild(svgE('rect', { 'class': 'shape-pill', x: px, y: py-9, width: pw, height: 18, fill: '#313244' }));
		var pt = svgE('text', { 'class': 'shape-pill-text', x: px+pw/2, y: py, fill: '#cdd6f4' });
		pt.textContent = inStr; g.appendChild(pt);

		if (n.output_shapes && n.output_shapes.length > 0) {
			var outStr = shapeStr(n.output_shapes[0]);
			var ax = px + pw + 6;
			var at = svgE('text', { 'class': 'shape-arrow-text', x: ax, y: py, fill: '#a6adc8' });
			at.textContent = '\u2192'; g.appendChild(at);
			var opx = ax + 14, opw = outStr.length * 7 + 10;
			g.appendChild(svgE('rect', { 'class': 'shape-pill', x: opx, y: py-9, width: opw, height: 18, fill: '#313244' }));
			var opt = svgE('text', { 'class': 'shape-pill-text', x: opx+opw/2, y: py, fill: '#cdd6f4' });
			opt.textContent = outStr; g.appendChild(opt);
		}
	}

	// Chevron
	if (entry.hasChildren) {
		var chev = svgE('text', { 'class': 'chevron', x: x+w-20, y: y+22, 'font-size': 14, fill: '#a6adc8' });
		chev.textContent = entry.isExpanded ? '\u25BC' : '\u25B6';
		chev.addEventListener('click', function(e) {
			e.stopPropagation();
			expanded[entry.id] = !expanded[entry.id];
			render();
		});
		g.appendChild(chev);
	}

	// Repeat badge
	if (n.repeat_count && n.repeat_count > 1) {
		var badge = svgE('text', { 'class': 'repeat-badge', x: x+w-45, y: y+22, fill: '#89b4fa' });
		badge.textContent = '\u00D7' + n.repeat_count; g.appendChild(badge);
	}

	// Untraceable badge
	if (!n.traceable) {
		var warn = svgE('text', { x: x+w-22, y: y+38, fill: '#fab387', 'font-size': 14 });
		warn.textContent = '\u26A0'; g.appendChild(warn);
	}

	return g;
}

// ---------- Render edges ----------
function renderFlowEdges(entries) {
	var g = svgE('g', {});
	if (!doc || !doc.edges) return g;

	var entryMap = {};
	for (var i = 0; i < entries.length; i++) entryMap[entries[i].id] = entries[i];

	var flowEdges = doc.edges.filter(function(e) { return e.type === 'flow'; });

	for (var j = 0; j < flowEdges.length; j++) {
		var edge = flowEdges[j];
		var srcEntry = entryMap[edge.source.node];
		var tgtEntry = entryMap[edge.target.node];
		if (!srcEntry || !tgtEntry) continue;

		var srcPort = doc.nodes[edge.source.node].ports[edge.source.port];
		var tgtPort = doc.nodes[edge.target.node].ports[edge.target.port];
		if (!srcPort || !tgtPort) continue;

		var coords = getPortCoords(srcEntry, srcPort.side, 'source');
		var coordt = getPortCoords(tgtEntry, tgtPort.side, 'target');

		// Only draw if there's actual vertical distance
		if (Math.abs(coordt.y - coords.y) < 2 && Math.abs(coordt.x - coords.x) < 2) continue;

		var line = svgE('line', {
			'class': 'flow-arrow',
			x1: coords.x, y1: coords.y, x2: coordt.x, y2: coordt.y,
			stroke: '#a6adc8', opacity: 0.5
		});
		g.appendChild(line);

		// Shape pill on edge midpoint
		if (edge.shape && edge.shape.length > 0) {
			var mx = (coords.x + coordt.x) / 2 + 12;
			var my = (coords.y + coordt.y) / 2;
			var st = shapeStr(edge.shape);
			var sw = st.length * 6 + 8;
			g.appendChild(svgE('rect', { 'class': 'edge-shape-pill', x: mx-sw/2, y: my-8, width: sw, height: 16, fill: '#313244', opacity: 0.8 }));
			var stxt = svgE('text', { 'class': 'edge-shape-text', x: mx, y: my, fill: '#a6adc8' });
			stxt.textContent = st; g.appendChild(stxt);
		}
	}
	return g;
}

function renderCrossEdges(entries) {
	var g = svgE('g', {});
	if (!doc || !doc.edges) return g;

	var entryMap = {};
	for (var i = 0; i < entries.length; i++) entryMap[entries[i].id] = entries[i];

	var crossEdges = doc.edges.filter(function(e) { return e.type === 'cross'; });

	for (var j = 0; j < crossEdges.length; j++) {
		var edge = crossEdges[j];
		var srcEntry = entryMap[edge.source.node];
		var tgtEntry = entryMap[edge.target.node];
		if (!srcEntry || !tgtEntry) continue;

		var srcPort = doc.nodes[edge.source.node].ports[edge.source.port];
		var tgtPort = doc.nodes[edge.target.node].ports[edge.target.port];
		if (!srcPort || !tgtPort) continue;

		var coords = getPortCoords(srcEntry, srcPort.side, 'source');
		var coordt = getPortCoords(tgtEntry, tgtPort.side, 'target');

		var bulge = Math.max(60, Math.abs(coordt.y - coords.y) * 0.35);
		var cpx1 = coords.x, cpy1 = coords.y;
		var cpx2 = coordt.x, cpy2 = coordt.y;

		// Bezier control points based on port sides
		if (srcPort.side === 'left' || srcPort.side === 'right') {
			var dir = srcPort.side === 'right' ? 1 : -1;
			cpx1 = coords.x + dir * bulge;
		} else {
			cpy1 = coords.y + (srcPort.side === 'bottom' ? bulge : -bulge);
		}
		if (tgtPort.side === 'left' || tgtPort.side === 'right') {
			var dir2 = tgtPort.side === 'right' ? 1 : -1;
			cpx2 = coordt.x + dir2 * bulge;
		} else {
			cpy2 = coordt.y + (tgtPort.side === 'bottom' ? bulge : -bulge);
		}

		var strokeColor = edge.label === 'residual' ? '#a6e3a1' : '#89b4fa';
		var path = svgE('path', {
			'class': 'cross-edge',
			d: 'M ' + coords.x + ' ' + coords.y + ' C ' + cpx1 + ' ' + cpy1 + ', ' + cpx2 + ' ' + cpy2 + ', ' + coordt.x + ' ' + coordt.y,
			stroke: strokeColor, opacity: 0.5
		});
		g.appendChild(path);

		// Label
		if (edge.label) {
			var lx = (coords.x + coordt.x) / 2 + (srcPort.side === 'right' || srcPort.side === 'left' ? bulge * 0.4 : 0);
			var ly = (coords.y + coordt.y) / 2;
			var lbl = svgE('text', { 'class': 'cross-label', x: lx, y: ly - 6, fill: strokeColor, opacity: 0.7 });
			lbl.textContent = edge.label; g.appendChild(lbl);
		}
	}
	return g;
}

function getPortCoords(entry, side, role) {
	var x = entry.x, y = entry.y, w = entry.w, h = entry.h;
	switch (side) {
		case 'top':    return { x: x + w / 2, y: y };
		case 'bottom': return { x: x + w / 2, y: y + h };
		case 'left':   return { x: x,         y: y + BLOCK_H / 2 };
		case 'right':  return { x: x + w,     y: y + BLOCK_H / 2 };
		default:       return { x: x + w / 2, y: role === 'source' ? y + h : y };
	}
}

// ---------- Main render ----------
function render() {
	if (!doc) return;
	vp.innerHTML = '';
	var entries = computeLayout();
	if (entries.length === 0) return;

	// Flow edges behind blocks
	vp.appendChild(renderFlowEdges(entries));

	// Blocks
	for (var i = 0; i < entries.length; i++) vp.appendChild(renderBlock(entries[i]));

	// Cross edges on top
	vp.appendChild(renderCrossEdges(entries));

	// Fit viewBox to content
	var maxX = 0, maxY = 0;
	for (var j = 0; j < entries.length; j++) {
		maxX = Math.max(maxX, entries[j].x + entries[j].w + 80);
		maxY = Math.max(maxY, entries[j].y + entries[j].h + 20);
	}
	viewBox.w = Math.max(maxX, 400);
	viewBox.h = Math.max(maxY, 300);
	applyViewBox();
	renderMinimap(entries);
}

function applyViewBox() {
	graphSvg.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
}

// ---------- Minimap ----------
function renderMinimap(entries) {
	minimapSvg.innerHTML = '';
	var maxX = 0, maxY = 0;
	for (var i = 0; i < entries.length; i++) {
		maxX = Math.max(maxX, entries[i].x + entries[i].w);
		maxY = Math.max(maxY, entries[i].y + entries[i].h);
	}
	minimapSvg.setAttribute('viewBox', '0 0 ' + (maxX + 20) + ' ' + (maxY + 20));
	for (var j = 0; j < entries.length; j++) {
		var e = entries[j];
		minimapSvg.appendChild(svgE('rect', {
			x: e.x, y: e.y, width: e.w, height: Math.min(e.h, BLOCK_H),
			rx: 2, fill: ACCENT[e.node.module_type] || ACCENT.other, opacity: 0.6
		}));
	}
	minimapSvg.appendChild(svgE('rect', {
		'class': 'minimap-viewport', x: viewBox.x, y: viewBox.y, width: viewBox.w, height: viewBox.h
	}));
}

// ---------- Interactions ----------

// Zoom
graphSvg.addEventListener('wheel', function(e) {
	e.preventDefault();
	var scale = e.deltaY > 0 ? 1.1 : 0.9;
	var rect = graphSvg.getBoundingClientRect();
	var mx = (e.clientX - rect.left) / rect.width;
	var my = (e.clientY - rect.top) / rect.height;
	var nw = viewBox.w * scale, nh = viewBox.h * scale;
	viewBox.x += (viewBox.w - nw) * mx;
	viewBox.y += (viewBox.h - nh) * my;
	viewBox.w = nw; viewBox.h = nh;
	applyViewBox();
}, { passive: false });

// Pan
graphSvg.addEventListener('mousedown', function(e) {
	if (e.target === graphSvg || e.target.id === 'viewport' || e.target.tagName === 'svg') {
		isPanning = true; panStart = { x: e.clientX, y: e.clientY };
	}
});
window.addEventListener('mousemove', function(e) {
	if (!isPanning) return;
	var rect = graphSvg.getBoundingClientRect();
	viewBox.x -= (e.clientX - panStart.x) * (viewBox.w / rect.width);
	viewBox.y -= (e.clientY - panStart.y) * (viewBox.h / rect.height);
	panStart = { x: e.clientX, y: e.clientY };
	applyViewBox();
});
window.addEventListener('mouseup', function() { isPanning = false; });

// Fit
fitBtn.addEventListener('click', function() {
	viewBox = { x: 0, y: 0, w: 800, h: 600 };
	render();
});

// Search
window.addEventListener('keydown', function(e) {
	if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
		e.preventDefault();
		searchBar.classList.toggle('visible');
		if (searchBar.classList.contains('visible')) searchInput.focus();
		else { searchQuery = ''; render(); }
	}
	if (e.key === 'Escape') { searchBar.classList.remove('visible'); searchQuery = ''; render(); }
	if (e.key === 'f' && !e.metaKey && !e.ctrlKey && e.target === document.body) {
		viewBox = { x: 0, y: 0, w: 800, h: 600 }; render();
	}
});
searchInput.addEventListener('input', function() { searchQuery = searchInput.value; render(); });

// Minimap click
minimapDiv.addEventListener('click', function(e) {
	var rect = minimapSvg.getBoundingClientRect();
	var rx = (e.clientX - rect.left) / rect.width;
	var ry = (e.clientY - rect.top) / rect.height;
	var vb = minimapSvg.getAttribute('viewBox');
	if (!vb) return;
	var parts = vb.split(' ').map(Number);
	viewBox.x = rx * parts[2] - viewBox.w / 2;
	viewBox.y = ry * parts[3] - viewBox.h / 2;
	applyViewBox();
});

})();
</script>
</body>
</html>`;
}
