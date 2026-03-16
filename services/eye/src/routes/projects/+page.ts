import { getProjects } from '$lib/api/client';
import type { PageLoad } from './$types';

export const ssr = false;

export const load: PageLoad = async ({ fetch }) => {
	const projects = await getProjects(fetch);
	return { projects };
};
