import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GraphModel, GraphNode, Severity } from '$lib/graph/model';
import { SEVERITY_NOTCHES } from '$lib/graph/model';
import type { CameraMove, SceneRenderer } from '../types';
import {
	animateCamera,
	clusterPreset,
	FRONT_DIRECTION,
	fitPreset,
	nodePreset,
	overviewPreset,
	TOP_DIRECTION,
} from './camera-presets';
import {
	createEdgeMaterial,
	createGlowMaterial,
	createNodeMaterial,
	createNotchMaterial,
	GLOW_MAX_INTENSITY,
	GLOW_MIN_INTENSITY,
	GLOW_PERIOD,
} from './node-material';
import { NodeRaycaster } from './raycaster';

const COLUMN_RADIUS_TOP = 0.16;
const COLUMN_RADIUS_BOTTOM = 0.26;
const MIN_COLUMN_HEIGHT = 0.6;
const MAX_COLUMN_WIDTH = 0.5;
const DISTRICT_PADDING_X = 1.8;
const DISTRICT_PADDING_Z = 1.6;
const DISTRICT_FLOOR_Y = -0.04;
const DISTRICT_PLATE_HEIGHT = 0.05;
const EDGE_ATTACH_RATIO = 0.92;
const DEFAULT_MAX_DISTANCE = 200;

/** A press and release this close together is a click; anything further is a camera drag. */
const CLICK_DRAG_THRESHOLD_PX = 5;

/** The camera may not sink into the ground plane, whatever the keys ask for. */
export const MIN_CAMERA_HEIGHT = 0.5;

const MIN_SCENE_SCALE = 20;
const MOVE_STEP_RATIO = 0.15;
const KEY_MOVE_STEPS_PER_SECOND = 2;
const ROAM_RADIUS_RATIO = 1.5;
const ROAM_HEIGHT_RATIO = 1.2;
/** Just short of level, so orbiting never puts the viewer under the district plates. */
const MAX_POLAR_ANGLE = Math.PI * 0.495;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

const NOTCH_SLOT_PITCH_RATIO = 0.1;
const NOTCH_MAX_SLOT_PITCH = 0.18;
const NOTCH_THICKNESS_RATIO = 0.5;
const NOTCH_TOP_CLEARANCE = 1.8;
const NOTCH_RADIAL_OVERHANG = 1.45;
const CRITICAL_CAP_OVERHANG = 1.85;
const CRITICAL_CAP_THICKNESS_RATIO = 1.45;

/** One box wrapped around a column: `side` is its x/z footprint, `thickness` its height. */
export interface NotchBox {
	y: number;
	side: number;
	thickness: number;
}

function columnRadiusAt(columnHeight: number, columnWidth: number, y: number): number {
	const t = y / columnHeight;
	return columnWidth * (COLUMN_RADIUS_BOTTOM + (COLUMN_RADIUS_TOP - COLUMN_RADIUS_BOTTOM) * t);
}

function notchSlotPitch(columnHeight: number): number {
	return Math.min(columnHeight * NOTCH_SLOT_PITCH_RATIO, NOTCH_MAX_SLOT_PITCH);
}

/**
 * Bands wrap the column rather than capping it so the rank stays countable from any orbit angle.
 */
export function computeNotchBands(
	severity: Severity,
	columnHeight: number,
	columnWidth: number,
): NotchBox[] {
	const rank = SEVERITY_NOTCHES[severity];
	if (rank <= 0) return [];

	const pitch = notchSlotPitch(columnHeight);
	const thickness = pitch * NOTCH_THICKNESS_RATIO;
	const topY = columnHeight - pitch * NOTCH_TOP_CLEARANCE - thickness / 2;

	const bands: NotchBox[] = [];
	for (let i = 0; i < rank; i++) {
		const y = topY - i * pitch;
		bands.push({
			y,
			side: columnRadiusAt(columnHeight, columnWidth, y) * 2 * NOTCH_RADIAL_OVERHANG,
			thickness,
		});
	}
	return bands;
}

/** An overhanging apex slab so the top rank is identifiable before the bands become countable. */
export function computeCriticalCap(
	severity: Severity,
	columnHeight: number,
	columnWidth: number,
): NotchBox | null {
	if (severity !== 'CRITICAL') return null;
	const thickness = notchSlotPitch(columnHeight) * CRITICAL_CAP_THICKNESS_RATIO;
	return {
		y: columnHeight - thickness / 2,
		side: columnWidth * COLUMN_RADIUS_TOP * 2 * CRITICAL_CAP_OVERHANG,
		thickness,
	};
}

export class ThreeSceneRenderer implements SceneRenderer {
	private renderer!: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
	private controls!: OrbitControls;
	private raycaster!: NodeRaycaster;
	private container: HTMLElement | null = null;
	private animationId = 0;

	// Geometries are owned by the renderer instance and outlive every rebuild.
	private nodeGeometry = new THREE.CylinderGeometry(
		COLUMN_RADIUS_TOP,
		COLUMN_RADIUS_BOTTOM,
		1,
		6,
		1,
		false,
	);
	private notchGeometry = new THREE.BoxGeometry(1, 1, 1);

	private instancedMesh: THREE.InstancedMesh | null = null;
	private notchMesh: THREE.InstancedMesh | null = null;
	private edgeLines: THREE.LineSegments | null = null;
	private districtGroup: THREE.Group | null = null;
	private grid: THREE.GridHelper | null = null;
	private nodeIds: string[] = [];
	private graph: GraphModel | null = null;

	private glowMesh: THREE.Mesh | null = null;
	private glowMaterial: THREE.MeshStandardMaterial | null = null;

	private clickCallback: ((nodeId: string) => void) | null = null;
	private hoverCallback:
		| ((nodeId: string | null, position?: { x: number; y: number }) => void)
		| null = null;
	private hoveredNodeId: string | null = null;
	private timer = new THREE.Timer();
	private cancelCameraAnimation: (() => void) | null = null;

	private pointerDownAt: { x: number; y: number } | null = null;
	private velocity: CameraMove = {};
	private viewFramed = false;

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
		this.controls.maxDistance = DEFAULT_MAX_DISTANCE;
		// Panning should follow the pointer rather than slide along the ground plane.
		this.controls.screenSpacePanning = true;
		this.controls.mouseButtons = {
			LEFT: THREE.MOUSE.ROTATE,
			MIDDLE: THREE.MOUSE.PAN,
			RIGHT: THREE.MOUSE.PAN,
		};
		this.controls.maxPolarAngle = MAX_POLAR_ANGLE;

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
		this.velocity = {};
		this.container?.removeEventListener('pointermove', this.handlePointerMove);
		this.container?.removeEventListener('pointerdown', this.handlePointerDown, true);
		this.container?.removeEventListener('pointerup', this.handlePointerUp);

		// 4. Three.js resources (glow overlay)
		if (this.glowMesh) {
			this.scene.remove(this.glowMesh);
			this.glowMesh = null;
		}
		this.glowMaterial?.dispose();
		this.glowMaterial = null;

		this.controls?.dispose();

		this.disposeNodeMeshes();
		this.disposeEdgeLines();
		this.disposeDistricts();

		if (this.grid) {
			this.scene.remove(this.grid);
			this.grid.dispose();
			this.grid = null;
		}

		this.nodeGeometry.dispose();
		this.notchGeometry.dispose();

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
		// Findings reload on every filter change and SSE event; reframing then would yank the camera back.
		const cameFromEmpty = (this.graph?.nodes.size ?? 0) === 0;
		this.graph = model;
		this.rebuildScene(model);
		if (!this.viewFramed || cameFromEmpty) this.resetView();
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
		const box = this.getContentBox();
		this.viewFramed = box !== null;
		this.updateRoamLimits();
		this.cancelCameraAnimation?.();
		this.cancelCameraAnimation = animateCamera(
			this.camera,
			this.controls,
			box
				? fitPreset(box, this.camera.fov, this.camera.aspect)
				: overviewPreset(this.graph?.clusters.length ?? 1),
		);
	}

	/** The columns and their district plates — deliberately not the grid helper around them. */
	private getContentBox(): THREE.Box3 | null {
		const bounds = this.getSceneBounds();
		if (!bounds) return null;
		return new THREE.Box3(
			new THREE.Vector3(
				bounds.minX - DISTRICT_PADDING_X / 2,
				0,
				bounds.minZ - DISTRICT_PADDING_Z / 2,
			),
			new THREE.Vector3(
				bounds.maxX + DISTRICT_PADDING_X / 2,
				bounds.maxHeight,
				bounds.maxZ + DISTRICT_PADDING_Z / 2,
			),
		);
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
		const box = this.getContentBox();
		if (!box) return;
		this.cancelCameraAnimation?.();
		this.cancelCameraAnimation = animateCamera(
			this.camera,
			this.controls,
			fitPreset(
				box,
				this.camera.fov,
				this.camera.aspect,
				preset === 'top' ? TOP_DIRECTION : FRONT_DIRECTION,
			),
		);
	}

	moveCamera(move: CameraMove): void {
		if (!this.controls) return;

		const forward = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
		// Travel stays horizontal so forward does not dive into the ground when looking down.
		forward.y = 0;
		if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
		forward.normalize();
		const right = new THREE.Vector3(-forward.z, 0, forward.x);

		const step = this.moveStep();
		const offset = new THREE.Vector3()
			.addScaledVector(right, (move.right ?? 0) * step)
			.addScaledVector(forward, (move.forward ?? 0) * step);
		offset.y += (move.up ?? 0) * step;
		if (offset.lengthSq() === 0) return;

		const bounds = this.getSceneBounds();
		const scale = this.sceneScale();
		const radius = scale * ROAM_RADIUS_RATIO;
		const cx = bounds?.cx ?? 0;
		const cz = bounds?.cz ?? 0;

		const desired = this.controls.target.clone().add(offset);
		const applied = new THREE.Vector3(
			clamp(desired.x, cx - radius, cx + radius),
			clamp(desired.y, 0, scale * ROAM_HEIGHT_RATIO),
			clamp(desired.z, cz - radius, cz + radius),
		).sub(this.controls.target);

		this.controls.target.add(applied);
		this.camera.position.add(applied);
		this.clampAboveGround();
	}

	setCameraVelocity(move: CameraMove): void {
		this.velocity = move;
	}

	/** Mouse panning gets the same leash as the keys, through the controls' own target sphere. */
	private updateRoamLimits() {
		if (!this.controls) return;
		const bounds = this.getSceneBounds();
		this.controls.cursor.set(bounds?.cx ?? 0, (bounds?.maxHeight ?? 0) * 0.35, bounds?.cz ?? 0);
		const scale = this.sceneScale();
		this.controls.maxTargetRadius = scale * ROAM_RADIUS_RATIO;
		// A wide skyline needs to be framed from further out than the default ceiling allows.
		this.controls.maxDistance = Math.max(DEFAULT_MAX_DISTANCE, scale * 4);
	}

	private clampAboveGround() {
		if (this.camera.position.y >= MIN_CAMERA_HEIGHT) return;
		const lift = MIN_CAMERA_HEIGHT - this.camera.position.y;
		this.camera.position.y += lift;
		this.controls.target.y += lift;
	}

	private stepCamera(delta: number) {
		if (delta <= 0) return;
		const { right = 0, forward = 0, up = 0 } = this.velocity;
		if (right === 0 && forward === 0 && up === 0) return;
		const factor = KEY_MOVE_STEPS_PER_SECOND * delta;
		this.moveCamera({ right: right * factor, forward: forward * factor, up: up * factor });
	}

	private sceneScale(): number {
		const bounds = this.getSceneBounds();
		if (!bounds) return MIN_SCENE_SCALE;
		return Math.max(bounds.spanX, bounds.spanZ, bounds.maxHeight, MIN_SCENE_SCALE);
	}

	/** Close to a column a scene-sized step overshoots, so the orbit distance keeps it proportional. */
	private moveStep(): number {
		const scale = this.sceneScale();
		const distance = this.camera.position.distanceTo(this.controls.target);
		return clamp(distance, scale * 0.25, scale) * MOVE_STEP_RATIO;
	}

	private getSceneBounds(): {
		cx: number;
		cz: number;
		minX: number;
		maxX: number;
		minZ: number;
		maxZ: number;
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
			minX,
			maxX,
			minZ,
			maxZ,
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

	setSelectedNode(nodeId: string | null): void {
		// Remove existing glow overlay
		if (this.glowMesh) {
			this.scene.remove(this.glowMesh);
			this.glowMesh = null;
		}

		if (!nodeId || !this.instancedMesh) {
			this.glowMaterial?.dispose();
			this.glowMaterial = null;
			return;
		}

		const idx = this.nodeIds.indexOf(nodeId);
		if (idx === -1) {
			this.glowMaterial?.dispose();
			this.glowMaterial = null;
			return;
		}

		const matrix = new THREE.Matrix4();
		this.instancedMesh.getMatrixAt(idx, matrix);

		if (!this.glowMaterial) {
			this.glowMaterial = createGlowMaterial();
		}

		const mesh = new THREE.Mesh(this.nodeGeometry, this.glowMaterial);
		mesh.applyMatrix4(matrix);
		mesh.scale.multiplyScalar(1.03);
		mesh.name = 'glow-overlay';
		this.scene.add(mesh);
		this.glowMesh = mesh;
	}

	updateGlow(): void {
		if (!this.glowMesh || !this.glowMaterial) return;
		const elapsed = this.timer.getElapsed();
		const t = (elapsed % GLOW_PERIOD) / GLOW_PERIOD;
		const sine = (Math.sin(t * Math.PI * 2 - Math.PI / 2) + 1) / 2;
		this.glowMaterial.emissiveIntensity =
			GLOW_MIN_INTENSITY + sine * (GLOW_MAX_INTENSITY - GLOW_MIN_INTENSITY);
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

		this.grid = new THREE.GridHelper(200, 40, 0x12314a, 0x07131d);
		this.scene.add(this.grid);
	}

	private handlePointerMove = (e: PointerEvent) => {
		if (!this.container) return;
		this.raycaster.updatePointer(e, this.container);
		const nodeId = this.raycaster.pick();
		if (nodeId !== this.hoveredNodeId) {
			this.hoveredNodeId = nodeId;
			this.hoverCallback?.(nodeId, nodeId ? { x: e.clientX, y: e.clientY } : undefined);
		}
	};

	private handlePointerDown = (e: PointerEvent) => {
		this.pointerDownAt = { x: e.clientX, y: e.clientY };
		// OrbitControls reads mouseButtons when it handles the press, so this has to land first.
		this.controls.mouseButtons.LEFT = e.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
	};

	private handlePointerUp = (e: PointerEvent) => {
		const start = this.pointerDownAt;
		this.pointerDownAt = null;
		this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
		if (!start || !this.container) return;
		if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_DRAG_THRESHOLD_PX) return;

		this.raycaster.updatePointer(e, this.container);
		const nodeId = this.raycaster.pick();
		if (nodeId) {
			this.clickCallback?.(nodeId);
		}
	};

	private setupEvents(container: HTMLElement) {
		container.addEventListener('pointermove', this.handlePointerMove);
		container.addEventListener('pointerdown', this.handlePointerDown, true);
		container.addEventListener('pointerup', this.handlePointerUp);
	}

	private rebuildScene(model: GraphModel) {
		// Clear glow overlay from previous selection
		this.setSelectedNode(null);

		// Remove old meshes
		this.disposeNodeMeshes();
		this.disposeEdgeLines();
		this.disposeDistricts();

		this.nodeIds = [];
		const nodes = Array.from(model.nodes.values());
		if (nodes.length === 0) return;

		this.districtGroup = this.createDistrictGroup(model);
		this.scene.add(this.districtGroup);

		// Instanced mesh for nodes
		const material = createNodeMaterial();
		const mesh = new THREE.InstancedMesh(this.nodeGeometry, material, nodes.length);
		const matrix = new THREE.Matrix4();
		const color = new THREE.Color();

		const notchBoxes: Array<NotchBox & { x: number; z: number }> = [];

		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (!node) continue;
			this.nodeIds.push(node.id);
			const width = this.getColumnWidth(node);
			const height = this.getColumnHeight(node);
			matrix.makeScale(width, height, width);
			matrix.setPosition(node.position.x, height / 2, node.position.z);
			mesh.setMatrixAt(i, matrix);
			color.set(node.visual.color).lerp(new THREE.Color(0xffffff), node.epssScore * 0.18);
			mesh.setColorAt(i, color);

			for (const band of computeNotchBands(node.severity, height, width)) {
				notchBoxes.push({ ...band, x: node.position.x, z: node.position.z });
			}
			const cap = computeCriticalCap(node.severity, height, width);
			if (cap) notchBoxes.push({ ...cap, x: node.position.x, z: node.position.z });
		}
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		this.scene.add(mesh);
		this.instancedMesh = mesh;
		this.raycaster.setInstancedMesh(mesh, this.nodeIds);

		// Severity rank as dark bands — one extra draw call for the whole skyline
		if (notchBoxes.length > 0) {
			const notchMesh = new THREE.InstancedMesh(
				this.notchGeometry,
				createNotchMaterial(),
				notchBoxes.length,
			);
			notchMesh.name = 'severity-notches';
			for (let i = 0; i < notchBoxes.length; i++) {
				const box = notchBoxes[i];
				if (!box) continue;
				matrix.makeScale(box.side, box.thickness, box.side);
				matrix.setPosition(box.x, box.y, box.z);
				notchMesh.setMatrixAt(i, matrix);
			}
			notchMesh.instanceMatrix.needsUpdate = true;
			notchMesh.castShadow = false;
			notchMesh.receiveShadow = false;
			this.scene.add(notchMesh);
			this.notchMesh = notchMesh;
		}

		// Edge lines
		if (model.edges.length > 0) {
			const positions: number[] = [];
			for (const edge of model.edges) {
				const src = model.nodes.get(edge.source);
				const tgt = model.nodes.get(edge.target);
				if (src && tgt) {
					// Attach near the column tops: node.position.y is the raw score, not the built height
					positions.push(
						src.position.x,
						this.getColumnHeight(src) * EDGE_ATTACH_RATIO,
						src.position.z,
						tgt.position.x,
						this.getColumnHeight(tgt) * EDGE_ATTACH_RATIO,
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

	private getColumnWidth(node: GraphNode): number {
		return Math.min(MAX_COLUMN_WIDTH, 0.18 + node.visual.size * 0.12);
	}

	private disposeEdgeLines() {
		if (!this.edgeLines) return;
		this.scene.remove(this.edgeLines);
		this.edgeLines.geometry.dispose();
		if (this.edgeLines.material instanceof THREE.Material) {
			this.edgeLines.material.dispose();
		}
		this.edgeLines = null;
	}

	/** Meshes and materials are per-build; the geometries they share are not. */
	private disposeNodeMeshes() {
		for (const mesh of [this.instancedMesh, this.notchMesh]) {
			if (!mesh) continue;
			this.scene.remove(mesh);
			if (mesh.material instanceof THREE.Material) {
				mesh.material.dispose();
			}
			mesh.dispose();
		}
		this.instancedMesh = null;
		this.notchMesh = null;
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
			this.updateGlow();
			this.stepCamera(this.timer.getDelta());

			this.controls.update();
			this.clampAboveGround();
			this.renderer.render(this.scene, this.camera);
			this.animate();
		});
	}
}
