<script lang="ts">
import { Folder } from 'lucide-svelte';
import { SEVERITY_COLORS } from '$lib/graph/model';
import type { Facets } from '$lib/types/api';

let { data } = $props();

const LEVELS = [
	{ key: 'critical', label: 'Critical', color: SEVERITY_COLORS.CRITICAL },
	{ key: 'high', label: 'High', color: SEVERITY_COLORS.HIGH },
	{ key: 'medium', label: 'Medium', color: SEVERITY_COLORS.MEDIUM },
	{ key: 'low', label: 'Low', color: SEVERITY_COLORS.LOW },
	{ key: 'unknown', label: 'Unscored', color: SEVERITY_COLORS.UNKNOWN },
] as const;

function levels(facets: Facets) {
	return LEVELS.map((l) => ({ ...l, count: facets.severity_counts[l.key] ?? 0 })).filter(
		(l) => l.count > 0,
	);
}
</script>

<div class="mx-auto max-w-3xl px-4 py-8">
	<h1 class="hud-header text-base">Projects</h1>

	{#if data.projects.length === 0}
		<p class="mt-8 text-center text-hud-text-muted">No projects found. Configure targets in decree.yaml.</p>
	{:else}
		<ul class="mt-6 space-y-2">
			{#each data.projects as project (project.id)}
				{@const facets = data.facets[project.id]}
				<li>
					<a
						href="/projects/{project.id}"
						class="hud-panel flex items-start gap-3 px-4 py-3 transition-colors hover:border-hud-border-bright"
					>
						<Folder size={20} class="mt-0.5 text-hud-accent-dim" aria-hidden="true" />
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-baseline gap-x-3">
								<span class="font-mono font-medium">{project.name}</span>
								{#if facets}
									<span class="font-mono text-xs text-hud-text-secondary">
										{facets.total.toLocaleString()} active
									</span>
								{/if}
							</div>

							{#if facets}
								{#if facets.total === 0}
									<p class="mt-1.5 font-mono text-xs text-hud-safe">No findings</p>
								{:else}
									<ul class="mt-2 flex flex-wrap gap-x-3 gap-y-1">
										{#each levels(facets) as level (level.key)}
											<li
												class="flex items-center gap-1.5 font-mono text-xs text-hud-text-secondary"
												aria-label="{level.count} {level.label}"
											>
												<span
													class="h-2 w-2 shrink-0"
													aria-hidden="true"
													style="background-color: {level.color};"
												></span>
												<span class="text-hud-text">{level.count}</span>
												{level.label}
											</li>
										{/each}
									</ul>
								{/if}
							{/if}

							<div class="mt-1.5 font-mono text-xs text-hud-text-muted">
								Created {new Date(project.created_at).toLocaleDateString()}
							</div>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
