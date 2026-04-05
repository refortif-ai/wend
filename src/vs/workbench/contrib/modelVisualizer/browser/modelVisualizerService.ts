/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IModelVisualizerService, IGraphDocument } from '../common/modelVisualizer.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { URI } from '../../../../base/common/uri.js';

export class ModelVisualizerService extends Disposable implements IModelVisualizerService {
	declare readonly _serviceBrand: undefined;

	private _graph: IGraphDocument | undefined;
	private _archFolder: URI | undefined;

	private readonly _onDidUpdateGraph = this._register(new Emitter<IGraphDocument | undefined>());
	readonly onDidUpdateGraph: Event<IGraphDocument | undefined> = this._onDidUpdateGraph.event;

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._init();
	}

	private _init(): void {
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return;
		}

		this._archFolder = URI.joinPath(folders[0].uri, '.arch');

		// Watch .arch/ for changes
		this._register(this._fileService.onDidFilesChange(e => {
			if (this._archFolder && e.affects(this._archFolder)) {
				this._scanAndLoad();
			}
		}));

		// Also watch via createWatcher so we get events even if .arch/ doesn't exist yet
		this._register(this._fileService.createWatcher(this._archFolder, { recursive: false, excludes: [] }));

		// Initial scan
		this._scanAndLoad();
	}

	private async _scanAndLoad(): Promise<void> {
		if (!this._archFolder) {
			return;
		}

		try {
			const stat = await this._fileService.resolve(this._archFolder);
			if (!stat.children || stat.children.length === 0) {
				this._graph = undefined;
				this._onDidUpdateGraph.fire(undefined);
				return;
			}

			// Filter .json files and find the newest by mtime
			const jsonFiles = stat.children.filter(c => c.name.endsWith('.json') && !c.isDirectory);
			if (jsonFiles.length === 0) {
				this._graph = undefined;
				this._onDidUpdateGraph.fire(undefined);
				return;
			}

			// Resolve with metadata to get mtime
			let newest: { uri: URI; mtime: number } | undefined;
			for (const file of jsonFiles) {
				try {
					const meta = await this._fileService.resolve(file.resource, { resolveMetadata: true });
					const mtime = meta.mtime ?? 0;
					if (!newest || mtime > newest.mtime) {
						newest = { uri: file.resource, mtime };
					}
				} catch {
					// skip files we can't stat
				}
			}

			if (!newest) {
				this._graph = undefined;
				this._onDidUpdateGraph.fire(undefined);
				return;
			}

			// Read and parse
			const content = await this._fileService.readFile(newest.uri);
			const text = content.value.toString();
			const doc = JSON.parse(text) as IGraphDocument;
			this.loadGraph(doc);

		} catch (e) {
			// .arch/ doesn't exist or isn't readable — that's fine
			this._logService.debug('[ModelVisualizer] .arch/ not found or not readable');
			this._graph = undefined;
			this._onDidUpdateGraph.fire(undefined);
		}
	}

	loadGraph(doc: IGraphDocument): void {
		this._graph = doc;
		this._onDidUpdateGraph.fire(doc);
	}

	getGraph(): IGraphDocument | undefined {
		return this._graph;
	}
}
