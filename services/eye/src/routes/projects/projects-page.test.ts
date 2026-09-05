import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_GATEWAY_URL: 'http://localhost:8400' },
}));

import type { Facets, Project } from '$lib/types/api';
import ProjectsPage from './+page.svelte';

function project(id: string, name: string): Project {
	return { id, name, created_at: '2026-05-10T08:58:32Z' };
}

function facets(counts: Partial<Facets['severity_counts']>, total: number): Facets {
	return {
		ecosystems: ['npm'],
		severity_counts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0, ...counts },
		total,
	};
}

describe('projects page', () => {
	afterEach(() => cleanup());

	it('tells the user where the findings are instead of only listing names', () => {
		const { getByText } = render(ProjectsPage, {
			props: {
				data: {
					projects: [project('p1', 'helios-platform')],
					facets: { p1: facets({ critical: 47, high: 163 }, 1200) },
				},
			},
		});
		expect(getByText('helios-platform')).toBeTruthy();
		expect(getByText(/1,?200/)).toBeTruthy();
		expect(getByText('47')).toBeTruthy();
	});

	it('says a project is clean rather than showing an empty row', () => {
		const { getByText } = render(ProjectsPage, {
			props: {
				data: {
					projects: [project('p2', 'example')],
					facets: { p2: facets({}, 0) },
				},
			},
		});
		expect(getByText(/no findings/i)).toBeTruthy();
	});

	it('still renders a project whose counts could not be loaded', () => {
		const { getByText } = render(ProjectsPage, {
			props: { data: { projects: [project('p3', 'offline')], facets: {} } },
		});
		expect(getByText('offline')).toBeTruthy();
	});

	it('labels the severity counts so they are not colour-only', () => {
		const { getByLabelText } = render(ProjectsPage, {
			props: {
				data: {
					projects: [project('p1', 'helios-platform')],
					facets: { p1: facets({ critical: 47, high: 163, medium: 383 }, 1200) },
				},
			},
		});
		expect(getByLabelText(/47 critical/i)).toBeTruthy();
	});

	it('keeps the empty-state message when there are no projects at all', () => {
		const { getByText } = render(ProjectsPage, {
			props: { data: { projects: [], facets: {} } },
		});
		expect(getByText(/no projects found/i)).toBeTruthy();
	});
});
