import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GraphModel, GraphNode } from '$lib/graph/model';
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

const NODE_GEOMETRY = new THREE.CylinderGeometry(0.16, 0.26, 1, 6, 1, false);
const MIN_COLUMN_HEIGHT = 0.6;
const MAX_COLUMN_WIDTH = 0.5;
const DISTRICT_PADDING_X = 1.8;
const DISTRICT_PADDING_Z = 1.6;
const DISTRICT_FLOOR_Y = -0.04;
const DISTRICT_PLATE_HEIGHT = 0.05;
const CAMERA_VERTICAL_PADDING = 9;

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
	private districtGroup: THREE.Group | null = null;
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
		this.disposeDistricts();

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
		this.resetView();
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
			const { cx, cz, maxHeight, spanX, spanZ } = bounds;
			const horizontalSpan = Math.max(spanX, spanZ);
			const dist = Math.max(horizontalSpan * 1.45, maxHeight * 1.35, 18);
			const elevate = Math.max(CAMERA_VERTICAL_PADDING, maxHeight * 0.7);

			this.cancelCameraAnimation?.();
			this.cancelCameraAnimation = animateCamera(this.camera, this.controls, {
				position: new THREE.Vector3(cx + horizontalSpan * 0.32, elevate, cz + dist),
				lookAt: new THREE.Vector3(cx, maxHeight * 0.35, cz),
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
		const cy = bounds ? bounds.maxHeight * 0.35 : 0;
		const span = bounds ? Math.max(bounds.spanX, bounds.spanZ) : 20;
		const target = preset === 'top' ? topDownPreset(cx, cy, span) : frontPreset(cx, cy, span);
		this.cancelCameraAnimation?.();
		this.cancelCameraAnimation = animateCamera(this.camera, this.controls, target);
	}

	private getSceneBounds(): {
		cx: number;
		cz: number;
		maxHeight: number;
		spanX: number;
		spanZ: number;
	} | null {
		if (!this.graph || this.graph.nodes.size === 0) return null;
		const nodes = Array.from(this.graph.nodes.values());
		let minX = Infinity,
			maxX = -Infinity;
		let minZ = Infinity,
			maxZ = -Infinity;
		let maxHeight = 0;
		for (const n of nodes) {
			minX = Math.min(minX, n.position.x);
			maxX = Math.max(maxX, n.position.x);
			minZ = Math.min(minZ, n.position.z);
			maxZ = Math.max(maxZ, n.position.z);
			maxHeight = Math.max(maxHeight, this.getColumnHeight(n));
		}
		return {
			cx: (minX + maxX) / 2,
			cz: (minZ + maxZ) / 2,
			maxHeight,
			spanX: maxX - minX || 10,
			spanZ: maxZ - minZ || 10,
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
		const ambient = new THREE.AmbientLight(0xffffff, 0.48);
		this.scene.add(ambient);
		const directional = new THREE.DirectionalLight(0x7ddcff, 1.15);
		directional.position.set(12, 24, 10);
		this.scene.add(directional);
		const rim = new THREE.DirectionalLight(0xff7a18, 0.35);
		rim.position.set(-10, 12, -14);
		this.scene.add(rim);

		const grid = new THREE.GridHelper(200, 40, 0x12314a, 0x07131d);
		this.scene.add(grid);
	}

	private handlePointerMove = (e: PointerEvent) => {
		if (!this.container) return;
		this.raycaster.updatePointer(e, this.container);
		const nodeId = this.raycaster.pick();
		if (nodeId !== this.hoveredNodeId) {
			this.hoveredNodeId = nodeId;
			// Disable camera rotation while hovering a node so click targets stay stable
			this.controls.enableRotate = nodeId == null;
			this.hoverCallback?.(nodeId, nodeId ? { x: e.clientX, y: e.clientY } : undefined);
		}
	};

	private handleClick = (e: MouseEvent) => {
		if (!this.container) return;
		this.raycaster.updatePointer(e as PointerEvent, this.container);
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
		this.disposeDistricts();

		const nodes = Array.from(model.nodes.values());
		if (nodes.length === 0) return;

		this.districtGroup = this.createDistrictGroup(model);
		this.scene.add(this.districtGroup);

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
			const width = Math.min(MAX_COLUMN_WIDTH, 0.18 + node.visual.size * 0.12);
			const height = this.getColumnHeight(node);
			matrix.makeScale(width, height, width);
			matrix.setPosition(node.position.x, height / 2, node.position.z);
			mesh.setMatrixAt(i, matrix);
			color.set(node.visual.color).lerp(new THREE.Color(0xffffff), node.epssScore * 0.18);
			mesh.setColorAt(i, color);
		}
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
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

	private getColumnHeight(node: GraphNode): number {
		return Math.max(MIN_COLUMN_HEIGHT, 1 + node.decreeScore * 1.1);
	}

	private createDistrictGroup(model: GraphModel): THREE.Group {
		const group = new THREE.Group();
		group.name = 'districts';

		for (const cluster of model.clusters) {
			const clusterNodes = cluster.nodes
				.map((nodeId) => model.nodes.get(nodeId))
				.filter((node): node is NonNullable<typeof node> => Boolean(node));
			if (clusterNodes.length === 0) continue;

			let minX = Infinity;
			let maxX = -Infinity;
			let minZ = Infinity;
			let maxZ = -Infinity;

			for (const node of clusterNodes) {
				minX = Math.min(minX, node.position.x);
				maxX = Math.max(maxX, node.position.x);
				minZ = Math.min(minZ, node.position.z);
				maxZ = Math.max(maxZ, node.position.z);
			}

			const width = Math.max(2.4, maxX - minX + DISTRICT_PADDING_X);
			const depth = Math.max(2.8, maxZ - minZ + DISTRICT_PADDING_Z);
			const centerX = (minX + maxX) / 2;
			const centerZ = (minZ + maxZ) / 2;

			const plate = new THREE.Mesh(
				new THREE.BoxGeometry(width, DISTRICT_PLATE_HEIGHT, depth),
				new THREE.MeshBasicMaterial({
					color: 0x081723,
					transparent: true,
					opacity: 0.92,
				}),
			);
			plate.position.set(centerX, DISTRICT_FLOOR_Y, centerZ);
			group.add(plate);

			const outlinePoints = [
				new THREE.Vector3(centerX - width / 2, 0.01, centerZ - depth / 2),
				new THREE.Vector3(centerX + width / 2, 0.01, centerZ - depth / 2),
				new THREE.Vector3(centerX + width / 2, 0.01, centerZ + depth / 2),
				new THREE.Vector3(centerX - width / 2, 0.01, centerZ + depth / 2),
				new THREE.Vector3(centerX - width / 2, 0.01, centerZ - depth / 2),
			];
			const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints);
			const outline = new THREE.Line(
				outlineGeometry,
				new THREE.LineBasicMaterial({
					color: 0x1a5d8f,
					transparent: true,
					opacity: 0.9,
				}),
			);
			group.add(outline);

			const beaconGeometry = new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(centerX, 0.01, centerZ),
				new THREE.Vector3(centerX, 0.9, centerZ),
			]);
			const beacon = new THREE.Line(
				beaconGeometry,
				new THREE.LineBasicMaterial({
					color: 0x00e5ff,
					transparent: true,
					opacity: 0.55,
				}),
			);
			group.add(beacon);
		}

		return group;
	}

	private disposeDistricts() {
		if (!this.districtGroup) return;
		this.scene.remove(this.districtGroup);
		for (const child of this.districtGroup.children) {
			if ('geometry' in child && child.geometry instanceof THREE.BufferGeometry) {
				child.geometry.dispose();
			}
			const material = 'material' in child ? child.material : null;
			if (Array.isArray(material)) {
				for (const item of material) item.dispose();
			} else if (material instanceof THREE.Material) {
				material.dispose();
			}
		}
		this.districtGroup.clear();
		this.districtGroup = null;
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
