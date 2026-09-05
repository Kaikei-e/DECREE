import type { AdvisoryGroup } from '$lib/types/api';
import { NODE_SIZE_MAX, NODE_SIZE_MIN, parseSeverity, Y_SCALE } from './layout';
import type { GraphCluster, GraphModel, GraphNode } from './model';
import { SEVERITY_COLORS } from './model';

/** Spacing between adjacent columns inside one district. */
const NODE_PITCH = 1.2;

/** Gap between districts, on top of each district's own footprint. */
const DISTRICT_GAP = 4;

const NO_ECOSYSTEM = 'unspecified';

export interface DistrictCell {
	x: number;
	z: number;
}

/**
 * Arrange `count` districts on a square-ish 2D grid, spaced by the footprint a district
 * of `maxNodes` actually needs. A single row with fixed spacing let dense districts
 * overlap each other, which is what turned the scene into one solid slab.
 */
export function districtGrid(count: number, maxNodes: number): DistrictCell[] {
	const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
	const rows = Math.max(1, Math.ceil(count / columns));
	const footprint = Math.ceil(Math.sqrt(Math.max(1, maxNodes))) * NODE_PITCH;
	const pitch = footprint + DISTRICT_GAP;

	const cells: DistrictCell[] = [];
	for (let i = 0; i < count; i++) {
		const col = i % columns;
		const row = Math.floor(i / columns);
		cells.push({
			x: (col - (columns - 1) / 2) * pitch,
			z: (row - (rows - 1) / 2) * pitch,
		});
	}
	return cells;
}

/**
 * Build a scene from advisory groups rather than individual instances.
 * At instance granularity the live data puts 1028 columns into a slab occupying under
 * 10% of the viewport height; one node per advisory brings that to roughly half.
 *
 * `estimated` names the advisories a live event patched without the whole instance set
 * behind it, so their counts are rendered as approximations rather than as the truth.
 */
export function computeAdvisoryLayout(
	groups: AdvisoryGroup[],
	estimated?: ReadonlySet<string>,
): GraphModel {
	const byEcosystem = new Map<string, AdvisoryGroup[]>();
	for (const group of groups) {
		const key = group.ecosystems[0] ?? NO_ECOSYSTEM;
		const bucket = byEcosystem.get(key);
		bucket ? bucket.push(group) : byEcosystem.set(key, [group]);
	}

	const ecosystems = [...byEcosystem.keys()].sort();
	const largest = Math.max(1, ...[...byEcosystem.values()].map((g) => g.length));
	const cells = districtGrid(ecosystems.length, largest);

	const nodes = new Map<string, GraphNode>();
	const clusters: GraphCluster[] = [];

	ecosystems.forEach((ecosystem, districtIndex) => {
		const members = (byEcosystem.get(ecosystem) ?? [])
			.slice()
			.sort((a, b) => (b.max_decree_score ?? 0) - (a.max_decree_score ?? 0));
		const cell = cells[districtIndex] ?? { x: 0, z: 0 };
		const columns = Math.max(1, Math.ceil(Math.sqrt(members.length)));

		members.forEach((group, i) => {
			const col = i % columns;
			const row = Math.floor(i / columns);
			const rows = Math.ceil(members.length / columns);
			const score = group.max_decree_score ?? 0;
			const severity = parseSeverity(group.severity);

			nodes.set(group.advisory_id, {
				id: group.advisory_id,
				targetId: ecosystem,
				targetName: summariseTargets(group, estimated?.has(group.advisory_id) ?? false),
				packageName: group.package_names[0] ?? '(unknown package)',
				packageVersion: summarisePackages(group),
				ecosystem,
				advisoryId: group.advisory_id,
				severity,
				decreeScore: score,
				epssScore: group.epss_score ?? 0,
				cvssScore: group.cvss_score ?? 0,
				depDepth: 0,
				isActive: group.is_active,
				lastObservedAt: group.last_observed_at ?? null,
				position: {
					x: cell.x + (col - (columns - 1) / 2) * NODE_PITCH,
					y: score * Y_SCALE,
					z: cell.z + (row - (rows - 1) / 2) * NODE_PITCH,
				},
				visual: {
					color: SEVERITY_COLORS[severity],
					opacity: 1,
					size: sizeFromInstanceCount(group.instance_count),
					pulse: false,
					isNew: false,
					isDisappearing: false,
				},
			});
		});

		clusters.push({
			id: ecosystem,
			name: ecosystem,
			nodes: members.map((g) => g.advisory_id),
			centerX: cell.x,
		});
	});

	// Sharing a package is set membership, not a pairwise relation: on live data the
	// synthesized edges reduced to a spanning forest over 111 package cohorts plus 378
	// edges that carried no connectivity at all.
	return { nodes, edges: [], clusters };
}

function sizeFromInstanceCount(count: number): number {
	return Math.min(NODE_SIZE_MAX, NODE_SIZE_MIN + Math.sqrt(Math.max(0, count - 1)) * 0.5);
}

function summariseTargets(group: AdvisoryGroup, approximate: boolean): string {
	const shown = group.target_names.slice(0, 2).join(', ');
	const rest = group.target_count - Math.min(2, group.target_names.length);
	const count = `${approximate ? '~' : ''}${group.target_count}`;

	if (rest > 0) return `${shown} +${rest} more (${count} targets)`;
	// An approximated count has to stay visible even when the names alone would do.
	return approximate ? `${shown} (${count} targets)` : shown;
}

function summarisePackages(group: AdvisoryGroup): string {
	const extra = group.package_names.length - 1;
	return extra > 0 ? `+${extra} more packages` : '';
}
