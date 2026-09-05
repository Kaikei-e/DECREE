import type { GraphModel } from '$lib/graph/model';
import { createEmptyGraph } from '$lib/graph/model';
import type { Finding, Target } from '$lib/types/api';

/**
 * Loaded data plus the live-stream graph. Filters, view mode and selection are not here:
 * the URL is their single source of truth, so the layout loader can key off them.
 */
function createAppState() {
	let selectedProjectId = $state<string | null>(null);
	let targets = $state<Target[]>([]);
	let findings = $state<Finding[]>([]);
	let graphModel = $state<GraphModel>(createEmptyGraph());
	let error = $state<string | null>(null);

	return {
		get selectedProjectId() {
			return selectedProjectId;
		},
		set selectedProjectId(v: string | null) {
			selectedProjectId = v;
		},

		get targets() {
			return targets;
		},
		set targets(v: Target[]) {
			targets = v;
		},

		get findings() {
			return findings;
		},
		set findings(v: Finding[]) {
			findings = v;
		},

		get graphModel() {
			return graphModel;
		},
		set graphModel(v: GraphModel) {
			graphModel = v;
		},

		get error() {
			return error;
		},
		set error(v: string | null) {
			error = v;
		},

		reset() {
			selectedProjectId = null;
			targets = [];
			findings = [];
			graphModel = createEmptyGraph();
			error = null;
		},
	};
}

export const appState = createAppState();
