import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityReport } from '$lib/renderer/capability';

const capability = vi.hoisted(() => ({
	report: { capability: 'canvas2d', reason: 'jsdom has no WebGL2.' } as CapabilityReport,
}));

vi.mock('$lib/renderer/capability', () => ({
	detectCapability: async () => capability.report,
	resetCapabilityCache: () => {},
}));

import type { GraphModel, GraphNode, Severity } from '$lib/graph/model';
import { createEmptyGraph } from '$lib/graph/model';
import { Canvas2DRenderer } from '$lib/renderer/canvas2d/Canvas2DRenderer';
import { ThreeSceneRenderer } from '$lib/renderer/three/ThreeSceneRenderer';
import type { RendererStatus } from '$lib/renderer/types';
import VisualizationCanvas from './VisualizationCanvas.svelte';

beforeAll(() => {
	if (!('ResizeObserver' in globalThis)) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
});

function makeNode(id: string, advisoryId: string, score: number, severity: Severity): GraphNode {
	return {
		id,
		targetId: 't1',
		targetName: 'alt',
		packageName: `pkg-${id}`,
		packageVersion: '1.0.0',
		ecosystem: 'npm',
		advisoryId,
		severity,
		decreeScore: score,
		epssScore: 0.1,
		cvssScore: score,
		depDepth: 0,
		isActive: true,
		lastObservedAt: null,
		position: { x: 0, y: 0, z: 0 },
		visual: {
			color: '#FF9100',
			opacity: 0.8,
			size: 1,
			pulse: false,
			isNew: false,
			isDisappearing: false,
		},
	};
}

function makeGraph(): GraphModel {
	const graph = createEmptyGraph();
	graph.nodes.set('n1', makeNode('n1', 'CVE-2026-0001', 9.1, 'CRITICAL'));
	graph.nodes.set('n2', makeNode('n2', 'CVE-2026-0002', 4.2, 'MEDIUM'));
	graph.clusters.push({ id: 't1', name: 'alt', nodes: ['n1', 'n2'], centerX: 0 });
	return graph;
}

function baseProps(overrides: Record<string, unknown> = {}) {
	return {
		graphModel: makeGraph(),
		rendererType: '2d' as const,
		selectedNodeId: null,
		onNodeClick: vi.fn(),
		onNodeHover: vi.fn(),
		hasActiveFilters: false,
		onClearFilters: vi.fn(),
		...overrides,
	};
}

describe('VisualizationCanvas', () => {
	let setCameraVelocity: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		capability.report = { capability: 'canvas2d', reason: 'jsdom has no WebGL2.' };
		setCameraVelocity = vi
			.spyOn(Canvas2DRenderer.prototype, 'setCameraVelocity')
			.mockImplementation(() => {});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	/** The renderer is created asynchronously; the toolbar only appears once it is mounted. */
	async function renderScene(overrides: Record<string, unknown> = {}) {
		const utils = render(VisualizationCanvas, { props: baseProps(overrides) });
		await utils.findByRole('toolbar', { name: 'Camera controls' });
		return utils;
	}

	function lastVelocity() {
		return setCameraVelocity.mock.calls.at(-1)?.[0];
	}

	it('distinguishes an empty project from an empty filter result', () => {
		const clean = render(VisualizationCanvas, {
			props: baseProps({ graphModel: createEmptyGraph() }),
		});
		expect(clean.getByText('No vulnerabilities recorded for this project.')).toBeTruthy();
		expect(clean.queryByRole('button', { name: 'Clear filters' })).toBeNull();
		cleanup();

		const onClearFilters = vi.fn();
		const filtered = render(VisualizationCanvas, {
			props: baseProps({
				graphModel: createEmptyGraph(),
				hasActiveFilters: true,
				onClearFilters,
			}),
		});
		expect(filtered.getByText('No findings match the current filters.')).toBeTruthy();
		expect(filtered.queryByText('No vulnerabilities recorded for this project.')).toBeNull();
	});

	it('offers a way out of an over-filtered scene', async () => {
		const onClearFilters = vi.fn();
		const { getByRole } = render(VisualizationCanvas, {
			props: baseProps({
				graphModel: createEmptyGraph(),
				hasActiveFilters: true,
				onClearFilters,
			}),
		});

		await fireEvent.click(getByRole('button', { name: 'Clear filters' }));
		expect(onClearFilters).toHaveBeenCalledOnce();
	});

	it('makes the scene focusable and describes the key map it listens for', () => {
		const { getByRole } = render(VisualizationCanvas, { props: baseProps() });
		const scene = getByRole('application', { name: '2D vulnerability graph' });

		expect(scene.getAttribute('tabindex')).toBe('0');
		const describedBy = scene.getAttribute('aria-describedby');
		expect(describedBy).toBeTruthy();
		const description = document.getElementById(describedBy as string)?.textContent ?? '';
		expect(description).toContain('arrow keys pan');
		expect(description).toContain('N and P');
		expect(description).not.toContain('arrow keys to move between findings');
	});

	it('walks findings with n and p and announces the focused one', async () => {
		const { getByRole } = render(VisualizationCanvas, { props: baseProps() });
		const scene = getByRole('application', { name: '2D vulnerability graph' });

		await fireEvent.keyDown(scene, { key: 'n' });
		const status = getByRole('status');
		expect(status.textContent).toContain('CVE-2026-0001');
		expect(status.textContent).toContain('1 of 2');

		await fireEvent.keyDown(scene, { key: 'n' });
		expect(getByRole('status').textContent).toContain('CVE-2026-0002');
		expect(getByRole('status').textContent).toContain('2 of 2');

		await fireEvent.keyDown(scene, { key: 'p' });
		expect(getByRole('status').textContent).toContain('CVE-2026-0001');
	});

	it('selects the focused finding with Enter', async () => {
		const onNodeClick = vi.fn();
		const { getByRole } = render(VisualizationCanvas, { props: baseProps({ onNodeClick }) });
		const scene = getByRole('application', { name: '2D vulnerability graph' });

		await fireEvent.keyDown(scene, { key: 'n' });
		await fireEvent.keyDown(scene, { key: 'Enter' });
		expect(onNodeClick).toHaveBeenCalledWith('n1');
	});

	it('hands the highlight back when a finding is selected elsewhere', async () => {
		const { getByRole, rerender } = render(VisualizationCanvas, { props: baseProps() });
		const scene = getByRole('application', { name: '2D vulnerability graph' });

		await fireEvent.keyDown(scene, { key: 'n' });
		expect(getByRole('status').textContent).toContain('CVE-2026-0001');

		await rerender({ selectedNodeId: 'n2' });
		expect(getByRole('status').textContent?.trim()).toBe('');
	});

	it('ignores shortcuts pressed outside the scene', async () => {
		const { getByRole } = render(VisualizationCanvas, { props: baseProps() });

		await fireEvent.keyDown(document.body, { key: 'n' });
		expect(getByRole('status').textContent?.trim()).toBe('');
	});

	it('leaves modifier combinations to the browser', async () => {
		const { getByRole } = await renderScene();
		const scene = getByRole('application', { name: '2D vulnerability graph' });

		await fireEvent.keyDown(scene, { key: 'n', ctrlKey: true });
		await fireEvent.keyDown(scene, { key: '0', metaKey: true });
		await fireEvent.keyDown(scene, { key: 'ArrowRight', ctrlKey: true });

		expect(getByRole('status').textContent?.trim()).toBe('');
		expect(setCameraVelocity).not.toHaveBeenCalled();
	});

	it('does not steal keys typed into a text field inside the scene', async () => {
		const { getByRole } = await renderScene();
		const scene = getByRole('application', { name: '2D vulnerability graph' });

		const input = document.createElement('input');
		scene.appendChild(input);
		await fireEvent.keyDown(input, { key: 'n' });
		await fireEvent.keyDown(input, { key: 'ArrowRight' });

		expect(getByRole('status').textContent?.trim()).toBe('');
		expect(setCameraVelocity).not.toHaveBeenCalled();
	});

	describe('reporting the mounted renderer', () => {
		async function lastStatus(overrides: Record<string, unknown> = {}) {
			const onRendererReady = vi.fn();
			const utils = render(VisualizationCanvas, {
				props: baseProps({ onRendererReady, ...overrides }),
			});
			await waitFor(() => expect(onRendererReady).toHaveBeenCalled());
			return {
				...utils,
				onRendererReady,
				status: () => onRendererReady.mock.calls.at(-1)?.[0] as RendererStatus,
			};
		}

		it('names the renderer that mounted, not the one requested', async () => {
			const { status } = await lastStatus();
			expect(status()).toEqual({ kind: '2d', fallback: null });
		});

		it('reports a fallback caused by missing WebGL2', async () => {
			const { status } = await lastStatus({ rendererType: '3d' });
			expect(status()).toEqual({
				kind: '2d',
				fallback: { reason: 'webgl2-unavailable', detail: 'jsdom has no WebGL2.' },
			});
		});

		it('separates a 3D scene that failed to start from missing WebGL2', async () => {
			capability.report = { capability: 'webgl2', reason: null };
			vi.spyOn(console, 'warn').mockImplementation(() => {});
			vi.spyOn(ThreeSceneRenderer.prototype, 'mount').mockImplementation(() => {
				throw new Error('Error creating WebGL context.');
			});

			const { status } = await lastStatus({ rendererType: '3d' });

			expect(status().kind).toBe('2d');
			expect(status().fallback?.reason).toBe('scene-init-failed');
			expect(status().fallback?.detail).toContain('Error creating WebGL context.');
		});

		it('reports again when the renderer is swapped', async () => {
			const { onRendererReady, rerender } = await lastStatus();
			expect(onRendererReady).toHaveBeenCalledTimes(1);

			await rerender(baseProps({ onRendererReady, rendererType: '3d' }));
			await waitFor(() => expect(onRendererReady).toHaveBeenCalledTimes(2));
			expect(onRendererReady.mock.calls.at(-1)?.[0]).toMatchObject({ kind: '2d' });
		});

		it('describes the keys of the renderer that mounted, not the mode requested', async () => {
			const { getByRole } = await lastStatus({ rendererType: '3d' });

			const scene = getByRole('application', { name: '2D vulnerability graph' });
			const describedBy = scene.getAttribute('aria-describedby');
			const description = document.getElementById(describedBy as string)?.textContent ?? '';

			expect(description).toContain('arrow keys pan');
			expect(description).not.toContain('orbit');
			expect(description).not.toContain('altitude');
			expect(description).not.toContain('T for the top view');
		});
	});

	describe('camera keys', () => {
		it('strafes while left or right is held and stops on release', async () => {
			const { getByRole } = await renderScene();
			const scene = getByRole('application', { name: '2D vulnerability graph' });

			await fireEvent.keyDown(scene, { key: 'ArrowRight' });
			expect(lastVelocity()).toMatchObject({ right: 1, forward: 0, up: 0 });

			await fireEvent.keyUp(scene, { key: 'ArrowRight' });
			expect(lastVelocity()).toMatchObject({ right: 0, forward: 0, up: 0 });

			await fireEvent.keyDown(scene, { key: 'ArrowLeft' });
			expect(lastVelocity()).toMatchObject({ right: -1 });
		});

		it('travels forward and back on up and down', async () => {
			const { getByRole } = await renderScene();
			const scene = getByRole('application', { name: '2D vulnerability graph' });

			await fireEvent.keyDown(scene, { key: 'ArrowUp' });
			expect(lastVelocity()).toMatchObject({ forward: 1, up: 0 });

			await fireEvent.keyUp(scene, { key: 'ArrowUp' });
			await fireEvent.keyDown(scene, { key: 'ArrowDown' });
			expect(lastVelocity()).toMatchObject({ forward: -1 });
		});

		it('turns up and down into altitude while shift is held', async () => {
			const { getByRole } = await renderScene();
			const scene = getByRole('application', { name: '2D vulnerability graph' });

			await fireEvent.keyDown(scene, { key: 'ArrowUp', shiftKey: true });
			expect(lastVelocity()).toMatchObject({ forward: 0, up: 1 });

			await fireEvent.keyDown(scene, { key: 'ArrowDown', shiftKey: true });
			expect(lastVelocity()).toMatchObject({ forward: 0, up: 0 });
		});

		it('combines two held directions', async () => {
			const { getByRole } = await renderScene();
			const scene = getByRole('application', { name: '2D vulnerability graph' });

			await fireEvent.keyDown(scene, { key: 'ArrowUp' });
			await fireEvent.keyDown(scene, { key: 'ArrowRight' });
			expect(lastVelocity()).toMatchObject({ right: 1, forward: 1 });
		});

		it('parks the camera when the scene loses focus with a key still down', async () => {
			const { getByRole } = await renderScene();
			const scene = getByRole('application', { name: '2D vulnerability graph' });

			await fireEvent.keyDown(scene, { key: 'ArrowUp' });
			await fireEvent.blur(scene);

			expect(lastVelocity()).toMatchObject({ right: 0, forward: 0, up: 0 });
		});

		it('leaves the finding cursor alone while flying', async () => {
			const { getByRole } = await renderScene();
			const scene = getByRole('application', { name: '2D vulnerability graph' });

			await fireEvent.keyDown(scene, { key: 'ArrowRight' });
			await fireEvent.keyDown(scene, { key: 'ArrowDown' });

			expect(getByRole('status').textContent?.trim()).toBe('');
		});
	});
});
