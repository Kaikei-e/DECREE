import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError, PagedResponse } from '$lib/types/api';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_GATEWAY_URL: 'http://localhost:8400' },
}));

import {
	fetchAllAdvisories,
	fetchAllFindings,
	getAdvisories,
	getFacets,
	getFindingDetail,
	getFindings,
	getProject,
	getProjects,
	getTargets,
	getTimeline,
	getTopRisks,
} from './client';

const BASE = 'http://localhost:8400';

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

describe('api client functions', () => {
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('getProjects calls correct URL', async () => {
		fetchSpy.mockResolvedValueOnce(
			jsonResponse({ data: [{ id: '1', name: 'p', created_at: '' }] }),
		);
		const result = await getProjects();
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/projects`);
		expect(result).toEqual([{ id: '1', name: 'p', created_at: '' }]);
	});

	it('getProjects accepts custom fetch', async () => {
		const customFetch = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ data: [{ id: '2', name: 'q', created_at: '' }] }));
		const result = await getProjects(customFetch);
		expect(customFetch).toHaveBeenCalledWith(`${BASE}/api/projects`);
		expect(result).toEqual([{ id: '2', name: 'q', created_at: '' }]);
	});

	it('getTargets calls correct URL with projectId', async () => {
		fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [] }));
		const result = await getTargets('proj-1');
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/projects/proj-1/targets`);
		expect(result).toEqual([]);
	});

	it('getFindings calls correct URL without params', async () => {
		const body: PagedResponse<unknown> = { data: [], has_more: false };
		fetchSpy.mockResolvedValueOnce(jsonResponse(body));
		await getFindings('proj-1');
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/projects/proj-1/findings`);
	});

	it('getFindings builds query string from params', async () => {
		const body: PagedResponse<unknown> = { data: [], has_more: false };
		fetchSpy.mockResolvedValueOnce(jsonResponse(body));
		await getFindings('proj-1', { severity: 'high', active_only: true, limit: 25 });
		const url = fetchSpy.mock.calls[0]?.[0] as string;
		expect(url).toContain('severity=high');
		expect(url).toContain('active_only=true');
		expect(url).toContain('limit=25');
	});

	it('getFindingDetail calls correct URL', async () => {
		fetchSpy.mockResolvedValueOnce(
			jsonResponse({
				data: {
					instance_id: 'i-1',
					target_id: 't-1',
					target_name: '',
					package_name: '',
					package_version: '',
					ecosystem: '',
					advisory_id: '',
					advisory_source: '',
					is_active: true,
					fix_versions: [],
					exploits: [],
					dependency_path: [],
				},
			}),
		);
		const result = await getFindingDetail('i-1');
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/findings/i-1`);
		expect(result.instance_id).toBe('i-1');
	});

	it('getTopRisks calls correct URL with optional limit', async () => {
		fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [] }));
		const result = await getTopRisks('proj-1', 10);
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/projects/proj-1/top-risks?limit=10`);
		expect(result).toEqual([]);
	});

	it('getTopRisks omits limit when not provided', async () => {
		fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [] }));
		const result = await getTopRisks('proj-1');
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/projects/proj-1/top-risks`);
		expect(result).toEqual([]);
	});

	it('getTimeline calls correct URL with params', async () => {
		const body: PagedResponse<unknown> = { data: [], has_more: false };
		fetchSpy.mockResolvedValueOnce(jsonResponse(body));
		await getTimeline('proj-1', { target_id: 't-1', event_type: 'observed' });
		const url = fetchSpy.mock.calls[0]?.[0] as string;
		expect(url).toContain('/api/projects/proj-1/timeline?');
		expect(url).toContain('target_id=t-1');
		expect(url).toContain('event_type=observed');
	});

	it('getFindings passes sort, order and q through', async () => {
		fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [], has_more: false }));
		await getFindings('p1', { sort: 'severity', order: 'asc', q: 'log4j' });
		expect(fetchSpy).toHaveBeenCalledWith(
			`${BASE}/api/projects/p1/findings?sort=severity&order=asc&q=log4j`,
		);
	});

	it('getFindings percent-encodes a search term with special characters', async () => {
		fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [], has_more: false }));
		await getFindings('p1', { q: 'a b&c' });
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/projects/p1/findings?q=a%20b%26c`);
	});

	it('getProject calls the single-project endpoint', async () => {
		fetchSpy.mockResolvedValueOnce(
			jsonResponse({ data: { id: 'p1', name: 'helios', created_at: '' } }),
		);
		const result = await getProject('p1');
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/projects/p1`);
		expect(result.name).toBe('helios');
	});

	it('getFacets returns the unfiltered facet set', async () => {
		fetchSpy.mockResolvedValueOnce(
			jsonResponse({
				data: {
					ecosystems: ['Go', 'npm'],
					severity_counts: { critical: 47, high: 163, medium: 383, low: 478, unknown: 129 },
					total: 1200,
				},
			}),
		);
		const result = await getFacets('p1', true);
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/projects/p1/facets?active_only=true`);
		expect(result.ecosystems).toEqual(['Go', 'npm']);
		expect(result.severity_counts.critical).toBe(47);
	});

	it('fetchAllFindings follows next_cursor until the server runs out', async () => {
		fetchSpy
			.mockResolvedValueOnce(
				jsonResponse({ data: [{ instance_id: 'a' }], next_cursor: 'c1', has_more: true }),
			)
			.mockResolvedValueOnce(
				jsonResponse({ data: [{ instance_id: 'b' }], next_cursor: 'c2', has_more: true }),
			)
			.mockResolvedValueOnce(jsonResponse({ data: [{ instance_id: 'c' }], has_more: false }));

		const result = await fetchAllFindings('p1', { sort: 'severity' });

		expect(result.data.map((f) => f.instance_id)).toEqual(['a', 'b', 'c']);
		expect(result.truncated).toBe(false);
		expect(fetchSpy).toHaveBeenCalledTimes(3);
		expect(fetchSpy.mock.calls[1]?.[0]).toContain('cursor=c1');
		expect(fetchSpy.mock.calls[2]?.[0]).toContain('cursor=c2');
	});

	it('fetchAllFindings stops at the cap and reports truncation', async () => {
		// A Response body can only be read once, so each call needs a fresh one.
		fetchSpy.mockImplementation(() =>
			Promise.resolve(
				jsonResponse({
					data: [{ instance_id: 'x' }, { instance_id: 'y' }],
					next_cursor: 'c',
					has_more: true,
				}),
			),
		);

		const result = await fetchAllFindings('p1', {}, 3);

		expect(result.data).toHaveLength(4);
		expect(result.truncated).toBe(true);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('fetchAllFindings stops if the server keeps claiming more but returns nothing', async () => {
		fetchSpy.mockImplementation(() =>
			Promise.resolve(jsonResponse({ data: [], next_cursor: 'c', has_more: true })),
		);

		const result = await fetchAllFindings('p1', {}, 100);

		expect(result.data).toEqual([]);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('getAdvisories passes the shared filter set through', async () => {
		fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [], has_more: false }));
		await getAdvisories('p1', { severity: 'CRITICAL', sort: 'instance_count', limit: 25 });
		expect(fetchSpy).toHaveBeenCalledWith(
			`${BASE}/api/projects/p1/advisories?severity=CRITICAL&sort=instance_count&limit=25`,
		);
	});

	it('getAdvisories keeps the paged envelope intact', async () => {
		fetchSpy.mockResolvedValueOnce(
			jsonResponse({
				data: [{ advisory_id: 'CVE-2021-44228', instance_count: 9, target_count: 3 }],
				next_cursor: 'c1',
				has_more: true,
			}),
		);
		const page = await getAdvisories('p1');
		expect(page.has_more).toBe(true);
		expect(page.next_cursor).toBe('c1');
		expect(page.data[0]?.advisory_id).toBe('CVE-2021-44228');
	});

	it('fetchAllAdvisories walks the cursor the same way findings do', async () => {
		fetchSpy
			.mockResolvedValueOnce(
				jsonResponse({ data: [{ advisory_id: 'a' }], next_cursor: 'c1', has_more: true }),
			)
			.mockResolvedValueOnce(jsonResponse({ data: [{ advisory_id: 'b' }], has_more: false }));

		const result = await fetchAllAdvisories('p1', { sort: 'instance_count' });

		expect(result.data.map((a) => a.advisory_id)).toEqual(['a', 'b']);
		expect(result.truncated).toBe(false);
		expect(fetchSpy.mock.calls[1]?.[0]).toContain('cursor=c1');
	});

	it('throws ApiError on non-ok response', async () => {
		const apiError: ApiError = { error: { code: 'NOT_FOUND', message: 'not found' } };
		fetchSpy.mockResolvedValueOnce(jsonResponse(apiError, 404));
		await expect(getProjects()).rejects.toEqual(apiError);
	});

	it('throws ApiError on server error', async () => {
		const apiError: ApiError = { error: { code: 'INTERNAL', message: 'boom' } };
		fetchSpy.mockResolvedValueOnce(jsonResponse(apiError, 500));
		await expect(getFindingDetail('x')).rejects.toEqual(apiError);
	});
});
