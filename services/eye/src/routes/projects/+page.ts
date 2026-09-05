import { getFacets, getProjects } from '$lib/api/client';
import type { Facets } from '$lib/types/api';
import type { PageLoad } from './$types';

export const ssr = false;

export const load: PageLoad = async ({ fetch }) => {
	const projects = await getProjects(fetch);

	// One request per project. Fine for a handful; if this list ever grows, the counts
	// belong in the projects endpoint itself rather than in N round trips.
	const counts = await Promise.all(
		projects.map(async (p) => {
			try {
				return [p.id, await getFacets(p.id, true, fetch)] as const;
			} catch {
				// A project whose counts fail to load must still be reachable.
				return [p.id, null] as const;
			}
		}),
	);

	const facets: Record<string, Facets> = {};
	for (const [id, f] of counts) {
		if (f) facets[id] = f;
	}

	return { projects, facets };
};
