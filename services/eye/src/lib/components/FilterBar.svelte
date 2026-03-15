<script lang="ts">
import { Box, Monitor } from 'lucide-svelte';
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
</script>

<div class="hud-panel flex flex-wrap items-center gap-3 px-4 py-2 backdrop-blur bg-hud-base/80">
	<select
		class="bg-hud-surface text-hud-text border border-hud-border rounded-sm px-2 py-1 font-mono text-xs"
		value={filters.severity ?? ''}
		onchange={setSeverity}
	>
		<option value="">All Severities</option>
		{#each severities as sev}
			<option value={sev}>{sev}</option>
		{/each}
	</select>

	<select
		class="bg-hud-surface text-hud-text border border-hud-border rounded-sm px-2 py-1 font-mono text-xs"
		value={filters.ecosystem ?? ''}
		onchange={setEcosystem}
	>
		<option value="">All Ecosystems</option>
		{#each ecosystems as eco}
			<option value={eco}>{eco}</option>
		{/each}
	</select>

	<label class="hud-header flex items-center gap-1.5">
		<span>Min EPSS</span>
		<input
			type="range"
			min="0"
			max="1"
			step="0.01"
			value={filters.minEpss ?? 0}
			oninput={setMinEpss}
			class="w-20"
		/>
		<span class="w-10 font-mono text-xs text-hud-text-muted">{((filters.minEpss ?? 0) * 100).toFixed(0)}%</span>
	</label>

	<button
		class="rounded-sm px-2 py-1 font-mono text-xs transition-colors {filters.activeOnly ? 'hud-border-active bg-hud-accent/10 text-hud-accent' : 'bg-hud-surface text-hud-text-muted border border-hud-border'}"
		onclick={toggleActiveOnly}
	>
		Active Only
	</button>

	<div class="ml-auto flex items-center gap-1 bg-hud-surface border border-hud-border p-0.5">
		<button
			class="p-1 transition-colors {rendererType === '3d' ? 'bg-hud-accent/20 text-hud-accent' : 'text-hud-text-muted hover:text-hud-accent'}"
			onclick={() => onRendererChange('3d')}
			title="3D View"
		>
			<Box size={16} />
		</button>
		<button
			class="p-1 transition-colors {rendererType === '2d' ? 'bg-hud-accent/20 text-hud-accent' : 'text-hud-text-muted hover:text-hud-accent'}"
			onclick={() => onRendererChange('2d')}
			title="2D View"
		>
			<Monitor size={16} />
		</button>
	</div>
</div>
