import { Canvas2DRenderer } from './canvas2d/Canvas2DRenderer';
import { detectCapability } from './capability';
import { ThreeSceneRenderer } from './three/ThreeSceneRenderer';
import type { SceneRenderer } from './types';

export type RendererChoice = '3d' | '2d';

export async function createRenderer(choice?: RendererChoice): Promise<SceneRenderer> {
	if (choice === '2d') {
		return new Canvas2DRenderer();
	}

	const cap = await detectCapability();
	if (cap === 'webgl2') {
		return new ThreeSceneRenderer();
	}

	return new Canvas2DRenderer();
}
