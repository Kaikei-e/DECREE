<script lang="ts">
import { AlertTriangle } from 'lucide-svelte';
import { page } from '$app/state';
</script>

<div class="flex min-h-[80vh] items-center justify-center">
	<div class="text-center">
		<AlertTriangle size={48} class="mx-auto text-hud-danger" />
		<h1 class="mt-4 text-2xl font-bold text-hud-text">{page.status}</h1>
		<p class="mt-2 text-hud-text-secondary">{page.error?.message ?? 'Something went wrong'}</p>
		<a href="/projects" class="mt-4 inline-block text-sm text-hud-accent hover:underline">
			Back to projects
		</a>
	</div>
</div>
