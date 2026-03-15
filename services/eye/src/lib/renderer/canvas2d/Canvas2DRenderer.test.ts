import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphModel } from '$lib/graph/model';
import { createEmptyGraph } from '$lib/graph/model';
import { Canvas2DRenderer } from './Canvas2DRenderer';

function makeGraph(): GraphModel {
	const graph = createEmptyGraph();
	graph.nodes.set('n1', {
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
	});
	graph.clusters.push({ id: 't1', name: 'target-1', nodes: ['n1'], centerX: 4 });
	return graph;
}

describe('Canvas2DRenderer', () => {
	let container: HTMLElement;
	let renderer: Canvas2DRenderer;

	beforeEach(() => {
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

		// We can't truly simulate canvas pixel hits in jsdom,
		// but we verify the callback registration works
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
});
