import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { VisualizationInsights } from '$lib/graph/insights';
import SceneGuide from './SceneGuide.svelte';

describe('SceneGuide', () => {
	afterEach(() => cleanup());

	const summary: VisualizationInsights = {
		totalFindings: 50,
		activeFindings: 46,
		targetCount: 3,
		criticalCount: 1,
		pulsingCount: 12,
		highestScore: 4.9,
		largestCluster: {
			id: 'target-fim',
			name: 'FIM',
			count: 22,
		},
		severityBreakdown: [
			{ severity: 'CRITICAL', count: 1, color: '#ff1744' },
			{ severity: 'HIGH', count: 20, color: '#ff9100' },
			{ severity: 'MEDIUM', count: 18, color: '#ffd600' },
			{ severity: 'LOW', count: 7, color: '#448aff' },
			{ severity: 'INFO', count: 4, color: '#00e676' },
		],
	};

	it('keeps the essential summary visible while hiding the full guide by default', () => {
		const { getByText, queryByText } = render(SceneGuide, {
			props: { summary, rendererType: '3d' },
		});

		expect(getByText('Scene At A Glance')).toBeTruthy();
		expect(getByText('50')).toBeTruthy();
		expect(getByText('Show scene guide')).toBeTruthy();
		expect(queryByText('Visual Encoding')).toBeNull();
	});

	it('reveals the full interpretation guide on demand', async () => {
		const { getByText } = render(SceneGuide, {
			props: { summary, rendererType: '3d' },
		});

		await fireEvent.click(getByText('Show scene guide'));

		expect(getByText('Visual Encoding')).toBeTruthy();
		expect(getByText('Hide scene guide')).toBeTruthy();
		expect(getByText('Severity mix')).toBeTruthy();
	});
});
