import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animateCamera, FRONT_DIRECTION, fitPreset, TOP_DIRECTION } from './camera-presets';

describe('fitPreset', () => {
	const FOV = 60;
	const ASPECT = 1.6;

	/** The skyline is a long flat slab: eight districts wide, twelve units tall. */
	const skyline = new THREE.Box3(new THREE.Vector3(-6, 0, -6), new THREE.Vector3(62, 12, 6));

	function corners(box: THREE.Box3): THREE.Vector3[] {
		const out: THREE.Vector3[] = [];
		for (const x of [box.min.x, box.max.x]) {
			for (const y of [box.min.y, box.max.y]) {
				for (const z of [box.min.z, box.max.z]) {
					out.push(new THREE.Vector3(x, y, z));
				}
			}
		}
		return out;
	}

	function project(box: THREE.Box3, fov = FOV, aspect = ASPECT): THREE.Vector3[] {
		const { position, lookAt } = fitPreset(box, fov, aspect);
		const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 20000);
		camera.position.copy(position);
		camera.lookAt(lookAt);
		camera.updateMatrixWorld();
		return corners(box).map((corner) => corner.project(camera));
	}

	it('keeps every corner of the content on screen', () => {
		for (const ndc of project(skyline)) {
			expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
			expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
			expect(ndc.z).toBeLessThan(1);
		}
	});

	it('fills the frame with the findings instead of the empty grid around them', () => {
		const widest = Math.max(...project(skyline).map((ndc) => Math.abs(ndc.x)));
		expect(widest).toBeGreaterThan(0.8);
	});

	it('adapts to the viewport shape', () => {
		const wide = fitPreset(skyline, FOV, 2.4);
		const narrow = fitPreset(skyline, FOV, 0.8);
		const center = skyline.getCenter(new THREE.Vector3());
		expect(wide.position.distanceTo(center)).toBeLessThan(narrow.position.distanceTo(center));
	});

	it('looks down on the scene from outside it', () => {
		const { position, lookAt } = fitPreset(skyline, FOV, ASPECT);
		expect(lookAt.toArray()).toEqual(skyline.getCenter(new THREE.Vector3()).toArray());
		expect(position.y).toBeGreaterThan(skyline.max.y);
		expect(skyline.containsPoint(position)).toBe(false);
	});

	it('frames the same content from above without gimbal lock', () => {
		const { position, lookAt } = fitPreset(skyline, FOV, ASPECT, TOP_DIRECTION);
		expect(position.y).toBeGreaterThan(skyline.max.y);
		expect(Math.abs(position.x - lookAt.x)).toBeLessThan(0.01);
		expect(position.z).not.toBe(lookAt.z);

		for (const ndc of project(skyline, FOV, ASPECT)) {
			expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
		}
	});

	it('frames the same content head-on from the front', () => {
		const { position, lookAt } = fitPreset(skyline, FOV, ASPECT, FRONT_DIRECTION);
		expect(position.z).toBeGreaterThan(skyline.max.z);
		expect(Math.abs(position.x - lookAt.x)).toBeLessThan(0.01);
	});

	it('keeps a degenerate single-column scene at a workable distance', () => {
		const dot = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0));
		const { position, lookAt } = fitPreset(dot, FOV, ASPECT);
		expect(position.distanceTo(lookAt)).toBeGreaterThan(3);
	});
});

describe('animateCamera', () => {
	beforeEach(() => {
		// jsdom ships no matchMedia, so define it here rather than depend on another file's setup.
		stubReducedMotion(false);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubReducedMotion(matches: boolean) {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }) as MediaQueryList);
	}

	function fakeControls() {
		return { target: new THREE.Vector3(), update: vi.fn() } as unknown as OrbitControls;
	}

	it('eases toward the target instead of jumping there', () => {
		stubReducedMotion(false);
		const camera = new THREE.PerspectiveCamera();
		const controls = fakeControls();

		const cancel = animateCamera(camera, controls, {
			position: new THREE.Vector3(100, 100, 100),
			lookAt: new THREE.Vector3(50, 50, 50),
		});

		expect(camera.position.x).toBeLessThan(100);
		expect(controls.target.x).toBeLessThan(50);
		cancel();
	});

	it('cuts straight to the target when the user prefers reduced motion', () => {
		stubReducedMotion(true);
		const camera = new THREE.PerspectiveCamera();
		const controls = fakeControls();

		const cancel = animateCamera(camera, controls, {
			position: new THREE.Vector3(1, 2, 3),
			lookAt: new THREE.Vector3(4, 5, 6),
		});

		expect(camera.position.toArray()).toEqual([1, 2, 3]);
		expect(controls.target.toArray()).toEqual([4, 5, 6]);
		expect(controls.update).toHaveBeenCalled();
		expect(() => cancel()).not.toThrow();
	});
});
