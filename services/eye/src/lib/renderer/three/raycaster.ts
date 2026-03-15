import * as THREE from 'three';

export class NodeRaycaster {
	private raycaster = new THREE.Raycaster();
	private pointer = new THREE.Vector2();
	private camera: THREE.Camera;
	private instancedMesh: THREE.InstancedMesh | null = null;
	private nodeIds: string[] = [];

	constructor(camera: THREE.Camera) {
		this.camera = camera;
	}

	setInstancedMesh(mesh: THREE.InstancedMesh, nodeIds: string[]) {
		this.instancedMesh = mesh;
		this.nodeIds = nodeIds;
	}

	updatePointer(event: PointerEvent, container: HTMLElement) {
		const rect = container.getBoundingClientRect();
		this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	}

	pick(): string | null {
		if (!this.instancedMesh) return null;
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const intersects = this.raycaster.intersectObject(this.instancedMesh);
		const first = intersects[0];
		if (first && first.instanceId !== undefined) {
			return this.nodeIds[first.instanceId] ?? null;
		}
		return null;
	}
}
