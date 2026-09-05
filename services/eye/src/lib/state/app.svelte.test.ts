import { describe, expect, it } from 'vitest';
import { appState } from './app.svelte';

describe('appState', () => {
	it('initializes with default values', () => {
		appState.reset();
		expect(appState.selectedProjectId).toBeNull();
		expect(appState.targets).toEqual([]);
		expect(appState.findings).toEqual([]);
		expect(appState.graphModel.nodes.size).toBe(0);
		expect(appState.error).toBeNull();
	});

	it('tracks error state', () => {
		appState.reset();
		appState.error = 'Something went wrong';
		expect(appState.error).toBe('Something went wrong');
	});

	it('reset clears all state', () => {
		appState.selectedProjectId = '1';
		appState.error = 'err';
		appState.findings = [
			{
				instance_id: 'inst-1',
				target_id: 't1',
				target_name: 'alt',
				package_name: 'lodash',
				package_version: '4.17.0',
				ecosystem: 'npm',
				advisory_id: 'CVE-2026-0001',
				is_active: true,
			},
		];

		appState.reset();

		expect(appState.selectedProjectId).toBeNull();
		expect(appState.error).toBeNull();
		expect(appState.findings).toEqual([]);
	});

	it('no longer mirrors the filters or the view mode, which live in the URL', () => {
		const keys = Object.keys(appState);
		expect(keys).not.toContain('filters');
		expect(keys).not.toContain('rendererType');
		expect(keys).not.toContain('selectedNodeId');
		expect(keys).not.toContain('selectedFindingDetail');
	});
});
