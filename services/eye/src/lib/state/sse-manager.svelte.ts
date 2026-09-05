import { env } from '$env/dynamic/public';
import { FINDINGS_PAGE_LIMIT, getFindings } from '$lib/api/client';
import { createSSEConnection, type SSEConnection } from '$lib/api/sse';
import {
	type AdvisoryEventOutcome,
	type AdvisoryFilterState,
	type AdvisoryIndex,
	absorbAdvisoryInstances,
	advisoryGroups,
	applyAdvisoryEvent,
	applyFindingUpdate,
	buildAdvisoryIndex,
	emptyAdvisoryIndex,
} from '$lib/graph/updater';
import type { AdvisoryGroup, Finding, FindingChangedEvent } from '$lib/types/api';
import { appState } from './app.svelte';

const GATEWAY_URL = env.PUBLIC_GATEWAY_URL ?? 'http://localhost:8400';

/** One scan emits an event per changed finding, so the follow-up requests are coalesced. */
const RESOLVE_DEBOUNCE_MS = 750;

/** Past this many advisories, one reload of the query costs less than the burst. */
const MAX_TARGETED_FETCHES = 8;

const DEFAULT_FILTERS: AdvisoryFilterState = { activeOnly: true };

/**
 * The advisory-grained listing the 3D scene and the table are built from, kept up to
 * date in memory instead of by re-running the loader. The loader seeds it; the stream
 * patches it through the same aggregation rules the gateway's GROUP BY uses.
 */
function createLiveAdvisories() {
	let index = $state.raw<AdvisoryIndex>(emptyAdvisoryIndex());
	let estimatedIds = $state.raw<ReadonlySet<string>>(new Set<string>());
	let stale = $state(false);
	let generation = $state(0);

	function seed(groups: AdvisoryGroup[], findings: Finding[], filters: AdvisoryFilterState) {
		index = buildAdvisoryIndex(groups, findings, filters);
		estimatedIds = new Set();
		stale = false;
		generation += 1;
	}

	return {
		get groups(): AdvisoryGroup[] {
			return advisoryGroups(index);
		},
		/** Advisories whose aggregates are the client's best effort, not the server's answer. */
		get estimated(): ReadonlySet<string> {
			return estimatedIds;
		},
		/** True once a live change means the list no longer matches the server's own ordering. */
		get stale(): boolean {
			return stale;
		},
		get filters(): AdvisoryFilterState {
			return index.filters;
		},
		/** Bumped on every load, so a refetch still in flight for an older query is dropped. */
		get generation(): number {
			return generation;
		},

		seed,

		reset() {
			seed([], [], DEFAULT_FILTERS);
		},

		/** Driven by the stream. Components read the getters. */
		apply(event: FindingChangedEvent): AdvisoryEventOutcome {
			const result = applyAdvisoryEvent(index, event);
			if (result.outcome === 'ignored') return result.outcome;

			index = result.index;
			stale = true;
			if (result.outcome === 'estimated') {
				estimatedIds = new Set(estimatedIds).add(result.advisoryId);
			}
			return result.outcome;
		},

		/** Driven by a targeted refetch, which is authoritative for that one advisory. */
		absorb(advisoryId: string, findings: Finding[]) {
			index = absorbAdvisoryInstances(index, advisoryId, findings);
			if (!estimatedIds.has(advisoryId)) return;

			const next = new Set(estimatedIds);
			next.delete(advisoryId);
			estimatedIds = next;
		},
	};
}

function createSSEManager() {
	let connection = $state<SSEConnection | null>(null);
	let lastEventId = $state<string | null>(null);
	let connected = $state(false);
	let reloadRequestId = $state(0);

	let projectId: string | null = null;
	let pending = new Set<string>();
	let resolveTimer: ReturnType<typeof setTimeout> | null = null;

	function connect(id: string) {
		disconnect();
		projectId = id;
		const url = `${GATEWAY_URL}/api/events?project_id=${encodeURIComponent(id)}`;
		connection = createSSEConnection({
			url,
			lastEventId: lastEventId ?? undefined,
			onEvent(event) {
				lastEventId = event.id;
				if (event.type !== 'finding_changed') return;

				const finding = parseFindingChanged(event.data);
				if (!finding) return;

				appState.graphModel = applyFindingUpdate(appState.graphModel, finding, appState.targets);

				const outcome = liveAdvisories.apply(finding);
				if (outcome === 'unknown-advisory' || outcome === 'estimated') {
					queueResolve(finding.advisory_id);
				}
			},
			onOpen() {
				connected = true;
			},
			onError() {
				connected = false;
			},
		});
	}

	function disconnect() {
		if (resolveTimer) {
			clearTimeout(resolveTimer);
			resolveTimer = null;
		}
		pending = new Set();

		if (connection) {
			connection.close();
			connection = null;
			connected = false;
		}
	}

	function queueResolve(advisoryId: string) {
		pending.add(advisoryId);
		if (resolveTimer) clearTimeout(resolveTimer);
		resolveTimer = setTimeout(resolvePending, RESOLVE_DEBOUNCE_MS);
	}

	/**
	 * An advisory the client cannot recompute is re-read on its own. The `advisory` filter
	 * is just another condition on the listing's WHERE clause, so one page of instances is
	 * exactly the set the group aggregates over — and one request, not the loader's eight.
	 */
	async function resolvePending() {
		resolveTimer = null;
		const advisoryIds = [...pending];
		pending = new Set();

		const project = projectId;
		if (!project || advisoryIds.length === 0) return;

		if (advisoryIds.length > MAX_TARGETED_FETCHES) {
			requestReload();
			return;
		}

		const generation = liveAdvisories.generation;
		const filters = liveAdvisories.filters;

		for (const advisory of advisoryIds) {
			try {
				const page = await getFindings(project, {
					advisory,
					severity: filters.severity,
					ecosystem: filters.ecosystem,
					min_epss: filters.minEpss,
					min_score: filters.minScore,
					active_only: filters.activeOnly,
					q: filters.q,
					limit: FINDINGS_PAGE_LIMIT,
				});
				if (generation !== liveAdvisories.generation) return;

				// A group wider than one page cannot be summarised from that page.
				if (page.has_more) {
					requestReload();
					return;
				}
				liveAdvisories.absorb(advisory, page.data);
			} catch {
				requestReload();
				return;
			}
		}
	}

	function requestReload() {
		reloadRequestId += 1;
	}

	return {
		get connected() {
			return connected;
		},
		get lastEventId() {
			return lastEventId;
		},
		/** Increments when only re-running the loader can put the view back in step. */
		get reloadRequestId() {
			return reloadRequestId;
		},
		connect,
		disconnect,
	};
}

const REQUIRED_IDS = ['instance_id', 'advisory_id', 'target_id'] as const;
const REQUIRED_TEXT = ['target_name', 'package_name', 'package_version', 'ecosystem'] as const;

/** The stream is an external boundary: one bad frame must not kill the connection. */
function parseFindingChanged(data: string): FindingChangedEvent | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		console.warn('discarded malformed finding_changed payload');
		return null;
	}

	if (!isFindingChanged(parsed)) {
		console.warn('discarded finding_changed payload missing required fields');
		return null;
	}
	return parsed;
}

function isFindingChanged(value: unknown): value is FindingChangedEvent {
	if (typeof value !== 'object' || value === null) return false;

	const event = value as Record<string, unknown>;
	if (typeof event.is_active !== 'boolean') return false;
	if (!REQUIRED_IDS.every((key) => typeof event[key] === 'string' && event[key] !== ''))
		return false;
	return REQUIRED_TEXT.every((key) => typeof event[key] === 'string');
}

export const liveAdvisories = createLiveAdvisories();
export const sseManager = createSSEManager();
