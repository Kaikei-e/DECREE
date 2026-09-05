import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityReport } from './capability';

const capability = vi.hoisted(() => ({
	report: { capability: 'canvas2d', reason: 'stub' } as CapabilityReport,
}));

vi.mock('./capability', () => ({
	detectCapability: async () => capability.report,
	resetCapabilityCache: () => {},
}));

import { Canvas2DRenderer } from './canvas2d/Canvas2DRenderer';
import { createRenderer } from './factory';
import { ThreeSceneRenderer } from './three/ThreeSceneRenderer';

describe('createRenderer', () => {
	beforeEach(() => {
		capability.report = { capability: 'webgl2', reason: null };
	});

	it('builds the 3D scene when WebGL2 is there', async () => {
		const created = await createRenderer('3d');

		expect(created.renderer).toBeInstanceOf(ThreeSceneRenderer);
		expect(created.status).toEqual({ kind: '3d', fallback: null });
	});

	it('honours an explicit 2D choice without calling it a fallback', async () => {
		const created = await createRenderer('2d');

		expect(created.renderer).toBeInstanceOf(Canvas2DRenderer);
		expect(created.status).toEqual({ kind: '2d', fallback: null });
	});

	it('reports why it fell back instead of silently returning 2D', async () => {
		capability.report = { capability: 'canvas2d', reason: 'Driver blocklisted WebGL2.' };

		const created = await createRenderer('3d');

		expect(created.renderer).toBeInstanceOf(Canvas2DRenderer);
		expect(created.status).toEqual({
			kind: '2d',
			fallback: { reason: 'webgl2-unavailable', detail: 'Driver blocklisted WebGL2.' },
		});
	});
});
