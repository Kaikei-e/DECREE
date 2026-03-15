import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError, PagedResponse } from '$lib/types/api';
import { ApiClient } from './client';

const BASE = 'http://localhost:8400';

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

describe('ApiClient', () => {
	let client: ApiClient;
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		client = new ApiClient();
		fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('getProjects calls correct URL', async () => {
		fetchSpy.mockResolvedValueOnce(jsonResponse([{ id: '1', name: 'p', created_at: '' }]));
		const result = await client.getProjects();
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/v1/projects`);
		expect(result).toEqual([{ id: '1', name: 'p', created_at: '' }]);
	});

	it('getTargets calls correct URL with projectId', async () => {
		fetchSpy.mockResolvedValueOnce(jsonResponse([]));
		await client.getTargets('proj-1');
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/v1/projects/proj-1/targets`);
	});

	it('getFindings calls correct URL without params', async () => {
		const body: PagedResponse<unknown> = { data: [], has_more: false };
		fetchSpy.mockResolvedValueOnce(jsonResponse(body));
		await client.getFindings('proj-1');
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/v1/projects/proj-1/findings`);
	});

	it('getFindings builds query string from params', async () => {
		const body: PagedResponse<unknown> = { data: [], has_more: false };
		fetchSpy.mockResolvedValueOnce(jsonResponse(body));
		await client.getFindings('proj-1', { severity: 'high', active_only: true, limit: 25 });
		const url = fetchSpy.mock.calls[0]?.[0] as string;
		expect(url).toContain('severity=high');
		expect(url).toContain('active_only=true');
		expect(url).toContain('limit=25');
	});

	it('getFindingDetail calls correct URL', async () => {
		fetchSpy.mockResolvedValueOnce(
			jsonResponse({
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
			}),
		);
		await client.getFindingDetail('i-1');
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/v1/findings/i-1`);
	});

	it('getTopRisks calls correct URL with optional limit', async () => {
		fetchSpy.mockResolvedValueOnce(jsonResponse([]));
		await client.getTopRisks('proj-1', 10);
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/v1/projects/proj-1/top-risks?limit=10`);
	});

	it('getTopRisks omits limit when not provided', async () => {
		fetchSpy.mockResolvedValueOnce(jsonResponse([]));
		await client.getTopRisks('proj-1');
		expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/v1/projects/proj-1/top-risks`);
	});

	it('getTimeline calls correct URL with params', async () => {
		const body: PagedResponse<unknown> = { data: [], has_more: false };
		fetchSpy.mockResolvedValueOnce(jsonResponse(body));
		await client.getTimeline('proj-1', { target_id: 't-1', event_type: 'observed' });
		const url = fetchSpy.mock.calls[0]?.[0] as string;
		expect(url).toContain('/api/v1/projects/proj-1/timeline?');
		expect(url).toContain('target_id=t-1');
		expect(url).toContain('event_type=observed');
	});

	it('throws ApiError on non-ok response', async () => {
		const apiError: ApiError = { error: { code: 'NOT_FOUND', message: 'not found' } };
		fetchSpy.mockResolvedValueOnce(jsonResponse(apiError, 404));
		await expect(client.getProjects()).rejects.toEqual(apiError);
	});

	it('throws ApiError on server error', async () => {
		const apiError: ApiError = { error: { code: 'INTERNAL', message: 'boom' } };
		fetchSpy.mockResolvedValueOnce(jsonResponse(apiError, 500));
		await expect(client.getFindingDetail('x')).rejects.toEqual(apiError);
	});
});
