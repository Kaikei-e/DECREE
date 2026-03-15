import type { RendererCapability } from './types';

export async function detectCapability(): Promise<RendererCapability> {
	if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
		try {
			const adapter = await (navigator as { gpu: GPU }).gpu.requestAdapter();
			if (adapter) return 'webgpu';
		} catch {
			// WebGPU not available
		}
	}

	if (typeof document !== 'undefined') {
		try {
			const canvas = document.createElement('canvas');
			const gl = canvas.getContext('webgl2');
			if (gl) return 'webgl2';
		} catch {
			// WebGL2 not available
		}
	}

	return 'canvas2d';
}
