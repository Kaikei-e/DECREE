import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	computeGeometry,
	epssToX,
	HIGH_RISK_EPSS,
	HIGH_RISK_SCORE,
	scoreToY,
} from '$lib/graph/beeswarm';
import { SEVERITY_COLORS } from '$lib/graph/model';
import type { Finding } from '$lib/types/api';
import BeeswarmView, { MARK_RADIUS, SELECTION_COLOR } from './BeeswarmView.svelte';

const WIDTH = 1600;
const HEIGHT = 900;
const geo = computeGeometry(WIDTH, HEIGHT);

interface DrawOp {
	op: string;
	args: number[];
	fillStyle: string;
	strokeStyle: string;
	text: string;
}

interface Mark {
	x: number;
	y: number;
	radius: number;
	mode: 'fill' | 'stroke';
	color: string;
}

let ops: DrawOp[] = [];

function createFakeContext(): CanvasRenderingContext2D {
	let fillStyle = '';
	let strokeStyle = '';
	const record =
		(op: string) =>
		(...args: unknown[]) => {
			ops.push({
				op,
				args: args.filter((a): a is number => typeof a === 'number'),
				fillStyle,
				strokeStyle,
				text: args.find((a): a is string => typeof a === 'string') ?? '',
			});
		};

	return {
		get fillStyle() {
			return fillStyle;
		},
		set fillStyle(value: string) {
			fillStyle = value;
		},
		get strokeStyle() {
			return strokeStyle;
		},
		set strokeStyle(value: string) {
			strokeStyle = value;
		},
		lineWidth: 1,
		font: '',
		textAlign: 'left',
		textBaseline: 'alphabetic',
		globalAlpha: 1,
		save: record('save'),
		restore: record('restore'),
		setTransform: record('setTransform'),
		translate: record('translate'),
		rotate: record('rotate'),
		clearRect: record('clearRect'),
		fillRect: record('fillRect'),
		strokeRect: record('strokeRect'),
		beginPath: record('beginPath'),
		closePath: record('closePath'),
		moveTo: record('moveTo'),
		lineTo: record('lineTo'),
		arc: record('arc'),
		fill: record('fill'),
		stroke: record('stroke'),
		fillText: record('fillText'),
		setLineDash: record('setLineDash'),
		measureText: () => ({ width: 40 }),
	} as unknown as CanvasRenderingContext2D;
}

function marks(): Mark[] {
	const found: Mark[] = [];
	for (let i = 0; i < ops.length; i++) {
		const op = ops[i];
		if (op?.op !== 'arc') continue;
		for (let j = i + 1; j < ops.length; j++) {
			const next = ops[j];
			if (!next || next.op === 'arc') break;
			if (next.op === 'fill' || next.op === 'stroke') {
				found.push({
					x: op.args[0] ?? 0,
					y: op.args[1] ?? 0,
					radius: op.args[2] ?? 0,
					mode: next.op,
					color: next.op === 'fill' ? op.fillStyle : op.strokeStyle,
				});
				break;
			}
		}
	}
	return found;
}

function drawnText(): string {
	return ops
		.filter((o) => o.op === 'fillText')
		.map((o) => o.text)
		.join('\n');
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		instance_id: 'i1',
		target_id: 't1',
		target_name: 'alt-backend',
		package_name: 'lodash',
		package_version: '4.17.0',
		ecosystem: 'npm',
		advisory_id: 'CVE-2026-0001',
		severity: 'HIGH',
		decree_score: 7.5,
		epss_score: 0.5,
		cvss_score: 7.5,
		is_active: true,
		...overrides,
	};
}

const findings = [
	makeFinding({ instance_id: 'hot', decree_score: 9.2, epss_score: 0.9, severity: 'CRITICAL' }),
	makeFinding({ instance_id: 'cold', decree_score: 2.1, epss_score: 0.0005, severity: 'LOW' }),
];

function baseProps(overrides: Record<string, unknown> = {}) {
	return {
		findings,
		selectedId: null,
		onSelect: vi.fn(),
		onHover: vi.fn(),
		...overrides,
	};
}

function at(finding: Finding) {
	return { x: epssToX(finding.epss_score, geo), y: scoreToY(finding.decree_score, geo) };
}

async function renderView(overrides: Record<string, unknown> = {}) {
	const utils = render(BeeswarmView, { props: baseProps(overrides) });
	await tick();
	return utils;
}

describe('BeeswarmView', () => {
	beforeEach(() => {
		ops = [];
		if (!('ResizeObserver' in globalThis)) {
			globalThis.ResizeObserver = class {
				observe() {}
				unobserve() {}
				disconnect() {}
			} as unknown as typeof ResizeObserver;
		}
		Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
			configurable: true,
			get: () => WIDTH,
		});
		Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
			configurable: true,
			get: () => HEIGHT,
		});
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			left: 0,
			top: 0,
			right: WIDTH,
			bottom: HEIGHT,
			width: WIDTH,
			height: HEIGHT,
		} as DOMRect);
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() =>
			createFakeContext()) as unknown as HTMLCanvasElement['getContext']);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	describe('text alternative', () => {
		it('exposes the plot as an image that names both encoded variables', async () => {
			const { getByRole } = await renderView();
			const canvas = getByRole('img');

			const label = canvas.getAttribute('aria-label') ?? '';
			expect(label).toContain('EPSS');
			expect(label).toContain('DECREE Score');
			expect(label).toContain('2 findings');
		});

		it('describes the axes, their units and every count the plot encodes as position', async () => {
			const { getByRole } = await renderView({
				findings: [
					...findings,
					makeFinding({ instance_id: 'noscore', decree_score: undefined, severity: undefined }),
					makeFinding({ instance_id: 'zero', epss_score: 0 }),
					makeFinding({ instance_id: 'noepss', epss_score: undefined }),
				],
			});

			const describedBy = getByRole('img').getAttribute('aria-describedby') ?? '';
			const summary = document.getElementById(describedBy)?.textContent ?? '';

			expect(summary).toContain('logarithmic');
			expect(summary).toContain('0.001% to 100%');
			expect(summary).toContain('0 to 10');
			expect(summary).toContain('1 finding has no DECREE Score');
			expect(summary).toContain('1 finding has an EPSS of exactly 0');
			expect(summary).toContain('1 finding has no EPSS value');
			expect(summary).toContain('high-risk');
		});

		it('says the unscored band is empty rather than leaving it unexplained', async () => {
			const { getByRole } = await renderView();
			const describedBy = getByRole('img').getAttribute('aria-describedby') ?? '';
			expect(document.getElementById(describedBy)?.textContent).toContain(
				'No findings are unscored',
			);
		});
	});

	describe('canvas chrome', () => {
		it('draws both axis titles with their units', async () => {
			await renderView();
			const text = drawnText();
			expect(text).toContain('EPSS');
			expect(text).toContain('DECREE SCORE');
		});

		it('labels the log axis in percentages, not raw probabilities', async () => {
			await renderView();
			const text = drawnText();
			expect(text).toContain('100%');
			expect(text).toContain('0.1%');
			expect(text).not.toContain('0.001\n');
		});

		it('labels the unscored band with its count so an empty area is never ambiguous', async () => {
			await renderView({
				findings: [
					...findings,
					makeFinding({ instance_id: 'noscore', decree_score: undefined }),
					makeFinding({ instance_id: 'noscore2', decree_score: undefined }),
				],
			});
			expect(drawnText()).toContain('NO DECREE SCORE · 2');
		});

		it('labels the EPSS zero and unknown lanes with their counts', async () => {
			await renderView({
				findings: [
					...findings,
					makeFinding({ instance_id: 'zero', epss_score: 0 }),
					makeFinding({ instance_id: 'noepss', epss_score: undefined }),
				],
			});
			const text = drawnText();
			expect(text).toContain('EPSS 0');
			expect(text).toContain('EPSS n/a');
		});

		it('keeps the lane labels legible over the marks that share the lane', async () => {
			await renderView({
				findings: [...findings, makeFinding({ instance_id: 'zero', epss_score: 0 })],
			});

			const lastMark = ops.findLastIndex((o) => o.op === 'arc');
			const laneLabel = ops.findIndex((o) => o.op === 'fillText' && o.text.startsWith('EPSS 0'));
			expect(laneLabel).toBeGreaterThan(lastMark);
		});
	});

	describe('marks', () => {
		it('places a finding at its EPSS and its DECREE Score', async () => {
			await renderView();
			const expected = at(findings[0] ?? makeFinding());
			const hit = marks().find(
				(m) => Math.abs(m.x - expected.x) < 1 && Math.abs(m.y - expected.y) < 1,
			);

			expect(hit).toBeTruthy();
			expect(hit?.mode).toBe('fill');
			expect(hit?.color).toBe(SEVERITY_COLORS.CRITICAL);
		});

		it('draws an unrated finding as a hollow neutral ring, never as the lowest level', async () => {
			await renderView({
				findings: [makeFinding({ instance_id: 'u', severity: undefined, decree_score: 5 })],
			});

			const mark = marks().find((m) => m.radius === MARK_RADIUS);
			expect(mark?.mode).toBe('stroke');
			expect(mark?.color).toBe(SEVERITY_COLORS.UNKNOWN);
			expect(mark?.color).not.toBe(SEVERITY_COLORS.LOW);
		});

		it('parks an unscored finding in the gutter, not on the zero line', async () => {
			await renderView({
				findings: [makeFinding({ instance_id: 'n', decree_score: undefined, epss_score: 0.5 })],
			});

			const mark = marks().find((m) => m.radius === MARK_RADIUS);
			expect(mark?.mode).toBe('stroke');
			expect(mark?.y).toBeGreaterThan(geo.plotBottom);
			expect(mark?.y).toBeGreaterThan(scoreToY(0, geo));
			expect(mark?.y).toBeLessThan(geo.gutterBottom);
			expect(mark?.x).toBeCloseTo(epssToX(0.5, geo), 0);
		});

		it('separates findings that would land on the same pixel', async () => {
			const pile = Array.from({ length: 8 }, (_, i) =>
				makeFinding({ instance_id: `p${i}`, decree_score: 6, epss_score: 0.3 }),
			);
			await renderView({ findings: pile });

			const placed = marks().filter((m) => m.radius === MARK_RADIUS);
			expect(placed).toHaveLength(8);
			expect(new Set(placed.map((m) => m.x)).size).toBe(8);
		});

		it('marks the selected finding with more than a colour change', async () => {
			const plain = await renderView();
			const ringsBefore = marks().filter((m) => m.radius > MARK_RADIUS);
			expect(ringsBefore).toHaveLength(0);
			plain.unmount();

			ops = [];
			await renderView({ selectedId: 'hot' });
			const expected = at(findings[0] ?? makeFinding());
			const ring = marks().find(
				(m) => m.radius > MARK_RADIUS && Math.abs(m.x - expected.x) < 1 && m.mode === 'stroke',
			);

			expect(ring).toBeTruthy();
			expect(ring?.color).toBe(SELECTION_COLOR);
		});

		it('shades the high-risk corner without drawing over the marks', async () => {
			await renderView();
			const zone = ops.find(
				(o) => o.op === 'fillRect' && o.args[0] === epssToX(HIGH_RISK_EPSS, geo),
			);
			expect(zone).toBeTruthy();
			expect(zone?.args[1]).toBeCloseTo(geo.plotTop, 6);
			expect(zone?.args[3]).toBeCloseTo(scoreToY(HIGH_RISK_SCORE, geo) - geo.plotTop, 6);
		});
	});

	describe('device pixel ratio', () => {
		it('backs the canvas with real pixels and draws in CSS units', async () => {
			const { getByRole } = await renderView();
			const canvas = getByRole('img') as HTMLCanvasElement;

			expect(canvas.width).toBe(WIDTH * 2);
			expect(canvas.height).toBe(HEIGHT * 2);
			expect(ops.find((o) => o.op === 'setTransform')?.args).toEqual([2, 0, 0, 2, 0, 0]);
		});
	});

	describe('interaction', () => {
		it('reports the finding under the cursor and clears it on the way out', async () => {
			const onHover = vi.fn();
			const { getByRole } = await renderView({ onHover });
			const canvas = getByRole('img');
			const target = at(findings[0] ?? makeFinding());

			await fireEvent.mouseMove(canvas, { clientX: target.x, clientY: target.y });
			expect(onHover).toHaveBeenCalledWith('hot', { x: target.x, y: target.y });

			onHover.mockClear();
			await fireEvent.mouseLeave(canvas);
			expect(onHover).toHaveBeenCalledWith(null);
		});

		it('does not report a hover over empty plot area', async () => {
			const onHover = vi.fn();
			const { getByRole } = await renderView({ onHover });

			await fireEvent.mouseMove(getByRole('img'), { clientX: 700, clientY: 700 });
			expect(onHover).not.toHaveBeenCalled();
		});

		it('selects the finding under the click', async () => {
			const onSelect = vi.fn();
			const { getByRole } = await renderView({ onSelect });
			const target = at(findings[1] ?? makeFinding());

			await fireEvent.click(getByRole('img'), { clientX: target.x, clientY: target.y });
			expect(onSelect).toHaveBeenCalledWith('cold');
		});

		it('ignores a click on empty plot area', async () => {
			const onSelect = vi.fn();
			const { getByRole } = await renderView({ onSelect });

			await fireEvent.click(getByRole('img'), { clientX: 700, clientY: 700 });
			expect(onSelect).not.toHaveBeenCalled();
		});
	});

	describe('legend', () => {
		it('names every severity level and the unrated ring in text', async () => {
			const { getByText } = await renderView();
			for (const level of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']) {
				expect(getByText(level)).toBeTruthy();
			}
			expect(getByText(/hollow ring/i)).toBeTruthy();
		});
	});

	describe('empty state', () => {
		it('says the plot is empty instead of showing a blank canvas', async () => {
			const { getByText, getByRole } = await renderView({ findings: [] });

			expect(getByText('No findings to plot.')).toBeTruthy();
			expect(getByRole('img').getAttribute('aria-label')).toContain('0 findings');
		});
	});
});
