import type { RendererCapability } from './types';

export interface CapabilityReport {
	capability: RendererCapability;
	/** Why WebGL2 is out, in one sentence; null when it is available. */
	reason: string | null;
}

let cached: CapabilityReport | null = null;

export async function detectCapability(): Promise<CapabilityReport> {
	if (cached) return cached;

	cached = probe();
	return cached;
}

function probe(): CapabilityReport {
	if (typeof document === 'undefined') {
		return { capability: 'canvas2d', reason: 'There is no document to test WebGL2 against.' };
	}

	try {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2');
		if (!gl) {
			return {
				capability: 'canvas2d',
				reason: 'This browser or graphics driver did not provide a WebGL2 context.',
			};
		}

		gl.getExtension('WEBGL_lose_context')?.loseContext();
		return { capability: 'webgl2', reason: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { capability: 'canvas2d', reason: `Requesting a WebGL2 context failed: ${message}` };
	}
}

/** Reset cached capability (for testing only). */
export function resetCapabilityCache() {
	cached = null;
}
