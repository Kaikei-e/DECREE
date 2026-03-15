import type { GraphModel } from '$lib/graph/model';
import { createEmptyGraph } from '$lib/graph/model';
import type { Finding, FindingDetail, Project, Target } from '$lib/types/api';

export type RendererType = '3d' | '2d';

export interface FindingFilters {
	severity?: string;
	ecosystem?: string;
	minEpss?: number;
	activeOnly: boolean;
}

function createAppState() {
	let projects = $state<Project[]>([]);
	let selectedProjectId = $state<string | null>(null);
	let targets = $state<Target[]>([]);
	let findings = $state<Finding[]>([]);
	let graphModel = $state<GraphModel>(createEmptyGraph());
	let selectedNodeId = $state<string | null>(null);
	let selectedFindingDetail = $state<FindingDetail | null>(null);
	let filters = $state<FindingFilters>({ activeOnly: true });
	let rendererType = $state<RendererType>('3d');
	let loading = $state(false);
	let error = $state<string | null>(null);

	return {
		get projects() {
			return projects;
		},
		set projects(v: Project[]) {
			projects = v;
		},

		get selectedProjectId() {
			return selectedProjectId;
		},
		set selectedProjectId(v: string | null) {
			selectedProjectId = v;
		},

		get selectedProject(): Project | undefined {
			return projects.find((p) => p.id === selectedProjectId);
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

		get selectedNodeId() {
			return selectedNodeId;
		},
		set selectedNodeId(v: string | null) {
			selectedNodeId = v;
		},

		get selectedFindingDetail() {
			return selectedFindingDetail;
		},
		set selectedFindingDetail(v: FindingDetail | null) {
			selectedFindingDetail = v;
		},

		get filters() {
			return filters;
		},
		set filters(v: FindingFilters) {
			filters = v;
		},

		get rendererType() {
			return rendererType;
		},
		set rendererType(v: RendererType) {
			rendererType = v;
		},

		get loading() {
			return loading;
		},
		set loading(v: boolean) {
			loading = v;
		},

		get error() {
			return error;
		},
		set error(v: string | null) {
			error = v;
		},

		reset() {
			projects = [];
			selectedProjectId = null;
			targets = [];
			findings = [];
			graphModel = createEmptyGraph();
			selectedNodeId = null;
			selectedFindingDetail = null;
			filters = { activeOnly: true };
			rendererType = '3d';
			loading = false;
			error = null;
		},
	};
}

export const appState = createAppState();
