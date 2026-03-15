<script lang="ts">
import { ExternalLink, X } from 'lucide-svelte';
import { parseSeverity } from '$lib/graph/layout';
import type { FindingDetail } from '$lib/types/api';
import ScoreBreakdown from './ScoreBreakdown.svelte';
import SeverityBadge from './SeverityBadge.svelte';

interface Props {
	finding: FindingDetail | null;
	onClose: () => void;
}

const { finding, onClose }: Props = $props();
</script>

{#if finding}
	<div class="fixed inset-y-0 right-0 z-40 w-96 overflow-y-auto border-l border-hud-border bg-hud-void" style="box-shadow: inset 1px 0 8px rgba(0, 229, 255, 0.1);">
		<div class="flex items-center justify-between border-b border-hud-border px-4 py-3">
			<h2 class="hud-header text-sm">{finding.advisory_id}</h2>
			<button onclick={onClose} class="p-1 text-hud-text-muted hover:text-hud-accent transition-colors">
				<X size={16} />
			</button>
		</div>

		<div class="space-y-4 p-4">
			<div class="flex items-center gap-2">
				<SeverityBadge severity={parseSeverity(finding.severity)} />
				{#if finding.is_active}
					<span class="rounded-sm bg-hud-safe/15 px-2 py-0.5 text-xs text-hud-safe border border-hud-safe/30">Active</span>
				{:else}
					<span class="rounded-sm bg-hud-surface px-2 py-0.5 text-xs text-hud-text-muted border border-hud-border">Resolved</span>
				{/if}
			</div>

			<div class="text-sm text-hud-text">
				<div class="font-mono">{finding.package_name}@{finding.package_version}</div>
				<div class="mt-1 text-xs text-hud-text-muted">{finding.ecosystem} • {finding.target_name}</div>
			</div>

			{#if finding.decree_score != null}
				<ScoreBreakdown
					cvss={finding.cvss_score ?? 0}
					epss={finding.epss_score ?? 0}
					reachability={finding.reachability ?? 0}
					total={finding.decree_score}
				/>
			{/if}

			{#if finding.fix_versions.length > 0}
				<div>
					<h3 class="hud-header">Fix Versions</h3>
					<div class="mt-1 flex flex-wrap gap-1">
						{#each finding.fix_versions as ver}
							<span class="rounded-sm bg-hud-safe/15 px-2 py-0.5 text-xs text-hud-safe border border-hud-safe/30">{ver}</span>
						{/each}
					</div>
				</div>
			{/if}

			{#if finding.exploits.length > 0}
				<div>
					<h3 class="hud-header">Known Exploits</h3>
					<ul class="mt-1 space-y-1">
						{#each finding.exploits as exploit}
							<li class="text-xs text-hud-text-secondary">
								{#if exploit.url}
									<a href={exploit.url} target="_blank" rel="noopener" class="flex items-center gap-1 text-hud-accent hover:underline">
										{exploit.title ?? exploit.source_id}
										<ExternalLink size={10} />
									</a>
								{:else}
									{exploit.title ?? exploit.source_id}
								{/if}
								<span class="text-hud-text-muted">({exploit.source})</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if finding.dependency_path.length > 0}
				<div>
					<h3 class="hud-header">Dependency Path</h3>
					<div class="mt-1 space-y-0.5 font-mono text-xs text-hud-text-secondary">
						{#each finding.dependency_path as edge, i}
							<div class="flex items-center gap-1">
								{#if i === 0}
									<span>{edge.from_pkg}</span>
								{/if}
								<span class="text-hud-accent-dim">→</span>
								<span>{edge.to_pkg}</span>
								<span class="text-hud-text-muted">({edge.dep_type})</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if finding.cvss_vector}
				<div class="text-xs">
					<span class="text-hud-text-muted">CVSS Vector:</span>
					<span class="font-mono text-hud-text-secondary">{finding.cvss_vector}</span>
				</div>
			{/if}
		</div>
	</div>
{/if}
