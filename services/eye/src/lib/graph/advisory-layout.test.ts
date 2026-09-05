import { describe, expect, it } from 'vitest';
import type { AdvisoryGroup } from '$lib/types/api';
import { computeAdvisoryLayout, districtGrid } from './advisory-layout';
import { Y_SCALE } from './layout';

function group(overrides: Partial<AdvisoryGroup> = {}): AdvisoryGroup {
	return {
		advisory_id: 'CVE-2021-44228',
		severity: 'critical',
		max_decree_score: 8.7,
		epss_score: 0.97,
		cvss_score: 10,
		instance_count: 9,
		target_count: 3,
		target_names: ['helios-legacy-admin', 'helios-payments-service'],
		package_names: ['org.apache.logging.log4j:log4j-core'],
		ecosystems: ['Maven'],
		is_active: true,
		...overrides,
	};
}

function pitchOf(cells: { x: number; z: number }[]): number {
	return (cells[1]?.x ?? 0) - (cells[0]?.x ?? 0);
}

describe('districtGrid', () => {
	it('lays districts out in two dimensions rather than one long row', () => {
		const cells = districtGrid(8, 10);
		const columns = new Set(cells.map((c) => c.x)).size;
		const rows = new Set(cells.map((c) => c.z)).size;
		expect(columns).toBeGreaterThan(1);
		expect(rows).toBeGreaterThan(1);
	});

	it('spaces districts by their real footprint so they cannot overlap', () => {
		// A district holding 200 nodes is far wider than one holding 4; fixed spacing
		// let the big ones collide, which is what made the scene unreadable.
		const widePitch = pitchOf(districtGrid(2, 200));
		const narrowPitch = pitchOf(districtGrid(2, 4));
		expect(widePitch).toBeGreaterThan(narrowPitch);
	});

	it('centres the whole arrangement on the origin', () => {
		const cells = districtGrid(4, 16);
		const mean = cells.reduce((sum, c) => sum + c.x, 0) / cells.length;
		expect(Math.abs(mean)).toBeLessThan(0.001);
	});
});

describe('computeAdvisoryLayout', () => {
	it('produces one node per advisory', () => {
		const model = computeAdvisoryLayout([
			group({ advisory_id: 'A' }),
			group({ advisory_id: 'B' }),
			group({ advisory_id: 'C' }),
		]);
		expect(model.nodes.size).toBe(3);
		expect([...model.nodes.keys()].sort()).toEqual(['A', 'B', 'C']);
	});

	it('never emits edges — set membership is not a pairwise relation', () => {
		const model = computeAdvisoryLayout([
			group({ advisory_id: 'A', package_names: ['left-pad'] }),
			group({ advisory_id: 'B', package_names: ['left-pad'] }),
		]);
		expect(model.edges).toEqual([]);
	});

	it('takes column height from the worst instance in the group', () => {
		const model = computeAdvisoryLayout([group({ advisory_id: 'A', max_decree_score: 6 })]);
		expect(model.nodes.get('A')?.decreeScore).toBe(6);
		expect(model.nodes.get('A')?.position.y).toBe(6 * Y_SCALE);
	});

	it('scales node size by how many instances the advisory covers', () => {
		const model = computeAdvisoryLayout([
			group({ advisory_id: 'small', instance_count: 1 }),
			group({ advisory_id: 'large', instance_count: 29 }),
		]);
		const small = model.nodes.get('small')?.visual.size ?? 0;
		const large = model.nodes.get('large')?.visual.size ?? 0;
		expect(large).toBeGreaterThan(small);
	});

	it('groups advisories into districts by ecosystem', () => {
		const model = computeAdvisoryLayout([
			group({ advisory_id: 'A', ecosystems: ['npm'] }),
			group({ advisory_id: 'B', ecosystems: ['npm'] }),
			group({ advisory_id: 'C', ecosystems: ['Maven'] }),
		]);
		expect(model.clusters).toHaveLength(2);
		const npm = model.clusters.find((c) => c.id === 'npm');
		expect(npm?.nodes.sort()).toEqual(['A', 'B']);
	});

	it('keeps an advisory with no ecosystem out of a real ecosystem district', () => {
		const model = computeAdvisoryLayout([group({ advisory_id: 'A', ecosystems: [] })]);
		expect(model.clusters).toHaveLength(1);
		expect(model.clusters[0]?.id).not.toBe('');
	});

	it('gives every node a distinct position', () => {
		const groups = Array.from({ length: 60 }, (_, i) =>
			group({ advisory_id: `CVE-${i}`, ecosystems: [i % 3 === 0 ? 'npm' : 'Go'] }),
		);
		const model = computeAdvisoryLayout(groups);
		const keys = new Set(
			[...model.nodes.values()].map((n) => `${n.position.x.toFixed(3)}:${n.position.z.toFixed(3)}`),
		);
		expect(keys.size).toBe(60);
	});

	it('summarises the packages and targets the advisory spans', () => {
		const model = computeAdvisoryLayout([
			group({ advisory_id: 'A', target_count: 4, target_names: ['a', 'b'] }),
		]);
		const node = model.nodes.get('A');
		expect(node?.targetName).toContain('4');
		expect(node?.packageName).toBe('org.apache.logging.log4j:log4j-core');
	});

	it('marks an advisory whose instances are all resolved as inactive', () => {
		const model = computeAdvisoryLayout([group({ advisory_id: 'A', is_active: false })]);
		expect(model.nodes.get('A')?.isActive).toBe(false);
	});

	it('survives an advisory with no score, severity or epss', () => {
		const model = computeAdvisoryLayout([
			group({
				advisory_id: 'A',
				severity: undefined,
				max_decree_score: undefined,
				epss_score: undefined,
				cvss_score: undefined,
			}),
		]);
		const node = model.nodes.get('A');
		expect(node).toBeDefined();
		expect(node?.decreeScore).toBe(0);
		expect(Number.isFinite(node?.position.y ?? Number.NaN)).toBe(true);
	});

	it('marks an approximated group so its target count does not read as authoritative', () => {
		const model = computeAdvisoryLayout(
			[group({ advisory_id: 'A', target_count: 4, target_names: ['a', 'b'] })],
			new Set(['A']),
		);
		expect(model.nodes.get('A')?.targetName).toContain('~4');
	});

	it('shows the approximate count even when every target name fits in the sample', () => {
		const model = computeAdvisoryLayout(
			[group({ advisory_id: 'A', target_count: 2, target_names: ['a', 'b'] })],
			new Set(['A']),
		);
		expect(model.nodes.get('A')?.targetName).toContain('~2');
	});

	it('leaves a group the server confirmed unmarked', () => {
		const model = computeAdvisoryLayout([
			group({ advisory_id: 'A', target_count: 4, target_names: ['a', 'b'] }),
		]);
		expect(model.nodes.get('A')?.targetName).not.toContain('~');
	});
});
