import { describe, expect, it } from 'vitest';
import {
	DEFAULT_FINDINGS_QUERY,
	DEFAULT_VIEW_QUERY,
	parseFindingsQuery,
	parseViewQuery,
	toSearchParams,
} from './query-params';

function params(search: string): URLSearchParams {
	return new URLSearchParams(search);
}

describe('parseFindingsQuery', () => {
	it('falls back to the defaults on an empty query string', () => {
		expect(parseFindingsQuery(params(''))).toEqual(DEFAULT_FINDINGS_QUERY);
	});

	it('reads every supported filter', () => {
		const q = parseFindingsQuery(
			params(
				'severity=CRITICAL&ecosystem=crates.io&epss=0.4&active=0&q=log4j&sort=severity&order=asc',
			),
		);
		expect(q).toEqual({
			severity: 'CRITICAL',
			ecosystem: 'crates.io',
			minEpss: 0.4,
			activeOnly: false,
			q: 'log4j',
			sort: 'severity',
			order: 'asc',
		});
	});

	it('preserves ecosystem casing because the gateway matches it exactly', () => {
		expect(parseFindingsQuery(params('ecosystem=PyPI')).ecosystem).toBe('PyPI');
	});

	it('rejects an unsupported sort key rather than passing it to the gateway', () => {
		expect(parseFindingsQuery(params('sort=score')).sort).toBe(DEFAULT_FINDINGS_QUERY.sort);
	});

	it('rejects an unsupported order', () => {
		expect(parseFindingsQuery(params('order=sideways')).order).toBe(DEFAULT_FINDINGS_QUERY.order);
	});

	it('drops a non-numeric or out-of-range epss', () => {
		expect(parseFindingsQuery(params('epss=abc')).minEpss).toBeUndefined();
		expect(parseFindingsQuery(params('epss=2')).minEpss).toBeUndefined();
		expect(parseFindingsQuery(params('epss=-1')).minEpss).toBeUndefined();
		expect(parseFindingsQuery(params('epss=0')).minEpss).toBeUndefined();
	});

	it('trims a search term and drops a blank one', () => {
		expect(parseFindingsQuery(params('q=%20%20')).q).toBeUndefined();
		expect(parseFindingsQuery(params('q=%20log4j%20')).q).toBe('log4j');
	});

	it('caps the search term at the gateway limit instead of provoking a 400', () => {
		const long = 'a'.repeat(200);
		expect(parseFindingsQuery(params(`q=${long}`)).q).toHaveLength(128);
	});
});

describe('parseViewQuery', () => {
	it('defaults to the 3D view with nothing selected', () => {
		expect(parseViewQuery(params(''))).toEqual(DEFAULT_VIEW_QUERY);
	});

	it('reads a view mode and a selected finding', () => {
		expect(parseViewQuery(params('view=table&finding=inst-1'))).toEqual({
			view: 'table',
			finding: 'inst-1',
		});
	});

	it('reads a selected advisory independently of a selected instance', () => {
		expect(parseViewQuery(params('advisory=CVE-2021-44228'))).toEqual({
			view: '3d',
			advisory: 'CVE-2021-44228',
		});
	});

	it('keeps both when an advisory has been expanded down to one instance', () => {
		const q = parseViewQuery(params('advisory=CVE-2021-44228&finding=inst-1'));
		expect(q.advisory).toBe('CVE-2021-44228');
		expect(q.finding).toBe('inst-1');
	});

	it('ignores an unknown view mode', () => {
		expect(parseViewQuery(params('view=hologram')).view).toBe(DEFAULT_VIEW_QUERY.view);
	});
});

describe('toSearchParams', () => {
	it('omits every value that equals its default so shared URLs stay short', () => {
		const search = toSearchParams(DEFAULT_FINDINGS_QUERY, DEFAULT_VIEW_QUERY);
		expect(search.toString()).toBe('');
	});

	it('round-trips a fully populated query', () => {
		const findings = {
			severity: 'HIGH',
			ecosystem: 'npm',
			minEpss: 0.25,
			activeOnly: false,
			q: 'lodash',
			sort: 'epss' as const,
			order: 'asc' as const,
		};
		const view = { view: 'table' as const, advisory: 'CVE-2021-1', finding: 'inst-9' };

		const search = toSearchParams(findings, view);

		expect(parseFindingsQuery(search)).toEqual(findings);
		expect(parseViewQuery(search)).toEqual(view);
	});

	it('emits active=0 only when active-only is switched off', () => {
		expect(toSearchParams({ ...DEFAULT_FINDINGS_QUERY, activeOnly: false }).get('active')).toBe(
			'0',
		);
		expect(toSearchParams(DEFAULT_FINDINGS_QUERY).has('active')).toBe(false);
	});

	it('orders keys deterministically so the same state always yields the same URL', () => {
		const a = toSearchParams(
			{ ...DEFAULT_FINDINGS_QUERY, q: 'x', severity: 'LOW' },
			{ view: 'table', finding: 'i1' },
		);
		const b = toSearchParams(
			{ ...DEFAULT_FINDINGS_QUERY, severity: 'LOW', q: 'x' },
			{ finding: 'i1', view: 'table' },
		);
		expect(a.toString()).toBe(b.toString());
	});
});
