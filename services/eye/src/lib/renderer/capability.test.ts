import { describe, expect, it, vi } from 'vitest';
import { detectCapability } from './capability';

describe('detectCapability', () => {
	it('returns canvas2d in jsdom (no WebGL)', async () => {
		const result = await detectCapability();
		expect(result).toBe('canvas2d');
	});

	it('returns webgpu when navigator.gpu is available', async () => {
		const mockAdapter = {};
		Object.defineProperty(navigator, 'gpu', {
			value: { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) },
			configurable: true,
		});

		const result = await detectCapability();
		expect(result).toBe('webgpu');

		// Cleanup
		Object.defineProperty(navigator, 'gpu', {
			value: undefined,
			configurable: true,
		});
	});

	it('falls back to webgl2 when webgpu fails', async () => {
		Object.defineProperty(navigator, 'gpu', {
			value: { requestAdapter: vi.fn().mockResolvedValue(null) },
			configurable: true,
		});

		// Mock canvas.getContext to return a truthy value for webgl2
		const origCreateElement = document.createElement.bind(document);
		vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			const el = origCreateElement(tag);
			if (tag === 'canvas') {
				(el as HTMLCanvasElement).getContext = vi.fn().mockReturnValue({}) as never;
			}
			return el;
		});

		const result = await detectCapability();
		expect(result).toBe('webgl2');

		// Cleanup
		Object.defineProperty(navigator, 'gpu', {
			value: undefined,
			configurable: true,
		});
		vi.restoreAllMocks();
	});
});
