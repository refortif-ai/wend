/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const MODEL_VISUALIZER_VIEW_CONTAINER_ID = 'workbench.view.modelVisualizer';
export const MODEL_VISUALIZER_VIEW_ID = 'workbench.view.modelVisualizer.main';

export const enum ModelVisualizerCommandId {
	Toggle = 'workbench.action.modelVisualizer.toggle',
	Upload = 'workbench.action.modelVisualizer.upload',
}

// --- Graph Notation Types (matches spec exactly) ---

export interface IPort {
	readonly side: 'top' | 'bottom' | 'left' | 'right';
	readonly shape: number[];
}

export interface IGraphNode {
	readonly id: string;
	readonly parent: string | null;
	readonly children: string[];
	readonly order: number;
	readonly name: string;
	readonly class_name: string;
	readonly module_type: string;
	readonly input_shapes: number[][];
	readonly output_shapes: number[][];
	readonly repeat_group: string | null;
	readonly repeat_count: number | null;
	readonly is_canonical: boolean;
	readonly traceable: boolean;
	readonly operations: string[];
	readonly ports: Record<string, IPort>;
}

export interface IEdgeEndpoint {
	readonly node: string;
	readonly port: string;
}

export interface IEdge {
	readonly id: string;
	readonly type: 'flow' | 'cross';
	readonly source: IEdgeEndpoint;
	readonly target: IEdgeEndpoint;
	readonly shape: number[];
	readonly label: string | null;
	readonly operation?: string;
}

export interface IGraphMeta {
	readonly input_shapes: number[][];
	readonly framework: string;
	readonly partial: boolean;
}

export interface IGraphDocument {
	readonly version: string;
	readonly model_name: string;
	readonly model_class: string;
	readonly nodes: Record<string, IGraphNode>;
	readonly edges: IEdge[];
	readonly root: string;
	readonly meta: IGraphMeta;
}

// --- Service ---

export interface IModelVisualizerService {
	readonly _serviceBrand: undefined;
	readonly onDidUpdateGraph: Event<IGraphDocument>;
	loadGraph(doc: IGraphDocument): void;
	getGraph(): IGraphDocument | undefined;
}

export const IModelVisualizerService = createDecorator<IModelVisualizerService>('modelVisualizerService');
