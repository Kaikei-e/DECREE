import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigating = { to: null as unknown };

vi.mock('$app/state', () => ({
	get navigating() {
		return navigating;
	},
}));

import RootLayout from './+layout.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>page body</p>' }));

describe('root layout', () => {
	afterEach(() => {
		cleanup();
		navigating.to = null;
	});

	it('does not announce navigation when idle', () => {
		const { queryByRole } = render(RootLayout, { props: { children } });
		expect(queryByRole('status')).toBeNull();
	});

	it('announces an in-flight navigation instead of relying on a pulsing bar', () => {
		navigating.to = { pathname: '/projects' };
		const { getByRole } = render(RootLayout, { props: { children } });

		const status = getByRole('status');
		expect(status.getAttribute('aria-busy')).toBe('true');
		expect(status.textContent).toContain('Loading');
	});

	it('names the primary navigation', () => {
		const { getByRole } = render(RootLayout, { props: { children } });
		expect(getByRole('navigation', { name: 'Primary' })).toBeTruthy();
	});
});
