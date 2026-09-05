import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { VisualizationInsights } from '$lib/graph/insights';
import SceneGuide from './SceneGuide.svelte';

const advisorySummary: VisualizationInsights = {
	scope: 'advisory',
	unitLabel: 'Advisories',
	clusterLabel: 'Ecosystems',
	unitCount: 208,
	activeCount: 200,
	clusterCount: 6,
	criticalCount: 12,
	freshCount: 30,
	highestScore: 8.7,
	largestCluster: { id: 'npm', name: 'npm', count: 74 },
	severityBreakdown: [
		{ severity: 'CRITICAL', count: 12, color: '#ff1744' },
		{ severity: 'HIGH', count: 40, color: '#ff9100' },
		{ severity: 'MEDIUM', count: 80, color: '#ffd600' },
		{ severity: 'LOW', count: 60, color: '#448aff' },
		{ severity: 'UNKNOWN', count: 16, color: '#9aa0a6' },
	],
	truncated: false,
};

const instanceSummary: VisualizationInsights = {
	...advisorySummary,
	scope: 'instance',
	unitLabel: 'Instances',
	clusterLabel: 'Targets',
	unitCount: 1028,
	largestCluster: { id: 'target-fim', name: 'FIM', count: 220 },
};

function props(overrides: Record<string, unknown> = {}) {
	return { summary: advisorySummary, view: '3d' as const, fallback: null, ...overrides };
}

describe('SceneGuide', () => {
	afterEach(() => cleanup());

	it('keeps the essential summary visible while hiding the full guide by default', () => {
		const { getByText, queryByText } = render(SceneGuide, { props: props() });

		expect(getByText('Scene At A Glance')).toBeTruthy();
		expect(getByText('208')).toBeTruthy();
		expect(getByText('Show scene guide')).toBeTruthy();
		expect(queryByText('Visual Encoding')).toBeNull();
	});

	it('names the rows it is counting rather than calling everything a finding', () => {
		const advisories = render(SceneGuide, { props: props() });
		expect(advisories.getByText('Advisories')).toBeTruthy();
		expect(advisories.getByText('Ecosystems')).toBeTruthy();
		cleanup();

		const plot = render(SceneGuide, { props: props({ summary: instanceSummary, view: '2d' }) });
		expect(plot.getByText('Instances')).toBeTruthy();
		expect(plot.getByText('Targets')).toBeTruthy();
	});

	it('labels each view mode', () => {
		const spatial = render(SceneGuide, { props: props() });
		expect(spatial.getByText('3D spatial mode')).toBeTruthy();
		cleanup();

		const plot = render(SceneGuide, { props: props({ summary: instanceSummary, view: '2d' }) });
		expect(plot.getByText('Risk plot mode')).toBeTruthy();
		cleanup();

		const table = render(SceneGuide, { props: props({ view: 'table' }) });
		expect(table.getByText('Table mode')).toBeTruthy();
	});

	it('does not claim 3D when the renderer silently fell back', () => {
		const { getByText, queryByText } = render(SceneGuide, {
			props: props({
				fallback: { reason: 'webgl2-unavailable', detail: 'Driver blocklisted WebGL2.' },
			}),
		});

		expect(getByText('2D fallback · WebGL2 unavailable')).toBeTruthy();
		expect(queryByText('3D spatial mode')).toBeNull();
	});

	it('does not blame WebGL2 when WebGL2 was there and the scene still failed', () => {
		const { getByText, queryByText } = render(SceneGuide, {
			props: props({
				fallback: { reason: 'scene-init-failed', detail: 'Error creating WebGL context.' },
			}),
		});

		expect(getByText('2D fallback · 3D scene failed to start')).toBeTruthy();
		expect(queryByText('2D fallback · WebGL2 unavailable')).toBeNull();
		expect(queryByText('3D spatial mode')).toBeNull();
	});

	it('keeps the underlying reason reachable without printing it into the layout', () => {
		const { getByText } = render(SceneGuide, {
			props: props({
				fallback: { reason: 'scene-init-failed', detail: 'Error creating WebGL context.' },
			}),
		});

		const badge = getByText('2D fallback · 3D scene failed to start');
		expect(badge.getAttribute('title')).toBe('Error creating WebGL context.');
	});

	it('says the loaded set was capped instead of presenting it as a total', () => {
		const { getByText } = render(SceneGuide, {
			props: props({ summary: { ...advisorySummary, truncated: true } }),
		});
		expect(getByText(/first 208 rows/i)).toBeTruthy();
		cleanup();

		const complete = render(SceneGuide, { props: props() });
		expect(complete.queryByText(/first 208 rows/i)).toBeNull();
	});

	it('reveals the full interpretation guide on demand', async () => {
		const { getByText } = render(SceneGuide, { props: props() });

		await fireEvent.click(getByText('Show scene guide'));

		expect(getByText('Visual Encoding')).toBeTruthy();
		expect(getByText('Hide scene guide')).toBeTruthy();
		expect(getByText('Severity mix')).toBeTruthy();
	});

	it('reads a column as one advisory, which is what the scene draws', async () => {
		const { getByText } = render(SceneGuide, { props: props() });
		await fireEvent.click(getByText('Show scene guide'));
		expect(getByText('Column = advisory')).toBeTruthy();
	});

	it('uses real headings for its sections', async () => {
		const { getByRole } = render(SceneGuide, { props: props() });

		expect(getByRole('heading', { level: 2, name: 'Scene At A Glance' })).toBeTruthy();

		await fireEvent.click(getByRole('button', { name: 'Show scene guide' }));

		expect(getByRole('heading', { level: 3, name: 'Visual Encoding' })).toBeTruthy();
		expect(getByRole('heading', { level: 3, name: 'Reading keys' })).toBeTruthy();
		expect(getByRole('heading', { level: 3, name: 'Severity mix' })).toBeTruthy();
	});

	it('links the disclosure button to the region it toggles', async () => {
		const { getByRole } = render(SceneGuide, { props: props() });

		const toggle = getByRole('button', { name: 'Show scene guide' });
		expect(toggle.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(toggle);

		const expanded = getByRole('button', { name: 'Hide scene guide' });
		expect(expanded.getAttribute('aria-expanded')).toBe('true');
		const controls = expanded.getAttribute('aria-controls');
		expect(controls).toBeTruthy();
		expect(document.getElementById(controls as string)).toBeTruthy();
	});
});
