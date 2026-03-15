<script lang="ts">
import { AlertTriangle, Info, Shield, ShieldAlert, ShieldCheck } from 'lucide-svelte';
import { SEVERITY_COLORS, type Severity } from '$lib/graph/model';

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
	INFO: Info,
} as const;

const icon = $derived(iconMap[severity]);
const color = $derived(colorMap[severity]);
</script>

<span
	class="inline-flex items-center gap-1 rounded-sm px-2 py-0.5 font-mono text-xs font-medium uppercase tracking-wider"
	style="background-color: {color}15; color: {color}; border-left: 2px solid {color};"
>
	{#if icon}
		{@const Icon = icon}
		<Icon size={12} />
	{/if}
	{severity}
</span>
