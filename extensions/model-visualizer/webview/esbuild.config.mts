/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import esbuild from 'esbuild';
import path from 'path';

const srcDir = path.join(import.meta.dirname, 'src');
const outDir = path.join(import.meta.dirname, '..', '..', '..', 'src', 'vs', 'workbench', 'contrib', 'modelVisualizer', 'browser', 'media');

const isWatch = process.argv.includes('--watch');

const config: esbuild.BuildOptions = {
	entryPoints: [path.join(srcDir, 'renderer.ts')],
	bundle: true,
	outfile: path.join(outDir, 'modelVisualizer.js'),
	format: 'iife',
	platform: 'browser',
	target: ['es2020'],
	minify: !isWatch,
	sourcemap: isWatch,
	logOverride: {
		'import-is-undefined': 'error',
	},
};

async function build(): Promise<void> {
	if (isWatch) {
		const ctx = await esbuild.context(config);
		await ctx.watch();
		console.log('[modelVisualizer] Watching for changes...');
	} else {
		await esbuild.build(config).catch(() => process.exit(1));
		console.log('[modelVisualizer] Build complete');
	}
}

build();
