<script lang="ts">
import { Folder } from 'lucide-svelte';

let { data } = $props();
</script>

<div class="mx-auto max-w-3xl px-4 py-8">
	<h1 class="hud-header text-base">Projects</h1>

	{#if data.projects.length === 0}
		<p class="mt-8 text-center text-hud-text-muted">No projects found. Configure targets in decree.yaml.</p>
	{:else}
		<ul class="mt-6 space-y-2">
			{#each data.projects as project}
				<li>
					<a
						href="/projects/{project.id}"
						class="hud-panel flex items-center gap-3 px-4 py-3 hover:border-hud-border-bright transition-colors"
					>
						<Folder size={20} class="text-hud-accent-dim" />
						<div>
							<div class="font-mono font-medium">{project.name}</div>
							<div class="font-mono text-xs text-hud-text-muted">
								Created {new Date(project.created_at).toLocaleDateString()}
							</div>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
