import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GraphModel } from '$lib/graph/model';
import type { SceneRenderer } from '../types';
import { animateCamera, clusterPreset, nodePreset, overviewPreset } from './camera-presets';
import { createEdgeMaterial, createNodeMaterial } from './node-material';
import { NodeRaycaster } from './raycaster';

const NODE_GEOMETRY = new THREE.SphereGeometry(0.3, 16, 12);
const PULSE_SPEED = 2;

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
	private clock = new THREE.Clock();

	mount(container: HTMLElement) {
		this.container = container;
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(container.clientWidth, container.clientHeight);
		this.renderer.setClearColor(0x050a0e, 1);
		container.appendChild(this.renderer.domElement);

		this.camera.aspect = container.clientWidth / container.clientHeight;
		this.camera.updateProjectionMatrix();

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.05;

		this.raycaster = new NodeRaycaster(this.camera);

		this.setupLights();
		this.setupEvents(container);
		this.resetView();
		this.animate();
	}

	dispose() {
		cancelAnimationFrame(this.animationId);
		this.controls?.dispose();
		this.renderer?.dispose();
		if (this.container && this.renderer?.domElement.parentNode === this.container) {
			this.container.removeChild(this.renderer.domElement);
		}
		this.scene.clear();
	}

	setGraphModel(model: GraphModel) {
		this.graph = model;
		this.rebuildScene(model);
	}

	focusCluster(clusterId: string) {
		const cluster = this.graph?.clusters.find((c) => c.id === clusterId);
		if (cluster) {
			animateCamera(this.camera, this.controls, clusterPreset(cluster.centerX));
		}
	}

	focusNode(nodeId: string) {
		const node = this.graph?.nodes.get(nodeId);
		if (node) {
			animateCamera(
				this.camera,
				this.controls,
				nodePreset(node.position.x, node.position.y, node.position.z),
			);
		}
	}

	resetView() {
		const clusterCount = this.graph?.clusters.length ?? 1;
		animateCamera(this.camera, this.controls, overviewPreset(clusterCount));
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

	private setupEvents(container: HTMLElement) {
		container.addEventListener('pointermove', (e) => {
			this.raycaster.updatePointer(e, container);
			const nodeId = this.raycaster.pick();
			if (nodeId !== this.hoveredNodeId) {
				this.hoveredNodeId = nodeId;
				this.hoverCallback?.(nodeId, nodeId ? { x: e.clientX, y: e.clientY } : undefined);
			}
		});

		container.addEventListener('click', (e) => {
			this.raycaster.updatePointer(e as PointerEvent, container);
			const nodeId = this.raycaster.pick();
			if (nodeId) {
				this.clickCallback?.(nodeId);
			}
		});
	}

	private rebuildScene(model: GraphModel) {
		// Remove old meshes
		if (this.instancedMesh) {
			this.scene.remove(this.instancedMesh);
			this.instancedMesh.dispose();
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
		this.animationId = requestAnimationFrame(() => this.animate());
		this.clock.getDelta();

		// Pulse animation for recently observed nodes
		if (this.instancedMesh && this.graph) {
			const time = this.clock.getElapsedTime();
			const nodes = Array.from(this.graph.nodes.values());
			const matrix = new THREE.Matrix4();
			for (let i = 0; i < nodes.length; i++) {
				const node = nodes[i];
				if (!node) continue;
				if (node.visual.pulse) {
					const scale = node.visual.size * (1 + 0.15 * Math.sin(time * PULSE_SPEED));
					matrix.makeScale(scale, scale, scale);
					matrix.setPosition(node.position.x, node.position.y, node.position.z);
					this.instancedMesh.setMatrixAt(i, matrix);
				}
			}
			this.instancedMesh.instanceMatrix.needsUpdate = true;
		}

		this.controls.update();
		this.renderer.render(this.scene, this.camera);
	}
}
