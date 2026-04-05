/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IModelVisualizerService, IGraphDocument } from '../common/modelVisualizer.js';

export class ModelVisualizerService extends Disposable implements IModelVisualizerService {
	declare readonly _serviceBrand: undefined;

	private _graph: IGraphDocument | undefined;

	private readonly _onDidUpdateGraph = this._register(new Emitter<IGraphDocument>());
	readonly onDidUpdateGraph: Event<IGraphDocument> = this._onDidUpdateGraph.event;

	loadGraph(doc: IGraphDocument): void {
		this._graph = doc;
		this._onDidUpdateGraph.fire(doc);
	}

	getGraph(): IGraphDocument | undefined {
		return this._graph;
	}
}
