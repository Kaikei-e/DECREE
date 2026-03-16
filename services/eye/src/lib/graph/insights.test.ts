import { describe, expect, it } from 'vitest';
import type { Finding } from '$lib/types/api';
import { buildVisualizationInsights, getTopVisibleRisks } from './insights';
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

describe('buildVisualizationInsights', () => {
	it('summarizes visible findings for the scene explainer', () => {
		const findings = [
			makeFinding({
				instance_id: 'critical-1',
				target_id: 'target-a',
				target_name: 'payments-api',
				severity: 'CRITICAL',
				decree_score: 9.8,
			}),
			makeFinding({
				instance_id: 'high-1',
				target_id: 'target-a',
				target_name: 'payments-api',
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

		const graphModel = computeLayout(findings, [
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
		]);

		const summary = buildVisualizationInsights(findings, graphModel);

		expect(summary.totalFindings).toBe(3);
		expect(summary.activeFindings).toBe(2);
		expect(summary.targetCount).toBe(2);
		expect(summary.criticalCount).toBe(1);
		expect(summary.pulsingCount).toBe(2);
		expect(summary.highestScore).toBe(9.8);
		expect(summary.largestCluster?.name).toBe('payments-api');
		expect(summary.largestCluster?.count).toBe(2);
		expect(summary.severityBreakdown.find((item) => item.severity === 'CRITICAL')?.count).toBe(1);
		expect(summary.severityBreakdown.find((item) => item.severity === 'LOW')?.count).toBe(0);
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
