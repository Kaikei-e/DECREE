import { describe, expect, it } from 'vitest';
import type { AdvisoryGroup, Finding } from '$lib/types/api';
import { computeAdvisoryLayout } from './advisory-layout';
import { buildAdvisoryInsights, buildInstanceInsights, getTopVisibleRisks } from './insights';
import { computeLayout } from './layout';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		instance_id: overrides.instance_id ?? 'finding-1',
		target_id: overrides.target_id ?? 'target-a',
		target_name: overrides.target_name ?? 'payments-api',
		package_name: overrides.package_name ?? 'openssl',
		package_version: overrides.package_version ?? '1.0.0',
		ecosystem: overrides.ecosystem ?? 'deb',
		advisory_id: overrides.advisory_id ?? 'CVE-2026-0001',
		severity: overrides.severity ?? 'HIGH',
		decree_score: overrides.decree_score ?? 7.2,
		epss_score: overrides.epss_score ?? 0.61,
		cvss_score: overrides.cvss_score ?? 8.8,
		is_active: overrides.is_active ?? true,
		last_observed_at: overrides.last_observed_at ?? new Date().toISOString(),
	};
}

function makeGroup(overrides: Partial<AdvisoryGroup> = {}): AdvisoryGroup {
	return {
		advisory_id: overrides.advisory_id ?? 'CVE-2026-0001',
		severity: overrides.severity ?? 'high',
		max_decree_score: overrides.max_decree_score ?? 7.2,
		epss_score: overrides.epss_score ?? 0.61,
		cvss_score: overrides.cvss_score ?? 8.8,
		instance_count: overrides.instance_count ?? 3,
		target_count: overrides.target_count ?? 2,
		target_names: overrides.target_names ?? ['payments-api', 'worker'],
		package_names: overrides.package_names ?? ['openssl'],
		ecosystems: overrides.ecosystems ?? ['npm'],
		is_active: overrides.is_active ?? true,
		first_observed_at: overrides.first_observed_at,
		last_observed_at: overrides.last_observed_at ?? new Date().toISOString(),
	};
}

const targets = [
	{
		id: 'target-a',
		project_id: 'proj-1',
		name: 'payments-api',
		target_type: 'repo',
		created_at: new Date().toISOString(),
	},
	{
		id: 'target-b',
		project_id: 'proj-1',
		name: 'worker',
		target_type: 'repo',
		created_at: new Date().toISOString(),
	},
];

describe('buildInstanceInsights', () => {
	it('summarizes the instances the risk plot is showing', () => {
		const findings = [
			makeFinding({
				instance_id: 'critical-1',
				severity: 'CRITICAL',
				decree_score: 9.8,
			}),
			makeFinding({
				instance_id: 'high-1',
				severity: 'HIGH',
				decree_score: 7.4,
				last_observed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
			}),
			makeFinding({
				instance_id: 'medium-1',
				target_id: 'target-b',
				target_name: 'worker',
				severity: 'MEDIUM',
				decree_score: 4.2,
				is_active: false,
			}),
		];

		const summary = buildInstanceInsights(findings, computeLayout(findings, targets));

		expect(summary.scope).toBe('instance');
		expect(summary.unitLabel).toBe('Instances');
		expect(summary.clusterLabel).toBe('Targets');
		expect(summary.unitCount).toBe(3);
		expect(summary.activeCount).toBe(2);
		expect(summary.clusterCount).toBe(2);
		expect(summary.criticalCount).toBe(1);
		expect(summary.freshCount).toBe(2);
		expect(summary.highestScore).toBe(9.8);
		expect(summary.largestCluster?.name).toBe('payments-api');
		expect(summary.largestCluster?.count).toBe(2);
		expect(summary.severityBreakdown.find((item) => item.severity === 'CRITICAL')?.count).toBe(1);
		expect(summary.severityBreakdown.find((item) => item.severity === 'LOW')?.count).toBe(0);
		expect(summary.truncated).toBe(false);
	});

	it('carries the truncation flag so a capped set is never shown as a total', () => {
		const summary = buildInstanceInsights(
			[makeFinding()],
			computeLayout([makeFinding()], targets),
			true,
		);
		expect(summary.truncated).toBe(true);
	});
});

describe('buildAdvisoryInsights', () => {
	it('counts advisories and ecosystems, not instances and targets', () => {
		const groups = [
			makeGroup({
				advisory_id: 'CVE-2026-1000',
				severity: 'critical',
				max_decree_score: 9.4,
				instance_count: 12,
				ecosystems: ['npm'],
			}),
			makeGroup({
				advisory_id: 'CVE-2026-1001',
				severity: 'high',
				max_decree_score: 6.1,
				ecosystems: ['npm'],
			}),
			makeGroup({
				advisory_id: 'CVE-2026-1002',
				severity: 'low',
				max_decree_score: 2.2,
				ecosystems: ['PyPI'],
				is_active: false,
				last_observed_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
			}),
		];

		const summary = buildAdvisoryInsights(groups, computeAdvisoryLayout(groups));

		expect(summary.scope).toBe('advisory');
		expect(summary.unitLabel).toBe('Advisories');
		expect(summary.clusterLabel).toBe('Ecosystems');
		expect(summary.unitCount).toBe(3);
		expect(summary.activeCount).toBe(2);
		expect(summary.clusterCount).toBe(2);
		expect(summary.criticalCount).toBe(1);
		expect(summary.freshCount).toBe(2);
		expect(summary.highestScore).toBe(9.4);
		expect(summary.largestCluster?.name).toBe('npm');
		expect(summary.largestCluster?.count).toBe(2);
		expect(summary.severityBreakdown.find((item) => item.severity === 'CRITICAL')?.count).toBe(1);
	});

	it('reads the lowercase severity the gateway sends', () => {
		const summary = buildAdvisoryInsights(
			[makeGroup({ severity: 'critical' })],
			computeAdvisoryLayout([]),
		);
		expect(summary.criticalCount).toBe(1);
	});
});

describe('getTopVisibleRisks', () => {
	it('sorts visible findings by DECREE score and limits the result', () => {
		const risks = getTopVisibleRisks(
			[
				makeFinding({ instance_id: 'low', decree_score: 2.1 }),
				makeFinding({ instance_id: 'high', decree_score: 7.7 }),
				makeFinding({ instance_id: 'critical', decree_score: 9.6 }),
			],
			2,
		);

		expect(risks.map((risk) => risk.instance_id)).toEqual(['critical', 'high']);
	});
});
