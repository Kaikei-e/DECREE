import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { SEVERITY_NOTCH_MAX, SEVERITY_NOTCHES, type Severity } from '$lib/graph/model';
import SeverityBadge from './SeverityBadge.svelte';

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const RANKED: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

describe('SeverityBadge', () => {
	afterEach(() => cleanup());

	it.each(SEVERITIES)('renders %s as text so severity survives without colour', (severity) => {
		const { getByText } = render(SeverityBadge, { props: { severity } });
		expect(getByText(severity)).toBeTruthy();
	});

	it.each(RANKED)('renders the notch rail as four slots for %s', (severity) => {
		const { container } = render(SeverityBadge, { props: { severity } });
		expect(container.querySelectorAll('[data-notch]')).toHaveLength(SEVERITY_NOTCH_MAX);
	});

	it.each(RANKED)('fills the notch count defined for %s', (severity) => {
		const { container } = render(SeverityBadge, { props: { severity } });
		expect(container.querySelectorAll('[data-notch="filled"]')).toHaveLength(
			SEVERITY_NOTCHES[severity],
		);
	});

	it('marks UNKNOWN with its own glyph instead of an empty level rail', () => {
		// An empty four-slot rail reads as "level zero", i.e. the safest thing on screen.
		const { container } = render(SeverityBadge, { props: { severity: 'UNKNOWN' } });
		expect(container.querySelector('[data-notch-rail]')).toBeNull();
		expect(container.querySelector('[data-unknown-marker]')).not.toBeNull();
	});

	it('gives UNKNOWN a neutral hue rather than the safe-looking green', () => {
		const { container } = render(SeverityBadge, { props: { severity: 'UNKNOWN' } });
		const style = container.querySelector('span')?.getAttribute('style') ?? '';
		expect(style.toLowerCase()).not.toContain('#00e676');
	});

	it('hides the decorative rail from assistive technology', () => {
		const { container } = render(SeverityBadge, { props: { severity: 'HIGH' } });
		const rail = container.querySelector('[data-notch-rail]');
		expect(rail?.getAttribute('aria-hidden')).toBe('true');
	});

	it('no longer encodes severity with the left border alone', () => {
		const { container } = render(SeverityBadge, { props: { severity: 'CRITICAL' } });
		const badge = container.querySelector('span');
		expect(badge?.getAttribute('style') ?? '').not.toContain('border-left');
	});
});
