import type { RendererCapability } from './types';

let cached: RendererCapability | null = null;

export async function detectCapability(): Promise<RendererCapability> {
	if (cached) return cached;

	if (typeof document !== 'undefined') {
		try {
			const canvas = document.createElement('canvas');
			const gl = canvas.getContext('webgl2');
			if (gl) {
				gl.getExtension('WEBGL_lose_context')?.loseContext();
				cached = 'webgl2';
				return cached;
			}
		} catch {
			// WebGL2 not available
		}
	}

	cached = 'canvas2d';
	return cached;
}

/** Reset cached capability (for testing only). */
export function resetCapabilityCache() {
	cached = null;
}
