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

export function createEdgeMaterial(): THREE.LineBasicMaterial {
	return new THREE.LineBasicMaterial({
		color: 0x444444,
		transparent: true,
		opacity: 0.3,
	});
}
