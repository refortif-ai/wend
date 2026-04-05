/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { localize, localize2 } from '../../../../nls.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

import {
	MODEL_VISUALIZER_VIEW_CONTAINER_ID,
	MODEL_VISUALIZER_VIEW_ID,
	ModelVisualizerCommandId,
	IModelVisualizerService,
} from '../common/modelVisualizer.js';
import { ModelVisualizerService } from './modelVisualizerService.js';
import { ModelVisualizerPanel } from './modelVisualizerPanel.js';

// --- Icons ---

const modelVisualizerViewIcon = registerIcon('model-visualizer-view-icon', Codicon.symbolStructure, localize('modelVisualizerViewIcon', 'View icon of the Model Visualizer view.'));

// --- Service ---

registerSingleton(IModelVisualizerService, ModelVisualizerService, InstantiationType.Delayed);

// --- View Container & View ---

const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: MODEL_VISUALIZER_VIEW_CONTAINER_ID,
	title: localize2('modelVisualizer', "Model Visualizer"),
	icon: modelVisualizerViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [MODEL_VISUALIZER_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: MODEL_VISUALIZER_VIEW_CONTAINER_ID,
	hideIfEmpty: false,
	order: 10,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: MODEL_VISUALIZER_VIEW_ID,
	name: localize2('modelVisualizer', "Model Visualizer"),
	containerIcon: modelVisualizerViewIcon,
	canToggleVisibility: true,
	canMoveView: true,
	ctorDescriptor: new SyncDescriptor(ModelVisualizerPanel),
	openCommandActionDescriptor: {
		id: ModelVisualizerCommandId.Toggle,
		mnemonicTitle: localize({ key: 'miModelVisualizer', comment: ['&& denotes a mnemonic'] }, "&&Model Visualizer"),
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyM,
		},
		order: 10,
	},
}], VIEW_CONTAINER);

