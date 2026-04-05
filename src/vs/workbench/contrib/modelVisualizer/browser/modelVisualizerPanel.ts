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
import { FileAccess } from '../../../../base/common/network.js';
import { IFileService } from '../../../../platform/files/common/files.js';

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
		@IFileService private readonly _fileService: IFileService,
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

	private async _createWebview(): Promise<void> {
		if (!this._container) {
			return;
		}

		// Read the bundled renderer script
		const scriptUri = FileAccess.asFileUri('vs/workbench/contrib/modelVisualizer/browser/media/modelVisualizer.js');
		let scriptContent = '';
		try {
			const file = await this._fileService.readFile(scriptUri);
			scriptContent = file.value.toString();
		} catch (e) {
			scriptContent = 'console.error("Failed to load model visualizer renderer");';
		}

		const webview = this._webviewService.createWebviewOverlay({
			providedViewType: 'modelVisualizer',
			title: 'Model Visualizer',
			options: { enableFindWidget: false },
			contentOptions: {
				allowScripts: true,
				localResourceRoots: [],
			},
			extension: undefined,
		});

		this._webview.value = webview;

		webview.setHtml(getWebviewHtml(scriptContent));
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


function getWebviewHtml(scriptContent: string): string {
	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<title>Model Visualizer</title>
<style>
:root {
	--surface: #1a1a2e;
	--surface-block: #2a2a3e;
	--surface-pill: #353550;
	--text-primary: #e0e0f0;
	--text-muted: #8888a8;
	--text-dim: #6c6c8a;
	--border: #3a3a50;
	--font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--surface); color: var(--text-primary); font-family: var(--font-mono); overflow: hidden; width: 100vw; height: 100vh; }
#app { width: 100%; height: 100%; position: relative; }

.empty-state {
	position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
	text-align: center; color: var(--text-muted); font-size: 13px;
}

.toolbar {
	position: absolute; top: 8px; left: 8px; z-index: 10;
	display: flex; gap: 6px; align-items: center;
}
.tool-btn {
	background: var(--surface-block); border: 1px solid var(--border);
	border-radius: 6px; color: var(--text-muted); font-family: var(--font-mono);
	font-size: 11px; padding: 5px 10px; cursor: pointer; transition: all 0.15s;
}
.tool-btn:hover { color: var(--text-primary); border-color: #89b4fa; background: #353550; }

.breadcrumb {
	display: flex; align-items: center; gap: 2px;
	font-size: 12px; color: var(--text-muted); margin-left: 8px;
}
.breadcrumb-item { padding: 2px 6px; border-radius: 4px; transition: all 0.15s; }
.breadcrumb-item:hover { background: #353550; color: var(--text-primary); }
.breadcrumb-current { color: var(--text-primary); font-weight: 600; }
.breadcrumb-sep { color: var(--text-dim); }

.model-badge {
	position: absolute; top: 8px; right: 8px; z-index: 10;
	background: var(--surface-block); border: 1px solid var(--border);
	border-radius: 6px; padding: 5px 12px; font-size: 11px; color: var(--text-muted);
}

.search-bar {
	position: absolute; top: 40px; right: 8px; z-index: 10;
	background: var(--surface-block); border: 1px solid var(--border);
	border-radius: 6px; padding: 6px 10px; display: none;
}
.search-bar.visible { display: flex; }
.search-bar input {
	background: transparent; border: none; color: var(--text-primary);
	font-family: var(--font-mono); font-size: 12px; outline: none; width: 200px;
}

svg.graph { width: 100%; height: 100%; cursor: grab; }
svg.graph:active { cursor: grabbing; }

.block { cursor: default; transition: opacity 0.15s; }
.block:hover .block-rect { stroke: #89b4fa; stroke-width: 1.5; }
.search-match .block-rect { stroke: #f9e2af !important; stroke-width: 2 !important; }
.search-dimmed { opacity: 0.2; }
.chevron-btn:hover circle { fill: #4a4a65; }

.minimap {
	position: absolute; bottom: 8px; right: 8px; width: 150px; height: 100px;
	background: var(--surface-block); border: 1px solid var(--border);
	border-radius: 6px; overflow: hidden; z-index: 10; cursor: pointer;
}
.minimap svg { width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="app">
	<div class="empty-state" id="emptyState" style="display: flex;">
		<div style="font-size: 28px; margin-bottom: 8px; opacity: 0.4;">&#9724;</div>
		<div>No architecture detected yet.</div>
		<div style="margin-top: 4px; font-size: 11px;">Place a graph JSON file in <code>.arch/</code> to visualize</div>
	</div>

	<div class="toolbar" id="toolbar" style="display: none;">
		<button class="tool-btn" id="fitBtn" title="Fit to view">Fit</button>
		<div class="breadcrumb" id="breadcrumb"></div>
	</div>

	<div class="model-badge" id="modelBadge" style="display: none;"></div>

	<div class="search-bar" id="searchBar">
		<input type="text" id="searchInput" placeholder="Search modules..." />
	</div>

	<svg class="graph" id="graphSvg" style="display: none;">
		<g id="viewport"></g>
	</svg>

	<div class="minimap" id="minimap" style="display: none;">
		<svg id="minimapSvg"></svg>
	</div>
</div>
<script>${scriptContent}</script>
</body>
</html>`;
}
