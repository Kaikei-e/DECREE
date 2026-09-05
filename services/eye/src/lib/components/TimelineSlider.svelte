<script lang="ts" module>
export function formatTimelineLabel(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}
</script>

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

const TRANSPORT_CLASS =
	'inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-hud-text-muted hover:text-hud-accent transition-colors disabled:opacity-30';

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
	return formatTimelineLabel(iso);
}

const valueText = $derived(
	timelineState.currentTime
		? formatTimelineLabel(timelineState.currentTime)
		: `Live, ${formatTimelineLabel(maxDate)}`,
);
</script>

<div
	role="group"
	aria-label="Timeline playback"
	class="hud-panel flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 backdrop-blur bg-hud-base/80"
>
	<div class="flex shrink-0 items-center gap-1.5">
		<button
			class={TRANSPORT_CLASS}
			onclick={() => timelineState.stepBackward()}
			disabled={isLive}
			aria-label="Step backward"
			title="Step back"
		>
			<SkipBack size={14} />
		</button>

		{#if isPlaying}
			<button
				class={TRANSPORT_CLASS}
				onclick={() => timelineState.pause()}
				aria-label="Pause replay"
				title="Pause"
			>
				<Pause size={14} />
			</button>
		{:else if timelineState.mode === 'paused'}
			<button
				class={TRANSPORT_CLASS}
				onclick={() => timelineState.resume()}
				aria-label="Resume replay"
				title="Resume"
			>
				<Play size={14} />
			</button>
		{:else}
			<button
				class={TRANSPORT_CLASS}
				onclick={() => timelineState.startReplay(minDate)}
				aria-label="Replay from the start"
				title="Replay"
			>
				<Play size={14} />
			</button>
		{/if}

		<button
			class={TRANSPORT_CLASS}
			onclick={() => timelineState.stepForward()}
			disabled={isLive}
			aria-label="Step forward"
			title="Step forward"
		>
			<SkipForward size={14} />
		</button>
	</div>

	<input
		type="range"
		min="0"
		max="1000"
		value={sliderValue()}
		oninput={onSliderInput}
		aria-label="Timeline position"
		aria-valuetext={valueText}
		class="min-w-32 flex-1"
	/>

	<div class="flex shrink-0 items-center gap-2">
		<!-- 120px holds the widest label the format produces (16 chars at 7.2px in JetBrains Mono 12px). -->
		<span class="min-w-30 whitespace-nowrap text-right font-mono text-xs text-hud-text-muted">
			{formatTime(timelineState.currentTime)}
		</span>

		<button
			class="inline-flex min-h-6 items-center gap-1 rounded-sm px-2 py-0.5 font-mono text-xs transition-colors {isLive ? 'hud-border-active bg-hud-accent/10 text-hud-accent hud-live-pulse' : 'bg-hud-surface text-hud-text-muted border border-hud-border-control hover:text-hud-accent'}"
			onclick={() => timelineState.goLive()}
			aria-pressed={isLive}
			title="Go live"
		>
			<Radio size={12} aria-hidden="true" />
			Live
		</button>
	</div>
</div>
