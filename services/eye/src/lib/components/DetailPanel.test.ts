import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdvisoryGroup, Finding, FindingDetail } from '$lib/types/api';
import DetailPanel from './DetailPanel.svelte';

const finding: FindingDetail = {
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

const advisory: AdvisoryGroup = {
	advisory_id: 'CVE-2021-44228',
	severity: 'critical',
	max_decree_score: 8.66,
	epss_score: 0.97425,
	cvss_score: 10,
	instance_count: 9,
	target_count: 3,
	target_names: ['helios-legacy-admin', 'helios-payments-service', 'helios-report-worker'],
	package_names: ['org.apache.logging.log4j:log4j-core'],
	ecosystems: ['Maven'],
	is_active: true,
	first_observed_at: '2026-06-08T10:52:33Z',
	last_observed_at: '2026-09-04T22:02:17Z',
};

const instances: Finding[] = [
	{
		instance_id: 'inst-a',
		target_id: 't1',
		target_name: 'helios-legacy-admin',
		package_name: 'org.apache.logging.log4j:log4j-core',
		package_version: '2.14.2',
		ecosystem: 'Maven',
		advisory_id: 'CVE-2021-44228',
		severity: 'critical',
		decree_score: 8.66,
		is_active: true,
	},
	{
		instance_id: 'inst-b',
		target_id: 't2',
		target_name: 'helios-payments-service',
		package_name: 'org.apache.logging.log4j:log4j-core',
		package_version: '2.13.0',
		ecosystem: 'Maven',
		advisory_id: 'CVE-2021-44228',
		severity: 'critical',
		decree_score: 8.4,
		is_active: true,
	},
];

function props(overrides: Record<string, unknown> = {}) {
	return {
		finding: null,
		advisory: null,
		instances: [],
		loading: false,
		error: null,
		overlay: false,
		onSelectInstance: vi.fn(),
		onBack: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	};
}

describe('DetailPanel', () => {
	afterEach(() => {
		cleanup();
		document.body.innerHTML = '';
	});

	it('renders detection evidence for a finding', () => {
		const { getByText } = render(DetailPanel, { props: props({ finding }) });

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

	it('is announced as a region named after the advisory', () => {
		const { getByRole, queryByRole } = render(DetailPanel, { props: props({ finding }) });

		expect(getByRole('region', { name: 'CVE-2026-28500' })).toBeTruthy();
		// A non-modal push panel must stay tabbable-through, so dialog semantics are wrong here.
		expect(queryByRole('dialog')).toBeNull();
	});

	it('names the close control', () => {
		const { getByRole } = render(DetailPanel, { props: props({ finding }) });
		expect(getByRole('button', { name: 'Close finding details' })).toBeTruthy();
	});

	it('closes on Escape pressed inside the panel', async () => {
		const onClose = vi.fn();
		const { getByRole } = render(DetailPanel, { props: props({ finding, onClose }) });

		await fireEvent.keyDown(getByRole('button', { name: 'Close finding details' }), {
			key: 'Escape',
		});
		expect(onClose).toHaveBeenCalledOnce();
	});

	it('ignores Escape pressed outside the panel', async () => {
		const onClose = vi.fn();
		render(DetailPanel, { props: props({ finding, onClose }) });

		await fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(onClose).not.toHaveBeenCalled();
	});

	it('returns focus to the control that opened it', async () => {
		const opener = document.createElement('button');
		document.body.appendChild(opener);
		opener.focus();

		const onClose = vi.fn();
		const { getByRole } = render(DetailPanel, { props: props({ finding, onClose }) });
		await tick();

		const close = getByRole('button', { name: 'Close finding details' });
		close.focus();
		await fireEvent.click(close);

		expect(onClose).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(opener);
	});

	it('renders nothing when nothing is selected', () => {
		const { queryByRole } = render(DetailPanel, { props: props() });
		expect(queryByRole('region')).toBeNull();
	});

	describe('advisory selection', () => {
		it('summarizes the advisory when no instance is picked yet', () => {
			const { getByRole, getByText } = render(DetailPanel, { props: props({ advisory }) });

			expect(getByRole('region', { name: 'CVE-2021-44228' })).toBeTruthy();
			expect(getByText('8.7')).toBeTruthy();
			expect(getByText('97.4%')).toBeTruthy();
			expect(getByText('9 instances across 3 targets')).toBeTruthy();
			expect(getByText('org.apache.logging.log4j:log4j-core')).toBeTruthy();
		});

		it('lists the advisory instances and selects one', async () => {
			const onSelectInstance = vi.fn();
			const { getByRole } = render(DetailPanel, {
				props: props({ advisory, instances, onSelectInstance }),
			});

			await fireEvent.click(getByRole('button', { name: /helios-payments-service/ }));
			expect(onSelectInstance).toHaveBeenCalledWith('inst-b');
		});

		it('says the instance list is loading rather than showing an empty list', () => {
			const { getByRole } = render(DetailPanel, { props: props({ advisory, loading: true }) });
			expect(getByRole('status').textContent).toMatch(/loading/i);
		});

		it('reports a failed fetch instead of silently showing nothing', () => {
			const { getByRole } = render(DetailPanel, {
				props: props({ advisory, error: 'Could not load the instances for this advisory.' }),
			});

			expect(getByRole('alert').textContent).toContain(
				'Could not load the instances for this advisory.',
			);
		});

		it('offers a way back to the advisory once an instance is open', async () => {
			const onBack = vi.fn();
			const { getByRole } = render(DetailPanel, { props: props({ finding, advisory, onBack }) });

			await fireEvent.click(getByRole('button', { name: 'Back to CVE-2021-44228' }));
			expect(onBack).toHaveBeenCalledOnce();
		});

		it('has no way back when the advisory is what is selected', () => {
			const { queryByRole } = render(DetailPanel, { props: props({ advisory }) });
			expect(queryByRole('button', { name: /^Back to/ })).toBeNull();
		});
	});

	describe('below the desktop breakpoint', () => {
		it('takes modal semantics because it covers the page', async () => {
			const { getByRole, queryByRole } = render(DetailPanel, {
				props: props({ finding, overlay: true }),
			});
			await tick();

			const dialog = getByRole('dialog', { name: 'CVE-2026-28500' });
			expect(dialog.getAttribute('aria-modal')).toBe('true');
			expect(queryByRole('region')).toBeNull();
		});

		it('moves focus into the panel it just covered the page with', async () => {
			const opener = document.createElement('button');
			document.body.appendChild(opener);
			opener.focus();

			const { getByRole } = render(DetailPanel, { props: props({ finding, overlay: true }) });
			await tick();

			expect(document.activeElement).toBe(getByRole('button', { name: 'Close finding details' }));
		});

		it('keeps Tab inside the panel so aria-modal is not a lie', async () => {
			const outside = document.createElement('button');
			document.body.appendChild(outside);

			const { getByRole, container } = render(DetailPanel, {
				props: props({ advisory, instances, overlay: true }),
			});
			await tick();

			const focusables = [
				...(container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea') ??
					[]),
			];
			const first = focusables[0] as HTMLElement;
			const last = focusables[focusables.length - 1] as HTMLElement;

			last.focus();
			await fireEvent.keyDown(last, { key: 'Tab' });
			expect(document.activeElement).toBe(first);

			await fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
			expect(document.activeElement).toBe(last);

			expect(getByRole('dialog')).toBeTruthy();
		});

		it('leaves the tab sequence alone when it is a push column', async () => {
			const { getByRole } = render(DetailPanel, { props: props({ advisory, instances }) });
			await tick();

			const close = getByRole('button', { name: 'Close finding details' });
			close.focus();
			await fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });

			// No trap: the browser's own sequencing is left to move focus out of the panel.
			expect(document.activeElement).toBe(close);
		});
	});
});
