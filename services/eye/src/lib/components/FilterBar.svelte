<script lang="ts">
import { Box, Monitor, RotateCcw } from 'lucide-svelte';
import type { FindingFilters, RendererType } from '$lib/state/app.svelte';

interface Props {
	filters: FindingFilters;
	rendererType: RendererType;
	ecosystems: string[];
	onFiltersChange: (filters: FindingFilters) => void;
	onRendererChange: (type: RendererType) => void;
}

const { filters, rendererType, ecosystems, onFiltersChange, onRendererChange }: Props = $props();

const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

function setSeverity(e: Event) {
	const value = (e.target as HTMLSelectElement).value || undefined;
	onFiltersChange({ ...filters, severity: value });
}

function setEcosystem(e: Event) {
	const value = (e.target as HTMLSelectElement).value || undefined;
	onFiltersChange({ ...filters, ecosystem: value });
}

function setMinEpss(e: Event) {
	const value = Number.parseFloat((e.target as HTMLInputElement).value);
	onFiltersChange({ ...filters, minEpss: value > 0 ? value : undefined });
}

function toggleActiveOnly() {
	onFiltersChange({ ...filters, activeOnly: !filters.activeOnly });
}

function resetFilters() {
	onFiltersChange({ activeOnly: true });
}
</script>

<div class="hud-panel flex flex-col gap-4 bg-hud-base/85 px-4 py-3 backdrop-blur xl:flex-row xl:items-center xl:justify-between">
	<div class="space-y-1">
		<p class="hud-header">Viewport Controls</p>
		<p class="text-sm text-hud-text-secondary">
			Filter what enters the scene, then switch between spatial inspection and flat comparison.
		</p>
	</div>

	<div class="flex flex-1 flex-wrap items-center gap-3 xl:justify-end">
		<label class="space-y-1 text-xs text-hud-text-secondary">
			<span class="hud-header">Severity</span>
			<select
				class="min-w-32 rounded-sm border border-hud-border bg-hud-surface px-2 py-2 font-mono text-xs text-hud-text"
				value={filters.severity ?? ''}
				onchange={setSeverity}
			>
				<option value="">All severities</option>
				{#each severities as sev}
					<option value={sev}>{sev}</option>
				{/each}
			</select>
		</label>

		<label class="space-y-1 text-xs text-hud-text-secondary">
			<span class="hud-header">Ecosystem</span>
			<select
				class="min-w-32 rounded-sm border border-hud-border bg-hud-surface px-2 py-2 font-mono text-xs text-hud-text"
				value={filters.ecosystem ?? ''}
				onchange={setEcosystem}
			>
				<option value="">All ecosystems</option>
				{#each ecosystems as eco}
					<option value={eco}>{eco}</option>
				{/each}
			</select>
		</label>

		<label class="min-w-56 space-y-1 text-xs text-hud-text-secondary">
			<span class="hud-header">Minimum EPSS</span>
			<div class="flex items-center gap-3 rounded-sm border border-hud-border bg-hud-surface px-3 py-2">
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={filters.minEpss ?? 0}
					oninput={setMinEpss}
					class="flex-1"
				/>
				<span class="w-10 text-right font-mono text-xs text-hud-text">{((filters.minEpss ?? 0) * 100).toFixed(0)}%</span>
			</div>
		</label>

		<button
			class="rounded-sm border px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] transition-colors {filters.activeOnly ? 'hud-border-active bg-hud-accent/10 text-hud-accent' : 'border-hud-border bg-hud-surface text-hud-text-secondary hover:text-hud-text'}"
			onclick={toggleActiveOnly}
		>
			Active Only
		</button>

		<button
			class="inline-flex items-center gap-2 rounded-sm border border-hud-border bg-hud-surface px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-hud-text-secondary transition-colors hover:text-hud-text"
			onclick={resetFilters}
			title="Reset filters"
		>
			<RotateCcw size={14} /> Reset
		</button>

		<div class="flex items-center gap-1 rounded-sm border border-hud-border bg-hud-surface p-1">
			<button
				class="inline-flex items-center gap-2 rounded-sm px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] transition-colors {rendererType === '3d' ? 'bg-hud-accent/15 text-hud-accent' : 'text-hud-text-secondary hover:text-hud-text'}"
				onclick={() => onRendererChange('3d')}
				title="3D spatial view"
			>
				<Box size={16} /> 3D Spatial
			</button>
			<button
				class="inline-flex items-center gap-2 rounded-sm px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] transition-colors {rendererType === '2d' ? 'bg-hud-accent/15 text-hud-accent' : 'text-hud-text-secondary hover:text-hud-text'}"
				onclick={() => onRendererChange('2d')}
				title="2D comparison view"
			>
				<Monitor size={16} /> 2D Compare
			</button>
		</div>
	</div>
</div>