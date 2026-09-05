import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteURL } from 'svelte/reactivity';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_GATEWAY_URL: 'http://localhost:8400' },
}));

const goto = vi.fn();
const pageState = { url: new SvelteURL('http://localhost:3400/projects/proj-1') };

vi.mock('$app/navigation', () => ({
	goto: (...args: unknown[]) => goto(...args),
}));

vi.mock('$app/state', () => ({
	get page() {
		return pageState;
	},
}));

const getFindingDetail = vi.fn();
const getFindings = vi.fn();

vi.mock('$lib/api/client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api/client')>();
	return {
		...actual,
		getFindingDetail: (...args: unknown[]) => getFindingDetail(...args),
		getFindings: (...args: unknown[]) => getFindings(...args),
	};
});

import { appState } from '$lib/state/app.svelte';
import { DEFAULT_FINDINGS_QUERY } from '$lib/state/query-params';
import { timelineState } from '$lib/state/timeline.svelte';
import type { AdvisoryGroup, Finding, FindingDetail } from '$lib/types/api';
import ProjectPage from './+page.svelte';

beforeAll(() => {
	if (!('ResizeObserver' in globalThis)) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
});

function finding(id: string, ecosystem: string, overrides: Partial<Finding> = {}): Finding {
	return {
		instance_id: id,
		target_id: 't1',
		target_name: 'alt',
		package_name: `pkg-${id}`,
		package_version: '1.0.0',
		ecosystem,
		advisory_id: `CVE-2026-${id}`,
		severity: 'HIGH',
		decree_score: 6,
		is_active: true,
		...overrides,
	};
}

function group(id: string, overrides: Partial<AdvisoryGroup> = {}): AdvisoryGroup {
	return {
		advisory_id: id,
		severity: 'high',
		max_decree_score: 6,
		epss_score: 0.4,
		cvss_score: 7,
		instance_count: 2,
		target_count: 1,
		target_names: ['alt'],
		package_names: ['pkg-a'],
		ecosystems: ['npm'],
		is_active: true,
		last_observed_at: '2026-09-01T00:00:00Z',
		...overrides,
	};
}

const npmFinding = finding('0001', 'npm');
const pypiFinding = finding('0002', 'PyPI');

function detail(instanceId: string, advisoryId: string): FindingDetail {
	return {
		...finding(instanceId, 'npm', { advisory_id: advisoryId }),
		advisory_source: 'nvd',
		fix_versions: [],
		exploits: [],
		dependency_path: [],
	};
}

function data(overrides: Record<string, unknown> = {}) {
	return {
		projectId: 'proj-1',
		project: { id: 'proj-1', name: 'helios-platform', created_at: '2026-01-01T00:00:00Z' },
		targets: [],
		facets: {
			ecosystems: ['PyPI', 'npm'],
			severity_counts: { critical: 0, high: 2, medium: 0, low: 0, unknown: 0 },
			total: 2,
		},
		query: DEFAULT_FINDINGS_QUERY,
		findings: [npmFinding, pypiFinding],
		advisories: [group('CVE-2026-0001'), group('CVE-2026-0002')],
		truncated: false,
		...overrides,
	};
}

/** The URL of the last goto call, as search params. */
function lastParams(): URLSearchParams {
	const target = goto.mock.calls.at(-1)?.[0] as string;
	return new URL(target, 'http://localhost:3400').searchParams;
}

function setSearch(search: string) {
	pageState.url.search = search;
}

describe('project page', () => {
	beforeEach(() => {
		appState.reset();
		timelineState.reset();
		goto.mockClear();
		getFindingDetail.mockReset();
		getFindings.mockReset();
		getFindings.mockResolvedValue({ data: [], has_more: false });
		pageState.url = new SvelteURL('http://localhost:3400/projects/proj-1');
	});

	afterEach(() => {
		cleanup();
		appState.reset();
		timelineState.reset();
	});

	it('starts the heading outline with a page-level heading', () => {
		const { getByRole } = render(ProjectPage, { props: { data: data() } });
		expect(getByRole('heading', { level: 1 })).toBeTruthy();
	});

	it('keeps every ecosystem selectable after one is chosen', () => {
		const { getByRole } = render(ProjectPage, {
			props: { data: data({ query: { ...DEFAULT_FINDINGS_QUERY, ecosystem: 'npm' } }) },
		});
		const select = getByRole('combobox', { name: 'Ecosystem' }) as HTMLSelectElement;

		expect([...select.options].map((o) => o.value).sort()).toEqual(['', 'PyPI', 'npm']);
	});

	describe('the scene shows advisories, not instances', () => {
		it('feeds the 3D scene the advisory groups', () => {
			// Instances are present but there are no advisory groups, so an instance-fed scene
			// would still have nodes to draw.
			const { getByText } = render(ProjectPage, { props: { data: data({ advisories: [] }) } });
			expect(getByText('No vulnerabilities recorded for this project.')).toBeTruthy();
		});

		it('selects an advisory rather than opening a finding', async () => {
			setSearch('?view=table');
			const { getAllByRole } = render(ProjectPage, { props: { data: data() } });

			await fireEvent.click(getAllByRole('row')[1] as HTMLElement);

			expect(lastParams().get('advisory')).toBe('CVE-2026-0001');
			expect(lastParams().get('finding')).toBeNull();
			expect(getFindingDetail).not.toHaveBeenCalled();
		});
	});

	describe('view modes', () => {
		it('renders the risk plot in 2d and the table in table mode', async () => {
			setSearch('?view=2d');
			const plot = render(ProjectPage, { props: { data: data() } });
			expect(plot.getByRole('img', { name: /DECREE Score/i })).toBeTruthy();
			expect(plot.queryByRole('grid')).toBeNull();
			cleanup();

			setSearch('?view=table');
			const table = render(ProjectPage, { props: { data: data() } });
			expect(table.getByRole('grid', { name: 'Findings grouped by advisory' })).toBeTruthy();
			expect(table.queryByRole('application')).toBeNull();
		});
	});

	describe('sorting', () => {
		it('writes the sort key to the URL', async () => {
			setSearch('?view=table');
			const { getByRole } = render(ProjectPage, { props: { data: data() } });

			await fireEvent.click(getByRole('button', { name: 'Sort by EPSS' }));

			expect(lastParams().get('sort')).toBe('epss');
			expect(lastParams().get('order')).toBeNull();
		});

		it('flips the direction when the same key is re-sent', async () => {
			setSearch('?view=table&sort=epss');
			const { getByRole } = render(ProjectPage, {
				props: { data: data({ query: { ...DEFAULT_FINDINGS_QUERY, sort: 'epss' } }) },
			});

			await fireEvent.click(getByRole('button', { name: 'Sort by EPSS ascending' }));

			expect(lastParams().get('sort')).toBe('epss');
			expect(lastParams().get('order')).toBe('asc');
		});

		it('keeps focus and stays out of the history', async () => {
			setSearch('?view=table');
			const { getByRole } = render(ProjectPage, { props: { data: data() } });

			await fireEvent.click(getByRole('button', { name: 'Sort by EPSS' }));

			expect(goto.mock.calls.at(-1)?.[1]).toEqual({
				replaceState: true,
				keepFocus: true,
				noScroll: true,
			});
		});
	});

	describe('table pagination', () => {
		const many = Array.from({ length: 60 }, (_, i) =>
			group(`CVE-2026-${String(i).padStart(4, '0')}`),
		);

		it('pages through the loaded set instead of pretending there is nothing more', async () => {
			setSearch('?view=table');
			const { getAllByRole, getByRole, queryByRole } = render(ProjectPage, {
				props: { data: data({ advisories: many }) },
			});

			// One header row plus the first page.
			expect(getAllByRole('row')).toHaveLength(51);

			await fireEvent.click(getByRole('button', { name: 'Load more advisories' }));
			expect(getAllByRole('row')).toHaveLength(61);
			expect(queryByRole('button', { name: 'Load more advisories' })).toBeNull();
		});

		it('ends the list when everything loaded is shown', () => {
			setSearch('?view=table');
			const { getByText } = render(ProjectPage, { props: { data: data() } });
			expect(getByText('End of results')).toBeTruthy();
		});
	});

	describe('the detail panel', () => {
		it('loads the finding detail named by the URL', async () => {
			getFindingDetail.mockResolvedValue(detail('inst-a', 'CVE-2026-9999'));
			setSearch('?finding=inst-a');

			const { getByRole } = render(ProjectPage, { props: { data: data() } });
			await tick();
			await tick();

			expect(getFindingDetail).toHaveBeenCalledWith('inst-a');
			expect(getByRole('region', { name: 'CVE-2026-9999' })).toBeTruthy();
		});

		it('reports a failed detail fetch instead of silently doing nothing', async () => {
			getFindingDetail.mockRejectedValue({
				error: { code: 'not_found', message: 'no such finding' },
			});
			setSearch('?finding=inst-a&advisory=CVE-2026-0001');

			const { getByRole } = render(ProjectPage, { props: { data: data() } });
			await tick();
			await tick();

			expect(getByRole('alert').textContent).toMatch(/no such finding/i);
		});

		it('ignores a late response for a selection that has been superseded', async () => {
			const pending = new Map<string, (value: FindingDetail) => void>();
			getFindingDetail.mockImplementation(
				(id: string) => new Promise<FindingDetail>((resolve) => pending.set(id, resolve)),
			);

			setSearch('?finding=inst-a');
			const { getByRole, queryByRole } = render(ProjectPage, { props: { data: data() } });
			await tick();

			setSearch('?finding=inst-b');
			await tick();

			pending.get('inst-b')?.(detail('inst-b', 'CVE-2026-BBBB'));
			await tick();
			await tick();
			expect(getByRole('region', { name: 'CVE-2026-BBBB' })).toBeTruthy();

			pending.get('inst-a')?.(detail('inst-a', 'CVE-2026-AAAA'));
			await tick();
			await tick();

			expect(queryByRole('region', { name: 'CVE-2026-AAAA' })).toBeNull();
			expect(getByRole('region', { name: 'CVE-2026-BBBB' })).toBeTruthy();
		});

		it('summarizes the advisory and lists its instances when only an advisory is selected', async () => {
			getFindings.mockResolvedValue({ data: [finding('inst-x', 'npm')], has_more: false });
			setSearch('?advisory=CVE-2026-0001');

			const { getByRole } = render(ProjectPage, { props: { data: data() } });
			await tick();
			await tick();

			expect(getFindings).toHaveBeenCalledWith(
				'proj-1',
				expect.objectContaining({ advisory: 'CVE-2026-0001' }),
			);
			expect(getByRole('region', { name: 'CVE-2026-0001' })).toBeTruthy();
			expect(getByRole('button', { name: /pkg-inst-x/ })).toBeTruthy();
			expect(getFindingDetail).not.toHaveBeenCalled();
		});

		it('opens an instance picked out of the advisory list', async () => {
			getFindings.mockResolvedValue({ data: [finding('inst-x', 'npm')], has_more: false });
			setSearch('?advisory=CVE-2026-0001');

			const { getByRole } = render(ProjectPage, { props: { data: data() } });
			await tick();
			await tick();

			await fireEvent.click(getByRole('button', { name: /pkg-inst-x/ }));
			expect(lastParams().get('finding')).toBe('inst-x');
			expect(lastParams().get('advisory')).toBe('CVE-2026-0001');
		});

		it('reports a failed instance fetch', async () => {
			getFindings.mockRejectedValue(new Error('gateway down'));
			setSearch('?advisory=CVE-2026-0001');

			const { getByRole } = render(ProjectPage, { props: { data: data() } });
			await tick();
			await tick();

			expect(getByRole('alert')).toBeTruthy();
		});

		it('sits beside the priority queue rather than on top of it', async () => {
			getFindings.mockResolvedValue({ data: [], has_more: false });
			setSearch('?advisory=CVE-2026-0001');

			const { getByRole } = render(ProjectPage, { props: { data: data() } });
			await tick();

			const panel = getByRole('region', { name: 'CVE-2026-0001' });
			const queue = getByRole('heading', { level: 2, name: 'Priority Queue' });

			expect(panel.className).not.toContain('fixed');
			expect(panel.parentElement).toBe(queue.closest('[data-page-grid] > *')?.parentElement);
		});

		it('closes back to no selection at all', async () => {
			getFindings.mockResolvedValue({ data: [], has_more: false });
			setSearch('?advisory=CVE-2026-0001');

			const { getByRole } = render(ProjectPage, { props: { data: data() } });
			await tick();

			await fireEvent.click(getByRole('button', { name: 'Close finding details' }));
			expect(lastParams().get('advisory')).toBeNull();
			expect(lastParams().get('finding')).toBeNull();
		});
	});

	describe('honest counts', () => {
		it('counts advisories in the scene and instances in the risk plot', async () => {
			const spatial = render(ProjectPage, { props: { data: data() } });
			expect(spatial.getByText('Advisories')).toBeTruthy();
			cleanup();

			setSearch('?view=2d');
			const plot = render(ProjectPage, { props: { data: data() } });
			expect(plot.getByText('Instances')).toBeTruthy();
		});

		it('surfaces a truncated load rather than presenting it as a total', () => {
			const { getByText } = render(ProjectPage, { props: { data: data({ truncated: true }) } });
			expect(getByText(/Row cap reached/i)).toBeTruthy();
		});
	});

	describe('empty results', () => {
		it('reports an empty project differently from an empty filter result', () => {
			const clean = render(ProjectPage, { props: { data: data({ advisories: [] }) } });
			expect(clean.getByText('No vulnerabilities recorded for this project.')).toBeTruthy();
			cleanup();

			const filtered = render(ProjectPage, {
				props: {
					data: data({
						advisories: [],
						query: { ...DEFAULT_FINDINGS_QUERY, severity: 'CRITICAL' },
					}),
				},
			});
			expect(filtered.getByText('No findings match the current filters.')).toBeTruthy();
		});

		it('clears the filters from the empty scene', async () => {
			const { getByRole } = render(ProjectPage, {
				props: {
					data: data({
						advisories: [],
						query: { ...DEFAULT_FINDINGS_QUERY, severity: 'CRITICAL', minEpss: 0.5 },
					}),
				},
			});

			await fireEvent.click(getByRole('button', { name: 'Clear filters' }));

			const params = lastParams();
			expect(params.get('severity')).toBeNull();
			expect(params.get('epss')).toBeNull();
		});
	});
});
