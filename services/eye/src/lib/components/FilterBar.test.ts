import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
const pageState = { url: new URL('http://localhost:3400/projects/proj-1') };

vi.mock('$app/navigation', () => ({
	goto: (...args: unknown[]) => goto(...args),
}));

vi.mock('$app/state', () => ({
	get page() {
		return pageState;
	},
}));

import type { FindingsQuery, ViewQuery } from '$lib/state/query-params';
import { DEFAULT_FINDINGS_QUERY, DEFAULT_VIEW_QUERY } from '$lib/state/query-params';
import FilterBar from './FilterBar.svelte';

function props(overrides: { query?: Partial<FindingsQuery>; view?: Partial<ViewQuery> } = {}) {
	return {
		query: { ...DEFAULT_FINDINGS_QUERY, ...overrides.query },
		view: { ...DEFAULT_VIEW_QUERY, ...overrides.view },
		ecosystems: ['Go', 'PyPI', 'crates.io', 'npm'],
		severityCounts: { critical: 39, high: 139, medium: 328, low: 409, unknown: 113 },
	};
}

/** The URL the single goto call was given, as a URLSearchParams. */
function writtenParams(): URLSearchParams {
	expect(goto).toHaveBeenCalledTimes(1);
	const target = goto.mock.calls[0]?.[0] as string;
	return new URL(target, 'http://localhost:3400').searchParams;
}

describe('FilterBar', () => {
	beforeEach(() => {
		goto.mockClear();
		pageState.url = new URL('http://localhost:3400/projects/proj-1');
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it('heads the panel with a real heading', () => {
		const { getByRole } = render(FilterBar, { props: props() });
		expect(getByRole('heading', { level: 2, name: 'Viewport Controls' })).toBeTruthy();
	});

	it('offers the three user-facing view modes and marks the current one', () => {
		const { getByRole } = render(FilterBar, { props: props({ view: { view: '2d' } }) });

		expect(getByRole('group', { name: 'View mode' })).toBeTruthy();
		expect(getByRole('button', { name: '3D Spatial' }).getAttribute('aria-pressed')).toBe('false');
		expect(getByRole('button', { name: 'Risk Plot' }).getAttribute('aria-pressed')).toBe('true');
		expect(getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('false');
	});

	it('writes the view to the URL and keeps the current selection', async () => {
		const { getByRole } = render(FilterBar, {
			props: props({ view: { view: '3d', advisory: 'CVE-2021-44228' } }),
		});

		await fireEvent.click(getByRole('button', { name: 'Table' }));

		const params = writtenParams();
		expect(params.get('view')).toBe('table');
		expect(params.get('advisory')).toBe('CVE-2021-44228');
	});

	it('navigates without stealing focus or scrolling, and without a history entry', async () => {
		const { getByRole } = render(FilterBar, { props: props() });
		await fireEvent.click(getByRole('button', { name: 'Table' }));

		expect(goto.mock.calls[0]?.[1]).toEqual({
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
	});

	it('shows the facet count next to each severity so the filter is predictable', () => {
		const { getByRole } = render(FilterBar, { props: props() });
		const select = getByRole('combobox', { name: /Severity/ }) as HTMLSelectElement;

		expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
			'All severities (1028)',
			'CRITICAL (39)',
			'HIGH (139)',
			'MEDIUM (328)',
			'LOW (409)',
			'UNKNOWN (113)',
		]);
	});

	it('passes the ecosystem facet value through unmodified', async () => {
		const { getByRole } = render(FilterBar, { props: props() });
		const select = getByRole('combobox', { name: 'Ecosystem' }) as HTMLSelectElement;

		expect([...select.options].map((o) => o.value)).toEqual(['', 'Go', 'PyPI', 'crates.io', 'npm']);

		await fireEvent.change(select, { target: { value: 'crates.io' } });
		expect(writtenParams().get('ecosystem')).toBe('crates.io');
	});

	it('drops the selection when a filter changes, because it belongs to the old result set', async () => {
		const { getByRole } = render(FilterBar, {
			props: props({ view: { view: 'table', advisory: 'CVE-2021-44228', finding: 'inst-1' } }),
		});

		await fireEvent.change(getByRole('combobox', { name: /Severity/ }), {
			target: { value: 'CRITICAL' },
		});

		const params = writtenParams();
		expect(params.get('severity')).toBe('CRITICAL');
		expect(params.get('view')).toBe('table');
		expect(params.get('advisory')).toBeNull();
		expect(params.get('finding')).toBeNull();
	});

	it('debounces the search box instead of loading once per keystroke', async () => {
		vi.useFakeTimers();
		const { getByRole } = render(FilterBar, { props: props() });
		const search = getByRole('searchbox', { name: 'Search' });

		await fireEvent.input(search, { target: { value: 'log' } });
		await fireEvent.input(search, { target: { value: 'log4' } });
		await fireEvent.input(search, { target: { value: 'log4j' } });
		expect(goto).not.toHaveBeenCalled();

		vi.advanceTimersByTime(300);
		expect(writtenParams().get('q')).toBe('log4j');
	});

	it('debounces the EPSS slider instead of loading once per pixel of drag', async () => {
		vi.useFakeTimers();
		const { getByRole } = render(FilterBar, { props: props() });
		const slider = getByRole('slider', { name: /Minimum EPSS/ });

		await fireEvent.input(slider, { target: { value: '0.2' } });
		await fireEvent.input(slider, { target: { value: '0.5' } });
		expect(goto).not.toHaveBeenCalled();

		vi.advanceTimersByTime(300);
		expect(writtenParams().get('epss')).toBe('0.5');
	});

	it('offers a short ladder of score thresholds and marks the active one', () => {
		const { getByRole } = render(FilterBar, { props: props({ query: { minScore: 5 } }) });

		const group = getByRole('group', { name: 'Minimum DECREE Score' });
		expect([...group.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
			'Any',
			'4+',
			'5+',
			'6+',
			'7+',
		]);
		expect(getByRole('button', { name: '5+' }).getAttribute('aria-pressed')).toBe('true');
		expect(getByRole('button', { name: 'Any' }).getAttribute('aria-pressed')).toBe('false');
	});

	it('applies a threshold on the click, since a discrete choice has nothing to debounce', async () => {
		vi.useFakeTimers();
		const { getByRole } = render(FilterBar, { props: props() });

		await fireEvent.click(getByRole('button', { name: '6+' }));
		expect(writtenParams().get('score')).toBe('6');
	});

	it('clears the threshold through the Any option rather than another control', async () => {
		const { getByRole } = render(FilterBar, { props: props({ query: { minScore: 7 } }) });

		await fireEvent.click(getByRole('button', { name: 'Any' }));
		expect(writtenParams().get('score')).toBeNull();
	});

	it('drops the selection when the threshold changes, like every other filter', async () => {
		const { getByRole } = render(FilterBar, {
			props: props({ view: { view: 'table', advisory: 'CVE-2021-44228', finding: 'inst-1' } }),
		});

		await fireEvent.click(getByRole('button', { name: '5+' }));

		const params = writtenParams();
		expect(params.get('score')).toBe('5');
		expect(params.get('advisory')).toBeNull();
		expect(params.get('finding')).toBeNull();
	});

	it('exposes the active-only toggle state and writes it to the URL', async () => {
		const { getByRole } = render(FilterBar, { props: props() });
		const toggle = getByRole('button', { name: 'Active Only' });
		expect(toggle.getAttribute('aria-pressed')).toBe('true');

		await fireEvent.click(toggle);
		expect(writtenParams().get('active')).toBe('0');
	});

	it('resets every filter param while keeping the view mode', async () => {
		const { getByRole } = render(FilterBar, {
			props: props({
				query: {
					severity: 'CRITICAL',
					ecosystem: 'npm',
					minEpss: 0.4,
					minScore: 6,
					q: 'log4j',
					activeOnly: false,
				},
				view: { view: 'table' },
			}),
		});

		await fireEvent.click(getByRole('button', { name: 'Reset' }));

		const params = writtenParams();
		expect(params.get('severity')).toBeNull();
		expect(params.get('ecosystem')).toBeNull();
		expect(params.get('epss')).toBeNull();
		expect(params.get('score')).toBeNull();
		expect(params.get('q')).toBeNull();
		expect(params.get('active')).toBeNull();
		expect(params.get('view')).toBe('table');
	});

	it('keeps a pending keystroke from re-applying after a reset', async () => {
		vi.useFakeTimers();
		const { getByRole } = render(FilterBar, { props: props() });

		await fireEvent.input(getByRole('searchbox', { name: 'Search' }), {
			target: { value: 'log4j' },
		});
		await fireEvent.click(getByRole('button', { name: 'Reset' }));
		vi.advanceTimersByTime(600);

		expect(writtenParams().get('q')).toBeNull();
	});

	it('keeps the sort key and direction the table is using', async () => {
		const { getByRole } = render(FilterBar, {
			props: props({ query: { sort: 'epss', order: 'asc' } }),
		});

		await fireEvent.click(getByRole('button', { name: 'Risk Plot' }));

		const params = writtenParams();
		expect(params.get('sort')).toBe('epss');
		expect(params.get('order')).toBe('asc');
	});
});
