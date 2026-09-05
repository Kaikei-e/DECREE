import type { Finding } from '$lib/types/api';
import { parseSeverity } from './layout';
import type { Severity } from './model';

export const SCORE_MIN = 0;
export const SCORE_MAX = 10;

/** FIRST publishes EPSS to five decimals, so 1e-5 is the smallest value the feed can express. */
export const EPSS_FLOOR = 1e-5;

/** The actionable corner: likely to be exploited and scored high enough to be worth the sprint. */
export const HIGH_RISK_EPSS = 0.1;
export const HIGH_RISK_SCORE = 7;

export const PLOT_MARGIN = { top: 26, right: 22, bottom: 42, left: 54 } as const;
/** EPSS = 0 and EPSS = missing are categories, not positions, so each gets a lane of its own. */
export const LANE_WIDTH = 26;
export const LANE_GAP = 14;
/** Findings with no DECREE Score live here, below the axis, never on the zero line. */
export const GUTTER_HEIGHT = 28;
export const GUTTER_GAP = 20;

export interface PlotGeometry {
	width: number;
	height: number;
	plotLeft: number;
	plotRight: number;
	plotTop: number;
	plotBottom: number;
	missingLaneX: number;
	zeroLaneX: number;
	laneDividerX: number;
	gutterTop: number;
	gutterBottom: number;
	gutterY: number;
}

export function computeGeometry(width: number, height: number): PlotGeometry {
	const plotLeft = PLOT_MARGIN.left + LANE_WIDTH * 2 + LANE_GAP;
	const plotRight = Math.max(plotLeft + 1, width - PLOT_MARGIN.right);
	const plotTop = PLOT_MARGIN.top;

	const gutterBottom = Math.max(
		plotTop + GUTTER_HEIGHT + GUTTER_GAP + 1,
		height - PLOT_MARGIN.bottom,
	);
	const gutterTop = gutterBottom - GUTTER_HEIGHT;
	const plotBottom = gutterTop - GUTTER_GAP;

	return {
		width,
		height,
		plotLeft,
		plotRight,
		plotTop,
		plotBottom,
		missingLaneX: PLOT_MARGIN.left + LANE_WIDTH / 2,
		zeroLaneX: PLOT_MARGIN.left + LANE_WIDTH + LANE_WIDTH / 2,
		laneDividerX: PLOT_MARGIN.left + LANE_WIDTH * 2 + LANE_GAP / 2,
		gutterTop,
		gutterBottom,
		gutterY: gutterTop + GUTTER_HEIGHT / 2,
	};
}

function isNumber(value: number | null | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

export function epssToX(epss: number | null | undefined, geo: PlotGeometry): number {
	if (!isNumber(epss)) return geo.missingLaneX;
	if (epss <= 0) return geo.zeroLaneX;

	const floorExponent = Math.log10(EPSS_FLOOR);
	const t = (Math.log10(Math.max(epss, EPSS_FLOOR)) - floorExponent) / -floorExponent;
	return geo.plotLeft + Math.min(1, t) * (geo.plotRight - geo.plotLeft);
}

export function scoreToY(score: number | null | undefined, geo: PlotGeometry): number {
	if (!isNumber(score)) return geo.gutterY;

	const t = Math.min(1, Math.max(0, (score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)));
	return geo.plotBottom - t * (geo.plotBottom - geo.plotTop);
}

export interface AxisTick {
	value: number;
	label: string;
}

/** Decades read as 0.1% / 1% / 10% far more easily than as 0.001 / 0.01 / 0.1. */
export function epssTicks(): AxisTick[] {
	const ticks: AxisTick[] = [];
	for (let exponent = Math.round(Math.log10(EPSS_FLOOR)); exponent <= 0; exponent++) {
		const value = 10 ** exponent;
		ticks.push({ value, label: `${Number((value * 100).toPrecision(2))}%` });
	}
	return ticks;
}

export function scoreTicks(): AxisTick[] {
	const ticks: AxisTick[] = [];
	for (let value = SCORE_MIN; value <= SCORE_MAX; value += 2) {
		ticks.push({ value, label: String(value) });
	}
	return ticks;
}

export interface PackablePoint {
	id: string;
	x: number;
	y: number;
	/** Bounds the displaced x must stay inside; unset means the point may move anywhere. */
	xMin?: number;
	xMax?: number;
}

export interface PackedPoint {
	id: string;
	x: number;
	y: number;
}

export interface BeeswarmPoint extends PackablePoint {
	severity: Severity;
	score: number | null;
	epss: number | null;
	xMin: number;
	xMax: number;
}

export function buildPoints(findings: readonly Finding[], geo: PlotGeometry): BeeswarmPoint[] {
	const laneHalfWidth = LANE_WIDTH / 2 - 2;

	return findings.map((finding) => {
		const epss = isNumber(finding.epss_score) ? finding.epss_score : null;
		const score = isNumber(finding.decree_score) ? finding.decree_score : null;
		const x = epssToX(epss, geo);
		const onLane = epss === null || epss <= 0;

		return {
			id: finding.instance_id,
			severity: parseSeverity(finding.severity),
			score,
			epss,
			x,
			y: scoreToY(score, geo),
			xMin: onLane ? x - laneHalfWidth : geo.plotLeft,
			xMax: onLane ? x + laneHalfWidth : geo.plotRight,
		};
	});
}

/** Half a radius per step lands neighbours exactly 2r apart without over-scanning candidates. */
const PACK_STEP_RATIO = 0.5;
const PACK_MAX_STEPS = 128;
const PACK_EPSILON = 1e-9;
const GRID_ORIGIN = 1 << 15;

function cellKey(cellX: number, cellY: number): number {
	return (cellX + GRID_ORIGIN) * 65536 + (cellY + GRID_ORIGIN);
}

function isOccupied(
	grid: Map<number, PackedPoint[]>,
	cellSize: number,
	x: number,
	y: number,
	minDistSq: number,
): boolean {
	const firstX = Math.floor((x - cellSize) / cellSize);
	const lastX = Math.floor((x + cellSize) / cellSize);
	const firstY = Math.floor((y - cellSize) / cellSize);
	const lastY = Math.floor((y + cellSize) / cellSize);

	for (let cellX = firstX; cellX <= lastX; cellX++) {
		for (let cellY = firstY; cellY <= lastY; cellY++) {
			const bucket = grid.get(cellKey(cellX, cellY));
			if (!bucket) continue;
			for (const other of bucket) {
				const dx = other.x - x;
				const dy = other.y - y;
				if (dx * dx + dy * dy < minDistSq - PACK_EPSILON) return true;
			}
		}
	}
	return false;
}

/**
 * Beeswarm packing: keep every y exact and nudge x until no two marks overlap, so a pile of
 * findings sharing one advisory stays countable instead of collapsing into a single blob.
 * Sorting dominates at O(n log n); placement is O(n) against a uniform grid of cell size 2r.
 */
export function packPoints(points: readonly PackablePoint[], radius: number): PackedPoint[] {
	const packed: PackedPoint[] = new Array(points.length);
	if (points.length === 0) return packed;

	const minDist = radius * 2;
	const minDistSq = minDist * minDist;
	const cellSize = Math.max(minDist, 1);
	const step = Math.max(radius * PACK_STEP_RATIO, 0.5);
	const grid = new Map<number, PackedPoint[]>();

	const order = points
		.map((_, index) => index)
		.sort((a, b) => {
			const left = points[a];
			const right = points[b];
			if (!left || !right) return 0;
			return left.y - right.y || left.x - right.x || left.id.localeCompare(right.id);
		});

	for (const index of order) {
		const point = points[index];
		if (!point) continue;

		const lower = point.xMin ?? Number.NEGATIVE_INFINITY;
		const upper = point.xMax ?? Number.POSITIVE_INFINITY;
		const base = Math.min(Math.max(point.x, lower), upper);

		let x = base;
		for (let s = 0; s <= PACK_MAX_STEPS; s++) {
			const candidates = s === 0 ? [base] : [base + s * step, base - s * step];
			let placed = false;
			for (const candidate of candidates) {
				if (candidate < lower || candidate > upper) continue;
				if (isOccupied(grid, cellSize, candidate, point.y, minDistSq)) continue;
				x = candidate;
				placed = true;
				break;
			}
			if (placed) break;
		}

		const result = { id: point.id, x, y: point.y };
		const key = cellKey(Math.floor(x / cellSize), Math.floor(point.y / cellSize));
		const bucket = grid.get(key);
		if (bucket) bucket.push(result);
		else grid.set(key, [result]);

		packed[index] = result;
	}

	return packed;
}

export function findNearestPoint(
	points: readonly PackedPoint[],
	x: number,
	y: number,
	radius: number,
): PackedPoint | null {
	const limit = radius * radius;
	let best: PackedPoint | null = null;
	let bestDist = Number.POSITIVE_INFINITY;

	for (const point of points) {
		const dx = point.x - x;
		const dy = point.y - y;
		const dist = dx * dx + dy * dy;
		if (dist <= limit && dist < bestDist) {
			best = point;
			bestDist = dist;
		}
	}
	return best;
}

export interface BeeswarmSummary {
	total: number;
	highRisk: number;
	unscored: number;
	unknownSeverity: number;
	epssZero: number;
	epssMissing: number;
}

export function summarize(points: readonly BeeswarmPoint[]): BeeswarmSummary {
	const summary: BeeswarmSummary = {
		total: points.length,
		highRisk: 0,
		unscored: 0,
		unknownSeverity: 0,
		epssZero: 0,
		epssMissing: 0,
	};

	for (const point of points) {
		if (point.score === null) summary.unscored += 1;
		if (point.severity === 'UNKNOWN') summary.unknownSeverity += 1;
		if (point.epss === null) summary.epssMissing += 1;
		else if (point.epss <= 0) summary.epssZero += 1;

		if (
			point.score !== null &&
			point.epss !== null &&
			point.score >= HIGH_RISK_SCORE &&
			point.epss >= HIGH_RISK_EPSS
		) {
			summary.highRisk += 1;
		}
	}

	return summary;
}

function countOf(n: number): string {
	return n === 1 ? '1 finding' : `${n} findings`;
}

function conjugate(n: number, singular: string, plural: string): string {
	return n === 1 ? singular : plural;
}

export function plotLabel(summary: BeeswarmSummary): string {
	return `Risk plot: EPSS exploitation probability against DECREE Score, ${countOf(summary.total)}`;
}

export function describePlot(summary: BeeswarmSummary): string {
	const sentences = [
		`Scatter plot of ${countOf(summary.total)}.`,
		`Horizontal axis: EPSS exploitation probability, logarithmic, 0.001% to 100%.`,
		`Vertical axis: DECREE Score, linear, 0 to 10.`,
		'Marker colour repeats the severity level.',
		`${countOf(summary.highRisk)} ${conjugate(summary.highRisk, 'sits', 'sit')} in the high-risk corner, at or above ${HIGH_RISK_EPSS * 100}% EPSS and DECREE Score ${HIGH_RISK_SCORE}.`,
	];

	sentences.push(
		summary.unscored === 0
			? 'No findings are unscored, so the band below the axis is empty.'
			: `${countOf(summary.unscored)} ${conjugate(summary.unscored, 'has', 'have')} no DECREE Score and ${conjugate(summary.unscored, 'is', 'are')} drawn as ${conjugate(summary.unscored, 'a hollow ring', 'hollow rings')} in the labelled band below the axis, not at zero.`,
	);

	if (summary.unknownSeverity > 0) {
		sentences.push(
			`${countOf(summary.unknownSeverity)} ${conjugate(summary.unknownSeverity, 'has', 'have')} an unrated severity and ${conjugate(summary.unknownSeverity, 'is', 'are')} drawn in neutral grey.`,
		);
	}

	sentences.push(
		summary.epssZero === 0 && summary.epssMissing === 0
			? 'Every finding has an EPSS value above 0.'
			: `${countOf(summary.epssZero)} ${conjugate(summary.epssZero, 'has', 'have')} an EPSS of exactly 0 and ${countOf(summary.epssMissing)} ${conjugate(summary.epssMissing, 'has', 'have')} no EPSS value; both sit in labelled lanes left of the logarithmic axis.`,
	);

	sentences.push('The findings table lists every finding as text.');
	return sentences.join(' ');
}
