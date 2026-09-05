<script lang="ts">
import { ArrowDown, ArrowRight, Keyboard, Maximize, ZoomIn, ZoomOut } from 'lucide-svelte';

interface Props {
	onZoomIn: () => void;
	onZoomOut: () => void;
	onResetView: () => void;
	onSetViewPreset: (preset: 'top' | 'front') => void;
	is3D: boolean;
}

const { onZoomIn, onZoomOut, onResetView, onSetViewPreset, is3D }: Props = $props();

const BUTTON_CLASS =
	'p-1.5 transition-colors text-hud-text-muted hover:text-hud-accent hover:bg-hud-accent/10 rounded-sm';

const legendId = $props.id();

let toolbarEl: HTMLElement | undefined = $state();
let activeIndex = $state(0);
let showLegend = $state(false);

const lastIndex = $derived(is3D ? 5 : 3);
const roving = $derived(Math.min(activeIndex, lastIndex));
const legendToggleLabel = $derived(
	showLegend ? 'Hide keyboard shortcuts' : 'Show keyboard shortcuts',
);

const legendRows = $derived(
	is3D
		? [
				{ keys: ['Drag'], action: 'Orbit' },
				{ keys: ['Shift', 'Drag'], action: 'Pan' },
				{ keys: ['Wheel'], action: 'Zoom' },
				{ keys: ['←', '→'], action: 'Strafe' },
				{ keys: ['↑', '↓'], action: 'Forward / back' },
				{ keys: ['Shift', '↑', '↓'], action: 'Up / down' },
				{ keys: ['=', '−'], action: 'Zoom' },
				{ keys: ['0'], action: 'Fit all' },
				{ keys: ['T', 'F'], action: 'Top / front' },
				{ keys: ['N', 'P'], action: 'Next / previous finding' },
				{ keys: ['Enter'], action: 'Open finding' },
			]
		: [
				{ keys: ['Drag'], action: 'Pan' },
				{ keys: ['Wheel'], action: 'Zoom' },
				{ keys: ['←', '→', '↑', '↓'], action: 'Pan' },
				{ keys: ['=', '−'], action: 'Zoom' },
				{ keys: ['0'], action: 'Fit all' },
				{ keys: ['N', 'P'], action: 'Next / previous finding' },
				{ keys: ['Enter'], action: 'Open finding' },
			],
);

function focusAt(index: number) {
	const buttons = toolbarEl ? [...toolbarEl.querySelectorAll('button')] : [];
	if (buttons.length === 0) return;
	const bounded = ((index % buttons.length) + buttons.length) % buttons.length;
	activeIndex = bounded;
	buttons[bounded]?.focus();
}

function moveFocus(delta: number) {
	const buttons = toolbarEl ? [...toolbarEl.querySelectorAll('button')] : [];
	const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
	focusAt((current < 0 ? roving : current) + delta);
}

function onToolbarKeydown(e: KeyboardEvent) {
	switch (e.key) {
		case 'ArrowDown':
		case 'ArrowRight':
			moveFocus(1);
			break;
		case 'ArrowUp':
		case 'ArrowLeft':
			moveFocus(-1);
			break;
		case 'Home':
			focusAt(0);
			break;
		case 'End':
			focusAt(lastIndex);
			break;
		default:
			return;
	}
	e.preventDefault();
}
</script>

<div class="relative">
	<div
		bind:this={toolbarEl}
		role="toolbar"
		aria-label="Camera controls"
		aria-orientation="vertical"
		tabindex={-1}
		onkeydown={onToolbarKeydown}
		class="hud-panel bg-hud-base/90 backdrop-blur p-1 flex flex-col gap-0.5"
	>
		<button
			class={BUTTON_CLASS}
			aria-label="Zoom in"
			title="Zoom In (=)"
			tabindex={roving === 0 ? 0 : -1}
			onclick={onZoomIn}
		>
			<ZoomIn size={16} />
		</button>
		<button
			class={BUTTON_CLASS}
			aria-label="Zoom out"
			title="Zoom Out (-)"
			tabindex={roving === 1 ? 0 : -1}
			onclick={onZoomOut}
		>
			<ZoomOut size={16} />
		</button>

		<div class="border-t border-hud-border my-0.5"></div>

		<button
			class={BUTTON_CLASS}
			aria-label="Fit all findings in view"
			title="Fit All (0)"
			tabindex={roving === 2 ? 0 : -1}
			onclick={onResetView}
		>
			<Maximize size={16} />
		</button>

		{#if is3D}
			<button
				class={BUTTON_CLASS}
				aria-label="Top view"
				title="Top View (T)"
				tabindex={roving === 3 ? 0 : -1}
				onclick={() => onSetViewPreset('top')}
			>
				<ArrowDown size={16} />
			</button>
			<button
				class={BUTTON_CLASS}
				aria-label="Front view"
				title="Front View (F)"
				tabindex={roving === 4 ? 0 : -1}
				onclick={() => onSetViewPreset('front')}
			>
				<ArrowRight size={16} />
			</button>
		{/if}

		<div class="border-t border-hud-border my-0.5"></div>

		<button
			class="{BUTTON_CLASS} {showLegend ? 'text-hud-accent bg-hud-accent/10' : ''}"
			aria-label={legendToggleLabel}
			title="Keyboard shortcuts"
			aria-expanded={showLegend}
			aria-controls={showLegend ? legendId : undefined}
			tabindex={roving === lastIndex ? 0 : -1}
			onclick={() => (showLegend = !showLegend)}
		>
			<Keyboard size={16} />
		</button>
	</div>

	{#if showLegend}
		<div
			id={legendId}
			role="group"
			aria-label="Keyboard shortcuts"
			class="absolute right-full top-0 mr-2 w-56 rounded-sm border border-hud-border-control bg-hud-base/95 p-2 backdrop-blur"
		>
			<dl class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
				{#each legendRows as row (row.keys.join('+') + row.action)}
					<dt class="flex flex-wrap items-center gap-1">
						{#each row.keys as key (key)}
							<kbd
								class="rounded-xs border border-hud-border-control bg-hud-surface px-1 font-mono text-[10px] text-hud-text"
							>{key}</kbd>
						{/each}
					</dt>
					<dd class="text-[11px] text-hud-text-secondary">{row.action}</dd>
				{/each}
			</dl>
		</div>
	{/if}
</div>
