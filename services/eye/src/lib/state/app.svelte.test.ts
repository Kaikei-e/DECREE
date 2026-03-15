import { describe, expect, it } from 'vitest';
import { appState } from './app.svelte';

describe('appState', () => {
	it('initializes with default values', () => {
		appState.reset();
		expect(appState.projects).toEqual([]);
		expect(appState.selectedProjectId).toBeNull();
		expect(appState.targets).toEqual([]);
		expect(appState.findings).toEqual([]);
		expect(appState.selectedNodeId).toBeNull();
		expect(appState.selectedFindingDetail).toBeNull();
		expect(appState.filters).toEqual({ activeOnly: true });
		expect(appState.rendererType).toBe('3d');
		expect(appState.loading).toBe(false);
		expect(appState.error).toBeNull();
	});

	it('sets and gets projects', () => {
		appState.reset();
		const projects = [{ id: '1', name: 'Test', created_at: '2024-01-01T00:00:00Z' }];
		appState.projects = projects;
		expect(appState.projects).toEqual(projects);
	});

	it('derives selectedProject from selectedProjectId', () => {
		appState.reset();
		appState.projects = [
			{ id: '1', name: 'Alpha', created_at: '2024-01-01T00:00:00Z' },
			{ id: '2', name: 'Beta', created_at: '2024-01-02T00:00:00Z' },
		];
		appState.selectedProjectId = '2';
		expect(appState.selectedProject?.name).toBe('Beta');
	});

	it('returns undefined for selectedProject when no match', () => {
		appState.reset();
		appState.selectedProjectId = 'nonexistent';
		expect(appState.selectedProject).toBeUndefined();
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

	it('tracks loading and error state', () => {
		appState.reset();
		appState.loading = true;
		appState.error = 'Something went wrong';
		expect(appState.loading).toBe(true);
		expect(appState.error).toBe('Something went wrong');
	});

	it('reset clears all state', () => {
		appState.projects = [{ id: '1', name: 'Test', created_at: '' }];
		appState.selectedProjectId = '1';
		appState.loading = true;
		appState.error = 'err';
		appState.rendererType = '2d';

		appState.reset();

		expect(appState.projects).toEqual([]);
		expect(appState.selectedProjectId).toBeNull();
		expect(appState.loading).toBe(false);
		expect(appState.error).toBeNull();
		expect(appState.rendererType).toBe('3d');
	});
});
