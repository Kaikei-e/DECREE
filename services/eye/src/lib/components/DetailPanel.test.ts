import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import DetailPanel from './DetailPanel.svelte';

describe('DetailPanel', () => {
	afterEach(() => cleanup());

	it('renders detection evidence for a finding', () => {
		const finding = {
			instance_id: 'inst-1',
			target_id: 'target-1',
			target_name: 'Alt',
			package_name: 'onnx',
			package_version: '1.20.1',
			ecosystem: 'PyPI',
			advisory_id: 'CVE-2026-28500',
			advisory_source: 'nvd',
			is_active: true,
			fix_versions: ['1.20.2'],
			exploits: [],
			dependency_path: [],
			detection_evidence: {
				source: 'osv',
				fetched_at: '2026-03-17T10:00:00Z',
				summary: 'OSV published the advisory before downstream UI caught up.',
				aliases: ['GHSA-xxxx-yyyy-zzzz', 'PYSEC-2026-1'],
				range_evaluation_status: 'contradicts_match' as const,
			},
		};

		const { getByText } = render(DetailPanel, {
			props: { finding, onClose: () => {} },
		});

		expect(getByText('OSV published the advisory before downstream UI caught up.')).toBeTruthy();
		expect(getByText('Source:')).toBeTruthy();
		expect(getByText('osv')).toBeTruthy();
		expect(getByText('GHSA-xxxx-yyyy-zzzz')).toBeTruthy();
		expect(
			getByText(
				'OSV range metadata disagrees with this version, but DECREE keeps the finding because source lag or metadata drift is possible.',
			),
		).toBeTruthy();
	});
});
