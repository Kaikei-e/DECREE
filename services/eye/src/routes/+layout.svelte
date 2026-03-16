<script lang="ts">
import '../app.css';
import { Shield } from 'lucide-svelte';
import { navigating } from '$app/state';

let { children } = $props();
</script>

<div class="min-h-screen bg-hud-void text-hud-text font-sans">
	{#if navigating.to}
		<div class="fixed inset-x-0 top-0 z-50 h-0.5 bg-hud-accent animate-pulse"></div>
	{/if}
	<nav class="hud-panel hud-scanlines flex items-center gap-4 border-b border-hud-border px-4 py-2">
		<a href="/" class="flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-widest text-hud-accent">
			<Shield size={18} class="text-hud-accent" />
			DECREE Eye
		</a>
		<a href="/projects" class="text-sm text-hud-text-secondary hover:text-hud-accent transition-colors">Projects</a>
		<div class="ml-auto flex items-center gap-1.5">
			<span class="hud-live-pulse inline-block h-2 w-2 rounded-full bg-hud-safe"></span>
			<span class="font-mono text-xs text-hud-text-muted">LIVE</span>
		</div>
	</nav>
	<main>
		{@render children()}
	</main>
</div>
