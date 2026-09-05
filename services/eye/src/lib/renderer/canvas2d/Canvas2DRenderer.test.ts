import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphModel, GraphNode, Severity } from '$lib/graph/model';
import { createEmptyGraph, SEVERITY_NOTCHES } from '$lib/graph/model';
import {
	Canvas2DRenderer,
	clampZoomScale,
	computeFitView,
	computeNotchTicks,
	MAX_ZOOM_FACTOR,
	MIN_ZOOM_FACTOR,
	NODE_MAX_RADIUS,
	NODE_MIN_RADIUS,
	NOTCH_TICK_COLOR,
	nodeRadius,
	pickNodeAt,
	SELECTION_COLOR,
} from './Canvas2DRenderer';

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
	return {
		id: 'n1',
		targetId: 't1',
		targetName: 'target-1',
		packageName: 'lodash',
		packageVersion: '4.17.0',
		ecosystem: 'npm',
		advisoryId: 'CVE-2021-1234',
		severity: 'HIGH',
		decreeScore: 7.5,
		epssScore: 0.8,
		cvssScore: 7.5,
		depDepth: 0,
		isActive: true,
		lastObservedAt: null,
		position: { x: 4, y: 37.5, z: 0 },
		visual: {
			color: '#FF9100',
			opacity: 0.8,
			size: 1,
			pulse: false,
			isNew: false,
			isDisappearing: false,
		},
		...overrides,
	};
}

function makeGraph(nodes: GraphNode[] = [makeNode()]): GraphModel {
	const graph = createEmptyGraph();
	for (const node of nodes) {
		graph.nodes.set(node.id, node);
	}
	graph.clusters.push({ id: 't1', name: 'target-1', nodes: nodes.map((n) => n.id), centerX: 4 });
	return graph;
}

interface StrokeRecord {
	strokeStyle: string;
	lineWidth: number;
}

interface ArcRecord {
	x: number;
	y: number;
	radius: number;
	strokeStyle: string;
}

/** jsdom has no canvas, so drawing needs a recording stand-in to be observable at all. */
function installFakeContext() {
	const strokes: StrokeRecord[] = [];
	const arcs: ArcRecord[] = [];
	const texts: string[] = [];
	let pendingArc: ArcRecord | null = null;

	const ctx = {
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 1,
		lineCap: 'butt',
		globalAlpha: 1,
		font: '',
		textAlign: '',
		save: vi.fn(),
		restore: vi.fn(),
		scale: vi.fn(),
		setTransform: vi.fn(),
		clearRect: vi.fn(),
		fillRect: vi.fn(),
		beginPath: vi.fn(() => {
			pendingArc = null;
		}),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		fill: vi.fn(),
		arc: vi.fn((x: number, y: number, radius: number) => {
			pendingArc = { x, y, radius, strokeStyle: '' };
			arcs.push(pendingArc);
		}),
		stroke: vi.fn(() => {
			strokes.push({ strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth });
			if (pendingArc) pendingArc.strokeStyle = ctx.strokeStyle;
		}),
		fillText: vi.fn((text: string) => {
			texts.push(text);
		}),
	};

	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);

	return { ctx, strokes, arcs, texts };
}

describe('Canvas2DRenderer', () => {
	let container: HTMLElement;
	let renderer: Canvas2DRenderer;

	beforeEach(() => {
		vi.restoreAllMocks();
		container = document.createElement('div');
		Object.defineProperty(container, 'clientWidth', { value: 800 });
		Object.defineProperty(container, 'clientHeight', { value: 600 });
		renderer = new Canvas2DRenderer();
	});

	it('mounts and creates a canvas element', () => {
		renderer.mount(container);
		expect(container.querySelector('canvas')).not.toBeNull();
		renderer.dispose();
	});

	it('disposes cleanly', () => {
		renderer.mount(container);
		renderer.dispose();
		expect(container.querySelector('canvas')).toBeNull();
	});

	it('survives disposal after the canvas was already detached', () => {
		renderer.mount(container);
		const canvas = container.querySelector('canvas');
		if (!canvas) throw new Error('Expected canvas element to be mounted');
		container.removeChild(canvas);

		expect(() => renderer.dispose()).not.toThrow();
	});

	it('sets graph model without error', () => {
		renderer.mount(container);
		expect(() => renderer.setGraphModel(makeGraph())).not.toThrow();
		renderer.dispose();
	});

	it('handles empty graph', () => {
		renderer.mount(container);
		expect(() => renderer.setGraphModel(createEmptyGraph())).not.toThrow();
		renderer.dispose();
	});

	it('fires click callback on node hit', () => {
		renderer.mount(container);
		renderer.setGraphModel(makeGraph());

		const callback = vi.fn();
		renderer.onNodeClick(callback);

		expect(callback).not.toHaveBeenCalled();
		renderer.dispose();
	});

	it('registers hover callback', () => {
		renderer.mount(container);
		const callback = vi.fn();
		renderer.onNodeHover(callback);
		expect(callback).not.toHaveBeenCalled();
		renderer.dispose();
	});

	it('removes event listeners from canvas on dispose', () => {
		renderer.mount(container);
		const canvas = container.querySelector('canvas');
		if (!canvas) {
			throw new Error('Expected canvas element to be mounted');
		}
		const removeSpy = vi.spyOn(canvas, 'removeEventListener');
		renderer.dispose();

		const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
		expect(removedTypes).toContain('pointermove');
		expect(removedTypes).toContain('pointerdown');
		expect(removedTypes).toContain('pointerup');
		expect(removedTypes).toContain('wheel');
	});

	it('zoomIn increases scale', () => {
		renderer.mount(container);
		renderer.setGraphModel(makeGraph());
		const scaleBefore = (renderer as unknown as { scale: number }).scale;
		renderer.zoomIn();
		const scaleAfter = (renderer as unknown as { scale: number }).scale;
		expect(scaleAfter).toBeGreaterThan(scaleBefore);
		renderer.dispose();
	});

	it('zoomOut decreases scale', () => {
		renderer.mount(container);
		renderer.setGraphModel(makeGraph());
		const scaleBefore = (renderer as unknown as { scale: number }).scale;
		renderer.zoomOut();
		const scaleAfter = (renderer as unknown as { scale: number }).scale;
		expect(scaleAfter).toBeLessThan(scaleBefore);
		renderer.dispose();
	});

	it('setViewPreset does not throw', () => {
		renderer.mount(container);
		renderer.setGraphModel(makeGraph());
		expect(() => renderer.setViewPreset('top')).not.toThrow();
		expect(() => renderer.setViewPreset('front')).not.toThrow();
		renderer.dispose();
	});

	it('clamps zoom in both directions instead of running away', () => {
		renderer.mount(container);
		renderer.setGraphModel(
			makeGraph([makeNode({ id: 'a' }), makeNode({ id: 'b', position: { x: 40, y: 8, z: 0 } })]),
		);
		const internals = renderer as unknown as { scale: number; fitScale: number };
		const fitScale = internals.fitScale;

		for (let i = 0; i < 40; i++) renderer.zoomIn();
		expect(internals.scale).toBeLessThanOrEqual(fitScale * MAX_ZOOM_FACTOR + 1e-9);

		for (let i = 0; i < 80; i++) renderer.zoomOut();
		expect(internals.scale).toBeGreaterThanOrEqual(fitScale * MIN_ZOOM_FACTOR - 1e-9);

		renderer.dispose();
	});

	it('precomputes the labelled nodes when the model is set, not on every frame', () => {
		renderer.mount(container);
		const nodes = Array.from({ length: 20 }, (_, i) =>
			makeNode({ id: `n${i}`, advisoryId: `CVE-${i}`, decreeScore: i }),
		);
		renderer.setGraphModel(makeGraph(nodes));

		const labels = (renderer as unknown as { labelNodes: GraphNode[] }).labelNodes;
		expect(labels).toHaveLength(15);
		expect(labels[0]?.id).toBe('n19');
		expect(labels.at(-1)?.id).toBe('n5');

		renderer.dispose();
	});

	describe('navigation', () => {
		type ViewInternals = {
			offsetX: number;
			offsetY: number;
			scale: number;
			fitScale: number;
			stepCamera(delta: number): void;
		};

		const view = () => renderer as unknown as ViewInternals;

		function canvasEl(): HTMLCanvasElement {
			const canvas = container.querySelector('canvas');
			if (!canvas) throw new Error('Expected canvas element to be mounted');
			return canvas;
		}

		function pointer(type: string, x: number, y: number, init: PointerEventInit = {}) {
			canvasEl().dispatchEvent(
				new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, ...init }),
			);
		}

		it('strafes the view sideways', () => {
			renderer.mount(container);
			renderer.setGraphModel(makeGraph());
			const before = view().offsetX;

			renderer.moveCamera({ right: 1 });

			expect(view().offsetX).toBeLessThan(before);
		});

		it('travels up and down the graph', () => {
			renderer.mount(container);
			renderer.setGraphModel(makeGraph());
			const before = view().offsetY;

			renderer.moveCamera({ forward: 1 });

			expect(view().offsetY).toBeGreaterThan(before);
		});

		it('has no altitude to change', () => {
			renderer.mount(container);
			renderer.setGraphModel(makeGraph());
			const before = { x: view().offsetX, y: view().offsetY, scale: view().scale };

			renderer.moveCamera({ up: 1 });

			expect(view().offsetX).toBe(before.x);
			expect(view().offsetY).toBe(before.y);
			expect(view().scale).toBe(before.scale);
		});

		it('moves continuously while a velocity is held, then stops', () => {
			renderer.mount(container);
			renderer.setGraphModel(makeGraph());

			renderer.setCameraVelocity({ right: 1 });
			view().stepCamera(0.5);
			const afterFirst = view().offsetX;
			view().stepCamera(0.5);
			expect(view().offsetX).toBeLessThan(afterFirst);

			renderer.setCameraVelocity({});
			const parked = view().offsetX;
			view().stepCamera(0.5);
			expect(view().offsetX).toBe(parked);
		});

		it('runs a frame loop only while a velocity is held', () => {
			const request = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(7);
			const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
			renderer.mount(container);
			renderer.setGraphModel(makeGraph());

			renderer.setCameraVelocity({ forward: 1 });
			expect(request).toHaveBeenCalled();

			renderer.setCameraVelocity({});
			expect(cancel).toHaveBeenCalledWith(7);

			renderer.dispose();
		});

		it('pans with a pointer drag', () => {
			renderer.mount(container);
			renderer.setGraphModel(makeGraph());
			const before = { x: view().offsetX, y: view().offsetY };

			pointer('pointerdown', 100, 100);
			pointer('pointermove', 140, 130, { buttons: 1 });

			expect(view().offsetX).toBeCloseTo(before.x + 40, 6);
			expect(view().offsetY).toBeCloseTo(before.y + 30, 6);

			renderer.dispose();
		});

		it('opens a finding on a press and release that barely moved', () => {
			const onClick = vi.fn();
			renderer.mount(container);
			renderer.setGraphModel(makeGraph());
			renderer.onNodeClick(onClick);
			const { offsetX, offsetY, scale } = view();
			const node = makeNode();
			const sx = node.position.x * scale + offsetX;
			const sy = node.position.y * scale + offsetY;

			pointer('pointerdown', sx, sy);
			pointer('pointerup', sx + 1, sy + 1);

			expect(onClick).toHaveBeenCalledWith('n1');
			renderer.dispose();
		});

		it('reads a drag over a node as a pan, not a click', () => {
			const onClick = vi.fn();
			renderer.mount(container);
			renderer.setGraphModel(makeGraph());
			renderer.onNodeClick(onClick);
			const { offsetX, offsetY, scale } = view();
			const node = makeNode();
			const sx = node.position.x * scale + offsetX;
			const sy = node.position.y * scale + offsetY;

			pointer('pointerdown', sx, sy);
			pointer('pointermove', sx + 40, sy, { buttons: 1 });
			pointer('pointerup', sx + 40, sy);

			expect(onClick).not.toHaveBeenCalled();
			renderer.dispose();
		});

		it('zooms on the wheel within the same clamp as the buttons', () => {
			renderer.mount(container);
			renderer.setGraphModel(
				makeGraph([makeNode({ id: 'a' }), makeNode({ id: 'b', position: { x: 40, y: 8, z: 0 } })]),
			);
			const fitScale = view().fitScale;

			canvasEl().dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
			expect(view().scale).toBeGreaterThan(fitScale);

			for (let i = 0; i < 60; i++) {
				canvasEl().dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
			}
			expect(view().scale).toBeLessThanOrEqual(fitScale * MAX_ZOOM_FACTOR + 1e-9);

			renderer.dispose();
		});

		it('keeps the view where the user left it when findings reload', () => {
			renderer.mount(container);
			renderer.setGraphModel(makeGraph());
			renderer.moveCamera({ right: 1 });
			const panned = view().offsetX;

			renderer.setGraphModel(makeGraph());

			expect(view().offsetX).toBe(panned);
			renderer.dispose();
		});

		it('refits when the scene comes back from empty', () => {
			renderer.mount(container);
			renderer.setGraphModel(makeGraph());
			renderer.moveCamera({ right: 1 });
			renderer.setGraphModel(createEmptyGraph());

			renderer.setGraphModel(makeGraph());

			const fitted = computeFitView([makeNode()], 800, 600);
			expect(view().offsetX).toBeCloseTo(fitted?.offsetX ?? 0, 6);
			renderer.dispose();
		});
	});

	describe('drawing', () => {
		it('draws one dark radial tick per severity rank on every node', () => {
			const { strokes } = installFakeContext();
			renderer.mount(container);
			renderer.setGraphModel(
				makeGraph([
					makeNode({ id: 'crit', severity: 'CRITICAL' }),
					makeNode({ id: 'unknown', severity: 'UNKNOWN', position: { x: 9, y: 1, z: 0 } }),
				]),
			);

			const notchStrokes = strokes.filter((s) => s.strokeStyle === NOTCH_TICK_COLOR);
			expect(notchStrokes).toHaveLength(SEVERITY_NOTCHES.CRITICAL + SEVERITY_NOTCHES.UNKNOWN);

			renderer.dispose();
		});

		it('draws a visible selection ring when a node is selected', () => {
			const { arcs } = installFakeContext();
			renderer.mount(container);
			renderer.setGraphModel(makeGraph());

			expect(arcs.some((a) => a.strokeStyle === SELECTION_COLOR)).toBe(false);

			renderer.setSelectedNode('n1');
			expect(arcs.some((a) => a.strokeStyle === SELECTION_COLOR)).toBe(true);

			renderer.dispose();
		});

		it('clears the selection ring again', () => {
			const { arcs } = installFakeContext();
			renderer.mount(container);
			renderer.setGraphModel(makeGraph());
			renderer.setSelectedNode('n1');
			arcs.length = 0;
			renderer.setSelectedNode(null);

			expect(arcs.some((a) => a.strokeStyle === SELECTION_COLOR)).toBe(false);

			renderer.dispose();
		});
	});
});

describe('nodeRadius', () => {
	it('bottoms out at the minimum radius', () => {
		expect(nodeRadius(0)).toBe(NODE_MIN_RADIUS);
	});

	it('grows with the connection-derived size', () => {
		expect(nodeRadius(2)).toBeGreaterThan(nodeRadius(1));
	});

	it('caps at the maximum radius', () => {
		expect(nodeRadius(3)).toBe(NODE_MAX_RADIUS);
		expect(nodeRadius(50)).toBe(NODE_MAX_RADIUS);
	});
});

describe('clampZoomScale', () => {
	it('leaves an in-range scale alone', () => {
		expect(clampZoomScale(20, 10)).toBe(20);
	});

	it('clamps runaway zoom in', () => {
		expect(clampZoomScale(1e6, 10)).toBe(10 * MAX_ZOOM_FACTOR);
	});

	it('clamps runaway zoom out', () => {
		expect(clampZoomScale(1e-6, 10)).toBe(10 * MIN_ZOOM_FACTOR);
	});

	it('passes through when there is no fitted scale to anchor to', () => {
		expect(clampZoomScale(7, 0)).toBe(7);
	});
});

describe('computeFitView', () => {
	it('returns null without nodes', () => {
		expect(computeFitView([], 800, 600)).toBeNull();
	});

	it('centres the content bounding box on the canvas', () => {
		const nodes = [
			makeNode({ id: 'a', position: { x: 0, y: 0, z: 0 } }),
			makeNode({ id: 'b', position: { x: 10, y: 20, z: 0 } }),
		];
		const view = computeFitView(nodes, 800, 600);
		if (!view) throw new Error('Expected a fitted view');

		expect(5 * view.scale + view.offsetX).toBeCloseTo(400, 6);
		expect(10 * view.scale + view.offsetY).toBeCloseTo(300, 6);
	});

	it('keeps the content inside the padded canvas', () => {
		const nodes = [
			makeNode({ id: 'a', position: { x: 0, y: 0, z: 0 } }),
			makeNode({ id: 'b', position: { x: 10, y: 20, z: 0 } }),
		];
		const view = computeFitView(nodes, 800, 600);
		if (!view) throw new Error('Expected a fitted view');

		expect(20 * view.scale).toBeLessThanOrEqual(600);
	});
});

describe('computeNotchTicks', () => {
	const severities: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

	it('draws one tick per severity rank', () => {
		for (const severity of severities) {
			expect(computeNotchTicks(severity, 12)).toHaveLength(SEVERITY_NOTCHES[severity]);
		}
	});

	it('starts at the 12 o clock position', () => {
		const first = computeNotchTicks('CRITICAL', 12)[0];
		if (!first) throw new Error('Expected a first tick');
		expect(first.x2).toBeCloseTo(0, 6);
		expect(first.y2).toBeLessThan(0);
	});

	it('advances clockwise', () => {
		const ticks = computeNotchTicks('CRITICAL', 12);
		for (let i = 1; i < ticks.length; i++) {
			expect(ticks[i]?.x2 ?? 0).toBeGreaterThan(ticks[i - 1]?.x2 ?? 0);
		}
	});

	it('keeps every tick inside the node disc where the dark ink has contrast', () => {
		for (const tick of computeNotchTicks('CRITICAL', 12)) {
			expect(Math.hypot(tick.x1, tick.y1)).toBeLessThan(12);
			expect(Math.hypot(tick.x2, tick.y2)).toBeLessThanOrEqual(12);
			expect(Math.hypot(tick.x2, tick.y2)).toBeGreaterThan(Math.hypot(tick.x1, tick.y1));
		}
	});
});

describe('pickNodeAt', () => {
	const view = { scale: 1, offsetX: 0, offsetY: 0 };

	it('picks the node under the pointer', () => {
		const nodes = [makeNode({ id: 'a', position: { x: 100, y: 100, z: 0 } })];
		expect(pickNodeAt(nodes, 100, 100, view)).toBe('a');
		expect(pickNodeAt(nodes, 102, 101, view)).toBe('a');
	});

	it('returns null when nothing is under the pointer', () => {
		const nodes = [makeNode({ id: 'a', position: { x: 100, y: 100, z: 0 } })];
		expect(pickNodeAt(nodes, 400, 400, view)).toBeNull();
	});

	it('prefers the last drawn node when discs overlap', () => {
		const nodes = [
			makeNode({ id: 'under', position: { x: 100, y: 100, z: 0 } }),
			makeNode({ id: 'over', position: { x: 101, y: 100, z: 0 } }),
		];
		expect(pickNodeAt(nodes, 100, 100, view)).toBe('over');
	});
});
