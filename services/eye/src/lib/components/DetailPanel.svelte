<script lang="ts">
import { ArrowLeft, ExternalLink, Loader2, X } from 'lucide-svelte';
import { parseSeverity } from '$lib/graph/layout';
import type { AdvisoryGroup, Finding, FindingDetail } from '$lib/types/api';
import ScoreBreakdown from './ScoreBreakdown.svelte';
import SeverityBadge from './SeverityBadge.svelte';

interface Props {
	finding: FindingDetail | null;
	advisory: AdvisoryGroup | null;
	instances: Finding[];
	loading: boolean;
	error: string | null;
	/** True below the desktop breakpoint, where the panel covers the page instead of pushing it. */
	overlay: boolean;
	onSelectInstance: (instanceId: string) => void;
	onBack: () => void;
	onClose: () => void;
}

const {
	finding,
	advisory,
	instances,
	loading,
	error,
	overlay,
	onSelectInstance,
	onBack,
	onClose,
}: Props = $props();

const titleId = $props.id();

const open = $derived(!!finding || !!advisory);
const title = $derived(finding?.advisory_id ?? advisory?.advisory_id ?? '');
const showBack = $derived(!!finding && !!advisory);

const FOCUSABLE =
	'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

let panelEl: HTMLElement | undefined = $state();
let closeEl: HTMLButtonElement | undefined = $state();
let opener: HTMLElement | null = null;

$effect(() => {
	if (!open) {
		opener = null;
		return;
	}
	const active = document.activeElement;
	opener ??= active instanceof HTMLElement && active !== document.body ? active : null;
});

// An overlay hides what is behind it, so focus has to follow the panel onto the screen.
$effect(() => {
	if (open && overlay) closeEl?.focus();
});

// Bound to the panel rather than the window: a global Escape handler would also
// swallow Escape meant for a filter select or the tooltip elsewhere on the page.
$effect(() => {
	const el = panelEl;
	if (!el) return;

	const onKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			close();
			return;
		}
		if (e.key === 'Tab' && overlay) trapTab(e, el);
	};

	el.addEventListener('keydown', onKeydown);
	return () => el.removeEventListener('keydown', onKeydown);
});

/** aria-modal claims the rest of the page is unreachable, so Tab has to make that true. */
function trapTab(e: KeyboardEvent, el: HTMLElement) {
	const focusables = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
	const first = focusables[0];
	const last = focusables[focusables.length - 1];
	if (!first || !last) return;

	if (e.shiftKey && document.activeElement === first) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && document.activeElement === last) {
		e.preventDefault();
		first.focus();
	}
}

function close() {
	const returnTo = opener;
	const focusWasInside = !!panelEl && panelEl.contains(document.activeElement);
	onClose();
	if (focusWasInside && returnTo?.isConnected) returnTo.focus();
}

function formatPurl(purl: string): string {
	return decodeURIComponent(purl.replace(/^pkg:[^/]+\//, '').replace(/\?.*$/, ''));
}

function formatScore(value: number | undefined): string {
	return value == null ? '—' : value.toFixed(1);
}

function formatEpss(value: number | undefined): string {
	if (value == null) return '—';
	const percent = value * 100;
	return `${percent >= 1 ? percent.toFixed(1) : percent.toFixed(2)}%`;
}

function reachCopy(group: AdvisoryGroup): string {
	const instanceWord = group.instance_count === 1 ? 'instance' : 'instances';
	const targetWord = group.target_count === 1 ? 'target' : 'targets';
	return `${group.instance_count} ${instanceWord} across ${group.target_count} ${targetWord}`;
}

function rangeStatusCopy(status?: string): string {
	switch (status) {
		case 'supports_match':
			return 'OSV affected range supports this match.';
		case 'contradicts_match':
			return 'OSV range metadata disagrees with this version, but DECREE keeps the finding because source lag or metadata drift is possible.';
		default:
			return 'DECREE could not conclusively evaluate the advisory range metadata for this package version.';
	}
}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -- the overlay genuinely covers the page, so dialog semantics are correct there and wrong for the push column -->
	<section
		bind:this={panelEl}
		role={overlay ? 'dialog' : undefined}
		aria-modal={overlay ? 'true' : undefined}
		aria-labelledby={titleId}
		class="flex min-h-0 flex-col border-hud-border bg-hud-void {overlay
			? 'fixed inset-y-0 right-0 z-40 w-96 max-w-full border-l'
			: 'hud-panel h-full'}"
	>
		<div class="flex flex-shrink-0 items-center justify-between gap-2 border-b border-hud-border px-4 py-3">
			<h2 id={titleId} class="hud-header truncate text-sm">{title}</h2>
			<button
				bind:this={closeEl}
				onclick={close}
				aria-label="Close finding details"
				title="Close finding details"
				class="p-1 text-hud-text-muted transition-colors hover:text-hud-accent"
			>
				<X size={16} aria-hidden="true" />
			</button>
		</div>

		{#if showBack && advisory}
			<div class="flex-shrink-0 border-b border-hud-border px-4 py-2">
				<button
					onclick={onBack}
					class="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-hud-text-secondary transition-colors hover:text-hud-accent"
				>
					<ArrowLeft size={12} aria-hidden="true" /> Back to {advisory.advisory_id}
				</button>
			</div>
		{/if}

		{#if error}
			<p role="alert" class="flex-shrink-0 border-b border-hud-danger/40 bg-hud-danger/10 px-4 py-3 text-sm text-hud-text">
				{error}
			</p>
		{/if}

		{#if finding}
			<div class="flex-shrink-0 space-y-4 border-b border-hud-border p-4">
				<div class="flex items-center gap-2">
					<SeverityBadge severity={parseSeverity(finding.severity)} />
					{#if finding.is_active}
						<span class="rounded-sm border border-hud-safe/30 bg-hud-safe/15 px-2 py-0.5 text-xs text-hud-safe">Active</span>
					{:else}
						<span class="rounded-sm border border-hud-border bg-hud-surface px-2 py-0.5 text-xs text-hud-text-muted">Resolved</span>
					{/if}
				</div>

				<div class="text-sm text-hud-text">
					<div class="font-mono break-all">{finding.package_name}@{finding.package_version}</div>
					<div class="mt-1 text-xs text-hud-text-muted">{finding.ecosystem} • {finding.target_name}</div>
				</div>

				{#if finding.detection_evidence?.summary}
					<div class="rounded-sm border border-hud-border bg-hud-surface/70 px-3 py-2 text-sm leading-6 text-hud-text">
						{finding.detection_evidence.summary}
					</div>
				{/if}

				{#if finding.detection_evidence}
					<div class="rounded-sm border border-hud-border bg-hud-surface/40 px-3 py-2 text-xs text-hud-text-secondary">
						<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
							<div>
								<span class="text-hud-text-muted">Source:</span>
								<span class="ml-1 font-mono text-hud-text">{finding.detection_evidence.source}</span>
							</div>
							{#if finding.detection_evidence.fetched_at}
								<div>
									<span class="text-hud-text-muted">Fetched:</span>
									<span class="ml-1 text-hud-text">{new Date(finding.detection_evidence.fetched_at).toLocaleString()}</span>
								</div>
							{/if}
						</div>
						<div class="mt-2 text-hud-text">{rangeStatusCopy(finding.detection_evidence.range_evaluation_status)}</div>
						{#if finding.detection_evidence.aliases.length > 0}
							<div class="mt-2 flex flex-wrap gap-1">
								{#each finding.detection_evidence.aliases as alias (alias)}
									<span class="rounded-sm border border-hud-border bg-hud-void px-2 py-0.5 font-mono text-[11px] text-hud-text-muted">{alias}</span>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				{#if finding.decree_score != null}
					<ScoreBreakdown
						cvss={finding.cvss_score ?? 0}
						epss={finding.epss_score ?? 0}
						reachability={finding.reachability ?? null}
						total={finding.decree_score}
					/>
				{/if}

				{#if finding.fix_versions.length > 0}
					<div>
						<h3 class="hud-header">Fix Versions</h3>
						<div class="mt-1 flex flex-wrap gap-1">
							{#each finding.fix_versions as ver (ver)}
								<span class="rounded-sm border border-hud-safe/30 bg-hud-safe/15 px-2 py-0.5 text-xs text-hud-safe">{ver}</span>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
				{#if finding.exploits.length > 0}
					<div>
						<h3 class="hud-header">Known Exploits</h3>
						<ul class="mt-1 space-y-1">
							{#each finding.exploits as exploit (`${exploit.source}:${exploit.source_id}`)}
								<li class="text-xs text-hud-text-secondary">
									{#if exploit.url}
										<a href={exploit.url} target="_blank" rel="noopener" class="flex items-center gap-1 text-hud-accent hover:underline">
											{exploit.title ?? exploit.source_id}
											<ExternalLink size={10} aria-hidden="true" />
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
							{#each finding.dependency_path as edge, i (`${i}:${edge.from_pkg}>${edge.to_pkg}`)}
								<div class="flex flex-wrap items-center gap-1">
									{#if i === 0}
										<span>{formatPurl(edge.from_pkg)}</span>
									{/if}
									<span class="text-hud-accent-dim" aria-hidden="true">→</span>
									<span>{formatPurl(edge.to_pkg)}</span>
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
		{:else if advisory}
			<div class="flex-shrink-0 space-y-4 border-b border-hud-border p-4">
				<div class="flex items-center gap-2">
					<SeverityBadge severity={parseSeverity(advisory.severity)} />
					{#if advisory.is_active}
						<span class="rounded-sm border border-hud-safe/30 bg-hud-safe/15 px-2 py-0.5 text-xs text-hud-safe">Active</span>
					{:else}
						<span class="rounded-sm border border-hud-border bg-hud-surface px-2 py-0.5 text-xs text-hud-text-muted">Resolved</span>
					{/if}
				</div>

				<dl class="grid grid-cols-3 gap-2 text-center">
					<div class="rounded-sm border border-hud-border bg-hud-surface/60 px-2 py-2">
						<dt class="hud-header">DECREE</dt>
						<dd class="mt-1 font-mono text-lg text-hud-accent">{formatScore(advisory.max_decree_score)}</dd>
					</div>
					<div class="rounded-sm border border-hud-border bg-hud-surface/60 px-2 py-2">
						<dt class="hud-header">EPSS</dt>
						<dd class="mt-1 font-mono text-lg text-hud-text">{formatEpss(advisory.epss_score)}</dd>
					</div>
					<div class="rounded-sm border border-hud-border bg-hud-surface/60 px-2 py-2">
						<dt class="hud-header">CVSS</dt>
						<dd class="mt-1 font-mono text-lg text-hud-text">{formatScore(advisory.cvss_score)}</dd>
					</div>
				</dl>

				<p class="text-sm text-hud-text">{reachCopy(advisory)}</p>

				<div>
					<h3 class="hud-header">Packages</h3>
					<div class="mt-1 flex flex-wrap gap-1">
						{#each advisory.package_names as name (name)}
							<span class="rounded-sm border border-hud-border bg-hud-surface px-2 py-0.5 font-mono text-[11px] break-all text-hud-text">{name}</span>
						{/each}
						{#each advisory.ecosystems as eco (eco)}
							<span class="rounded-sm border border-hud-border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-hud-text-muted">{eco}</span>
						{/each}
					</div>
				</div>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto">
				<h3 class="hud-header sticky top-0 border-b border-hud-border bg-hud-void px-4 py-2">Instances</h3>
				{#if loading}
					<p role="status" class="flex items-center gap-2 px-4 py-4 font-mono text-sm text-hud-text-secondary">
						<Loader2 size={14} aria-hidden="true" class="hud-live-pulse" />
						Loading instances…
					</p>
				{:else if instances.length === 0}
					<p class="px-4 py-4 font-mono text-sm text-hud-text-secondary">No instances returned for this advisory.</p>
				{:else}
					<ul>
						{#each instances as instance (instance.instance_id)}
							<li class="border-b border-hud-border/60 last:border-b-0">
								<button
									class="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hud-accent/5"
									onclick={() => onSelectInstance(instance.instance_id)}
								>
									<div class="min-w-0 flex-1">
										<div class="truncate font-mono text-xs text-hud-text">{instance.package_name}@{instance.package_version}</div>
										<div class="mt-0.5 truncate text-xs text-hud-text-secondary">{instance.target_name}</div>
									</div>
									<span class="shrink-0 font-mono text-sm text-hud-accent">{formatScore(instance.decree_score)}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</section>
{/if}
