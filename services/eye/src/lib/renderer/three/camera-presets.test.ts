import { describe, expect, it } from 'vitest';
import { frontPreset, topDownPreset } from './camera-presets';

describe('topDownPreset', () => {
	it('positions camera above center looking down', () => {
		const result = topDownPreset(5, 10, 30);
		expect(result.position.x).toBe(5);
		expect(result.position.y).toBeGreaterThan(0);
		expect(result.position.z).toBeCloseTo(0, 0);
		expect(result.lookAt.x).toBe(5);
		expect(result.lookAt.y).toBe(10);
	});

	it('uses minimum distance of 20', () => {
		const result = topDownPreset(0, 0, 5);
		expect(result.position.y).toBeGreaterThanOrEqual(20);
	});

	it('offsets lookAt z slightly to avoid gimbal lock', () => {
		const result = topDownPreset(0, 0, 10);
		expect(result.lookAt.z).not.toBe(0);
		expect(Math.abs(result.lookAt.z)).toBeLessThan(0.01);
	});
});

describe('frontPreset', () => {
	it('positions camera in front of center looking at scene', () => {
		const result = frontPreset(5, 10, 30);
		expect(result.position.x).toBe(5);
		expect(result.position.y).toBe(10);
		expect(result.position.z).toBeGreaterThan(0);
		expect(result.lookAt.x).toBe(5);
		expect(result.lookAt.y).toBe(10);
		expect(result.lookAt.z).toBe(0);
	});

	it('uses minimum distance of 20', () => {
		const result = frontPreset(0, 0, 5);
		expect(result.position.z).toBeGreaterThanOrEqual(20);
	});
});
