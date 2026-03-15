import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ANIMATION_DURATION = 800;

interface AnimationTarget {
	position: THREE.Vector3;
	lookAt: THREE.Vector3;
}

export function overviewPreset(clusterCount: number): AnimationTarget {
	const span = Math.max(clusterCount * 8, 20);
	return {
		position: new THREE.Vector3(span / 2, 30, span),
		lookAt: new THREE.Vector3(span / 2, 15, 0),
	};
}

export function clusterPreset(centerX: number): AnimationTarget {
	return {
		position: new THREE.Vector3(centerX, 20, 20),
		lookAt: new THREE.Vector3(centerX, 15, 0),
	};
}

export function nodePreset(x: number, y: number, z: number): AnimationTarget {
	return {
		position: new THREE.Vector3(x + 5, y + 3, z + 8),
		lookAt: new THREE.Vector3(x, y, z),
	};
}

export function animateCamera(
	camera: THREE.Camera,
	controls: OrbitControls,
	target: AnimationTarget,
) {
	const startPos = camera.position.clone();
	const startTarget = controls.target.clone();
	const startTime = performance.now();

	function tick() {
		const elapsed = performance.now() - startTime;
		const t = Math.min(elapsed / ANIMATION_DURATION, 1);
		const ease = 1 - (1 - t) ** 3; // cubic ease-out

		camera.position.lerpVectors(startPos, target.position, ease);
		controls.target.lerpVectors(startTarget, target.lookAt, ease);
		controls.update();

		if (t < 1) {
			requestAnimationFrame(tick);
		}
	}

	tick();
}
