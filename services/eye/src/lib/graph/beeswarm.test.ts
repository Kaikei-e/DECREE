import { describe, expect, it } from 'vitest';
import type { Finding } from '$lib/types/api';
import {
	buildPoints,
	computeGeometry,
	describePlot,
	EPSS_FLOOR,
	epssTicks,
	epssToX,
	findNearestPoint,
	HIGH_RISK_EPSS,
	HIGH_RISK_SCORE,
	type PackablePoint,
	packPoints,
	plotLabel,
	SCORE_MAX,
	scoreTicks,
	scoreToY,
	summarize,
} from './beeswarm';
import { SEVERITY_COLORS } from './model';

const WIDTH = 1600;
const HEIGHT = 900;
const geo = computeGeometry(WIDTH, HEIGHT);

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

describe('computeGeometry', () => {
	it('orders the lanes, the plot and the gutter left to right and top to bottom', () => {
		expect(geo.missingLaneX).toBeLessThan(geo.zeroLaneX);
		expect(geo.zeroLaneX).toBeLessThan(geo.laneDividerX);
		expect(geo.laneDividerX).toBeLessThan(geo.plotLeft);
		expect(geo.plotLeft).toBeLessThan(geo.plotRight);
		expect(geo.plotRight).toBeLessThanOrEqual(WIDTH);

		expect(geo.plotTop).toBeLessThan(geo.plotBottom);
		expect(geo.plotBottom).toBeLessThan(geo.gutterTop);
		expect(geo.gutterTop).toBeLessThan(geo.gutterBottom);
		expect(geo.gutterBottom).toBeLessThanOrEqual(HEIGHT);
		expect(geo.gutterY).toBeGreaterThan(geo.gutterTop);
		expect(geo.gutterY).toBeLessThan(geo.gutterBottom);
	});

	it('stays ordered when the container is degenerately small', () => {
		const tiny = computeGeometry(10, 10);
		expect(tiny.plotLeft).toBeLessThan(tiny.plotRight);
		expect(tiny.plotTop).toBeLessThan(tiny.plotBottom);
		expect(tiny.plotBottom).toBeLessThan(tiny.gutterTop);
	});
});

describe('epssToX', () => {
	it('anchors the log axis at the floor and at 100%', () => {
		expect(epssToX(EPSS_FLOOR, geo)).toBeCloseTo(geo.plotLeft, 6);
		expect(epssToX(1, geo)).toBeCloseTo(geo.plotRight, 6);
	});

	it('gives every decade the same width', () => {
		const decades = [1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1].map((v) => epssToX(v, geo));
		const steps = decades.slice(1).map((x, i) => x - (decades[i] ?? 0));
		for (const step of steps) {
			expect(step).toBeCloseTo(steps[0] ?? 0, 6);
		}
		// The whole point of the log axis: the median (2%) must not collapse into the left edge.
		const median = epssToX(0.0202, geo);
		expect((median - geo.plotLeft) / (geo.plotRight - geo.plotLeft)).toBeGreaterThan(0.5);
	});

	it('puts EPSS 0 in its own lane rather than at the axis floor', () => {
		expect(epssToX(0, geo)).toBe(geo.zeroLaneX);
		expect(epssToX(0, geo)).toBeLessThan(geo.plotLeft);
		expect(epssToX(0, geo)).not.toBe(epssToX(EPSS_FLOOR, geo));
	});

	it('puts a missing EPSS in a lane of its own, distinct from zero', () => {
		expect(epssToX(undefined, geo)).toBe(geo.missingLaneX);
		expect(epssToX(null, geo)).toBe(geo.missingLaneX);
		expect(epssToX(Number.NaN, geo)).toBe(geo.missingLaneX);
		expect(geo.missingLaneX).not.toBe(geo.zeroLaneX);
	});

	it('pins values below the floor to the axis start', () => {
		expect(epssToX(1e-9, geo)).toBeCloseTo(geo.plotLeft, 6);
	});
});

describe('scoreToY', () => {
	it('maps the fixed 0-10 domain onto the plot band', () => {
		expect(scoreToY(0, geo)).toBeCloseTo(geo.plotBottom, 6);
		expect(scoreToY(SCORE_MAX, geo)).toBeCloseTo(geo.plotTop, 6);
		expect(scoreToY(5, geo)).toBeCloseTo((geo.plotTop + geo.plotBottom) / 2, 6);
	});

	it('does not infer the domain from the data', () => {
		// A project whose worst finding is 3.0 still draws it at 30% of the axis, not at the top.
		expect(scoreToY(3, geo)).toBeCloseTo(geo.plotBottom - 0.3 * (geo.plotBottom - geo.plotTop), 6);
	});

	it('drops an unscored finding into the gutter, never onto the zero line', () => {
		expect(scoreToY(undefined, geo)).toBe(geo.gutterY);
		expect(scoreToY(null, geo)).toBe(geo.gutterY);
		expect(scoreToY(undefined, geo)).toBeGreaterThan(scoreToY(0, geo));
	});
});

describe('axis ticks', () => {
	it('labels the log axis in percentages rather than raw probabilities', () => {
		expect(epssTicks().map((t) => t.label)).toEqual([
			'0.001%',
			'0.01%',
			'0.1%',
			'1%',
			'10%',
			'100%',
		]);
		expect(epssTicks().map((t) => t.value)).toEqual([1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1]);
	});

	it('labels the score axis on its own 0-10 scale', () => {
		expect(scoreTicks().map((t) => t.value)).toEqual([0, 2, 4, 6, 8, 10]);
		expect(scoreTicks().map((t) => t.label)).toEqual(['0', '2', '4', '6', '8', '10']);
	});
});

describe('buildPoints', () => {
	it('keeps one point per finding in input order', () => {
		const findings = [
			makeFinding({ instance_id: 'a' }),
			makeFinding({ instance_id: 'b' }),
			makeFinding({ instance_id: 'c' }),
		];
		expect(buildPoints(findings, geo).map((p) => p.id)).toEqual(['a', 'b', 'c']);
	});

	it('marks an unrated finding UNKNOWN instead of the lowest severity', () => {
		const [none, unknown] = buildPoints(
			[makeFinding({ severity: undefined }), makeFinding({ severity: 'unknown' })],
			geo,
		);
		expect(none?.severity).toBe('UNKNOWN');
		expect(unknown?.severity).toBe('UNKNOWN');
		expect(SEVERITY_COLORS.UNKNOWN).not.toBe(SEVERITY_COLORS.LOW);
	});

	it('keeps the real EPSS position of a finding that has no score', () => {
		const [point] = buildPoints([makeFinding({ decree_score: undefined, epss_score: 0.5 })], geo);
		expect(point?.score).toBeNull();
		expect(point?.y).toBe(geo.gutterY);
		expect(point?.x).toBeCloseTo(epssToX(0.5, geo), 6);
	});

	it('keeps the real score of a finding that has no severity', () => {
		const [point] = buildPoints([makeFinding({ severity: undefined, decree_score: 4 })], geo);
		expect(point?.y).toBeCloseTo(scoreToY(4, geo), 6);
	});

	it('confines a lane point to its lane and lets a plotted point use the full axis', () => {
		const [zero, missing, plotted] = buildPoints(
			[
				makeFinding({ epss_score: 0 }),
				makeFinding({ epss_score: undefined }),
				makeFinding({ epss_score: 0.5 }),
			],
			geo,
		);
		expect(zero?.xMax ?? 0).toBeLessThan(geo.laneDividerX);
		expect(missing?.xMax ?? 0).toBeLessThan(geo.zeroLaneX);
		expect(plotted?.xMin).toBe(geo.plotLeft);
		expect(plotted?.xMax).toBe(geo.plotRight);
	});

	it('treats a NaN score as unscored rather than as zero', () => {
		const [point] = buildPoints([makeFinding({ decree_score: Number.NaN })], geo);
		expect(point?.score).toBeNull();
		expect(point?.y).toBe(geo.gutterY);
	});
});

describe('packPoints', () => {
	function pack(points: PackablePoint[], radius: number) {
		return packPoints(points, radius);
	}

	it('leaves points that already clear each other alone', () => {
		const input = [
			{ id: 'a', x: 100, y: 100 },
			{ id: 'b', x: 200, y: 100 },
		];
		expect(pack(input, 4)).toEqual(input);
	});

	it('returns every point, in input order', () => {
		const input = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, x: 100, y: 100 }));
		const packed = pack(input, 4);
		expect(packed).toHaveLength(40);
		expect(packed.map((p) => p.id)).toEqual(input.map((p) => p.id));
	});

	it('separates coincident points so every mark stays countable', () => {
		const input = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, x: 400, y: 250 }));
		const packed = pack(input, 4);

		for (let i = 0; i < packed.length; i++) {
			for (let j = i + 1; j < packed.length; j++) {
				const a = packed[i];
				const b = packed[j];
				if (!a || !b) continue;
				expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(8 - 1e-9);
			}
		}
	});

	it('displaces along x only, so the score axis stays exact', () => {
		const input = Array.from({ length: 25 }, (_, i) => ({
			id: `p${i}`,
			x: 400,
			y: 250 + i * 0.01,
		}));
		const packed = pack(input, 5);
		for (const [i, point] of packed.entries()) {
			expect(point.y).toBe(input[i]?.y);
		}
		expect(new Set(packed.map((p) => p.x)).size).toBeGreaterThan(1);
	});

	it('never pushes a point outside its allowed x range', () => {
		const input = Array.from({ length: 12 }, (_, i) => ({
			id: `p${i}`,
			x: 60,
			y: 300,
			xMin: 48,
			xMax: 72,
		}));
		for (const point of pack(input, 4)) {
			expect(point.x).toBeGreaterThanOrEqual(48);
			expect(point.x).toBeLessThanOrEqual(72);
		}
	});

	it('is deterministic', () => {
		const input = Array.from({ length: 200 }, (_, i) => ({
			id: `p${i}`,
			x: 300 + (i % 7) * 3,
			y: 200 + (i % 5) * 2,
		}));
		expect(pack(input, 4)).toEqual(pack(input, 4));
	});

	it('packs a full-scale scene without blowing up', () => {
		let seed = 1;
		const random = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};
		const input = Array.from({ length: 5000 }, (_, i) => ({
			id: `p${i}`,
			x: 110 + random() * 1400,
			y: 26 + random() * 780,
		}));

		const started = performance.now();
		const packed = pack(input, 4);
		const elapsed = performance.now() - started;

		expect(packed).toHaveLength(5000);
		expect(elapsed).toBeLessThan(1000);
	});
});

describe('findNearestPoint', () => {
	const points = [
		{ id: 'a', x: 100, y: 100 },
		{ id: 'b', x: 108, y: 100 },
		{ id: 'c', x: 400, y: 400 },
	];

	it('returns the closest point inside the radius', () => {
		expect(findNearestPoint(points, 106, 100, 7)?.id).toBe('b');
		expect(findNearestPoint(points, 101, 101, 7)?.id).toBe('a');
	});

	it('returns null when nothing is close enough', () => {
		expect(findNearestPoint(points, 250, 250, 7)).toBeNull();
	});

	it('returns null for an empty plot', () => {
		expect(findNearestPoint([], 0, 0, 7)).toBeNull();
	});
});

describe('summarize', () => {
	const points = buildPoints(
		[
			makeFinding({ instance_id: 'hot', decree_score: 9.2, epss_score: 0.9 }),
			makeFinding({
				instance_id: 'edge',
				decree_score: HIGH_RISK_SCORE,
				epss_score: HIGH_RISK_EPSS,
			}),
			makeFinding({ instance_id: 'cold', decree_score: 2, epss_score: 0.0001 }),
			makeFinding({ instance_id: 'nozero', decree_score: 3, epss_score: 0 }),
			makeFinding({ instance_id: 'noepss', decree_score: 3, epss_score: undefined }),
			makeFinding({ instance_id: 'noscore', decree_score: undefined, severity: undefined }),
		],
		geo,
	);

	it('counts the totals a reader would otherwise have to infer from empty space', () => {
		expect(summarize(points)).toEqual({
			total: 6,
			highRisk: 2,
			unscored: 1,
			unknownSeverity: 1,
			epssZero: 1,
			epssMissing: 1,
		});
	});
});

describe('describePlot', () => {
	const text = describePlot(
		summarize(
			buildPoints(
				[
					makeFinding({ instance_id: 'a', decree_score: 9.2, epss_score: 0.9 }),
					makeFinding({ instance_id: 'b', decree_score: undefined, severity: undefined }),
					makeFinding({ instance_id: 'c', epss_score: 0 }),
					makeFinding({ instance_id: 'd', epss_score: undefined }),
				],
				geo,
			),
		),
	);

	it('states both axes with their units and scale type', () => {
		expect(text).toContain('EPSS');
		expect(text).toContain('logarithmic');
		expect(text).toContain('0.001% to 100%');
		expect(text).toContain('DECREE Score');
		expect(text).toContain('0 to 10');
	});

	it('states every count that the plot encodes as position', () => {
		expect(text).toContain('4 findings');
		expect(text).toContain('1 finding has no DECREE Score');
		expect(text).toContain('1 finding has an EPSS of exactly 0');
		expect(text).toContain('1 finding has no EPSS value');
		expect(text).toContain('high-risk');
	});

	it('says an empty band is empty instead of leaving it unlabelled', () => {
		const empty = describePlot(summarize(buildPoints([makeFinding()], geo)));
		expect(empty).toContain('No findings are unscored');
	});
});

describe('plotLabel', () => {
	it('names both encoded variables', () => {
		const label = plotLabel(summarize(buildPoints([makeFinding()], geo)));
		expect(label).toContain('EPSS');
		expect(label).toContain('DECREE Score');
		expect(label).toContain('1 finding');
	});
});
