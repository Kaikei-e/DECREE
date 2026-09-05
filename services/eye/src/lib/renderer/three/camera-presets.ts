import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ANIMATION_DURATION = 800;

/** Three-quarter elevated view: the skyline reads as a skyline rather than a floor plan. */
export const OVERVIEW_DIRECTION = new THREE.Vector3(0.08, 0.5, 1).normalize();
/** A hair off vertical, because a camera exactly above its target has no roll reference. */
export const TOP_DIRECTION = new THREE.Vector3(0, 1, 0.001).normalize();
export const FRONT_DIRECTION = new THREE.Vector3(0, 0.08, 1).normalize();
const FIT_MARGIN = 1.08;
const MIN_FIT_DISTANCE = 8;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

interface AnimationTarget {
	position: THREE.Vector3;
	lookAt: THREE.Vector3;
}

export function overviewPreset(clusterCount: number): AnimationTarget {
	const centerX = ((clusterCount - 1) * 8) / 2;
	const dist = Math.max(clusterCount * 8, 20);
	return {
		position: new THREE.Vector3(centerX, 12, dist),
		lookAt: new THREE.Vector3(centerX, 10, 0),
	};
}

export function clusterPreset(centerX: number): AnimationTarget {
	return {
		position: new THREE.Vector3(centerX, 20, 20),
		lookAt: new THREE.Vector3(centerX, 15, 0),
	};
}

/**
 * Pulls back only as far as the content's own corners require, so the findings fill the frame
 * instead of floating in the grid plane around them.
 */
export function fitPreset(
	box: THREE.Box3,
	fovDegrees: number,
	aspect: number,
	direction: THREE.Vector3 = OVERVIEW_DIRECTION,
): AnimationTarget {
	const center = box.getCenter(new THREE.Vector3());
	const forward = direction.clone().negate();
	const right = new THREE.Vector3().crossVectors(forward, WORLD_UP).normalize();
	const up = new THREE.Vector3().crossVectors(right, forward);

	const tanV = Math.tan((fovDegrees * Math.PI) / 180 / 2);
	const tanH = tanV * aspect;

	const corner = new THREE.Vector3();
	let distance = 0;
	for (const x of [box.min.x, box.max.x]) {
		for (const y of [box.min.y, box.max.y]) {
			for (const z of [box.min.z, box.max.z]) {
				corner.set(x, y, z).sub(center);
				const depth = corner.dot(forward);
				distance = Math.max(
					distance,
					Math.abs(corner.dot(up)) / tanV - depth,
					Math.abs(corner.dot(right)) / tanH - depth,
				);
			}
		}
	}

	return {
		position: center
			.clone()
			.addScaledVector(direction, Math.max(distance * FIT_MARGIN, MIN_FIT_DISTANCE)),
		lookAt: center,
	};
}

export function nodePreset(x: number, y: number, z: number): AnimationTarget {
	return {
		position: new THREE.Vector3(x + 5, y + 3, z + 8),
		lookAt: new THREE.Vector3(x, y, z),
	};
}

function prefersReducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function animateCamera(
	camera: THREE.Camera,
	controls: OrbitControls,
	target: AnimationTarget,
): () => void {
	if (prefersReducedMotion()) {
		camera.position.copy(target.position);
		controls.target.copy(target.lookAt);
		controls.update();
		return () => {};
	}

	const startPos = camera.position.clone();
	const startTarget = controls.target.clone();
	const startTime = performance.now();
	let frameId = 0;

	function tick() {
		const elapsed = performance.now() - startTime;
		const t = Math.min(elapsed / ANIMATION_DURATION, 1);
		const ease = 1 - (1 - t) ** 3; // cubic ease-out

		camera.position.lerpVectors(startPos, target.position, ease);
		controls.target.lerpVectors(startTarget, target.lookAt, ease);
		controls.update();

		if (t < 1) {
			frameId = requestAnimationFrame(tick);
		}
	}

	tick();
	return () => cancelAnimationFrame(frameId);
}
