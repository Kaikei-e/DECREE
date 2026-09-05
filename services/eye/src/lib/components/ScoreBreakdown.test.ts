import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ScoreBreakdown from './ScoreBreakdown.svelte';

function barWidth(container: HTMLElement, name: string): number {
	const style = container.querySelector(`[data-bar="${name}"]`)?.getAttribute('style') ?? '';
	const match = style.match(/width:\s*([\d.]+)%/);
	return match?.[1] === undefined ? Number.NaN : Number(match[1]);
}

describe('ScoreBreakdown', () => {
	afterEach(() => cleanup());

	it('keeps a high EPSS bar inside its track', () => {
		const { container } = render(ScoreBreakdown, {
			props: { cvss: 9.8, epss: 0.9, reachability: 10, total: 8.57 },
		});
		expect(barWidth(container, 'epss')).toBeLessThanOrEqual(100);
	});

	it('normalizes every bar against its own maximum contribution', () => {
		const { container } = render(ScoreBreakdown, {
			props: { cvss: 10, epss: 1, reachability: 10, total: 10.0 },
		});
		expect(barWidth(container, 'cvss')).toBeCloseTo(100, 5);
		expect(barWidth(container, 'epss')).toBeCloseTo(100, 5);
		expect(barWidth(container, 'reach')).toBeCloseTo(100, 5);
	});

	it('renders half-strength inputs as half-width bars', () => {
		const { container } = render(ScoreBreakdown, {
			props: { cvss: 5, epss: 0.5, reachability: 5, total: 5.0 },
		});
		expect(barWidth(container, 'cvss')).toBeCloseTo(50, 5);
		expect(barWidth(container, 'epss')).toBeCloseTo(50, 5);
		expect(barWidth(container, 'reach')).toBeCloseTo(50, 5);
	});

	it('clips the tracks so an out-of-range bar cannot escape', () => {
		const { container } = render(ScoreBreakdown, {
			props: { cvss: 9.8, epss: 0.9, reachability: 10, total: 8.57 },
		});
		for (const name of ['cvss', 'epss', 'reach']) {
			const track = container.querySelector(`[data-track="${name}"]`);
			expect(track?.className).toContain('overflow-hidden');
		}
	});

	it('renders the total exactly as the API reported it', () => {
		const { getByText } = render(ScoreBreakdown, {
			props: { cvss: 9.0, epss: 0.5, reachability: 10, total: 7.85 },
		});
		expect(getByText('7.8')).toBeTruthy();
	});

	it('presents an unknown reachability as no data instead of zero', () => {
		const { container, getByText, queryByText } = render(ScoreBreakdown, {
			props: { cvss: 7.5, epss: 0.2, reachability: null, total: 3.95 },
		});
		expect(getByText('NO DATA')).toBeTruthy();
		expect(queryByText('0.00')).toBeNull();
		expect(container.querySelector('[data-bar="reach"]')).toBeNull();
	});

	it('warns that the components cannot sum to the total without reachability', () => {
		const { getByText } = render(ScoreBreakdown, {
			props: { cvss: 7.5, epss: 0.2, reachability: null, total: 3.95 },
		});
		expect(
			getByText('Reachability is unknown, so the components do not sum to the total.'),
		).toBeTruthy();
	});

	it('still renders a reachability contribution when the value is present', () => {
		const { getByText, queryByText } = render(ScoreBreakdown, {
			props: { cvss: 7.5, epss: 0.2, reachability: 5, total: 3.95 },
		});
		expect(getByText('1.25')).toBeTruthy();
		expect(queryByText('NO DATA')).toBeNull();
	});
});
