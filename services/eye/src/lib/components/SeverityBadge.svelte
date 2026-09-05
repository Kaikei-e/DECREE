<script lang="ts">
import { AlertTriangle, CircleHelp, Shield, ShieldAlert, ShieldCheck } from 'lucide-svelte';
import {
	SEVERITY_COLORS,
	SEVERITY_NOTCH_MAX,
	SEVERITY_NOTCHES,
	type Severity,
} from '$lib/graph/model';

interface Props {
	severity: Severity;
}

const { severity }: Props = $props();

const colorMap = SEVERITY_COLORS;

const iconMap = {
	CRITICAL: ShieldAlert,
	HIGH: AlertTriangle,
	MEDIUM: Shield,
	LOW: ShieldCheck,
	UNKNOWN: CircleHelp,
} as const;

const icon = $derived(iconMap[severity]);
const color = $derived(colorMap[severity]);
// A four-slot rail with nothing filled reads as "level zero", so unscored findings get
// their own glyph rather than looking like the safest thing on screen.
const isUnknown = $derived(severity === 'UNKNOWN');
// Bottom-up so the rail reads as a level meter: index 0 is the lowest slot.
const notches = $derived(
	Array.from({ length: SEVERITY_NOTCH_MAX }, (_, i) => i < SEVERITY_NOTCHES[severity]),
);
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-xs font-medium uppercase tracking-wider"
	style="background-color: {color}15; color: {color};"
>
	{#if isUnknown}
		<span
			class="h-[9px] w-[9px] rotate-45"
			data-unknown-marker
			aria-hidden="true"
			style="box-shadow: inset 0 0 0 1px {color};"
		></span>
	{:else}
		<span class="flex flex-col-reverse gap-px" data-notch-rail aria-hidden="true">
			{#each notches as filled}
				<span
					class="h-[3px] w-[3px]"
					data-notch={filled ? 'filled' : 'empty'}
					style={filled
						? `background-color: ${color};`
						: `box-shadow: inset 0 0 0 1px ${color}59;`}
				></span>
			{/each}
		</span>
	{/if}
	{#if icon}
		{@const Icon = icon}
		<Icon size={12} />
	{/if}
	{severity}
</span>
