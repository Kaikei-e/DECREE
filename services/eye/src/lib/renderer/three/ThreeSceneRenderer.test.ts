import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphModel } from '$lib/graph/model';

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
	type RendererInternals = {
		instancedMesh: { geometry: { type: string } } | null;
		districtGroup: { children: unknown[] } | null;
	};
	const sampleGraph: GraphModel = {
		nodes: new Map([
			[
				'node-1',
				{
					id: 'node-1',
					targetId: 'target-1',
					targetName: 'FIM',
					packageName: 'pkg-a',
					packageVersion: '1.0.0',
					ecosystem: 'npm',
					advisoryId: 'CVE-2025-0001',
					severity: 'CRITICAL',
					decreeScore: 4.9,
					epssScore: 0.8,
					cvssScore: 9.8,
					depDepth: 0,
					isActive: true,
					lastObservedAt: null,
					position: { x: 0, y: 24.5, z: 0 },
					visual: {
						color: '#FF1744',
						opacity: 0.8,
						size: 1,
						pulse: true,
						isNew: false,
						isDisappearing: false,
					},
				},
			],
			[
				'node-2',
				{
					id: 'node-2',
					targetId: 'target-1',
					targetName: 'FIM',
					packageName: 'pkg-b',
					packageVersion: '2.0.0',
					ecosystem: 'npm',
					advisoryId: 'CVE-2025-0002',
					severity: 'HIGH',
					decreeScore: 4.2,
					epssScore: 0.4,
					cvssScore: 8.2,
					depDepth: 0,
					isActive: true,
					lastObservedAt: null,
					position: { x: 1.4, y: 21, z: 0.6 },
					visual: {
						color: '#FF9100',
						opacity: 0.55,
						size: 1,
						pulse: false,
						isNew: false,
						isDisappearing: false,
					},
				},
			],
		]),
		edges: [],
		clusters: [{ id: 'target-1', name: 'FIM', nodes: ['node-1', 'node-2'], centerX: 0.7 }],
	};

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

		const forceLossOrder = mockForceContextLoss.mock.invocationCallOrder[0];
		const disposeOrder = mockRendererDispose.mock.invocationCallOrder[0];
		expect(forceLossOrder).toBeDefined();
		expect(disposeOrder).toBeDefined();
		if (forceLossOrder === undefined || disposeOrder === undefined) {
			throw new Error('Expected renderer disposal call order to be recorded');
		}
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

	it('renders nodes as skyline columns instead of spheres', () => {
		renderer.mount(container);
		renderer.setGraphModel(sampleGraph);

		const instancedMesh = (renderer as unknown as RendererInternals).instancedMesh;
		expect(instancedMesh?.geometry.type).toBe('CylinderGeometry');

		renderer.dispose();
	});

	it('adds district meshes for target groups', () => {
		renderer.mount(container);
		renderer.setGraphModel(sampleGraph);

		const districtGroup = (renderer as unknown as RendererInternals).districtGroup;
		expect(districtGroup).toBeTruthy();
		expect(districtGroup?.children.length).toBeGreaterThan(0);

		renderer.dispose();
	});
});
