import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FindingsTable from './FindingsTable.svelte';

const LONG_PACKAGE = `@decree/${'long-transitive-dependency-'.repeat(4)}core`.slice(0, 111);

const groups = [
	{
		advisory_id: 'CVE-2021-44228',
		severity: 'CRITICAL',
		max_decree_score: 9.4,
		epss_score: 0.97425,
		cvss_score: 10,
		instance_count: 12,
		target_count: 5,
		target_names: ['alt-backend', 'alt-frontend'],
		package_names: ['org.apache.logging.log4j:log4j-core'],
		ecosystems: ['Maven'],
		is_active: true,
		first_observed_at: '2026-01-02T00:00:00Z',
		last_observed_at: '2026-09-01T00:00:00Z',
	},
	{
		advisory_id: 'GHSA-7fh5-64p2-3v2j',
		severity: 'HIGH',
		max_decree_score: 6.1,
		epss_score: 0.00042,
		cvss_score: 7.5,
		instance_count: 1,
		target_count: 1,
		target_names: ['decree-eye'],
		package_names: [LONG_PACKAGE],
		ecosystems: ['npm'],
		is_active: false,
		first_observed_at: '2026-07-01T00:00:00Z',
		last_observed_at: '2026-08-20T00:00:00Z',
	},
];

const baseProps = {
	groups,
	sort: 'decree_score' as const,
	order: 'desc' as const,
	selectedAdvisoryId: null,
	loading: false,
	hasMore: false,
	hasActiveFilters: false,
	onSort: () => {},
	onSelect: () => {},
	onLoadMore: () => {},
	onClearFilters: () => {},
};

function cellAt(grid: HTMLElement, row: number, col: number): HTMLElement | null {
	return grid.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
}

describe('FindingsTable', () => {
	afterEach(() => cleanup());

	it('renders one row per advisory group plus the header row', () => {
		const { getAllByRole } = render(FindingsTable, { props: baseProps });
		expect(getAllByRole('row')).toHaveLength(groups.length + 1);
	});

	it('renders every advisory id in full', () => {
		const { getByText } = render(FindingsTable, { props: baseProps });

		const cve = getByText('CVE-2021-44228');
		expect(cve.textContent).toBe('CVE-2021-44228');
		expect(cve.className).not.toContain('truncate');
		expect(getByText('GHSA-7fh5-64p2-3v2j').textContent).toBe('GHSA-7fh5-64p2-3v2j');
	});

	it('marks exactly one column header as sorted', () => {
		const { container } = render(FindingsTable, { props: baseProps });

		const sorted = container.querySelectorAll('[aria-sort]');
		expect(sorted).toHaveLength(1);
		expect(sorted[0]?.getAttribute('aria-sort')).toBe('descending');
		expect(sorted[0]?.textContent).toContain('DECREE');
	});

	it('moves aria-sort with the sort key and direction', () => {
		const { container } = render(FindingsTable, {
			props: { ...baseProps, sort: 'epss' as const, order: 'asc' as const },
		});

		const sorted = container.querySelectorAll('[aria-sort]');
		expect(sorted).toHaveLength(1);
		expect(sorted[0]?.getAttribute('aria-sort')).toBe('ascending');
		expect(sorted[0]?.textContent).toContain('EPSS');
	});

	it('calls onSort with the key of the clicked column', async () => {
		const onSort = vi.fn();
		const { getByRole } = render(FindingsTable, { props: { ...baseProps, onSort } });

		await fireEvent.click(getByRole('button', { name: 'Sort by EPSS' }));
		expect(onSort).toHaveBeenCalledWith('epss');

		await fireEvent.click(getByRole('button', { name: 'Sort by Last seen' }));
		expect(onSort).toHaveBeenCalledWith('last_observed');
	});

	it('names the active sort button after the direction it would produce', () => {
		const { getByRole } = render(FindingsTable, { props: baseProps });
		expect(getByRole('button', { name: 'Sort by DECREE ascending' })).toBeTruthy();
	});

	it('keeps a single tab stop for the whole grid', () => {
		const { getByRole } = render(FindingsTable, { props: baseProps });
		expect(getByRole('grid').querySelectorAll('[tabindex="0"]')).toHaveLength(1);
	});

	it('moves the roving tab stop with the arrow keys', async () => {
		const { getByRole } = render(FindingsTable, { props: baseProps });
		const grid = getByRole('grid');

		cellAt(grid, 0, 0)?.focus();

		await fireEvent.keyDown(grid, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(cellAt(grid, 0, 1));

		await fireEvent.keyDown(grid, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(cellAt(grid, 1, 1));

		await fireEvent.keyDown(grid, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(cellAt(grid, 2, 1));

		// Clamped at the last row rather than wrapping around.
		await fireEvent.keyDown(grid, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(cellAt(grid, 2, 1));

		await fireEvent.keyDown(grid, { key: 'ArrowLeft' });
		expect(document.activeElement).toBe(cellAt(grid, 2, 0));

		await fireEvent.keyDown(grid, { key: 'End' });
		expect(document.activeElement).toBe(cellAt(grid, 2, 7));

		await fireEvent.keyDown(grid, { key: 'Home' });
		expect(document.activeElement).toBe(cellAt(grid, 2, 0));

		await fireEvent.keyDown(grid, { key: 'ArrowUp' });
		expect(document.activeElement).toBe(cellAt(grid, 1, 0));

		expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
		expect(document.activeElement?.getAttribute('tabindex')).toBe('0');
	});

	it('leaves the focus indicator of every focusable cell alone', () => {
		const { getByRole } = render(FindingsTable, { props: baseProps });
		const focusable = getByRole('grid').querySelectorAll('[data-row][data-col]');

		expect(focusable.length).toBe((groups.length + 1) * 8);
		for (const cell of focusable) {
			expect(cell.className).not.toContain('outline-none');
		}
	});

	it('selects a row on click and on Enter', async () => {
		const onSelect = vi.fn();
		const { getByRole, getByText } = render(FindingsTable, { props: { ...baseProps, onSelect } });

		await fireEvent.click(getByText('CVE-2021-44228'));
		expect(onSelect).toHaveBeenCalledWith('CVE-2021-44228');

		const grid = getByRole('grid');
		cellAt(grid, 2, 0)?.focus();
		await fireEvent.keyDown(grid, { key: 'Enter' });
		expect(onSelect).toHaveBeenLastCalledWith('GHSA-7fh5-64p2-3v2j');
	});

	it('reflects selectedAdvisoryId with aria-selected', () => {
		const { getAllByRole } = render(FindingsTable, {
			props: { ...baseProps, selectedAdvisoryId: 'GHSA-7fh5-64p2-3v2j' },
		});

		const selectable = getAllByRole('row').filter((row) => row.hasAttribute('aria-selected'));
		expect(selectable.map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'true']);
	});

	it('shows a loading state before the first page arrives', () => {
		const { getByRole, queryByRole } = render(FindingsTable, {
			props: { ...baseProps, groups: [], loading: true, hasActiveFilters: true },
		});

		expect(getByRole('status').textContent).toContain('Loading');
		expect(queryByRole('button', { name: 'Clear filters' })).toBeNull();
	});

	it('reports an empty project separately from an empty filter result', () => {
		const { getByText, queryByRole } = render(FindingsTable, {
			props: { ...baseProps, groups: [] },
		});

		expect(getByText('No vulnerabilities recorded for this project.')).toBeTruthy();
		expect(queryByRole('button', { name: 'Clear filters' })).toBeNull();
	});

	it('offers a filter reset when the filters removed every row', async () => {
		const onClearFilters = vi.fn();
		const { getByText, getByRole } = render(FindingsTable, {
			props: { ...baseProps, groups: [], hasActiveFilters: true, onClearFilters },
		});

		expect(getByText('No advisories match the current filters.')).toBeTruthy();
		await fireEvent.click(getByRole('button', { name: 'Clear filters' }));
		expect(onClearFilters).toHaveBeenCalledOnce();
	});

	it('shows +N more only when the server capped the target list', () => {
		const { getByText, queryAllByText } = render(FindingsTable, { props: baseProps });

		expect(getByText('+3 more')).toBeTruthy();
		expect(queryAllByText(/^\+\d+ more$/)).toHaveLength(1);
	});

	it('shows the blast radius of a group', () => {
		const { getByText } = render(FindingsTable, { props: baseProps });
		expect(getByText('12 inst')).toBeTruthy();
		expect(getByText('alt-backend, alt-frontend')).toBeTruthy();
	});

	it('renders EPSS as a percentage rather than a raw probability', () => {
		const { getByText, queryByText } = render(FindingsTable, { props: baseProps });

		expect(getByText('97.4%')).toBeTruthy();
		expect(getByText('0.04%')).toBeTruthy();
		expect(queryByText('0.97425')).toBeNull();
	});

	it('renders DECREE Score on its 0-10 scale', () => {
		const { getByText } = render(FindingsTable, { props: baseProps });
		expect(getByText('9.4')).toBeTruthy();
		expect(getByText('6.1')).toBeTruthy();
	});

	it('keeps a machine readable timestamp for the last observation', () => {
		const { container } = render(FindingsTable, { props: baseProps });
		const times = container.querySelectorAll('time');
		expect(times[0]?.getAttribute('datetime')).toBe('2026-09-01T00:00:00Z');
	});

	it('truncates a very long package name without changing the row height', () => {
		const { getByTitle, getAllByRole } = render(FindingsTable, { props: baseProps });

		const pkg = getByTitle(LONG_PACKAGE);
		expect(LONG_PACKAGE).toHaveLength(111);
		expect(pkg.className).toContain('truncate');
		// The full name stays in the DOM so find-in-page and screen readers still reach it.
		expect(pkg.textContent).toBe(LONG_PACKAGE);

		// Every row keeps the fixed-height layout class, so a long name cannot grow the row.
		const rows = getAllByRole('row').filter((row) => row.hasAttribute('aria-selected'));
		expect(rows.every((row) => row.classList.contains('findings-row-layout'))).toBe(true);
	});

	it('offers a load-more control only while more pages exist', async () => {
		const onLoadMore = vi.fn();
		const { queryByRole } = render(FindingsTable, { props: baseProps });
		expect(queryByRole('button', { name: 'Load more advisories' })).toBeNull();
		cleanup();

		const { getByRole } = render(FindingsTable, {
			props: { ...baseProps, hasMore: true, onLoadMore },
		});
		await fireEvent.click(getByRole('button', { name: 'Load more advisories' }));
		expect(onLoadMore).toHaveBeenCalledOnce();
	});
});
