import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockForceContextLoss = vi.fn();
const mockRendererDispose = vi.fn();
const mockRendererRender = vi.fn();
const mockDomElement = document.createElement('canvas');

const mockControlsDispose = vi.fn();
const mockControlsUpdate = vi.fn();

const mockTimerUpdate = vi.fn();
const mockTimerGetElapsed = vi.fn().mockReturnValue(0);
const mockTimerConnect = vi.fn();
const mockTimerDisconnect = vi.fn();
const mockTimerDispose = vi.fn();

vi.mock('three', async () => {
	const actual = await vi.importActual<typeof import('three')>('three');
	return {
		...actual,
		WebGLRenderer: class {
			setPixelRatio = vi.fn();
			setSize = vi.fn();
			setClearColor = vi.fn();
			render = mockRendererRender;
			dispose = mockRendererDispose;
			forceContextLoss = mockForceContextLoss;
			domElement = mockDomElement;
		},
		Timer: class {
			update = mockTimerUpdate;
			getElapsed = mockTimerGetElapsed;
			connect = mockTimerConnect;
			disconnect = mockTimerDisconnect;
			dispose = mockTimerDispose;
		},
	};
});

vi.mock('three/addons/controls/OrbitControls.js', () => ({
	OrbitControls: class {
		enableDamping = false;
		dampingFactor = 0;
		target = { clone: () => ({ lerpVectors: vi.fn() }) };
		dispose = mockControlsDispose;
		update = mockControlsUpdate;
	},
}));

vi.mock('./camera-presets', () => ({
	animateCamera: vi.fn().mockReturnValue(() => {}),
	overviewPreset: vi.fn().mockReturnValue({
		position: { x: 0, y: 0, z: 0 },
		lookAt: { x: 0, y: 0, z: 0 },
	}),
	clusterPreset: vi.fn(),
	nodePreset: vi.fn(),
	topDownPreset: vi.fn().mockReturnValue({
		position: { x: 0, y: 40, z: 0 },
		lookAt: { x: 0, y: 0, z: 0.001 },
	}),
	frontPreset: vi.fn().mockReturnValue({
		position: { x: 0, y: 0, z: 40 },
		lookAt: { x: 0, y: 0, z: 0 },
	}),
}));

vi.mock('./node-material', () => ({
	createNodeMaterial: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	createEdgeMaterial: vi.fn().mockReturnValue({ dispose: vi.fn() }),
}));

vi.mock('./raycaster', () => ({
	NodeRaycaster: class {
		updatePointer = vi.fn();
		pick = vi.fn().mockReturnValue(null);
		setInstancedMesh = vi.fn();
	},
}));

// Import after mocks
const { ThreeSceneRenderer } = await import('./ThreeSceneRenderer');

describe('ThreeSceneRenderer', () => {
	let container: HTMLElement;
	let renderer: InstanceType<typeof ThreeSceneRenderer>;

	beforeEach(() => {
		vi.clearAllMocks();
		container = document.createElement('div');
		Object.defineProperty(container, 'clientWidth', { value: 800 });
		Object.defineProperty(container, 'clientHeight', { value: 600 });
		renderer = new ThreeSceneRenderer();
	});

	it('calls forceContextLoss before dispose on WebGLRenderer', () => {
		renderer.mount(container);
		renderer.dispose();

		expect(mockForceContextLoss).toHaveBeenCalledOnce();
		expect(mockRendererDispose).toHaveBeenCalledOnce();

		const forceLossOrder = mockForceContextLoss.mock.invocationCallOrder[0]!;
		const disposeOrder = mockRendererDispose.mock.invocationCallOrder[0]!;
		expect(forceLossOrder).toBeLessThan(disposeOrder);
	});

	it('disposes Timer on cleanup', () => {
		renderer.mount(container);
		renderer.dispose();

		expect(mockTimerDisconnect).toHaveBeenCalledOnce();
		expect(mockTimerDispose).toHaveBeenCalledOnce();
	});

	it('connects Timer to document on mount', () => {
		renderer.mount(container);
		expect(mockTimerConnect).toHaveBeenCalledWith(document);
		renderer.dispose();
	});

	it('removes event listeners from container on dispose', () => {
		const removeSpy = vi.spyOn(container, 'removeEventListener');
		renderer.mount(container);
		renderer.dispose();

		const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
		expect(removedTypes).toContain('pointermove');
		expect(removedTypes).toContain('click');
	});

	it('sets canvas display to block on mount', () => {
		renderer.mount(container);
		expect(mockDomElement.style.display).toBe('block');
		renderer.dispose();
	});

	it('removes canvas from container on dispose', () => {
		renderer.mount(container);
		expect(container.contains(mockDomElement)).toBe(true);
		renderer.dispose();
		expect(container.contains(mockDomElement)).toBe(false);
	});

	it('zoomIn calls animateCamera', async () => {
		const { animateCamera } = await import('./camera-presets');
		renderer.mount(container);
		renderer.zoomIn();
		// animateCamera is called during mount (resetView) + zoomIn
		expect(animateCamera).toHaveBeenCalled();
		renderer.dispose();
	});

	it('zoomOut calls animateCamera', async () => {
		const { animateCamera } = await import('./camera-presets');
		renderer.mount(container);
		const callCountBefore = (animateCamera as ReturnType<typeof vi.fn>).mock.calls.length;
		renderer.zoomOut();
		expect((animateCamera as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
			callCountBefore,
		);
		renderer.dispose();
	});

	it('setViewPreset top calls topDownPreset', async () => {
		const { topDownPreset } = await import('./camera-presets');
		renderer.mount(container);
		renderer.setViewPreset('top');
		expect(topDownPreset).toHaveBeenCalled();
		renderer.dispose();
	});

	it('setViewPreset front calls frontPreset', async () => {
		const { frontPreset } = await import('./camera-presets');
		renderer.mount(container);
		renderer.setViewPreset('front');
		expect(frontPreset).toHaveBeenCalled();
		renderer.dispose();
	});
});
