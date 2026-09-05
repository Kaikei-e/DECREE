import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CameraToolbar from './CameraToolbar.svelte';

describe('CameraToolbar', () => {
	afterEach(() => cleanup());

	const defaultProps = {
		onZoomIn: vi.fn(),
		onZoomOut: vi.fn(),
		onResetView: vi.fn(),
		onSetViewPreset: vi.fn(),
		is3D: true,
	};

	it('exposes a labelled toolbar', () => {
		const { getByRole } = render(CameraToolbar, { props: defaultProps });
		expect(getByRole('toolbar', { name: 'Camera controls' })).toBeTruthy();
	});

	it('renders zoom and reset buttons with accessible names', () => {
		const { getByRole } = render(CameraToolbar, { props: defaultProps });
		expect(getByRole('button', { name: 'Zoom in' })).toBeTruthy();
		expect(getByRole('button', { name: 'Zoom out' })).toBeTruthy();
		expect(getByRole('button', { name: 'Fit all findings in view' })).toBeTruthy();
	});

	it('renders 3D-only buttons when is3D is true', () => {
		const { getByRole } = render(CameraToolbar, { props: defaultProps });
		expect(getByRole('button', { name: 'Top view' })).toBeTruthy();
		expect(getByRole('button', { name: 'Front view' })).toBeTruthy();
	});

	it('hides 3D-only buttons when is3D is false', () => {
		const { queryByRole } = render(CameraToolbar, {
			props: { ...defaultProps, is3D: false },
		});
		expect(queryByRole('button', { name: 'Top view' })).toBeNull();
		expect(queryByRole('button', { name: 'Front view' })).toBeNull();
	});

	it('calls onZoomIn when zoom in button is clicked', async () => {
		const onZoomIn = vi.fn();
		const { getByRole } = render(CameraToolbar, {
			props: { ...defaultProps, onZoomIn },
		});
		await fireEvent.click(getByRole('button', { name: 'Zoom in' }));
		expect(onZoomIn).toHaveBeenCalledOnce();
	});

	it('calls onZoomOut when zoom out button is clicked', async () => {
		const onZoomOut = vi.fn();
		const { getByRole } = render(CameraToolbar, {
			props: { ...defaultProps, onZoomOut },
		});
		await fireEvent.click(getByRole('button', { name: 'Zoom out' }));
		expect(onZoomOut).toHaveBeenCalledOnce();
	});

	it('calls onResetView when fit all button is clicked', async () => {
		const onResetView = vi.fn();
		const { getByRole } = render(CameraToolbar, {
			props: { ...defaultProps, onResetView },
		});
		await fireEvent.click(getByRole('button', { name: 'Fit all findings in view' }));
		expect(onResetView).toHaveBeenCalledOnce();
	});

	it('calls onSetViewPreset with top when top view button is clicked', async () => {
		const onSetViewPreset = vi.fn();
		const { getByRole } = render(CameraToolbar, {
			props: { ...defaultProps, onSetViewPreset },
		});
		await fireEvent.click(getByRole('button', { name: 'Top view' }));
		expect(onSetViewPreset).toHaveBeenCalledWith('top');
	});

	it('calls onSetViewPreset with front when front view button is clicked', async () => {
		const onSetViewPreset = vi.fn();
		const { getByRole } = render(CameraToolbar, {
			props: { ...defaultProps, onSetViewPreset },
		});
		await fireEvent.click(getByRole('button', { name: 'Front view' }));
		expect(onSetViewPreset).toHaveBeenCalledWith('front');
	});

	it('keeps a single tab stop across the toolbar', () => {
		const { getByRole } = render(CameraToolbar, { props: defaultProps });
		const toolbar = getByRole('toolbar');
		const tabbable = [...toolbar.querySelectorAll('button')].filter(
			(b) => b.getAttribute('tabindex') === '0',
		);
		expect(tabbable).toHaveLength(1);
		expect(tabbable[0]).toBe(getByRole('button', { name: 'Zoom in' }));
	});

	it('moves focus between controls with the arrow keys', async () => {
		const { getByRole } = render(CameraToolbar, { props: defaultProps });
		const toolbar = getByRole('toolbar');
		getByRole('button', { name: 'Zoom in' }).focus();

		await fireEvent.keyDown(toolbar, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(getByRole('button', { name: 'Zoom out' }));

		await fireEvent.keyDown(toolbar, { key: 'ArrowUp' });
		expect(document.activeElement).toBe(getByRole('button', { name: 'Zoom in' }));

		await fireEvent.keyDown(toolbar, { key: 'End' });
		expect(document.activeElement).toBe(getByRole('button', { name: 'Show keyboard shortcuts' }));

		await fireEvent.keyDown(toolbar, { key: 'Home' });
		expect(document.activeElement).toBe(getByRole('button', { name: 'Zoom in' }));
	});

	describe('keyboard legend', () => {
		it('keeps the key map out of the way until it is asked for', async () => {
			const { getByRole, queryByRole } = render(CameraToolbar, { props: defaultProps });
			const toggle = getByRole('button', { name: 'Show keyboard shortcuts' });

			expect(toggle.getAttribute('aria-expanded')).toBe('false');
			expect(queryByRole('group', { name: 'Keyboard shortcuts' })).toBeNull();

			await fireEvent.click(toggle);

			expect(getByRole('group', { name: 'Keyboard shortcuts' })).toBeTruthy();
			expect(getByRole('button', { name: 'Hide keyboard shortcuts' })).toBeTruthy();
		});

		it('spells out the movement keys the scene actually listens for', async () => {
			const { getByRole } = render(CameraToolbar, { props: defaultProps });
			await fireEvent.click(getByRole('button', { name: 'Show keyboard shortcuts' }));
			const legend = getByRole('group', { name: 'Keyboard shortcuts' });

			expect(legend.textContent).toContain('Orbit');
			expect(legend.textContent).toContain('Pan');
			expect(legend.textContent).toContain('Strafe');
			expect(legend.textContent).toContain('Forward / back');
			expect(legend.textContent).toContain('Up / down');
			expect(legend.textContent).toContain('Next / previous finding');
		});

		it('drops the 3D-only rows in 2D', async () => {
			const { getByRole } = render(CameraToolbar, {
				props: { ...defaultProps, is3D: false },
			});
			await fireEvent.click(getByRole('button', { name: 'Show keyboard shortcuts' }));
			const legend = getByRole('group', { name: 'Keyboard shortcuts' });

			expect(legend.textContent).not.toContain('Orbit');
			expect(legend.textContent).not.toContain('Top / front');
			expect(legend.textContent).toContain('Pan');
		});
	});
});
