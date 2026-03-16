import { describe, expect, it } from 'vitest';
import { appState } from './app.svelte';

describe('appState', () => {
	it('initializes with default values', () => {
		appState.reset();
		expect(appState.selectedProjectId).toBeNull();
		expect(appState.targets).toEqual([]);
		expect(appState.findings).toEqual([]);
		expect(appState.selectedNodeId).toBeNull();
		expect(appState.selectedFindingDetail).toBeNull();
		expect(appState.filters).toEqual({ activeOnly: true });
		expect(appState.rendererType).toBe('3d');
		expect(appState.error).toBeNull();
	});

	it('sets filters', () => {
		appState.reset();
		appState.filters = { severity: 'HIGH', activeOnly: false };
		expect(appState.filters.severity).toBe('HIGH');
		expect(appState.filters.activeOnly).toBe(false);
	});

	it('toggles renderer type', () => {
		appState.reset();
		expect(appState.rendererType).toBe('3d');
		appState.rendererType = '2d';
		expect(appState.rendererType).toBe('2d');
	});

	it('tracks error state', () => {
		appState.reset();
		appState.error = 'Something went wrong';
		expect(appState.error).toBe('Something went wrong');
	});

	it('reset clears all state', () => {
		appState.selectedProjectId = '1';
		appState.error = 'err';
		appState.rendererType = '2d';

		appState.reset();

		expect(appState.selectedProjectId).toBeNull();
		expect(appState.error).toBeNull();
		expect(appState.rendererType).toBe('3d');
	});
});
