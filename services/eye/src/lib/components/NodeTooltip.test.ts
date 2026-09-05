import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '$lib/graph/model';
import NodeTooltip, { computeTooltipPosition } from './NodeTooltip.svelte';

const node: GraphNode = {
	id: 'n1',
	targetId: 't1',
	targetName: 'alt',
	packageName: 'lodash',
	packageVersion: '4.17.0',
	ecosystem: 'npm',
	advisoryId: 'CVE-2026-1234',
	severity: 'HIGH',
	decreeScore: 7.5,
	epssScore: 0.42,
	cvssScore: 7.5,
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

describe('computeTooltipPosition', () => {
	const viewport = { viewportWidth: 1000, viewportHeight: 800 };

	it('sits to the right of the pointer when there is room', () => {
		const placement = computeTooltipPosition({
			x: 100,
			y: 200,
			width: 240,
			height: 120,
			...viewport,
		});
		expect(placement.left).toBe(112);
		expect(placement.top).toBe(190);
	});

	it('flips to the left of the pointer at the right edge', () => {
		const placement = computeTooltipPosition({
			x: 960,
			y: 200,
			width: 240,
			height: 120,
			...viewport,
		});
		expect(placement.left).toBe(960 - 12 - 240);
	});

	it('lifts the tooltip so it stays inside the bottom edge', () => {
		const placement = computeTooltipPosition({
			x: 100,
			y: 790,
			width: 240,
			height: 120,
			...viewport,
		});
		expect(placement.top + 120).toBeLessThanOrEqual(800);
	});

	it('never places the tooltip off the top or left edge', () => {
		const placement = computeTooltipPosition({
			x: 4,
			y: 2,
			width: 900,
			height: 900,
			...viewport,
		});
		expect(placement.left).toBeGreaterThanOrEqual(0);
		expect(placement.top).toBeGreaterThanOrEqual(0);
	});
});

describe('NodeTooltip', () => {
	afterEach(() => cleanup());

	it('exposes tooltip semantics', () => {
		const { getByRole } = render(NodeTooltip, {
			props: { node, x: 10, y: 10, onDismiss: () => {} },
		});
		expect(getByRole('tooltip')).toBeTruthy();
	});

	it('dismisses on Escape', async () => {
		const onDismiss = vi.fn();
		render(NodeTooltip, { props: { node, x: 10, y: 10, onDismiss } });

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it('does not listen for Escape when hidden', async () => {
		const onDismiss = vi.fn();
		render(NodeTooltip, { props: { node: null, x: 0, y: 0, onDismiss } });

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onDismiss).not.toHaveBeenCalled();
	});
});
