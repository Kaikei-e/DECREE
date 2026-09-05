import type * as THREE from 'three';
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
const mockTimerGetDelta = vi.fn().mockReturnValue(0);
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
			getDelta = mockTimerGetDelta;
			connect = mockTimerConnect;
			disconnect = mockTimerDisconnect;
			dispose = mockTimerDispose;
		},
	};
});

vi.mock('three/addons/controls/OrbitControls.js', async () => {
	const three = await vi.importActual<typeof import('three')>('three');
	return {
		OrbitControls: class {
			enableDamping = false;
			dampingFactor = 0;
			enableRotate = true;
			enableZoom = true;
			screenSpacePanning = false;
			rotateSpeed = 1;
			minDistance = 0;
			maxDistance = Infinity;
			maxPolarAngle = Math.PI;
			maxTargetRadius = Infinity;
			cursor = new three.Vector3();
			mouseButtons = {
				LEFT: three.MOUSE.ROTATE,
				MIDDLE: three.MOUSE.DOLLY,
				RIGHT: three.MOUSE.PAN,
			};
			target = new three.Vector3();
			dispose = mockControlsDispose;
			update = mockControlsUpdate;
		},
	};
});

vi.mock('./camera-presets', () => ({
	animateCamera: vi.fn().mockReturnValue(() => {}),
	overviewPreset: vi.fn().mockReturnValue({
		position: { x: 0, y: 0, z: 0 },
		lookAt: { x: 0, y: 0, z: 0 },
	}),
	clusterPreset: vi.fn(),
	nodePreset: vi.fn(),
	fitPreset: vi.fn().mockReturnValue({
		position: { x: 20, y: 24, z: 60 },
		lookAt: { x: 0, y: 0, z: 0 },
	}),
	OVERVIEW_DIRECTION: { x: 0.3, y: 0.62, z: 1 },
	TOP_DIRECTION: { x: 0, y: 1, z: 0.001 },
	FRONT_DIRECTION: { x: 0, y: 0.08, z: 1 },
}));

vi.mock('./node-material', async (importOriginal) => ({
	...(await importOriginal<typeof import('./node-material')>()),
	createNodeMaterial: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	createEdgeMaterial: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	createGlowMaterial: vi.fn().mockReturnValue({
		dispose: vi.fn(),
		emissiveIntensity: 0.15,
		emissive: { set: vi.fn() },
	}),
}));

vi.mock('./raycaster', () => ({
	NodeRaycaster: class {
		updatePointer = vi.fn();
		pick = vi.fn().mockReturnValue(null);
		setInstancedMesh = vi.fn();
	},
}));

// Import after mocks
const { computeCriticalCap, computeNotchBands, MIN_CAMERA_HEIGHT, ThreeSceneRenderer } =
	await import('./ThreeSceneRenderer');
const { MOUSE } = await import('three');

describe('ThreeSceneRenderer', () => {
	let container: HTMLElement;
	let renderer: InstanceType<typeof ThreeSceneRenderer>;
	type RendererInternals = {
		instancedMesh: { geometry: { type: string } } | null;
		notchMesh: THREE.InstancedMesh | null;
		nodeGeometry: THREE.BufferGeometry;
		notchGeometry: THREE.BufferGeometry;
		grid: THREE.GridHelper | null;
		scene: THREE.Scene;
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
		expect(removedTypes).toContain('pointerdown');
		expect(removedTypes).toContain('pointerup');
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

	it('frames the top view looking straight down at the findings', async () => {
		const { fitPreset } = await import('./camera-presets');
		renderer.mount(container);
		renderer.setGraphModel(sampleGraph);
		renderer.setViewPreset('top');

		const direction = (fitPreset as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[3];
		expect(direction.y).toBeGreaterThan(Math.abs(direction.z));
		renderer.dispose();
	});

	it('frames the front view head-on at the findings', async () => {
		const { fitPreset } = await import('./camera-presets');
		renderer.mount(container);
		renderer.setGraphModel(sampleGraph);
		renderer.setViewPreset('front');

		const direction = (fitPreset as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[3];
		expect(direction.z).toBeGreaterThan(direction.y);
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

	describe('glow overlay (selection feedback)', () => {
		type GlowInternals = {
			glowMesh: THREE.Mesh | null;
			glowMaterial: THREE.MeshStandardMaterial | null;
			scene: THREE.Scene;
		};

		it('creates glow overlay mesh when setSelectedNode is called with a valid node', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			renderer.setSelectedNode('node-1');

			const internals = renderer as unknown as GlowInternals;
			expect(internals.glowMesh).toBeTruthy();
			expect(internals.glowMesh?.name).toBe('glow-overlay');
			expect(internals.scene.getObjectByName('glow-overlay')).toBeTruthy();

			renderer.dispose();
		});

		it('removes glow overlay when setSelectedNode(null) is called', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			renderer.setSelectedNode('node-1');
			renderer.setSelectedNode(null);

			const internals = renderer as unknown as GlowInternals;
			expect(internals.glowMesh).toBeNull();
			expect(internals.scene.getObjectByName('glow-overlay')).toBeUndefined();

			renderer.dispose();
		});

		it('replaces the existing glow overlay when selecting a different node', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			renderer.setSelectedNode('node-1');
			renderer.setSelectedNode('node-2');

			const internals = renderer as unknown as GlowInternals;
			expect(internals.glowMesh).toBeTruthy();
			// Only one glow overlay should exist
			const overlays = internals.scene.children.filter((c) => c.name === 'glow-overlay');
			expect(overlays).toHaveLength(1);

			renderer.dispose();
		});

		it('uses warm emissive color from createGlowMaterial', async () => {
			const { createGlowMaterial } = await import('./node-material');
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			renderer.setSelectedNode('node-1');

			expect(createGlowMaterial).toHaveBeenCalled();

			renderer.dispose();
		});

		it('modulates emissiveIntensity sinusoidally over time', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			renderer.setSelectedNode('node-1');

			const internals = renderer as unknown as GlowInternals;
			const material = internals.glowMaterial as THREE.MeshStandardMaterial;

			// Simulate time at half period (peak of sine: sin(π - π/2) = sin(π/2) = 1)
			mockTimerGetElapsed.mockReturnValue(3.5 / 2); // GLOW_PERIOD / 2
			(renderer as unknown as { updateGlow(): void }).updateGlow();

			// At t=period/2 → sine peak → should be near max intensity
			expect(material.emissiveIntensity).toBeCloseTo(0.7, 1);

			// Simulate time at 0 (trough of sine: sin(-π/2) = -1 → mapped to 0)
			mockTimerGetElapsed.mockReturnValue(0);
			(renderer as unknown as { updateGlow(): void }).updateGlow();

			// At t=0 → sine trough → should be near min intensity
			expect(material.emissiveIntensity).toBeCloseTo(0.15, 1);

			renderer.dispose();
		});

		it('does nothing when setSelectedNode is called with an unknown node id', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			renderer.setSelectedNode('nonexistent');

			const internals = renderer as unknown as GlowInternals;
			expect(internals.glowMesh).toBeNull();

			renderer.dispose();
		});

		it('clears glow overlay when rebuildScene is called', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			renderer.setSelectedNode('node-1');

			// Rebuild scene via setGraphModel
			renderer.setGraphModel(sampleGraph);

			const internals = renderer as unknown as GlowInternals;
			expect(internals.glowMesh).toBeNull();

			renderer.dispose();
		});
	});

	it('positions the initial camera in an elevated overview instead of inside the columns', async () => {
		renderer.mount(container);
		renderer.setGraphModel(sampleGraph);

		const { animateCamera } = await import('./camera-presets');
		const calls = (animateCamera as ReturnType<typeof vi.fn>).mock.calls;
		const lastTarget = calls.at(-1)?.[2];
		expect(lastTarget?.position.y).toBeGreaterThan(8);
		expect(lastTarget?.position.z).toBeGreaterThan(10);

		renderer.dispose();
	});

	describe('severity notches', () => {
		it('renders one dark band per severity rank in a single extra instanced mesh', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);

			const internals = renderer as unknown as RendererInternals;
			const notchMesh = internals.notchMesh;
			expect(notchMesh).toBeTruthy();
			// CRITICAL (4 bands + apex cap) + HIGH (3 bands)
			expect(notchMesh?.count).toBe(8);
			expect(internals.scene?.getObjectByName('severity-notches')).toBeTruthy();

			renderer.dispose();
		});

		it('shares one BoxGeometry for every band', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);

			const internals = renderer as unknown as RendererInternals;
			expect(internals.notchMesh?.geometry.type).toBe('BoxGeometry');
			expect(internals.notchMesh?.geometry).toBe(internals.notchGeometry);

			renderer.dispose();
		});

		it('paints the bands in the HUD void colour', async () => {
			const { NOTCH_COLOR } = await import('./node-material');
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);

			const internals = renderer as unknown as RendererInternals;
			const material = internals.notchMesh?.material as THREE.MeshStandardMaterial;
			expect(material.color.getHex()).toBe(NOTCH_COLOR);
			expect(NOTCH_COLOR).toBe(0x050a0e);

			renderer.dispose();
		});

		it('rebuilds the band mesh alongside the column mesh', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);

			const internals = renderer as unknown as RendererInternals;
			const first = internals.notchMesh;
			renderer.setGraphModel(sampleGraph);

			expect(internals.notchMesh).not.toBe(first);
			const meshes = internals.scene?.children.filter((c) => c.name === 'severity-notches');
			expect(meshes).toHaveLength(1);

			renderer.dispose();
		});

		it('drops the band mesh when the graph becomes empty', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			renderer.setGraphModel({ nodes: new Map(), edges: [], clusters: [] });

			const internals = renderer as unknown as RendererInternals;
			expect(internals.notchMesh).toBeNull();
			expect(internals.scene?.getObjectByName('severity-notches')).toBeUndefined();

			renderer.dispose();
		});
	});

	describe('computeNotchBands', () => {
		it('returns one band per severity rank', () => {
			expect(computeNotchBands('CRITICAL', 6, 0.3)).toHaveLength(4);
			expect(computeNotchBands('HIGH', 6, 0.3)).toHaveLength(3);
			expect(computeNotchBands('MEDIUM', 6, 0.3)).toHaveLength(2);
			expect(computeNotchBands('LOW', 6, 0.3)).toHaveLength(1);
			expect(computeNotchBands('UNKNOWN', 6, 0.3)).toHaveLength(0);
		});

		it('stacks the bands downward from the top of the column', () => {
			const bands = computeNotchBands('CRITICAL', 6, 0.3);
			for (let i = 1; i < bands.length; i++) {
				expect(bands[i]?.y).toBeLessThan(bands[i - 1]?.y ?? 0);
			}
		});

		it('keeps every band inside the shortest possible column', () => {
			const height = 0.6;
			const bands = computeNotchBands('CRITICAL', height, 0.3);
			for (const band of bands) {
				expect(band.y - band.thickness / 2).toBeGreaterThan(0);
				expect(band.y + band.thickness / 2).toBeLessThan(height);
			}
		});

		it('makes each band wider than the column it wraps so it reads from any angle', () => {
			const height = 6;
			const width = 0.3;
			for (const band of computeNotchBands('CRITICAL', height, width)) {
				const t = band.y / height;
				const columnDiameter = width * (0.26 + (0.16 - 0.26) * t) * 2;
				expect(band.side).toBeGreaterThan(columnDiameter);
			}
		});

		it('scales the band footprint with the column width', () => {
			const narrow = computeNotchBands('CRITICAL', 6, 0.2)[0];
			const wide = computeNotchBands('CRITICAL', 6, 0.5)[0];
			expect(wide?.side).toBeGreaterThan(narrow?.side ?? 0);
		});
	});

	describe('computeCriticalCap', () => {
		it('caps only CRITICAL columns', () => {
			expect(computeCriticalCap('CRITICAL', 6, 0.3)).not.toBeNull();
			expect(computeCriticalCap('HIGH', 6, 0.3)).toBeNull();
			expect(computeCriticalCap('UNKNOWN', 6, 0.3)).toBeNull();
		});

		it('sits at the apex without overlapping the top band', () => {
			const height = 0.6;
			const cap = computeCriticalCap('CRITICAL', height, 0.3);
			const top = computeNotchBands('CRITICAL', height, 0.3)[0];
			if (!cap || !top) throw new Error('Expected a cap and a top band');
			expect(cap.y + cap.thickness / 2).toBeCloseTo(height, 5);
			expect(cap.y - cap.thickness / 2).toBeGreaterThan(top.y + top.thickness / 2);
		});

		it('overhangs the column so the top rank reads at a distance', () => {
			const cap = computeCriticalCap('CRITICAL', 6, 0.3);
			const top = computeNotchBands('CRITICAL', 6, 0.3)[0];
			expect(cap?.side).toBeGreaterThan(top?.side ?? 0);
		});
	});

	describe('GPU resource ownership', () => {
		it('reuses one column geometry across rebuilds and disposes it exactly once', () => {
			renderer.mount(container);
			const internals = renderer as unknown as RendererInternals;
			const geometry = internals.nodeGeometry;
			const disposeSpy = vi.spyOn(geometry, 'dispose');

			renderer.setGraphModel(sampleGraph);
			renderer.setGraphModel(sampleGraph);

			expect(internals.nodeGeometry).toBe(geometry);
			expect(disposeSpy).not.toHaveBeenCalled();

			renderer.dispose();
			expect(disposeSpy).toHaveBeenCalledOnce();
		});

		it('does not share geometry between renderer instances', () => {
			const other = new ThreeSceneRenderer();
			const a = renderer as unknown as RendererInternals;
			const b = other as unknown as RendererInternals;
			expect(a.nodeGeometry).not.toBe(b.nodeGeometry);
			expect(a.notchGeometry).not.toBe(b.notchGeometry);
		});

		it('disposes the grid helper instead of leaking it through scene.clear', () => {
			renderer.mount(container);
			const grid = (renderer as unknown as RendererInternals).grid;
			if (!grid) throw new Error('Expected a grid helper');
			const geometrySpy = vi.spyOn(grid.geometry, 'dispose');
			const material = grid.material as THREE.Material;
			const materialSpy = vi.spyOn(material, 'dispose');

			renderer.dispose();

			expect(geometrySpy).toHaveBeenCalled();
			expect(materialSpy).toHaveBeenCalled();
		});
	});

	describe('pointer navigation', () => {
		type PointerInternals = {
			camera: THREE.PerspectiveCamera;
			controls: {
				enableRotate: boolean;
				screenSpacePanning: boolean;
				mouseButtons: { LEFT: number; MIDDLE: number; RIGHT: number };
				target: THREE.Vector3;
			};
			raycaster: { pick: ReturnType<typeof vi.fn> };
		};

		const internals = () => renderer as unknown as PointerInternals;

		function pointer(type: string, x: number, y: number, init: PointerEventInit = {}) {
			container.dispatchEvent(
				new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, ...init }),
			);
		}

		it('keeps orbiting available while the pointer sits over a column', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			internals().raycaster.pick.mockReturnValue('node-1');

			pointer('pointermove', 100, 100);

			expect(internals().controls.enableRotate).toBe(true);
			renderer.dispose();
		});

		it('pans in screen space with the right and middle buttons', () => {
			renderer.mount(container);

			expect(internals().controls.screenSpacePanning).toBe(true);
			expect(internals().controls.mouseButtons.RIGHT).toBe(MOUSE.PAN);
			expect(internals().controls.mouseButtons.MIDDLE).toBe(MOUSE.PAN);
			expect(internals().controls.mouseButtons.LEFT).toBe(MOUSE.ROTATE);

			renderer.dispose();
		});

		it('will not orbit under the ground plane', () => {
			renderer.mount(container);
			expect(
				(renderer as unknown as { controls: { maxPolarAngle: number } }).controls.maxPolarAngle,
			).toBeLessThan(Math.PI / 2);
			renderer.dispose();
		});

		it('bounds a mouse pan to a volume around the scene', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);

			const controls = (
				renderer as unknown as {
					controls: { maxTargetRadius: number; cursor: THREE.Vector3 };
				}
			).controls;
			expect(Number.isFinite(controls.maxTargetRadius)).toBe(true);
			expect(controls.maxTargetRadius).toBeGreaterThan(0);
			expect(controls.cursor.x).toBeCloseTo(0.7, 6);
			expect(controls.cursor.z).toBeCloseTo(0.3, 6);

			renderer.dispose();
		});

		it('pans on shift + left-drag and hands the button back afterwards', () => {
			renderer.mount(container);

			pointer('pointerdown', 100, 100, { shiftKey: true });
			expect(internals().controls.mouseButtons.LEFT).toBe(MOUSE.PAN);

			pointer('pointerup', 100, 100, { shiftKey: true });
			expect(internals().controls.mouseButtons.LEFT).toBe(MOUSE.ROTATE);

			renderer.dispose();
		});

		it('opens a finding when the pointer barely moved between press and release', () => {
			const onClick = vi.fn();
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			renderer.onNodeClick(onClick);
			internals().raycaster.pick.mockReturnValue('node-1');

			pointer('pointerdown', 200, 150);
			pointer('pointerup', 202, 151);

			expect(onClick).toHaveBeenCalledWith('node-1');
			renderer.dispose();
		});

		it('reads a drag across a column as a camera move, not a click', () => {
			const onClick = vi.fn();
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			renderer.onNodeClick(onClick);
			internals().raycaster.pick.mockReturnValue('node-1');

			pointer('pointerdown', 200, 150);
			pointer('pointerup', 240, 150);

			expect(onClick).not.toHaveBeenCalled();
			renderer.dispose();
		});

		it('ignores a release that never had a press', () => {
			const onClick = vi.fn();
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			renderer.onNodeClick(onClick);
			internals().raycaster.pick.mockReturnValue('node-1');

			pointer('pointerup', 200, 150);

			expect(onClick).not.toHaveBeenCalled();
			renderer.dispose();
		});
	});

	describe('framing', () => {
		const emptyGraph: GraphModel = { nodes: new Map(), edges: [], clusters: [] };

		async function framingCalls() {
			const { animateCamera } = await import('./camera-presets');
			return (animateCamera as ReturnType<typeof vi.fn>).mock.calls.length;
		}

		it('frames the camera on the findings, not on the grid plane', async () => {
			const { fitPreset } = await import('./camera-presets');
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);

			const call = (fitPreset as ReturnType<typeof vi.fn>).mock.calls.at(-1);
			const box = call?.[0] as THREE.Box3;
			expect(box.min.x).toBeLessThanOrEqual(0);
			expect(box.max.x).toBeGreaterThanOrEqual(1.4);
			expect(box.min.z).toBeLessThanOrEqual(0);
			expect(box.max.z).toBeGreaterThanOrEqual(0.6);
			expect(box.min.y).toBe(0);
			// The tallest column is 1 + decreeScore * 1.1, not the node's raw score.
			expect(box.max.y).toBeCloseTo(1 + 4.9 * 1.1, 5);
			expect(call?.[1]).toBe(60);
			expect(call?.[2]).toBeCloseTo(800 / 600, 5);

			renderer.dispose();
		});

		it('frames the scene the first time a model arrives', async () => {
			renderer.mount(container);
			const before = await framingCalls();
			renderer.setGraphModel(sampleGraph);
			expect(await framingCalls()).toBeGreaterThan(before);
			renderer.dispose();
		});

		it('keeps the camera where the user left it when findings reload', async () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			const before = await framingCalls();

			renderer.setGraphModel(sampleGraph);

			expect(await framingCalls()).toBe(before);
			renderer.dispose();
		});

		it('reframes when the scene comes back from empty', async () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			renderer.setGraphModel(emptyGraph);
			const before = await framingCalls();

			renderer.setGraphModel(sampleGraph);

			expect(await framingCalls()).toBeGreaterThan(before);
			renderer.dispose();
		});
	});

	describe('camera movement', () => {
		type MoveInternals = {
			camera: THREE.PerspectiveCamera;
			controls: { target: THREE.Vector3 };
			stepCamera(delta: number): void;
		};

		const internals = () => renderer as unknown as MoveInternals;

		/** animateCamera is mocked, so the view has to be placed by hand. */
		function place(x: number, y: number, z: number, targetY = 0) {
			internals().camera.position.set(x, y, z);
			internals().controls.target.set(0, targetY, 0);
		}

		function wideGraph(span: number): GraphModel {
			const nodes = new Map(sampleGraph.nodes);
			const far = nodes.get('node-2');
			if (!far) throw new Error('Expected node-2 in the sample graph');
			nodes.set('node-2', { ...far, position: { ...far.position, x: span, z: span } });
			return { ...sampleGraph, nodes };
		}

		it('strafes perpendicular to the view direction', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			place(0, 10, 30);

			renderer.moveCamera({ right: 1 });

			expect(internals().camera.position.x).toBeGreaterThan(0);
			expect(internals().camera.position.z).toBeCloseTo(30, 6);
			expect(internals().controls.target.x).toBeCloseTo(internals().camera.position.x, 6);
		});

		it('travels along the view direction without diving into the ground', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			place(0, 10, 30);

			renderer.moveCamera({ forward: 1 });

			expect(internals().camera.position.z).toBeLessThan(30);
			expect(internals().camera.position.y).toBeCloseTo(10, 6);
		});

		it('changes altitude on its own axis', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			place(0, 10, 30);

			renderer.moveCamera({ up: 1 });

			expect(internals().camera.position.y).toBeGreaterThan(10);
			expect(internals().camera.position.z).toBeCloseTo(30, 6);
		});

		it('scales one step to the size of the scene', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			place(0, 10, 30);
			renderer.moveCamera({ right: 1 });
			const smallStep = internals().camera.position.x;

			renderer.setGraphModel(wideGraph(400));
			place(0, 10, 30);
			renderer.moveCamera({ right: 1 });
			const largeStep = internals().camera.position.x;

			expect(largeStep).toBeGreaterThan(smallStep * 2);
		});

		it('walls the camera inside a bounding volume around the scene', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			place(0, 10, 30);

			renderer.moveCamera({ forward: 1e6 });
			const parked = internals().camera.position.clone();
			renderer.moveCamera({ forward: 1e6 });

			expect(internals().camera.position.distanceTo(parked)).toBeCloseTo(0, 6);
			expect(parked.length()).toBeLessThan(1e4);
		});

		it('never lets the camera fall below the ground plane', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			// Looking up from just above the plates is the case where descending would go underground.
			place(0, 1, 30, 20);

			renderer.moveCamera({ up: -1 });
			expect(internals().camera.position.y).toBeGreaterThanOrEqual(MIN_CAMERA_HEIGHT);

			renderer.moveCamera({ up: -1e6 });
			expect(internals().camera.position.y).toBeGreaterThanOrEqual(MIN_CAMERA_HEIGHT);
		});

		it('moves continuously while a velocity is held, then stops', () => {
			renderer.mount(container);
			renderer.setGraphModel(sampleGraph);
			place(0, 10, 30);

			renderer.setCameraVelocity({ right: 1 });
			internals().stepCamera(0.5);
			const afterFirst = internals().camera.position.x;
			expect(afterFirst).toBeGreaterThan(0);

			internals().stepCamera(0.5);
			expect(internals().camera.position.x).toBeGreaterThan(afterFirst);

			renderer.setCameraVelocity({});
			const parked = internals().camera.position.x;
			internals().stepCamera(0.5);
			expect(internals().camera.position.x).toBe(parked);
		});

		it('ignores movement before the scene is mounted', () => {
			expect(() => renderer.moveCamera({ forward: 1 })).not.toThrow();
			expect(() => renderer.setCameraVelocity({ forward: 1 })).not.toThrow();
		});
	});
});
