import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { timelineState } from '$lib/state/timeline.svelte';
import TimelineSlider, { formatTimelineLabel } from './TimelineSlider.svelte';

const minDate = '2026-01-01T00:00:00.000Z';
const maxDate = '2026-04-01T00:00:00.000Z';

describe('TimelineSlider', () => {
	beforeEach(() => timelineState.reset());
	afterEach(() => {
		cleanup();
		timelineState.reset();
	});

	it('names every transport control', () => {
		const { getByRole } = render(TimelineSlider, { props: { minDate, maxDate } });

		expect(getByRole('button', { name: 'Step backward' })).toBeTruthy();
		expect(getByRole('button', { name: 'Replay from the start' })).toBeTruthy();
		expect(getByRole('button', { name: 'Step forward' })).toBeTruthy();
	});

	it('exposes the live toggle state instead of relying on colour', () => {
		const { getByRole, unmount } = render(TimelineSlider, { props: { minDate, maxDate } });
		expect(getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true');
		unmount();

		timelineState.startReplay('2026-02-01T00:00:00.000Z');
		const replaying = render(TimelineSlider, { props: { minDate, maxDate } });
		expect(replaying.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe(
			'false',
		);
	});

	it('gives the range input an accessible name', () => {
		const { getByRole } = render(TimelineSlider, { props: { minDate, maxDate } });
		expect(getByRole('slider', { name: 'Timeline position' })).toBeTruthy();
	});

	it('announces the timestamp rather than the raw slider value', () => {
		timelineState.startReplay('2026-02-01T00:00:00.000Z');
		const { getByRole } = render(TimelineSlider, { props: { minDate, maxDate } });

		const slider = getByRole('slider', { name: 'Timeline position' });
		const valueText = slider.getAttribute('aria-valuetext');

		expect(valueText).toBe(formatTimelineLabel('2026-02-01T00:00:00.000Z'));
		expect(valueText).not.toBe(slider.getAttribute('value'));
	});

	it('marks the live position as live in the value text', () => {
		const { getByRole } = render(TimelineSlider, { props: { minDate, maxDate } });
		const slider = getByRole('slider', { name: 'Timeline position' });
		expect(slider.getAttribute('aria-valuetext')).toContain('Live');
	});
});
