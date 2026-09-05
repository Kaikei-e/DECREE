import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectCapability, resetCapabilityCache } from './capability';

function stubCanvasContext(getContext: () => unknown) {
	const origCreateElement = document.createElement.bind(document);
	vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
		const el = origCreateElement(tag);
		if (tag === 'canvas') {
			(el as HTMLCanvasElement).getContext = getContext as never;
		}
		return el;
	});
}

describe('detectCapability', () => {
	afterEach(() => {
		resetCapabilityCache();
		vi.restoreAllMocks();
	});

	it('returns canvas2d in jsdom (no WebGL)', async () => {
		const report = await detectCapability();
		expect(report.capability).toBe('canvas2d');
	});

	it('returns webgl2 when WebGL2 context is available', async () => {
		const mockLoseContext = vi.fn();
		stubCanvasContext(
			vi.fn().mockReturnValue({
				getExtension: vi.fn().mockReturnValue({ loseContext: mockLoseContext }),
			}),
		);

		const report = await detectCapability();
		expect(report.capability).toBe('webgl2');
		expect(report.reason).toBeNull();
		expect(mockLoseContext).toHaveBeenCalledOnce();
	});

	it('says a refused context is different from a thrown one', async () => {
		stubCanvasContext(vi.fn().mockReturnValue(null));

		const refused = await detectCapability();
		expect(refused.capability).toBe('canvas2d');
		expect(refused.reason).toMatch(/did not provide a WebGL2 context/i);

		resetCapabilityCache();
		vi.restoreAllMocks();

		stubCanvasContext(
			vi.fn().mockImplementation(() => {
				throw new Error('WebGL is disabled by policy');
			}),
		);

		const thrown = await detectCapability();
		expect(thrown.capability).toBe('canvas2d');
		expect(thrown.reason).toContain('WebGL is disabled by policy');
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
