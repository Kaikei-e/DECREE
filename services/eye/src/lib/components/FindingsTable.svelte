<script lang="ts">
import { ArrowDown, ArrowUp, ChevronsUpDown, Loader2 } from 'lucide-svelte';
import type { FindingSort } from '$lib/api/client';
import { parseSeverity } from '$lib/graph/layout';
import SeverityBadge from './SeverityBadge.svelte';

interface AdvisoryGroup {
	advisory_id: string;
	severity?: string;
	max_decree_score?: number;
	epss_score?: number;
	cvss_score?: number;
	instance_count: number;
	target_count: number;
	target_names: string[];
	package_names: string[];
	ecosystems: string[];
	is_active: boolean;
	first_observed_at?: string;
	last_observed_at?: string;
}

interface Props {
	groups: AdvisoryGroup[];
	sort: FindingSort;
	order: 'asc' | 'desc';
	selectedAdvisoryId: string | null;
	loading: boolean;
	hasMore: boolean;
	hasActiveFilters: boolean;
	/** Advisories whose counts are the client's best effort while a live edit is reconciled. */
	estimated?: ReadonlySet<string>;
	onSort: (key: FindingSort) => void;
	onSelect: (advisoryId: string) => void;
	onLoadMore: () => void;
	onClearFilters: () => void;
}

const {
	groups,
	sort,
	order,
	selectedAdvisoryId,
	loading,
	hasMore,
	hasActiveFilters,
	onSort,
	onSelect,
	onLoadMore,
	onClearFilters,
	estimated,
}: Props = $props();

interface Column {
	key: FindingSort;
	label: string;
	numeric?: boolean;
}

const COLUMNS: Column[] = [
	{ key: 'severity', label: 'Severity' },
	{ key: 'advisory', label: 'Advisory' },
	{ key: 'package', label: 'Package' },
	{ key: 'target', label: 'Targets' },
	{ key: 'decree_score', label: 'DECREE', numeric: true },
	{ key: 'epss', label: 'EPSS', numeric: true },
	{ key: 'cvss', label: 'CVSS', numeric: true },
	{ key: 'last_observed', label: 'Last seen' },
];

const LAST_COLUMN = COLUMNS.length - 1;

const describedById = $props.id();

let gridEl: HTMLElement | undefined = $state();
let cursorRow = $state(0);
let cursorCol = $state(0);

// Row 0 is the header, so data row n lives at cursor row n + 1.
const lastRow = $derived(groups.length);
const activeRow = $derived(Math.min(cursorRow, lastRow));
const activeCol = $derived(Math.min(cursorCol, LAST_COLUMN));

function ariaSort(key: FindingSort): 'ascending' | 'descending' | undefined {
	if (key !== sort) return undefined;
	return order === 'asc' ? 'ascending' : 'descending';
}

function sortActionName(column: Column): string {
	if (column.key !== sort) return `Sort by ${column.label}`;
	return `Sort by ${column.label} ${order === 'asc' ? 'descending' : 'ascending'}`;
}

function focusCell(row: number, col: number) {
	const cell = gridEl?.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
	if (!cell) return;
	cursorRow = row;
	cursorCol = col;
	cell.focus();
}

function handleFocusIn(event: FocusEvent) {
	const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-row][data-col]');
	if (!cell) return;
	cursorRow = Number(cell.dataset.row);
	cursorCol = Number(cell.dataset.col);
}

function handleKeydown(event: KeyboardEvent) {
	if (event.altKey || event.metaKey) return;
	if (event.ctrlKey && event.key !== 'Home' && event.key !== 'End') return;

	let row = activeRow;
	let col = activeCol;

	switch (event.key) {
		case 'ArrowRight':
			col = Math.min(col + 1, LAST_COLUMN);
			break;
		case 'ArrowLeft':
			col = Math.max(col - 1, 0);
			break;
		case 'ArrowDown':
			row = Math.min(row + 1, lastRow);
			break;
		case 'ArrowUp':
			row = Math.max(row - 1, 0);
			break;
		case 'Home':
			col = 0;
			if (event.ctrlKey) row = 0;
			break;
		case 'End':
			col = LAST_COLUMN;
			if (event.ctrlKey) row = lastRow;
			break;
		case 'Enter':
		case ' ': {
			// A header cell's own button handles activation, so only data rows select here.
			if (activeRow === 0) return;
			const group = groups[activeRow - 1];
			if (!group) return;
			event.preventDefault();
			onSelect(group.advisory_id);
			return;
		}
		default:
			return;
	}

	event.preventDefault();
	focusCell(row, col);
}

function formatScore(value: number | undefined): string {
	return value == null ? '—' : value.toFixed(1);
}

function formatEpss(value: number | undefined): string {
	if (value == null) return '—';
	const percent = value * 100;
	return `${percent >= 1 ? percent.toFixed(1) : percent.toFixed(2)}%`;
}

function formatRelative(iso: string | undefined): string {
	if (!iso) return '—';
	const parsed = Date.parse(iso);
	if (Number.isNaN(parsed)) return '—';

	const minutes = Math.floor((Date.now() - parsed) / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(months / 12)}y ago`;
}

function observedTitle(group: AdvisoryGroup): string {
	const first = group.first_observed_at ? `First seen ${group.first_observed_at}` : null;
	const last = group.last_observed_at ? `Last seen ${group.last_observed_at}` : 'Never observed';
	return first ? `${first} · ${last}` : last;
}

function tabIndexFor(row: number, col: number): 0 | -1 {
	return activeRow === row && activeCol === col ? 0 : -1;
}

const cellClass = 'flex h-full min-w-0 items-center px-2';
const numericCellClass = `${cellClass} justify-end font-mono tabular-nums`;
const rowClass =
	'findings-row findings-row-layout cursor-pointer border-b border-b-hud-border border-l-2 text-xs hover:bg-hud-accent/5';
</script>

<div class="hud-panel flex h-full min-h-0 flex-col bg-hud-base/90">
	<div class="findings-scroll min-h-0 flex-1 overflow-auto">
		<div
			bind:this={gridEl}
			role="grid"
			tabindex={-1}
			aria-label="Findings grouped by advisory"
			aria-describedby={describedById}
			aria-colcount={COLUMNS.length}
			aria-rowcount={hasMore ? -1 : groups.length + 1}
			aria-busy={loading || undefined}
			class="findings-grid"
			onkeydown={handleKeydown}
			onfocusin={handleFocusIn}
		>
			<div role="rowgroup" class="findings-head bg-hud-surface">
				<div
					role="row"
					aria-rowindex={1}
					class="findings-row-layout border-b border-hud-border-control"
				>
					{#each COLUMNS as column, columnIndex (column.key)}
						<div role="columnheader" aria-sort={ariaSort(column.key)} class="flex h-full min-w-0">
							<button
								type="button"
								data-row="0"
								data-col={columnIndex}
								tabindex={tabIndexFor(0, columnIndex)}
								aria-label={sortActionName(column)}
								class="hud-header flex h-full w-full min-w-0 items-center gap-1 px-2 hover:text-hud-text {column.numeric
									? 'justify-end'
									: ''} {column.key === sort ? 'text-hud-accent' : 'text-hud-text-secondary'}"
								onclick={() => onSort(column.key)}
							>
								<span class="truncate">{column.label}</span>
								{#if column.key === sort}
									{#if order === 'asc'}
										<ArrowUp size={12} aria-hidden="true" />
									{:else}
										<ArrowDown size={12} aria-hidden="true" />
									{/if}
								{:else}
									<ChevronsUpDown size={12} aria-hidden="true" class="opacity-40" />
								{/if}
							</button>
						</div>
					{/each}
				</div>
			</div>

			<div role="rowgroup">
				{#each groups as group, index (group.advisory_id)}
					{@const selected = group.advisory_id === selectedAdvisoryId}
					{@const hiddenTargets = group.target_count - group.target_names.length}
					{@const approx = estimated?.has(group.advisory_id) ?? false}
					<!-- svelte-ignore a11y_click_events_have_key_events -- the grid-level handler carries the keyboard equivalent for the focused cell -->
					<div
						role="row"
						tabindex={-1}
						aria-rowindex={index + 2}
						aria-selected={selected}
						class="{rowClass} {selected
							? 'border-l-hud-accent bg-hud-accent/10'
							: 'border-l-transparent'} {group.is_active ? 'text-hud-text' : 'text-hud-text-secondary'}"
						onclick={() => onSelect(group.advisory_id)}
					>
						<div role="gridcell" tabindex={tabIndexFor(index + 1, 0)} data-row={index + 1} data-col="0" class={cellClass}>
							<SeverityBadge severity={parseSeverity(group.severity)} />
						</div>

						<div role="gridcell" tabindex={tabIndexFor(index + 1, 1)} data-row={index + 1} data-col="1" class="{cellClass} gap-2">
							<span class="whitespace-nowrap font-mono text-xs text-hud-accent">{group.advisory_id}</span>
							{#if !group.is_active}
								<span class="shrink-0 border border-hud-border px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-hud-text-muted">Resolved</span>
							{/if}
						</div>

						<div role="gridcell" tabindex={tabIndexFor(index + 1, 2)} data-row={index + 1} data-col="2" class="{cellClass} gap-2">
							<span class="truncate font-mono" title={group.package_names.join(', ')}>{group.package_names.join(', ')}</span>
							{#if group.ecosystems.length > 0}
								<span class="shrink-0 border border-hud-border px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-hud-text-muted">{group.ecosystems.join(' ')}</span>
							{/if}
						</div>

						<div role="gridcell" tabindex={tabIndexFor(index + 1, 3)} data-row={index + 1} data-col="3" class="{cellClass} gap-2">
							<span class="truncate" title={group.target_names.join(', ')}>{group.target_names.join(', ')}</span>
							{#if hiddenTargets > 0}
								<span class="shrink-0 font-mono text-[10px] text-hud-text-muted" title="{hiddenTargets} more targets not listed">+{hiddenTargets} more</span>
							{/if}
							<span
								class="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-hud-text-secondary"
								title={approx
									? `About ${group.instance_count} instances across about ${group.target_count} targets. Reconciling with the server.`
									: `${group.instance_count} vulnerable instances across ${group.target_count} targets`}
							>{approx ? '~' : ''}{group.instance_count} inst</span>
						</div>

						<div role="gridcell" tabindex={tabIndexFor(index + 1, 4)} data-row={index + 1} data-col="4" class="{numericCellClass} text-hud-accent" title="DECREE Score {formatScore(group.max_decree_score)} of 10">
							{formatScore(group.max_decree_score)}
						</div>

						<div role="gridcell" tabindex={tabIndexFor(index + 1, 5)} data-row={index + 1} data-col="5" class={numericCellClass} title="EPSS probability {group.epss_score ?? 'unknown'}">
							{formatEpss(group.epss_score)}
						</div>

						<div role="gridcell" tabindex={tabIndexFor(index + 1, 6)} data-row={index + 1} data-col="6" class={numericCellClass} title="CVSS base score {formatScore(group.cvss_score)} of 10">
							{formatScore(group.cvss_score)}
						</div>

						<div role="gridcell" tabindex={tabIndexFor(index + 1, 7)} data-row={index + 1} data-col="7" class="{cellClass} justify-end font-mono text-hud-text-secondary">
							{#if group.last_observed_at}
								<time datetime={group.last_observed_at} title={observedTitle(group)}>{formatRelative(group.last_observed_at)}</time>
							{:else}
								<span>—</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>

		{#if groups.length === 0}
			<div class="flex flex-col items-center gap-3 px-4 py-12 text-center">
				{#if loading}
					<p role="status" class="flex items-center gap-2 font-mono text-sm text-hud-text-secondary">
						<Loader2 size={14} aria-hidden="true" class="hud-live-pulse" />
						Loading findings…
					</p>
				{:else if hasActiveFilters}
					<p class="font-mono text-sm text-hud-text-secondary">No advisories match the current filters.</p>
					<button
						type="button"
						class="border border-hud-border-control bg-hud-surface px-3 py-1.5 font-mono text-xs uppercase tracking-[0.14em] text-hud-text-secondary hover:text-hud-text"
						onclick={onClearFilters}
					>
						Clear filters
					</button>
				{:else}
					<p class="font-mono text-sm text-hud-text-secondary">No vulnerabilities recorded for this project.</p>
				{/if}
			</div>
		{/if}
	</div>

	<p id={describedById} class="sr-only">
		{COLUMNS.length} columns of advisory groups. DECREE Score and CVSS are on a 0 to 10 scale, EPSS
		is an exploitation probability. Use the arrow keys to move between cells, Home and End for the
		first and last column of a row, and Enter to open the advisory of the focused row.
	</p>

	{#if groups.length > 0}
		<div class="flex items-center justify-between gap-3 border-t border-hud-border px-3 py-2">
			<p role="status" class="font-mono text-[11px] uppercase tracking-[0.14em] text-hud-text-secondary">
				{groups.length} advisories{hasMore ? ' loaded' : ''}
			</p>
			{#if hasMore}
				<button
					type="button"
					class="border border-hud-border-control bg-hud-surface px-3 py-1.5 font-mono text-xs uppercase tracking-[0.14em] text-hud-text-secondary hover:text-hud-text disabled:opacity-50"
					disabled={loading}
					onclick={onLoadMore}
				>
					{loading ? 'Loading…' : 'Load more advisories'}
				</button>
			{:else}
				<span class="font-mono text-[11px] uppercase tracking-[0.14em] text-hud-text-muted">End of results</span>
			{/if}
		</div>
	{/if}
</div>

<style>
.findings-grid {
	min-width: 63rem;
}

/* A sticky header that covers the row the keyboard just moved to is WCAG 2.4.11 failure F110. */
.findings-scroll {
	scroll-padding-top: 2.25rem;
}

.findings-head {
	position: sticky;
	top: 0;
	z-index: 1;
}

.findings-row-layout {
	display: grid;
	grid-template-columns:
		7rem minmax(14rem, 1fr) minmax(10rem, 1.3fr) minmax(12rem, 1.5fr)
		4.5rem 5rem 4.5rem 6rem;
	align-items: center;
	height: 2.25rem;
}

/* Baseline 2024 stand-in for JS virtualization: keeps find-in-page, the a11y tree and tab order. */
.findings-row {
	content-visibility: auto;
	contain-intrinsic-size: auto 2.25rem;
}
</style>
