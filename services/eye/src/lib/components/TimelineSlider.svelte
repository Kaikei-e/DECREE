<script lang="ts">
import { Pause, Play, Radio, SkipBack, SkipForward } from 'lucide-svelte';
import { timelineState } from '$lib/state/timeline.svelte';

interface Props {
	minDate: string;
	maxDate: string;
}

const { minDate, maxDate }: Props = $props();

const isLive = $derived(timelineState.mode === 'live');
const isPlaying = $derived(timelineState.mode === 'replaying');

function onSliderInput(e: Event) {
	const value = Number.parseInt((e.target as HTMLInputElement).value, 10);
	const min = new Date(minDate).getTime();
	const max = new Date(maxDate).getTime();
	const time = new Date(min + (max - min) * (value / 1000)).toISOString();
	timelineState.startReplay(time);
}

function sliderValue(): number {
	if (!timelineState.currentTime) return 1000;
	const min = new Date(minDate).getTime();
	const max = new Date(maxDate).getTime();
	const cur = new Date(timelineState.currentTime).getTime();
	if (max === min) return 500;
	return Math.round(((cur - min) / (max - min)) * 1000);
}

function formatTime(iso: string | null): string {
	if (!iso) return 'Live';
	const d = new Date(iso);
	return d.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}
</script>

<div class="hud-panel flex items-center gap-2 px-3 py-2 backdrop-blur bg-hud-base/80">
	<button
		class="p-1 text-hud-text-muted hover:text-hud-accent transition-colors disabled:opacity-30"
		onclick={() => timelineState.stepBackward()}
		disabled={isLive}
		title="Step back"
	>
		<SkipBack size={14} />
	</button>

	{#if isPlaying}
		<button
			class="p-1 text-hud-text-muted hover:text-hud-accent transition-colors"
			onclick={() => timelineState.pause()}
			title="Pause"
		>
			<Pause size={14} />
		</button>
	{:else if timelineState.mode === 'paused'}
		<button
			class="p-1 text-hud-text-muted hover:text-hud-accent transition-colors"
			onclick={() => timelineState.resume()}
			title="Resume"
		>
			<Play size={14} />
		</button>
	{:else}
		<button
			class="p-1 text-hud-text-muted hover:text-hud-accent transition-colors"
			onclick={() => timelineState.startReplay(minDate)}
			title="Replay"
		>
			<Play size={14} />
		</button>
	{/if}

	<button
		class="p-1 text-hud-text-muted hover:text-hud-accent transition-colors disabled:opacity-30"
		onclick={() => timelineState.stepForward()}
		disabled={isLive}
		title="Step forward"
	>
		<SkipForward size={14} />
	</button>

	<input
		type="range"
		min="0"
		max="1000"
		value={sliderValue()}
		oninput={onSliderInput}
		class="mx-2 flex-1"
	/>

	<span class="w-28 text-right font-mono text-xs text-hud-text-muted">
		{formatTime(timelineState.currentTime)}
	</span>

	<button
		class="rounded-sm px-2 py-0.5 font-mono text-xs transition-colors {isLive ? 'hud-border-active bg-hud-accent/10 text-hud-accent hud-live-pulse' : 'bg-hud-surface text-hud-text-muted border border-hud-border hover:text-hud-accent'}"
		onclick={() => timelineState.goLive()}
		title="Go live"
	>
		<span class="flex items-center gap-1">
			<Radio size={12} />
			Live
		</span>
	</button>
</div>
