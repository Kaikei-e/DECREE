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

describe('TimelineSlider layout', () => {
	const replayAt = '2026-02-01T00:00:00.000Z';

	beforeEach(() => timelineState.reset());
	afterEach(() => {
		cleanup();
		timelineState.reset();
	});

	it('reflows onto a second line instead of overflowing the row', () => {
		const { getByRole } = render(TimelineSlider, { props: { minDate, maxDate } });
		expect(getByRole('group', { name: 'Timeline playback' }).className).toContain('flex-wrap');
	});

	it('keeps the transport buttons together on one line', () => {
		const { getByRole } = render(TimelineSlider, { props: { minDate, maxDate } });
		const back = getByRole('button', { name: 'Step backward' });
		const forward = getByRole('button', { name: 'Step forward' });
		const cluster = back.parentElement;

		expect(forward.parentElement).toBe(cluster);
		expect(cluster).not.toBe(getByRole('group', { name: 'Timeline playback' }));
		expect(cluster?.className).toContain('shrink-0');
	});

	it('keeps the timestamp and the live toggle together as a pair', () => {
		timelineState.startReplay(replayAt);
		const { getByRole, getByText } = render(TimelineSlider, { props: { minDate, maxDate } });
		const stamp = getByText(formatTimelineLabel(replayAt));

		expect(stamp.parentElement).toBe(getByRole('button', { name: 'Live' }).parentElement);
		expect(stamp.parentElement?.className).toContain('shrink-0');
	});

	it('holds the range input open when the row wraps', () => {
		const { getByRole } = render(TimelineSlider, { props: { minDate, maxDate } });
		const slider = getByRole('slider', { name: 'Timeline position' });

		expect(slider.className).toContain('flex-1');
		expect(slider.className).toMatch(/\bmin-w-\d/);
	});

	it('grows the timestamp box rather than wrapping or clipping the label', () => {
		timelineState.startReplay(replayAt);
		const { getByText } = render(TimelineSlider, { props: { minDate, maxDate } });
		const stamp = getByText(formatTimelineLabel(replayAt));

		expect(stamp.className).toContain('whitespace-nowrap');
		expect(stamp.className).toMatch(/\bmin-w-\d/);
		expect(stamp.className).not.toMatch(/(^|\s)w-\d/);
	});

	it('gives every control the 24px minimum touch target', () => {
		const { getByRole } = render(TimelineSlider, { props: { minDate, maxDate } });
		const iconOnly = ['Step backward', 'Replay from the start', 'Step forward'];

		for (const name of [...iconOnly, 'Live']) {
			expect(getByRole('button', { name }).className).toContain('min-h-6');
		}
		for (const name of iconOnly) {
			expect(getByRole('button', { name }).className).toContain('min-w-6');
		}
	});
});
