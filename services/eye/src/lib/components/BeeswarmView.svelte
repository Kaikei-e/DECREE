<script lang="ts" module>
import {
	type BeeswarmPoint,
	type BeeswarmSummary,
	buildPoints,
	computeGeometry,
	describePlot,
	epssTicks,
	epssToX,
	findNearestPoint,
	HIGH_RISK_EPSS,
	HIGH_RISK_SCORE,
	LANE_WIDTH,
	PLOT_MARGIN,
	type PlotGeometry,
	packPoints,
	plotLabel,
	scoreTicks,
	scoreToY,
	summarize,
} from '$lib/graph/beeswarm';
import { SEVERITY_COLORS, type Severity } from '$lib/graph/model';
import type { Finding } from '$lib/types/api';

export const MARK_RADIUS = 4;
/** A little larger than the mark so a near miss still selects rather than doing nothing. */
export const HIT_RADIUS = 8;
export const SELECTION_COLOR = '#00e5ff';
export const SELECTION_RING_GAP = 4;

// Literal HUD values rather than getComputedStyle: Tailwind v4 tree-shakes unreferenced @theme
// tokens, and Canvas2DRenderer already pins the same palette this way.
const BACKGROUND = '#050a0e';
const GRID_COLOR = 'rgba(0, 229, 255, 0.07)';
const AXIS_COLOR = '#2a4a6a';
const LABEL_COLOR = '#7a9ab5';
const MUTED_COLOR = '#66879f';
const BAND_FILL = 'rgba(26, 42, 58, 0.55)';
const BREAK_COLOR = '#4a7397';
const HIGH_RISK_FILL = 'rgba(255, 23, 68, 0.07)';
const HIGH_RISK_STROKE = 'rgba(255, 23, 68, 0.32)';
const HOVER_COLOR = '#00e5ff';

const AXIS_FONT = '10px monospace';
const TAU = Math.PI * 2;
const LEGEND_LEVELS: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

function isHollow(point: BeeswarmPoint): boolean {
	return point.score === null || point.severity === 'UNKNOWN';
}

function drawHighRiskZone(ctx: CanvasRenderingContext2D, geo: PlotGeometry) {
	const left = epssToX(HIGH_RISK_EPSS, geo);
	const bottom = scoreToY(HIGH_RISK_SCORE, geo);

	ctx.fillStyle = HIGH_RISK_FILL;
	ctx.fillRect(left, geo.plotTop, geo.plotRight - left, bottom - geo.plotTop);

	ctx.strokeStyle = HIGH_RISK_STROKE;
	ctx.lineWidth = 1;
	ctx.setLineDash([3, 4]);
	ctx.beginPath();
	ctx.moveTo(left, geo.plotTop);
	ctx.lineTo(left, bottom);
	ctx.lineTo(geo.plotRight, bottom);
	ctx.stroke();
	ctx.setLineDash([]);

	ctx.font = AXIS_FONT;
	ctx.fillStyle = HIGH_RISK_STROKE;
	ctx.textAlign = 'right';
	ctx.textBaseline = 'top';
	ctx.fillText('HIGH RISK', geo.plotRight - 6, geo.plotTop + 4);
}

function drawGrid(ctx: CanvasRenderingContext2D, geo: PlotGeometry) {
	ctx.strokeStyle = GRID_COLOR;
	ctx.lineWidth = 1;

	for (const tick of scoreTicks()) {
		const y = scoreToY(tick.value, geo);
		ctx.beginPath();
		ctx.moveTo(geo.plotLeft, y);
		ctx.lineTo(geo.plotRight, y);
		ctx.stroke();
	}

	// Carried through the gutter as well, because the unscored band shares the same EPSS scale.
	for (const tick of epssTicks()) {
		const x = epssToX(tick.value, geo);
		ctx.beginPath();
		ctx.moveTo(x, geo.plotTop);
		ctx.lineTo(x, geo.gutterBottom);
		ctx.stroke();
	}
}

function drawLaneBand(ctx: CanvasRenderingContext2D, geo: PlotGeometry, x: number) {
	ctx.fillStyle = BAND_FILL;
	ctx.fillRect(x - LANE_WIDTH / 2, geo.plotTop, LANE_WIDTH, geo.gutterBottom - geo.plotTop);
}

/** Drawn over the marks: a lane is narrow enough that a few points would otherwise hide its count. */
function drawLaneLabel(ctx: CanvasRenderingContext2D, geo: PlotGeometry, x: number, text: string) {
	ctx.save();
	ctx.translate(x, geo.plotBottom - 6);
	ctx.rotate(-Math.PI / 2);
	ctx.font = AXIS_FONT;
	ctx.fillStyle = LABEL_COLOR;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	ctx.fillText(text, 0, 0);
	ctx.restore();
}

function drawLaneLabels(
	ctx: CanvasRenderingContext2D,
	geo: PlotGeometry,
	summary: BeeswarmSummary,
) {
	drawLaneLabel(ctx, geo, geo.missingLaneX, `EPSS n/a · ${summary.epssMissing}`);
	drawLaneLabel(ctx, geo, geo.zeroLaneX, `EPSS 0 · ${summary.epssZero}`);
}

function drawBands(ctx: CanvasRenderingContext2D, geo: PlotGeometry, summary: BeeswarmSummary) {
	drawLaneBand(ctx, geo, geo.missingLaneX);
	drawLaneBand(ctx, geo, geo.zeroLaneX);

	ctx.fillStyle = BAND_FILL;
	ctx.fillRect(
		PLOT_MARGIN.left,
		geo.gutterTop,
		geo.plotRight - PLOT_MARGIN.left,
		geo.gutterBottom - geo.gutterTop,
	);

	ctx.strokeStyle = BREAK_COLOR;
	ctx.lineWidth = 1;
	ctx.setLineDash([2, 5]);

	ctx.beginPath();
	ctx.moveTo(geo.laneDividerX, geo.plotTop);
	ctx.lineTo(geo.laneDividerX, geo.gutterBottom);
	ctx.stroke();

	// The axis break sits directly under the zero line, leaving the gap for the band's own label.
	const breakY = geo.plotBottom + 5;
	ctx.beginPath();
	ctx.moveTo(PLOT_MARGIN.left, breakY);
	ctx.lineTo(geo.plotRight, breakY);
	ctx.stroke();
	ctx.setLineDash([]);

	ctx.font = AXIS_FONT;
	ctx.fillStyle = MUTED_COLOR;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'bottom';
	ctx.fillText(`NO DECREE SCORE · ${summary.unscored}`, PLOT_MARGIN.left, geo.gutterTop - 4);
}

function drawAxes(ctx: CanvasRenderingContext2D, geo: PlotGeometry) {
	ctx.strokeStyle = AXIS_COLOR;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(geo.plotLeft, geo.plotTop);
	ctx.lineTo(geo.plotLeft, geo.plotBottom);
	ctx.lineTo(geo.plotRight, geo.plotBottom);
	ctx.stroke();

	ctx.font = AXIS_FONT;
	ctx.fillStyle = LABEL_COLOR;

	// Left of the lane bands, not next to the axis, or they would sit on top of the EPSS lanes.
	ctx.textAlign = 'right';
	ctx.textBaseline = 'middle';
	for (const tick of scoreTicks()) {
		const y = scoreToY(tick.value, geo);
		ctx.fillText(tick.label, PLOT_MARGIN.left - 8, y);
		ctx.beginPath();
		ctx.moveTo(geo.plotLeft - 4, y);
		ctx.lineTo(geo.plotLeft, y);
		ctx.stroke();
	}

	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';
	for (const tick of epssTicks()) {
		ctx.fillText(tick.label, epssToX(tick.value, geo), geo.gutterBottom + 6);
	}

	ctx.fillStyle = MUTED_COLOR;
	ctx.fillText(
		'EPSS - PROBABILITY OF EXPLOITATION IN 30 DAYS (LOG)',
		(geo.plotLeft + geo.plotRight) / 2,
		geo.gutterBottom + 20,
	);

	ctx.save();
	ctx.translate(12, (geo.plotTop + geo.plotBottom) / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';
	ctx.fillText('DECREE SCORE (0-10)', 0, 0);
	ctx.restore();
}

function drawMarks(
	ctx: CanvasRenderingContext2D,
	marks: readonly BeeswarmPoint[],
	selectedId: string | null,
	hoveredId: string | null,
) {
	ctx.globalAlpha = 0.88;
	ctx.lineWidth = 1.5;

	for (const mark of marks) {
		const color = SEVERITY_COLORS[mark.severity];
		ctx.fillStyle = color;
		ctx.strokeStyle = color;
		ctx.beginPath();
		ctx.arc(mark.x, mark.y, MARK_RADIUS, 0, TAU);
		if (isHollow(mark)) ctx.stroke();
		else ctx.fill();
	}
	ctx.globalAlpha = 1;

	const hovered = marks.find((mark) => mark.id === hoveredId);
	if (hovered) {
		ctx.strokeStyle = HOVER_COLOR;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(hovered.x, hovered.y, MARK_RADIUS + 2, 0, TAU);
		ctx.stroke();
	}

	const selected = marks.find((mark) => mark.id === selectedId);
	if (!selected) return;

	ctx.strokeStyle = SELECTION_COLOR;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(selected.x, selected.y, MARK_RADIUS + SELECTION_RING_GAP, 0, TAU);
	ctx.stroke();

	// Crosshair ticks: the selection has to survive a greyscale print and a red/green deficiency.
	const inner = MARK_RADIUS + SELECTION_RING_GAP + 3;
	const outer = inner + 5;
	ctx.lineWidth = 1.5;
	for (const [dx, dy] of [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	]) {
		ctx.beginPath();
		ctx.moveTo(selected.x + (dx ?? 0) * inner, selected.y + (dy ?? 0) * inner);
		ctx.lineTo(selected.x + (dx ?? 0) * outer, selected.y + (dy ?? 0) * outer);
		ctx.stroke();
	}
}
</script>

<script lang="ts">
interface Props {
	findings: Finding[];
	selectedId: string | null;
	onSelect: (instanceId: string) => void;
	onHover: (instanceId: string | null, position?: { x: number; y: number }) => void;
}

const { findings, selectedId, onSelect, onHover }: Props = $props();

const summaryId = $props.id();

let plotEl: HTMLDivElement | undefined = $state();
let canvasEl: HTMLCanvasElement | undefined = $state();
let cssWidth = $state(0);
let cssHeight = $state(0);
let hoveredId = $state<string | null>(null);

const geometry = $derived(computeGeometry(cssWidth, cssHeight));
const points = $derived(buildPoints(findings, geometry));
const packed = $derived(packPoints(points, MARK_RADIUS));
const marks = $derived(points.map((point, i) => ({ ...point, x: packed[i]?.x ?? point.x })));
const summary = $derived(summarize(points));

$effect(() => {
	const el = plotEl;
	if (!el) return;

	const measure = () => {
		cssWidth = el.clientWidth;
		cssHeight = el.clientHeight;
	};
	measure();

	const observer = new ResizeObserver(measure);
	observer.observe(el);
	return () => observer.disconnect();
});

$effect(() => {
	const canvas = canvasEl;
	if (!canvas || cssWidth <= 0 || cssHeight <= 0) return;

	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.round(cssWidth * dpr);
	canvas.height = Math.round(cssHeight * dpr);

	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	ctx.save();
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, cssWidth, cssHeight);
	ctx.fillStyle = BACKGROUND;
	ctx.fillRect(0, 0, cssWidth, cssHeight);

	drawHighRiskZone(ctx, geometry);
	drawGrid(ctx, geometry);
	drawBands(ctx, geometry, summary);
	drawAxes(ctx, geometry);
	drawMarks(ctx, marks, selectedId, hoveredId);
	drawLaneLabels(ctx, geometry, summary);

	ctx.restore();
});

function locate(event: MouseEvent): { x: number; y: number } | null {
	const canvas = canvasEl;
	if (!canvas) return null;
	const rect = canvas.getBoundingClientRect();
	return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function handleMouseMove(event: MouseEvent) {
	const at = locate(event);
	if (!at) return;

	const hit = findNearestPoint(marks, at.x, at.y, HIT_RADIUS);
	const id = hit?.id ?? null;
	if (id === hoveredId) return;

	hoveredId = id;
	onHover(id, id ? { x: event.clientX, y: event.clientY } : undefined);
}

function handleMouseLeave() {
	if (hoveredId === null) return;
	hoveredId = null;
	onHover(null);
}

function handleClick(event: MouseEvent) {
	const at = locate(event);
	if (!at) return;

	const hit = findNearestPoint(marks, at.x, at.y, HIT_RADIUS);
	if (hit) onSelect(hit.id);
}
</script>

<div class="hud-panel flex h-full min-h-0 w-full flex-col bg-hud-base/90">
	<div bind:this={plotEl} class="relative min-h-0 flex-1">
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions, a11y_no_interactive_element_to_noninteractive_role -- ARIA in HTML allows any role on a canvas with no fallback content; this one is a picture, and the equivalent keyboard path is the findings table named in the description -->
		<canvas
			bind:this={canvasEl}
			role="img"
			aria-label={plotLabel(summary)}
			aria-describedby={summaryId}
			class="block h-full w-full"
			onmousemove={handleMouseMove}
			onmouseleave={handleMouseLeave}
			onclick={handleClick}
		></canvas>

		{#if findings.length === 0}
			<p
				class="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-sm text-hud-text-secondary"
			>
				No findings to plot.
			</p>
		{/if}
	</div>

	<p id={summaryId} class="sr-only">{describePlot(summary)}</p>

	<div
		class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hud-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-hud-text-secondary"
	>
		{#each LEGEND_LEVELS as level (level)}
			<span class="flex items-center gap-1.5">
				<span
					class="h-2 w-2 rounded-full"
					aria-hidden="true"
					style={level === 'UNKNOWN'
						? `box-shadow: inset 0 0 0 1.5px ${SEVERITY_COLORS[level]};`
						: `background-color: ${SEVERITY_COLORS[level]};`}
				></span>
				{level}
			</span>
		{/each}
		<span class="text-hud-text-muted normal-case tracking-normal">
			Hollow ring = unrated or unscored
		</span>
		<span class="text-hud-text-muted normal-case tracking-normal">
			Left lanes = EPSS 0 or missing; band below the axis = no DECREE Score
		</span>
	</div>
</div>
