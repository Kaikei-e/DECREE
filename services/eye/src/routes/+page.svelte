<script lang="ts">
import { onMount } from 'svelte';
import { goto } from '$app/navigation';

onMount(() => {
	goto('/projects');
});
</script>

<div class="flex min-h-[80vh] items-center justify-center">
	<div class="text-center">
		<h1 class="font-mono text-4xl font-bold tracking-wider text-hud-accent">DECREE Eye</h1>
		<p class="mt-4 text-lg text-hud-text-secondary">
			Dynamic Realtime Exploit Classification &amp; Evaluation Engine
		</p>
		<p class="mt-2 text-sm text-hud-text-muted">Redirecting to projects...</p>
	</div>
</div>
