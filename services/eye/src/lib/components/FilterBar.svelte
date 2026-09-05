<script lang="ts">
import { Box, ChartScatter, RotateCcw, Search, Table } from 'lucide-svelte';
import { untrack } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import {
	DEFAULT_FINDINGS_QUERY,
	type FindingsQuery,
	toSearchParams,
	type ViewMode,
	type ViewQuery,
} from '$lib/state/query-params';

interface Props {
	query: FindingsQuery;
	view: ViewQuery;
	ecosystems: string[];
	severityCounts: Record<string, number>;
}

const { query, view, ecosystems, severityCounts }: Props = $props();

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

const VIEW_MODES: { value: ViewMode; label: string; icon: typeof Box; hint: string }[] = [
	{ value: '3d', label: '3D Spatial', icon: Box, hint: 'Advisory skyline in 3D' },
	{ value: '2d', label: 'Risk Plot', icon: ChartScatter, hint: 'EPSS against DECREE Score' },
	{ value: 'table', label: 'Table', icon: Table, hint: 'Sortable advisory table' },
];

/** Long enough to swallow a fast typist's inter-key gap, short enough to feel immediate. */
const DEBOUNCE_MS = 300;

// The DECREE Score is a weighted composite, so a tenth of a point is noise; these are
// the stops where the active list actually collapses. 0 means the filter is off.
const SCORE_THRESHOLDS: { value: number; label: string; hint: string }[] = [
	{ value: 0, label: 'Any', hint: 'No DECREE Score floor' },
	{ value: 4, label: '4+', hint: 'DECREE Score 4.0 and above' },
	{ value: 5, label: '5+', hint: 'DECREE Score 5.0 and above' },
	{ value: 6, label: '6+', hint: 'DECREE Score 6.0 and above' },
	{ value: 7, label: '7+', hint: 'DECREE Score 7.0 and above' },
];

// The threshold group is not a form control, so its visible heading is bound by id.
const scoreLabelId = $props.id();

const totalCount = $derived(Object.values(severityCounts).reduce((sum, n) => sum + n, 0));

let term = $state(untrack(() => query.q) ?? '');
let epss = $state(untrack(() => query.minEpss) ?? 0);
let pendingTerm: ReturnType<typeof setTimeout> | null = null;
let pendingEpss: ReturnType<typeof setTimeout> | null = null;

// Adopt a URL written elsewhere (Reset, the back button) unless a keystroke is still in flight,
// which would otherwise rewind what the user is typing.
$effect(() => {
	const incoming = query.q ?? '';
	if (!pendingTerm) term = incoming;
});

$effect(() => {
	const incoming = query.minEpss ?? 0;
	if (!pendingEpss) epss = incoming;
});

$effect(() => () => {
	if (pendingTerm) clearTimeout(pendingTerm);
	if (pendingEpss) clearTimeout(pendingEpss);
});

function navigate(nextQuery: FindingsQuery, nextView: ViewQuery) {
	const search = toSearchParams(nextQuery, nextView).toString();
	goto(search ? `${page.url.pathname}?${search}` : page.url.pathname, {
		replaceState: true,
		keepFocus: true,
		noScroll: true,
	});
}

/**
 * A filter change invalidates the result set the selection was picked from, so `advisory`
 * and `finding` are dropped with it. The cursor goes the same way — the table restarts at
 * its first page — because the gateway rejects a cursor whose sort key no longer matches.
 */
function applyFilters(next: FindingsQuery) {
	cancelPending();
	navigate(next, { view: view.view });
}

function cancelPending() {
	if (pendingTerm) clearTimeout(pendingTerm);
	if (pendingEpss) clearTimeout(pendingEpss);
	pendingTerm = null;
	pendingEpss = null;
}

function setSeverity(e: Event) {
	const value = (e.target as HTMLSelectElement).value || undefined;
	applyFilters({ ...query, severity: value });
}

function setEcosystem(e: Event) {
	const value = (e.target as HTMLSelectElement).value || undefined;
	applyFilters({ ...query, ecosystem: value });
}

function setTerm(e: Event) {
	term = (e.target as HTMLInputElement).value;
	if (pendingTerm) clearTimeout(pendingTerm);
	pendingTerm = setTimeout(() => {
		pendingTerm = null;
		const trimmed = term.trim();
		applyFilters({ ...query, q: trimmed || undefined });
	}, DEBOUNCE_MS);
}

function setMinEpss(e: Event) {
	epss = Number.parseFloat((e.target as HTMLInputElement).value);
	if (pendingEpss) clearTimeout(pendingEpss);
	pendingEpss = setTimeout(() => {
		pendingEpss = null;
		applyFilters({ ...query, minEpss: epss > 0 ? epss : undefined });
	}, DEBOUNCE_MS);
}

/** Discrete and deliberate, so it applies on the click; only the dragged and typed controls debounce. */
function setMinScore(value: number) {
	applyFilters({ ...query, minScore: value > 0 ? value : undefined });
}

function toggleActiveOnly() {
	applyFilters({ ...query, activeOnly: !query.activeOnly });
}

function resetFilters() {
	term = '';
	epss = 0;
	applyFilters({ ...DEFAULT_FINDINGS_QUERY });
}

function setView(mode: ViewMode) {
	navigate(query, { ...view, view: mode });
}

function severityLabel(severity: string): string {
	return `${severity} (${severityCounts[severity.toLowerCase()] ?? 0})`;
}
</script>

<div class="hud-panel flex flex-col gap-4 bg-hud-base/85 px-4 py-3 backdrop-blur xl:flex-row xl:items-center xl:justify-between">
	<div class="space-y-1">
		<h2 class="hud-header">Viewport Controls</h2>
		<p class="text-sm text-hud-text-secondary">
			Filter what enters the scene, then switch between the spatial skyline, the risk plot and the
			table.
		</p>
	</div>

	<div class="flex flex-1 flex-wrap items-end gap-3 xl:justify-end">
		<label class="min-w-52 flex-1 space-y-1 text-xs text-hud-text-secondary xl:max-w-64">
			<span class="hud-header">Search</span>
			<div class="flex items-center gap-2 rounded-sm border border-hud-border-control bg-hud-surface px-2">
				<Search size={14} aria-hidden="true" class="shrink-0 text-hud-text-muted" />
				<input
					type="search"
					value={term}
					oninput={setTerm}
					placeholder="CVE, package or target"
					class="w-full bg-transparent py-2 font-mono text-xs text-hud-text placeholder:text-hud-text-muted focus:outline-none"
				/>
			</div>
		</label>

		<label class="space-y-1 text-xs text-hud-text-secondary">
			<span class="hud-header">Severity</span>
			<select
				class="min-w-40 rounded-sm border border-hud-border-control bg-hud-surface px-2 py-2 font-mono text-xs text-hud-text"
				value={query.severity ?? ''}
				onchange={setSeverity}
			>
				<option value="">All severities ({totalCount})</option>
				{#each SEVERITIES as sev (sev)}
					<option value={sev}>{severityLabel(sev)}</option>
				{/each}
			</select>
		</label>

		<label class="space-y-1 text-xs text-hud-text-secondary">
			<span class="hud-header">Ecosystem</span>
			<select
				class="min-w-32 rounded-sm border border-hud-border-control bg-hud-surface px-2 py-2 font-mono text-xs text-hud-text"
				value={query.ecosystem ?? ''}
				onchange={setEcosystem}
			>
				<option value="">All ecosystems</option>
				{#each ecosystems as eco (eco)}
					<option value={eco}>{eco}</option>
				{/each}
			</select>
		</label>

		<label class="min-w-56 space-y-1 text-xs text-hud-text-secondary">
			<span class="hud-header">Minimum EPSS</span>
			<div class="flex items-center gap-3 rounded-sm border border-hud-border-control bg-hud-surface px-3 py-2">
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={epss}
					oninput={setMinEpss}
					class="flex-1"
				/>
				<span class="w-10 text-right font-mono text-xs text-hud-text">{(epss * 100).toFixed(0)}%</span>
			</div>
		</label>

		<div class="space-y-1 text-xs text-hud-text-secondary">
			<span class="hud-header" id={scoreLabelId}>Minimum DECREE Score</span>
			<div
				role="group"
				aria-labelledby={scoreLabelId}
				class="flex items-center gap-1 rounded-sm border border-hud-border-control bg-hud-surface p-1"
			>
				{#each SCORE_THRESHOLDS as threshold (threshold.value)}
					<button
						class="rounded-sm px-2.5 py-1.5 font-mono text-xs transition-colors {(query.minScore ?? 0) === threshold.value ? 'bg-hud-accent/15 text-hud-accent' : 'text-hud-text-secondary hover:text-hud-text'}"
						aria-pressed={(query.minScore ?? 0) === threshold.value}
						onclick={() => setMinScore(threshold.value)}
						title={threshold.hint}
					>
						{threshold.label}
					</button>
				{/each}
			</div>
		</div>

		<button
			class="rounded-sm border px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] transition-colors {query.activeOnly ? 'hud-border-active bg-hud-accent/10 text-hud-accent' : 'border-hud-border-control bg-hud-surface text-hud-text-secondary hover:text-hud-text'}"
			aria-pressed={query.activeOnly}
			onclick={toggleActiveOnly}
		>
			Active Only
		</button>

		<button
			class="inline-flex items-center gap-2 rounded-sm border border-hud-border-control bg-hud-surface px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-hud-text-secondary transition-colors hover:text-hud-text"
			onclick={resetFilters}
			title="Reset filters"
		>
			<RotateCcw size={14} aria-hidden="true" /> Reset
		</button>

		<div
			role="group"
			aria-label="View mode"
			class="flex items-center gap-1 rounded-sm border border-hud-border-control bg-hud-surface p-1"
		>
			{#each VIEW_MODES as mode (mode.value)}
				<button
					class="inline-flex items-center gap-2 rounded-sm px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] transition-colors {view.view === mode.value ? 'bg-hud-accent/15 text-hud-accent' : 'text-hud-text-secondary hover:text-hud-text'}"
					aria-pressed={view.view === mode.value}
					onclick={() => setView(mode.value)}
					title={mode.hint}
				>
					<mode.icon size={16} aria-hidden="true" /> {mode.label}
				</button>
			{/each}
		</div>
	</div>
</div>
