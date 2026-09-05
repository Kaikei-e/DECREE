import { Canvas2DRenderer } from './canvas2d/Canvas2DRenderer';
import { detectCapability } from './capability';
import { ThreeSceneRenderer } from './three/ThreeSceneRenderer';
import type { RendererChoice, RendererStatus, SceneRenderer } from './types';

export interface CreatedRenderer {
	renderer: SceneRenderer;
	status: RendererStatus;
}

export async function createRenderer(choice?: RendererChoice): Promise<CreatedRenderer> {
	if (choice === '2d') {
		return { renderer: new Canvas2DRenderer(), status: { kind: '2d', fallback: null } };
	}

	const report = await detectCapability();
	if (report.capability === 'webgl2') {
		return { renderer: new ThreeSceneRenderer(), status: { kind: '3d', fallback: null } };
	}

	return {
		renderer: new Canvas2DRenderer(),
		status: {
			kind: '2d',
			fallback: {
				reason: 'webgl2-unavailable',
				detail: report.reason ?? 'WebGL2 is not available here.',
			},
		},
	};
}
