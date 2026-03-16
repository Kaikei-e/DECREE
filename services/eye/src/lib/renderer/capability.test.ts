import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectCapability, resetCapabilityCache } from './capability';

describe('detectCapability', () => {
	afterEach(() => {
		resetCapabilityCache();
		vi.restoreAllMocks();
	});

	it('returns canvas2d in jsdom (no WebGL)', async () => {
		const result = await detectCapability();
		expect(result).toBe('canvas2d');
	});

	it('returns webgl2 when WebGL2 context is available', async () => {
		const mockLoseContext = vi.fn();
		const origCreateElement = document.createElement.bind(document);
		vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			const el = origCreateElement(tag);
			if (tag === 'canvas') {
				(el as HTMLCanvasElement).getContext = vi.fn().mockReturnValue({
					getExtension: vi.fn().mockReturnValue({ loseContext: mockLoseContext }),
				}) as never;
			}
			return el;
		});

		const result = await detectCapability();
		expect(result).toBe('webgl2');
		expect(mockLoseContext).toHaveBeenCalledOnce();
	});

	it('caches result and does not create context on subsequent calls', async () => {
		const createSpy = vi.spyOn(document, 'createElement');

		// First call
		await detectCapability();
		const callsAfterFirst = createSpy.mock.calls.length;

		// Second call should use cache
		await detectCapability();
		expect(createSpy.mock.calls.length).toBe(callsAfterFirst);
	});
});
