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

	it('renders zoom and reset buttons', () => {
		const { getByTitle } = render(CameraToolbar, { props: defaultProps });
		expect(getByTitle('Zoom In (=)')).toBeTruthy();
		expect(getByTitle('Zoom Out (-)')).toBeTruthy();
		expect(getByTitle('Fit All (0)')).toBeTruthy();
	});

	it('renders 3D-only buttons when is3D is true', () => {
		const { getByTitle } = render(CameraToolbar, { props: defaultProps });
		expect(getByTitle('Top View (T)')).toBeTruthy();
		expect(getByTitle('Front View (F)')).toBeTruthy();
	});

	it('hides 3D-only buttons when is3D is false', () => {
		const { queryByTitle } = render(CameraToolbar, {
			props: { ...defaultProps, is3D: false },
		});
		expect(queryByTitle('Top View (T)')).toBeNull();
		expect(queryByTitle('Front View (F)')).toBeNull();
	});

	it('calls onZoomIn when zoom in button is clicked', async () => {
		const onZoomIn = vi.fn();
		const { getByTitle } = render(CameraToolbar, {
			props: { ...defaultProps, onZoomIn },
		});
		await fireEvent.click(getByTitle('Zoom In (=)'));
		expect(onZoomIn).toHaveBeenCalledOnce();
	});

	it('calls onZoomOut when zoom out button is clicked', async () => {
		const onZoomOut = vi.fn();
		const { getByTitle } = render(CameraToolbar, {
			props: { ...defaultProps, onZoomOut },
		});
		await fireEvent.click(getByTitle('Zoom Out (-)'));
		expect(onZoomOut).toHaveBeenCalledOnce();
	});

	it('calls onResetView when fit all button is clicked', async () => {
		const onResetView = vi.fn();
		const { getByTitle } = render(CameraToolbar, {
			props: { ...defaultProps, onResetView },
		});
		await fireEvent.click(getByTitle('Fit All (0)'));
		expect(onResetView).toHaveBeenCalledOnce();
	});

	it('calls onSetViewPreset with top when top view button is clicked', async () => {
		const onSetViewPreset = vi.fn();
		const { getByTitle } = render(CameraToolbar, {
			props: { ...defaultProps, onSetViewPreset },
		});
		await fireEvent.click(getByTitle('Top View (T)'));
		expect(onSetViewPreset).toHaveBeenCalledWith('top');
	});

	it('calls onSetViewPreset with front when front view button is clicked', async () => {
		const onSetViewPreset = vi.fn();
		const { getByTitle } = render(CameraToolbar, {
			props: { ...defaultProps, onSetViewPreset },
		});
		await fireEvent.click(getByTitle('Front View (F)'));
		expect(onSetViewPreset).toHaveBeenCalledWith('front');
	});
});
