<script lang="ts">
interface Props {
	cvss: number;
	epss: number;
	reachability: number | null;
	total: number;
}

const { cvss, epss, reachability, total }: Props = $props();

// Each term of the DECREE Score tops out at a different value, so a shared
// denominator would make the EPSS bar overflow its track.
const CVSS_MAX_CONTRIB = 4.0;
const EPSS_MAX_CONTRIB = 3.5;
const REACH_MAX_CONTRIB = 2.5;

const rows = $derived([
	{
		key: 'cvss',
		label: 'CVSS × 40%',
		value: cvss * 0.4,
		max: CVSS_MAX_CONTRIB,
		bar: 'bg-hud-info',
	},
	{
		key: 'epss',
		label: 'EPSS × 35%',
		value: epss * 10 * 0.35,
		max: EPSS_MAX_CONTRIB,
		bar: 'bg-hud-warning',
	},
	{
		key: 'reach',
		label: 'Reachability × 25%',
		value: reachability === null ? null : reachability * 0.25,
		max: REACH_MAX_CONTRIB,
		bar: 'bg-hud-safe',
	},
]);
</script>

<div class="space-y-2">
	<div class="flex items-center justify-between text-sm">
		<span class="font-mono font-semibold text-hud-text-muted">DECREE Score</span>
		<span class="flex items-baseline gap-1 font-mono text-hud-accent">
			<span class="text-2xl font-bold">{total.toFixed(1)}</span>
			<span class="text-xs text-hud-text-muted">/ 10</span>
		</span>
	</div>

	<div class="space-y-1.5">
		{#each rows as row (row.key)}
			<div>
				<div class="flex items-baseline justify-between font-mono text-xs text-hud-text-muted">
					<span>{row.label}</span>
					{#if row.value === null}
						<span>NO DATA</span>
					{:else}
						<span class="flex items-baseline gap-1">
							<span class="text-hud-text-secondary">{row.value.toFixed(2)}</span>
							<span>/ {row.max.toFixed(2)}</span>
						</span>
					{/if}
				</div>
				<div class="h-2 overflow-hidden bg-hud-surface" data-track={row.key} aria-hidden="true">
					{#if row.value !== null}
						<div
							class="h-full {row.bar} hud-bar-glow"
							data-bar={row.key}
							style="width: {(row.value / row.max) * 100}%"
						></div>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	{#if reachability === null}
		<p class="font-mono text-[11px] leading-snug text-hud-text-muted">
			Reachability is unknown, so the components do not sum to the total.
		</p>
	{/if}
</div>
