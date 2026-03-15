<script lang="ts">
interface Props {
	cvss: number;
	epss: number;
	reachability: number;
	total: number;
}

const { cvss, epss, reachability, total }: Props = $props();

const cvssContrib = $derived(cvss * 0.4);
const epssContrib = $derived(epss * 100 * 0.35);
const reachContrib = $derived(reachability * 0.25);
const maxScore = 10;
</script>

<div class="space-y-2">
	<div class="flex items-center justify-between text-sm">
		<span class="font-mono font-semibold text-hud-text-muted">DECREE Score</span>
		<span class="font-mono text-2xl font-bold text-hud-accent">{total.toFixed(1)}</span>
	</div>

	<div class="space-y-1.5">
		<div>
			<div class="flex justify-between font-mono text-xs text-hud-text-muted">
				<span>CVSS × 40%</span>
				<span>{cvssContrib.toFixed(2)}</span>
			</div>
			<div class="h-2 bg-hud-surface">
				<div
					class="h-full bg-hud-info hud-bar-glow"
					style="width: {(cvssContrib / maxScore) * 100}%"
				></div>
			</div>
		</div>

		<div>
			<div class="flex justify-between font-mono text-xs text-hud-text-muted">
				<span>EPSS × 35%</span>
				<span>{epssContrib.toFixed(2)}</span>
			</div>
			<div class="h-2 bg-hud-surface">
				<div
					class="h-full bg-hud-warning hud-bar-glow"
					style="width: {(epssContrib / maxScore) * 100}%"
				></div>
			</div>
		</div>

		<div>
			<div class="flex justify-between font-mono text-xs text-hud-text-muted">
				<span>Reachability × 25%</span>
				<span>{reachContrib.toFixed(2)}</span>
			</div>
			<div class="h-2 bg-hud-surface">
				<div
					class="h-full bg-hud-safe hud-bar-glow"
					style="width: {(reachContrib / maxScore) * 100}%"
				></div>
			</div>
		</div>
	</div>
</div>
