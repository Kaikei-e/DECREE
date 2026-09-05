import type { AdvisoryGroup, Finding, FindingChangedEvent, Target } from '$lib/types/api';
import { computeLayout, parseSeverity } from './layout';
import { type GraphModel, SEVERITY_COLORS } from './model';

/**
 * The fields an update may carry. A full `Finding` from the list endpoint satisfies it,
 * and so does the narrower payload the oracle publishes over SSE.
 */
export type FindingUpdate = Pick<
	Finding,
	| 'instance_id'
	| 'target_id'
	| 'target_name'
	| 'package_name'
	| 'package_version'
	| 'ecosystem'
	| 'advisory_id'
	| 'is_active'
> & {
	severity?: string;
	decree_score?: number;
	epss_score?: number;
	cvss_score?: number;
	last_observed_at?: string;
};

/**
 * Apply a single finding update to the graph immutably.
 * Returns a new GraphModel with the change applied.
 */
export function applyFindingUpdate(
	graph: GraphModel,
	finding: FindingUpdate,
	targets: Target[],
): GraphModel {
	const existingNode = graph.nodes.get(finding.instance_id);

	if (existingNode && finding.is_active) {
		// Update existing active node: refresh score and visuals
		const severity = parseSeverity(finding.severity);
		const decreeScore = finding.decree_score ?? 0;
		const now = new Date();

		let opacity = 0.5;
		if (finding.epss_score != null) {
			opacity = Math.max(0.3, Math.min(1.0, finding.epss_score));
		}

		// An update with no timestamp came from a scan that just ran, so it was observed now.
		const lastObservedAt = finding.last_observed_at ?? now.toISOString();
		const pulse = now.getTime() - new Date(lastObservedAt).getTime() < 24 * 60 * 60 * 1000;

		const updatedNode = {
			...existingNode,
			severity,
			decreeScore,
			epssScore: finding.epss_score ?? 0,
			cvssScore: finding.cvss_score ?? existingNode.cvssScore,
			isActive: true,
			lastObservedAt,
			position: {
				...existingNode.position,
				y: decreeScore * 5, // Y_SCALE
			},
			visual: {
				...existingNode.visual,
				color: SEVERITY_COLORS[severity],
				opacity,
				pulse,
				isNew: false,
				isDisappearing: false,
			},
		};

		const newNodes = new Map(graph.nodes);
		newNodes.set(finding.instance_id, updatedNode);
		return { ...graph, nodes: newNodes };
	}

	if (!existingNode && finding.is_active) {
		// New finding: recompute full layout with this finding included
		const allFindings = buildFindingsList(graph, finding);
		const newGraph = computeLayout(allFindings, targets);

		// Mark the new node
		const newNode = newGraph.nodes.get(finding.instance_id);
		if (newNode) {
			newNode.visual.isNew = true;
		}

		return newGraph;
	}

	if (existingNode && !finding.is_active) {
		// Deactivating: mark as disappearing
		const updatedNode = {
			...existingNode,
			isActive: false,
			visual: {
				...existingNode.visual,
				isDisappearing: true,
				isNew: false,
			},
		};

		const newNodes = new Map(graph.nodes);
		newNodes.set(finding.instance_id, updatedNode);

		// Update cluster node list
		const newClusters = graph.clusters.map((c) => {
			if (c.id === existingNode.targetId) {
				return { ...c };
			}
			return c;
		});

		return { ...graph, nodes: newNodes, clusters: newClusters };
	}

	// Finding doesn't exist and is not active — no-op
	return graph;
}

/**
 * Reconstruct a findings list from the current graph plus a new finding.
 */
function buildFindingsList(graph: GraphModel, newFinding: FindingUpdate): Finding[] {
	const findings: Finding[] = [];
	for (const [, node] of graph.nodes) {
		findings.push({
			instance_id: node.id,
			target_id: node.targetId,
			target_name: node.targetName,
			package_name: node.packageName,
			package_version: node.packageVersion,
			ecosystem: node.ecosystem,
			advisory_id: node.advisoryId,
			severity: node.severity,
			decree_score: node.decreeScore,
			epss_score: node.epssScore,
			cvss_score: node.cvssScore,
			is_active: node.isActive,
			last_observed_at: node.lastObservedAt ?? undefined,
		});
	}
	findings.push({
		...newFinding,
		last_observed_at: newFinding.last_observed_at ?? new Date().toISOString(),
	});
	return findings;
}

/** Mirrors the gateway's AdvisoryNameCap: the sample name lists are cut to five. */
export const ADVISORY_NAME_CAP = 5;

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * The filter the current listing was fetched with. The gateway derives the advisory
 * aggregates from the same WHERE clause as the findings list, so reproducing the
 * predicate here is what lets a single event be applied without asking the server.
 */
export interface AdvisoryFilterState {
	severity?: string;
	ecosystem?: string;
	minEpss?: number;
	minScore?: number;
	activeOnly: boolean;
	q?: string;
}

/** One row of the set an AdvisoryGroup aggregates over. */
export interface AdvisoryInstance {
	instance_id: string;
	advisory_id: string;
	target_id: string;
	target_name: string;
	package_name: string;
	package_version: string;
	ecosystem: string;
	severity?: string;
	decree_score?: number;
	epss_score?: number;
	cvss_score?: number;
	is_active: boolean;
	last_observed_at?: string;
}

export interface AdvisoryEntry {
	group: AdvisoryGroup;
	instances: Map<string, AdvisoryInstance>;
	/** True while the held instances provably cover everything the group aggregates. */
	exact: boolean;
}

export interface AdvisoryIndex {
	/** Keyed by advisory id, in the order the server returned the groups. */
	entries: Map<string, AdvisoryEntry>;
	filters: AdvisoryFilterState;
}

export type AdvisoryEventOutcome =
	/** Recomputed from a complete instance set: the aggregates match what the server would send. */
	| 'applied'
	/** Only the monotone aggregates could be moved; the group now needs the server. */
	| 'estimated'
	/** Not in the index, and one instance is not enough to synthesise a group. */
	| 'unknown-advisory'
	/** Outside the current filter result, so the server would not have listed it either. */
	| 'ignored';

export interface AdvisoryEventResult {
	index: AdvisoryIndex;
	advisoryId: string;
	outcome: AdvisoryEventOutcome;
}

export function emptyAdvisoryIndex(
	filters: AdvisoryFilterState = { activeOnly: true },
): AdvisoryIndex {
	return { entries: new Map(), filters };
}

/**
 * Pair each listed advisory with the instances the findings list loaded for it.
 * A group is only marked exact when the two agree on how many there are, so a
 * truncated or filtered load cannot quietly turn into a wrong count later.
 */
export function buildAdvisoryIndex(
	groups: AdvisoryGroup[],
	findings: Finding[],
	filters: AdvisoryFilterState,
): AdvisoryIndex {
	const byAdvisory = new Map<string, Map<string, AdvisoryInstance>>();
	for (const finding of findings) {
		let bucket = byAdvisory.get(finding.advisory_id);
		if (!bucket) {
			bucket = new Map();
			byAdvisory.set(finding.advisory_id, bucket);
		}
		bucket.set(finding.instance_id, toAdvisoryInstance(finding));
	}

	const entries = new Map<string, AdvisoryEntry>();
	for (const group of groups) {
		const instances = byAdvisory.get(group.advisory_id) ?? new Map<string, AdvisoryInstance>();
		entries.set(group.advisory_id, {
			group,
			instances,
			exact: instances.size === group.instance_count,
		});
	}

	return { entries, filters };
}

export function advisoryGroups(index: AdvisoryIndex): AdvisoryGroup[] {
	return [...index.entries.values()].map((entry) => entry.group);
}

export function toAdvisoryInstance(finding: Finding): AdvisoryInstance {
	return {
		instance_id: finding.instance_id,
		advisory_id: finding.advisory_id,
		target_id: finding.target_id,
		target_name: finding.target_name,
		package_name: finding.package_name,
		package_version: finding.package_version,
		ecosystem: finding.ecosystem,
		severity: text(finding.severity),
		decree_score: numeric(finding.decree_score),
		epss_score: numeric(finding.epss_score),
		cvss_score: numeric(finding.cvss_score),
		is_active: finding.is_active,
		last_observed_at: text(finding.last_observed_at),
	};
}

/** The client-side twin of the gateway's filterConditions(). */
export function matchesAdvisoryFilters(
	instance: AdvisoryInstance,
	filters: AdvisoryFilterState,
): boolean {
	if (filters.activeOnly && !instance.is_active) return false;
	if (filters.severity != null && !severityMatches(instance.severity, filters.severity)) {
		return false;
	}
	if (filters.ecosystem != null && instance.ecosystem !== filters.ecosystem) return false;
	// SQL compares a NULL score with >= and gets NULL, so a scoreless instance is excluded.
	if (
		filters.minEpss != null &&
		!(instance.epss_score != null && instance.epss_score >= filters.minEpss)
	) {
		return false;
	}
	// The gateway only adds the score condition above zero.
	if (
		filters.minScore != null &&
		filters.minScore > 0 &&
		!(instance.decree_score != null && instance.decree_score >= filters.minScore)
	) {
		return false;
	}
	if (filters.q != null && !textMatches(instance, filters.q)) return false;
	return true;
}

/** Recompute a group the way the gateway's GROUP BY does, over the instances given. */
export function summariseAdvisory(
	advisoryId: string,
	instances: AdvisoryInstance[],
	base?: AdvisoryGroup,
): AdvisoryGroup {
	const worst = [...instances].sort(bySeverityDesc)[0];

	return {
		advisory_id: advisoryId,
		severity: worst?.severity,
		max_decree_score: maxOf(instances.map((i) => i.decree_score)),
		epss_score: maxOf(instances.map((i) => i.epss_score)),
		// The stream carries no CVSS, so a group whose instances all lack one keeps what
		// the list endpoint last supplied rather than claiming there is none.
		cvss_score: maxOf(instances.map((i) => i.cvss_score)) ?? base?.cvss_score,
		instance_count: instances.length,
		target_count: distinct(instances.map((i) => i.target_id)).length,
		target_names: distinct(instances.map((i) => i.target_name)).slice(0, ADVISORY_NAME_CAP),
		package_names: distinct(instances.map((i) => i.package_name)).slice(0, ADVISORY_NAME_CAP),
		ecosystems: distinct(instances.map((i) => i.ecosystem)).slice(0, ADVISORY_NAME_CAP),
		is_active: instances.some((i) => i.is_active),
		// No event carries a first observation, so it stays as the server reported it.
		first_observed_at: base?.first_observed_at,
		last_observed_at: latest(instances.map((i) => i.last_observed_at)) ?? base?.last_observed_at,
	};
}

/** Apply one stream event to the advisory listing, immutably. */
export function applyAdvisoryEvent(
	index: AdvisoryIndex,
	event: FindingChangedEvent,
): AdvisoryEventResult {
	const advisoryId = event.advisory_id;
	const entry = index.entries.get(advisoryId);
	const instance = eventInstance(event, entry?.instances.get(event.instance_id));
	const belongs = matchesAdvisoryFilters(instance, index.filters);

	if (!entry) {
		// One instance carries no package list, no counts and no CVSS, so a group made
		// from it would be a fabrication; the caller resolves this against the server.
		return { index, advisoryId, outcome: belongs ? 'unknown-advisory' : 'ignored' };
	}

	if (!belongs && !entry.instances.has(event.instance_id)) {
		return { index, advisoryId, outcome: 'ignored' };
	}

	if (!entry.exact) {
		return {
			index: withEntry(index, advisoryId, estimateEntry(entry, instance, belongs)),
			advisoryId,
			outcome: 'estimated',
		};
	}

	const instances = new Map(entry.instances);
	if (belongs) instances.set(instance.instance_id, instance);
	else instances.delete(instance.instance_id);

	if (instances.size === 0) {
		const entries = new Map(index.entries);
		entries.delete(advisoryId);
		return { index: { ...index, entries }, advisoryId, outcome: 'applied' };
	}

	const group = summariseAdvisory(advisoryId, [...instances.values()], entry.group);
	return {
		index: withEntry(index, advisoryId, { group, instances, exact: true }),
		advisoryId,
		outcome: 'applied',
	};
}

/**
 * Replace one advisory with a group summarised from an authoritative instance set —
 * the answer to a targeted `?advisory=` refetch, which shares the listing's WHERE clause.
 */
export function absorbAdvisoryInstances(
	index: AdvisoryIndex,
	advisoryId: string,
	findings: Finding[],
): AdvisoryIndex {
	const instances = new Map<string, AdvisoryInstance>();
	for (const finding of findings) {
		if (finding.advisory_id !== advisoryId) continue;
		instances.set(finding.instance_id, toAdvisoryInstance(finding));
	}

	const entries = new Map(index.entries);
	if (instances.size === 0) {
		entries.delete(advisoryId);
	} else {
		entries.set(advisoryId, {
			group: summariseAdvisory(advisoryId, [...instances.values()], entries.get(advisoryId)?.group),
			instances,
			exact: true,
		});
	}

	return { ...index, entries };
}

/**
 * Without the whole instance set, only the aggregates one instance can move on its own
 * are safe: a maximum can climb, and a bool_or can turn on. Everything else keeps the
 * server's number, and the group is reported as approximate.
 */
function estimateEntry(
	entry: AdvisoryEntry,
	instance: AdvisoryInstance,
	belongs: boolean,
): AdvisoryEntry {
	const instances = new Map(entry.instances);
	if (belongs) instances.set(instance.instance_id, instance);
	else instances.delete(instance.instance_id);

	const group = { ...entry.group };
	if (belongs) {
		if (raises(instance.decree_score, group.max_decree_score)) {
			group.max_decree_score = instance.decree_score;
		}
		if (raises(instance.epss_score, group.epss_score)) {
			group.epss_score = instance.epss_score;
		}
		if (severityRank(instance.severity) > severityRank(group.severity)) {
			group.severity = instance.severity;
		}
		if (instance.is_active) group.is_active = true;
		group.last_observed_at = latest([group.last_observed_at, instance.last_observed_at]);
	}

	return { group, instances, exact: false };
}

function eventInstance(event: FindingChangedEvent, previous?: AdvisoryInstance): AdvisoryInstance {
	return {
		instance_id: event.instance_id,
		advisory_id: event.advisory_id,
		target_id: event.target_id,
		target_name: event.target_name,
		package_name: event.package_name,
		package_version: event.package_version,
		ecosystem: event.ecosystem,
		severity: text(event.severity),
		decree_score: numeric(event.decree_score),
		epss_score: numeric(event.epss_score),
		// The oracle publishes no CVSS; blanking it would drop what the list endpoint gave.
		cvss_score: previous?.cvss_score,
		is_active: event.is_active,
		// An active event means this scan observed it; a resolution observed nothing.
		last_observed_at: event.is_active ? new Date().toISOString() : previous?.last_observed_at,
	};
}

function withEntry(index: AdvisoryIndex, advisoryId: string, entry: AdvisoryEntry): AdvisoryIndex {
	const entries = new Map(index.entries);
	entries.set(advisoryId, entry);
	return { ...index, entries };
}

function raises(candidate: number | undefined, current: number | undefined): boolean {
	if (candidate == null) return false;
	return current == null || candidate > current;
}

function severityRank(severity?: string): number {
	return SEVERITY_RANK[(severity ?? '').toLowerCase()] ?? 0;
}

function severityMatches(label: string | undefined, wanted: string): boolean {
	// The projection leaves last_severity NULL for never-scored findings, and the
	// gateway folds those into "unknown".
	if (wanted === 'unknown') return label === undefined || label === wanted;
	return label === wanted;
}

function textMatches(instance: AdvisoryInstance, term: string): boolean {
	const needle = term.toLowerCase();
	return (
		instance.package_name.toLowerCase().includes(needle) ||
		instance.advisory_id.toLowerCase().includes(needle) ||
		instance.target_name.toLowerCase().includes(needle)
	);
}

function bySeverityDesc(a: AdvisoryInstance, b: AdvisoryInstance): number {
	const byRank = severityRank(b.severity) - severityRank(a.severity);
	if (byRank !== 0) return byRank;
	if (a.severity === b.severity) return 0;
	// Postgres orders NULLs last on an ascending tie-break.
	if (a.severity === undefined) return 1;
	if (b.severity === undefined) return -1;
	return compareText(a.severity, b.severity);
}

function distinct(values: string[]): string[] {
	return [...new Set(values)].sort(compareText);
}

function compareText(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}

function maxOf(values: (number | undefined)[]): number | undefined {
	let max: number | undefined;
	for (const value of values) {
		if (value == null) continue;
		if (max === undefined || value > max) max = value;
	}
	return max;
}

function latest(values: (string | undefined)[]): string | undefined {
	let best: string | undefined;
	let bestTime = Number.NEGATIVE_INFINITY;
	for (const value of values) {
		if (!value) continue;
		const time = Date.parse(value);
		if (!Number.isNaN(time) && time > bestTime) {
			bestTime = time;
			best = value;
		}
	}
	return best;
}

function text(value: string | undefined): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

function numeric(value: number | undefined): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
