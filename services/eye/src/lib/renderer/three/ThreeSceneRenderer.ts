import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GraphModel } from '$lib/graph/model';
import type { SceneRenderer } from '../types';
import {
	animateCamera,
	clusterPreset,
	frontPreset,
	nodePreset,
	overviewPreset,
	topDownPreset,
} from './camera-presets';
import { createEdgeMaterial, createNodeMaterial } from './node-material';
import { NodeRaycaster } from './raycaster';

const NODE_GEOMETRY = new THREE.SphereGeometry(0.3, 16, 12);

export class ThreeSceneRenderer implements SceneRenderer {
	private renderer!: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
	private controls!: OrbitControls;
	private raycaster!: NodeRaycaster;
	private container: HTMLElement | null = null;
	private animationId = 0;

	private instancedMesh: THREE.InstancedMesh | null = null;
	private edgeLines: THREE.LineSegments | null = null;
	private nodeIds: string[] = [];
	private graph: GraphModel | null = null;

	private clickCallback: ((nodeId: string) => void) | null = null;
	private hoverCallback:
		| ((nodeId: string | null, position?: { x: number; y: number }) => void)
		| null = null;
	private hoveredNodeId: string | null = null;
	private timer = new THREE.Timer();
	private cancelCameraAnimation: (() => void) | null = null;

	mount(container: HTMLElement) {
		this.container = container;
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(container.clientWidth, container.clientHeight);
		this.renderer.setClearColor(0x050a0e, 1);
		this.renderer.domElement.style.display = 'block';
		container.appendChild(this.renderer.domElement);

		this.camera.aspect = container.clientWidth / container.clientHeight;
		this.camera.updateProjectionMatrix();

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.15;
		this.controls.rotateSpeed = 0.5;
		this.controls.minDistance = 3;
		this.controls.maxDistance = 200;

		this.raycaster = new NodeRaycaster(this.camera);

		this.timer.connect(document);
		this.setupLights();
		this.setupEvents(container);
		this.resetView();
		this.animate();
	}

	dispose() {
		// 1. Animation loop
		cancelAnimationFrame(this.animationId);
		this.cancelCameraAnimation?.();

		// 2. Timer cleanup
		this.timer.disconnect();
		this.timer.dispose();

		// 3. Event listeners
		this.container?.removeEventListener('pointermove', this.handlePointerMove);
		this.container?.removeEventListener('click', this.handleClick);

		// 4. Three.js resources
		this.controls?.dispose();

		if (this.instancedMesh) {
			this.instancedMesh.geometry.dispose();
			if (this.instancedMesh.material instanceof THREE.Material) {
				this.instancedMesh.material.dispose();
			}
		}
		if (this.edgeLines) {
			this.edgeLines.geometry.dispose();
			if (this.edgeLines.material instanceof THREE.Material) {
				this.edgeLines.material.dispose();
			}
		}

		this.scene.clear();

		// 5. WebGL context release (forceContextLoss before dispose)
		this.renderer?.forceContextLoss();
		this.renderer?.dispose();

		// 6. DOM cleanup
		if (this.container && this.renderer?.domElement.parentNode === this.container) {
			this.container.removeChild(this.renderer.domElement);
		}
	}

	setGraphModel(model: GraphModel) {
		this.graph = model;
		this.rebuildScene(model);
	}

	focusCluster(clusterId: string) {
		const cluster = this.graph?.clusters.find((c) => c.id === clusterId);
		if (cluster) {
			this.cancelCameraAnimation?.();
			this.cancelCameraAnimation = animateCamera(
				this.camera,
				this.controls,
				clusterPreset(cluster.centerX),
			);
		}
	}

	focusNode(nodeId: string) {
		const node = this.graph?.nodes.get(nodeId);
		if (node) {
			this.cancelCameraAnimation?.();
			this.cancelCameraAnimation = animateCamera(
				this.camera,
				this.controls,
				nodePreset(node.position.x, node.position.y, node.position.z),
			);
		}
	}

	resetView() {
		const bounds = this.getSceneBounds();
		if (bounds) {
			const { cx, cy, spanX, spanY } = bounds;
			const margin = 1.3;
			const vFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
			const aspect = this.camera.aspect;
			const distY = (spanY * margin) / (2 * Math.tan(vFov));
			const distX = (spanX * margin) / (2 * Math.tan(vFov) * aspect);
			const dist = Math.max(distY, distX, 15);
			const elevate = spanY * 0.1;

			this.cancelCameraAnimation?.();
			this.cancelCameraAnimation = animateCamera(this.camera, this.controls, {
				position: new THREE.Vector3(cx, cy + elevate, dist),
				lookAt: new THREE.Vector3(cx, cy, 0),
			});
		} else {
			const clusterCount = this.graph?.clusters.length ?? 1;
			this.cancelCameraAnimation?.();
			this.cancelCameraAnimation = animateCamera(
				this.camera,
				this.controls,
				overviewPreset(clusterCount),
			);
		}
	}

	zoomIn(): void {
		const dir = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
		const newPos = this.camera.position.clone().addScaledVector(dir, 0.2);
		if (newPos.distanceTo(this.controls.target) < this.controls.minDistance) return;
		this.cancelCameraAnimation?.();
		this.cancelCameraAnimation = animateCamera(this.camera, this.controls, {
			position: newPos,
			lookAt: this.controls.target.clone(),
		});
	}

	zoomOut(): void {
		const dir = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
		const newPos = this.camera.position.clone().addScaledVector(dir, -0.2);
		if (newPos.distanceTo(this.controls.target) > this.controls.maxDistance) return;
		this.cancelCameraAnimation?.();
		this.cancelCameraAnimation = animateCamera(this.camera, this.controls, {
			position: newPos,
			lookAt: this.controls.target.clone(),
		});
	}

	setViewPreset(preset: 'top' | 'front'): void {
		const bounds = this.getSceneBounds();
		const cx = bounds?.cx ?? 0;
		const cy = bounds?.cy ?? 0;
		const span = bounds ? Math.max(bounds.spanX, bounds.spanY) : 20;
		const target = preset === 'top' ? topDownPreset(cx, cy, span) : frontPreset(cx, cy, span);
		this.cancelCameraAnimation?.();
		this.cancelCameraAnimation = animateCamera(this.camera, this.controls, target);
	}

	private getSceneBounds(): { cx: number; cy: number; spanX: number; spanY: number } | null {
		if (!this.graph || this.graph.nodes.size === 0) return null;
		const nodes = Array.from(this.graph.nodes.values());
		let minX = Infinity,
			maxX = -Infinity;
		let minY = Infinity,
			maxY = -Infinity;
		for (const n of nodes) {
			minX = Math.min(minX, n.position.x);
			maxX = Math.max(maxX, n.position.x);
			minY = Math.min(minY, n.position.y);
			maxY = Math.max(maxY, n.position.y);
		}
		return {
			cx: (minX + maxX) / 2,
			cy: (minY + maxY) / 2,
			spanX: maxX - minX || 10,
			spanY: maxY - minY || 10,
		};
	}

	onNodeClick(callback: (nodeId: string) => void) {
		this.clickCallback = callback;
	}

	onNodeHover(callback: (nodeId: string | null, position?: { x: number; y: number }) => void) {
		this.hoverCallback = callback;
	}

	resize() {
		if (!this.container) return;
		const w = this.container.clientWidth;
		const h = this.container.clientHeight;
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(w, h);
	}

	private setupLights() {
		const ambient = new THREE.AmbientLight(0xffffff, 0.4);
		this.scene.add(ambient);
		const directional = new THREE.DirectionalLight(0xffffff, 0.8);
		directional.position.set(10, 20, 10);
		this.scene.add(directional);

		// HUD grid floor
		const grid = new THREE.GridHelper(200, 40, 0x0a2030, 0x061520);
		this.scene.add(grid);
	}

	private handlePointerMove = (e: PointerEvent) => {
		this.raycaster.updatePointer(e, this.container!);
		const nodeId = this.raycaster.pick();
		if (nodeId !== this.hoveredNodeId) {
			this.hoveredNodeId = nodeId;
			// Disable camera rotation while hovering a node so click targets stay stable
			this.controls.enableRotate = nodeId == null;
			this.hoverCallback?.(nodeId, nodeId ? { x: e.clientX, y: e.clientY } : undefined);
		}
	};

	private handleClick = (e: MouseEvent) => {
		this.raycaster.updatePointer(e as PointerEvent, this.container!);
		const nodeId = this.raycaster.pick();
		if (nodeId) {
			this.clickCallback?.(nodeId);
		}
	};

	private setupEvents(container: HTMLElement) {
		container.addEventListener('pointermove', this.handlePointerMove);
		container.addEventListener('click', this.handleClick);
	}

	private rebuildScene(model: GraphModel) {
		// Remove old meshes
		if (this.instancedMesh) {
			this.scene.remove(this.instancedMesh);
			this.instancedMesh.geometry.dispose();
			if (this.instancedMesh.material instanceof THREE.Material) {
				this.instancedMesh.material.dispose();
			}
		}
		if (this.edgeLines) {
			this.scene.remove(this.edgeLines);
			this.edgeLines.geometry.dispose();
			if (this.edgeLines.material instanceof THREE.Material) {
				this.edgeLines.material.dispose();
			}
		}

		const nodes = Array.from(model.nodes.values());
		if (nodes.length === 0) return;

		// Instanced mesh for nodes
		const material = createNodeMaterial();
		const mesh = new THREE.InstancedMesh(NODE_GEOMETRY, material, nodes.length);
		const matrix = new THREE.Matrix4();
		const color = new THREE.Color();

		this.nodeIds = [];
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (!node) continue;
			this.nodeIds.push(node.id);
			const scale = node.visual.size;
			matrix.makeScale(scale, scale, scale);
			matrix.setPosition(node.position.x, node.position.y, node.position.z);
			mesh.setMatrixAt(i, matrix);
			color.set(node.visual.color);
			mesh.setColorAt(i, color);
		}
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		this.scene.add(mesh);
		this.instancedMesh = mesh;
		this.raycaster.setInstancedMesh(mesh, this.nodeIds);

		// Edge lines
		if (model.edges.length > 0) {
			const positions: number[] = [];
			for (const edge of model.edges) {
				const src = model.nodes.get(edge.source);
				const tgt = model.nodes.get(edge.target);
				if (src && tgt) {
					positions.push(
						src.position.x,
						src.position.y,
						src.position.z,
						tgt.position.x,
						tgt.position.y,
						tgt.position.z,
					);
				}
			}
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
			const edgeMat = createEdgeMaterial();
			this.edgeLines = new THREE.LineSegments(geometry, edgeMat);
			this.scene.add(this.edgeLines);
		}
	}

	private animate() {
		this.animationId = requestAnimationFrame((timestamp) => {
			this.timer.update(timestamp);

			this.controls.update();
			this.renderer.render(this.scene, this.camera);
			this.animate();
		});
	}
}
