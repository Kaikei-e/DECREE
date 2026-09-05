import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem } from './TopRisksSummary.svelte';
import TopRisksSummary from './TopRisksSummary.svelte';

const items: QueueItem[] = [
	{
		id: 'inst-1',
		advisoryId: 'CVE-2026-0001',
		severity: 'CRITICAL',
		primary: 'lodash@4.17.0',
		secondary: 'alt / npm',
		score: 9.1,
	},
	{
		id: 'inst-2',
		advisoryId: 'CVE-2026-0002',
		severity: 'HIGH',
		primary: 'axios@0.21.0',
		secondary: 'alt / npm',
		score: 7.4,
	},
];

function props(overrides: Record<string, unknown> = {}) {
	return { items, unitLabel: 'findings', selectedId: null, onSelect: vi.fn(), ...overrides };
}

describe('TopRisksSummary', () => {
	afterEach(() => cleanup());

	it('sits under the page heading as a section heading', () => {
		const { getByRole } = render(TopRisksSummary, { props: props() });
		expect(getByRole('heading', { level: 2, name: 'Priority Queue' })).toBeTruthy();
	});

	it('selects an entry from the queue', async () => {
		const onSelect = vi.fn();
		const { getByRole } = render(TopRisksSummary, { props: props({ onSelect }) });

		await fireEvent.click(getByRole('button', { name: /CVE-2026-0001/ }));
		expect(onSelect).toHaveBeenCalledWith('inst-1');
	});

	it('marks the row whose detail is open, so the panel and the queue agree', () => {
		const { getByRole } = render(TopRisksSummary, { props: props({ selectedId: 'inst-2' }) });

		expect(getByRole('button', { name: /CVE-2026-0002/ }).getAttribute('aria-current')).toBe(
			'true',
		);
		expect(getByRole('button', { name: /CVE-2026-0001/ }).getAttribute('aria-current')).toBeNull();
	});

	it('says the filters are responsible when the queue is empty', () => {
		const { getByText } = render(TopRisksSummary, { props: props({ items: [] }) });
		expect(getByText(/no .* match the current filter set/i)).toBeTruthy();
	});

	it('names what it is ranking, because the grain changes with the view', () => {
		const { getByText } = render(TopRisksSummary, { props: props({ unitLabel: 'advisories' }) });
		expect(getByText(/advisories/i)).toBeTruthy();
	});

	it('never truncates the advisory id — it is the identifier the user searches for', () => {
		const { getByText } = render(TopRisksSummary, { props: props() });
		const id = getByText('CVE-2026-0001');
		expect(id.className).not.toContain('truncate');
	});

	it('reports a missing score as unknown rather than as zero', () => {
		const { getByText } = render(TopRisksSummary, {
			props: props({ items: [{ ...items[0], score: undefined }] }),
		});
		expect(getByText('n/a')).toBeTruthy();
	});
});
