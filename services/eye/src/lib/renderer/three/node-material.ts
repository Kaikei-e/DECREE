import * as THREE from 'three';
import type { Severity } from '$lib/graph/model';
import { SEVERITY_COLORS } from '$lib/graph/model';

export function severityColor(severity: Severity): THREE.Color {
	return new THREE.Color(SEVERITY_COLORS[severity]);
}

export function createNodeMaterial(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		transparent: true,
		roughness: 0.6,
		metalness: 0.2,
	});
}

export const GLOW_COLOR = 0xffaa44;
export const GLOW_PERIOD = 3.5;
export const GLOW_MIN_INTENSITY = 0.15;
export const GLOW_MAX_INTENSITY = 0.7;

export function createGlowMaterial(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		transparent: true,
		opacity: 0.85,
		roughness: 0.3,
		metalness: 0.1,
		emissive: new THREE.Color(GLOW_COLOR),
		emissiveIntensity: GLOW_MIN_INTENSITY,
		depthWrite: false,
	});
}

export function createEdgeMaterial(): THREE.LineBasicMaterial {
	return new THREE.LineBasicMaterial({
		color: 0x0a3050,
		transparent: true,
		opacity: 0.15,
	});
}
