import type { GraphModel, GraphNode, Severity } from '$lib/graph/model';
import { SEVERITY_NOTCHES } from '$lib/graph/model';
import type { CameraMove, SceneRenderer } from '../types';

const PADDING = 40;
export const NODE_MIN_RADIUS = 4;
export const NODE_MAX_RADIUS = 16;
const NODE_SIZE_RANGE = 3;
const LABEL_FONT = '11px monospace';
const LABEL_COUNT = 15;

/** Mirrors the 3D controls' minDistance/maxDistance so 2D zoom cannot run away either. */
export const MIN_ZOOM_FACTOR = 0.25;
export const MAX_ZOOM_FACTOR = 12;

/** --color-hud-void, the same ink the 3D bands and the DOM badge use. */
export const NOTCH_TICK_COLOR = '#050a0e';
export const SELECTION_COLOR = '#00e5ff';
const HOVER_COLOR = '#00e5ff';

/** A press and release this close together is a click; anything further is a pan. */
const CLICK_DRAG_THRESHOLD_PX = 5;
/** One keyboard step is a fraction of the shorter canvas edge, so it reads the same at any zoom. */
const PAN_STEP_RATIO = 0.15;
const KEY_MOVE_STEPS_PER_SECOND = 2;
const WHEEL_ZOOM_FACTOR = 1.12;

const NOTCH_TICK_PITCH = Math.PI / 5.6;
const NOTCH_TICK_INNER = 0.42;
const NOTCH_TICK_OUTER = 0.96;

export interface ViewTransform {
	scale: number;
	offsetX: number;
	offsetY: number;
}

export interface RadialTick {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export function nodeRadius(visualSize: number): number {
	const t = Math.max(0, Math.min(1, visualSize / NODE_SIZE_RANGE));
	return NODE_MIN_RADIUS + (NODE_MAX_RADIUS - NODE_MIN_RADIUS) * t;
}

export function clampZoomScale(scale: number, fitScale: number): number {
	if (!(fitScale > 0)) return scale;
	return Math.min(Math.max(scale, fitScale * MIN_ZOOM_FACTOR), fitScale * MAX_ZOOM_FACTOR);
}

export function computeFitView(
	nodes: GraphNode[],
	canvasW: number,
	canvasH: number,
): ViewTransform | null {
	if (nodes.length === 0) return null;

	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const n of nodes) {
		if (n.position.x < minX) minX = n.position.x;
		if (n.position.x > maxX) maxX = n.position.x;
		if (n.position.y < minY) minY = n.position.y;
		if (n.position.y > maxY) maxY = n.position.y;
	}

	const spanX = maxX - minX || 1;
	const spanY = maxY - minY || 1;
	const scale = Math.min((canvasW - PADDING * 2) / spanX, (canvasH - PADDING * 2) / spanY);

	return {
		scale,
		offsetX: canvasW / 2 - ((minX + maxX) / 2) * scale,
		offsetY: canvasH / 2 - ((minY + maxY) / 2) * scale,
	};
}

/** Severity rank as ticks counted clockwise from noon, matching the 3D bands and the DOM badge. */
export function computeNotchTicks(severity: Severity, radius: number): RadialTick[] {
	const ticks: RadialTick[] = [];
	for (let i = 0; i < SEVERITY_NOTCHES[severity]; i++) {
		const angle = -Math.PI / 2 + i * NOTCH_TICK_PITCH;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		ticks.push({
			x1: cos * radius * NOTCH_TICK_INNER,
			y1: sin * radius * NOTCH_TICK_INNER,
			x2: cos * radius * NOTCH_TICK_OUTER,
			y2: sin * radius * NOTCH_TICK_OUTER,
		});
	}
	return ticks;
}

export function pickNodeAt(
	nodes: GraphNode[],
	sx: number,
	sy: number,
	view: ViewTransform,
): string | null {
	// Reverse order so top-drawn nodes are tested first
	for (let i = nodes.length - 1; i >= 0; i--) {
		const node = nodes[i];
		if (!node) continue;
		const radius = nodeRadius(node.visual.size);
		const dx = sx - (node.position.x * view.scale + view.offsetX);
		const dy = sy - (node.position.y * view.scale + view.offsetY);
		if (dx * dx + dy * dy <= radius * radius) {
			return node.id;
		}
	}
	return null;
}

export class Canvas2DRenderer implements SceneRenderer {
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private container: HTMLElement | null = null;
	private graph: GraphModel | null = null;
	private animationId = 0;

	private clickCallback: ((nodeId: string) => void) | null = null;
	private hoverCallback:
		| ((nodeId: string | null, position?: { x: number; y: number }) => void)
		| null = null;
	private hoveredNodeId: string | null = null;
	private selectedNodeId: string | null = null;

	private nodeList: GraphNode[] = [];
	private labelNodes: GraphNode[] = [];

	// View transform
	private offsetX = 0;
	private offsetY = 0;
	private scale = 1;
	private fitScale = 0;
	private viewFitted = false;

	private pointerDownAt: { x: number; y: number } | null = null;
	private dragFrom: { x: number; y: number } | null = null;
	private velocity: CameraMove = {};

	mount(container: HTMLElement) {
		this.container = container;
		this.canvas = document.createElement('canvas');
		this.canvas.style.width = '100%';
		this.canvas.style.height = '100%';
		this.canvas.style.display = 'block';
		container.appendChild(this.canvas);
		this.ctx = this.canvas.getContext('2d');
		this.resize();
		this.setupEvents();
		this.draw();
	}

	dispose() {
		this.velocity = {};
		this.stopMoveLoop();
		// Remove event listeners
		this.canvas?.removeEventListener('pointermove', this.handlePointerMove);
		this.canvas?.removeEventListener('pointerdown', this.handlePointerDown);
		this.canvas?.removeEventListener('pointerup', this.handlePointerUp);
		this.canvas?.removeEventListener('pointercancel', this.handlePointerUp);
		this.canvas?.removeEventListener('wheel', this.handleWheel);
		// DOM cleanup
		if (this.canvas && this.canvas.parentNode === this.container) {
			this.container?.removeChild(this.canvas);
		}
		this.canvas = null;
		this.ctx = null;
	}

	setGraphModel(model: GraphModel) {
		const cameFromEmpty = this.nodeList.length === 0;
		this.graph = model;
		this.nodeList = Array.from(model.nodes.values());
		// Sorting the label set here keeps it off the per-frame path
		this.labelNodes = [...this.nodeList]
			.sort((a, b) => b.decreeScore - a.decreeScore)
			.slice(0, LABEL_COUNT);
		// Findings reload on every filter change and SSE event; refitting then would undo the user's pan.
		if (!this.viewFitted || cameFromEmpty) this.fitView();
		this.draw();
	}

	focusCluster(clusterId: string) {
		const cluster = this.graph?.clusters.find((c) => c.id === clusterId);
		if (cluster && this.canvas) {
			this.offsetX = this.canvasWidth() / 2 - cluster.centerX * this.scale;
			this.draw();
		}
	}

	focusNode(nodeId: string) {
		const node = this.graph?.nodes.get(nodeId);
		if (node && this.canvas) {
			this.offsetX = this.canvasWidth() / 2 - node.position.x * this.scale;
			this.offsetY = this.canvasHeight() / 2 - node.position.y * this.scale;
			this.draw();
		}
	}

	resetView() {
		this.fitView();
		this.draw();
	}

	zoomIn(): void {
		this.applyZoom(1.25);
	}

	zoomOut(): void {
		this.applyZoom(0.8);
	}

	setViewPreset(_preset: 'top' | 'front'): void {
		this.fitView();
		this.draw();
	}

	moveCamera(move: CameraMove): void {
		if (!this.canvas) return;
		const step = Math.min(this.canvasWidth(), this.canvasHeight()) * PAN_STEP_RATIO;
		const dx = -(move.right ?? 0) * step;
		const dy = (move.forward ?? 0) * step;
		if (dx === 0 && dy === 0) return;
		this.panBy(dx, dy);
	}

	setCameraVelocity(move: CameraMove): void {
		this.velocity = move;
		if ((move.right ?? 0) !== 0 || (move.forward ?? 0) !== 0) {
			this.startMoveLoop();
		} else {
			this.stopMoveLoop();
		}
	}

	/** 2D draws on demand, so held keys need a loop of their own rather than a permanent one. */
	private startMoveLoop() {
		if (this.animationId) return;
		let last = performance.now();
		const tick = (now: number) => {
			this.stepCamera((now - last) / 1000);
			last = now;
			this.animationId = requestAnimationFrame(tick);
		};
		this.animationId = requestAnimationFrame(tick);
	}

	private stopMoveLoop() {
		cancelAnimationFrame(this.animationId);
		this.animationId = 0;
	}

	private stepCamera(delta: number) {
		if (delta <= 0) return;
		const { right = 0, forward = 0 } = this.velocity;
		if (right === 0 && forward === 0) return;
		const factor = KEY_MOVE_STEPS_PER_SECOND * delta;
		this.moveCamera({ right: right * factor, forward: forward * factor });
	}

	private panBy(dx: number, dy: number) {
		this.offsetX += dx;
		this.offsetY += dy;
		this.draw();
	}

	setSelectedNode(nodeId: string | null): void {
		if (nodeId === this.selectedNodeId) return;
		this.selectedNodeId = nodeId;
		this.draw();
	}

	onNodeClick(callback: (nodeId: string) => void) {
		this.clickCallback = callback;
	}

	onNodeHover(callback: (nodeId: string | null, position?: { x: number; y: number }) => void) {
		this.hoverCallback = callback;
	}

	resize() {
		if (!this.canvas || !this.container) return;
		const dpr = window.devicePixelRatio || 1;
		const w = this.container.clientWidth;
		const h = this.container.clientHeight;
		this.canvas.width = w * dpr;
		this.canvas.height = h * dpr;
		this.draw();
	}

	private canvasWidth(): number {
		return (this.canvas?.width ?? 0) / (window.devicePixelRatio || 1);
	}

	private canvasHeight(): number {
		return (this.canvas?.height ?? 0) / (window.devicePixelRatio || 1);
	}

	private applyZoom(factor: number) {
		this.applyZoomAt(factor, this.canvasWidth() / 2, this.canvasHeight() / 2);
	}

	private applyZoomAt(factor: number, cx: number, cy: number) {
		if (!this.canvas) return;
		const next = clampZoomScale(this.scale * factor, this.fitScale);
		const applied = next / this.scale;
		this.offsetX = cx - (cx - this.offsetX) * applied;
		this.offsetY = cy - (cy - this.offsetY) * applied;
		this.scale = next;
		this.draw();
	}

	private fitView() {
		if (!this.canvas) return;
		const view = computeFitView(this.nodeList, this.canvasWidth(), this.canvasHeight());
		if (!view) return;
		this.viewFitted = true;
		this.scale = view.scale;
		this.fitScale = view.scale;
		this.offsetX = view.offsetX;
		this.offsetY = view.offsetY;
	}

	private worldToScreen(x: number, y: number): { sx: number; sy: number } {
		return {
			sx: x * this.scale + this.offsetX,
			sy: y * this.scale + this.offsetY,
		};
	}

	private draw() {
		const ctx = this.ctx;
		if (!ctx || !this.canvas) return;

		const dpr = window.devicePixelRatio || 1;
		const w = this.canvas.width / dpr;
		const h = this.canvas.height / dpr;

		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = '#050a0e';
		ctx.fillRect(0, 0, w, h);

		if (!this.graph) {
			ctx.restore();
			return;
		}

		// Draw edges
		ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
		ctx.lineWidth = 1;
		for (const edge of this.graph.edges) {
			const src = this.graph.nodes.get(edge.source);
			const tgt = this.graph.nodes.get(edge.target);
			if (src && tgt) {
				const a = this.worldToScreen(src.position.x, src.position.y);
				const b = this.worldToScreen(tgt.position.x, tgt.position.y);
				ctx.beginPath();
				ctx.moveTo(a.sx, a.sy);
				ctx.lineTo(b.sx, b.sy);
				ctx.stroke();
			}
		}

		// Draw nodes, each carrying its severity rank as dark radial ticks
		ctx.lineCap = 'round';
		let selected: { sx: number; sy: number; radius: number } | null = null;
		for (const node of this.nodeList) {
			const { sx, sy } = this.worldToScreen(node.position.x, node.position.y);
			const radius = nodeRadius(node.visual.size);

			ctx.globalAlpha = node.visual.opacity;
			ctx.fillStyle = node.visual.color;
			ctx.beginPath();
			ctx.arc(sx, sy, radius, 0, Math.PI * 2);
			ctx.fill();

			if (node.id === this.hoveredNodeId) {
				ctx.strokeStyle = HOVER_COLOR;
				ctx.lineWidth = 2;
				ctx.stroke();
			}

			ctx.globalAlpha = 1;
			ctx.strokeStyle = NOTCH_TICK_COLOR;
			ctx.lineWidth = Math.max(1.4, radius * 0.2);
			for (const tick of computeNotchTicks(node.severity, radius)) {
				ctx.beginPath();
				ctx.moveTo(sx + tick.x1, sy + tick.y1);
				ctx.lineTo(sx + tick.x2, sy + tick.y2);
				ctx.stroke();
			}

			if (node.id === this.selectedNodeId) {
				selected = { sx, sy, radius };
			}
		}
		ctx.lineCap = 'butt';

		if (selected) {
			ctx.strokeStyle = SELECTION_COLOR;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(selected.sx, selected.sy, selected.radius + 4, 0, Math.PI * 2);
			ctx.stroke();

			ctx.globalAlpha = 0.45;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(selected.sx, selected.sy, selected.radius + 9, 0, Math.PI * 2);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}

		// Draw labels for high-score nodes
		ctx.font = LABEL_FONT;
		ctx.fillStyle = '#7a9ab5';
		ctx.textAlign = 'center';
		for (const node of this.labelNodes) {
			const { sx, sy } = this.worldToScreen(node.position.x, node.position.y);
			ctx.fillText(node.advisoryId, sx, sy - 12);
		}

		ctx.restore();
	}

	private handlePointerMove = (e: PointerEvent) => {
		const canvas = this.canvas;
		if (!canvas) return;

		if (this.dragFrom) {
			this.panBy(e.clientX - this.dragFrom.x, e.clientY - this.dragFrom.y);
			this.dragFrom = { x: e.clientX, y: e.clientY };
			return;
		}

		const rect = canvas.getBoundingClientRect();
		const nodeId = pickNodeAt(this.nodeList, e.clientX - rect.left, e.clientY - rect.top, {
			scale: this.scale,
			offsetX: this.offsetX,
			offsetY: this.offsetY,
		});
		if (nodeId !== this.hoveredNodeId) {
			this.hoveredNodeId = nodeId;
			this.hoverCallback?.(nodeId, nodeId ? { x: e.clientX, y: e.clientY } : undefined);
			this.draw();
		}
	};

	private handlePointerDown = (e: PointerEvent) => {
		this.pointerDownAt = { x: e.clientX, y: e.clientY };
		this.dragFrom = { x: e.clientX, y: e.clientY };
		this.canvas?.setPointerCapture?.(e.pointerId);
	};

	private handlePointerUp = (e: PointerEvent) => {
		const start = this.pointerDownAt;
		this.pointerDownAt = null;
		this.dragFrom = null;
		this.canvas?.releasePointerCapture?.(e.pointerId);

		const canvas = this.canvas;
		if (!start || !canvas) return;
		if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_DRAG_THRESHOLD_PX) return;

		const rect = canvas.getBoundingClientRect();
		const nodeId = pickNodeAt(this.nodeList, e.clientX - rect.left, e.clientY - rect.top, {
			scale: this.scale,
			offsetX: this.offsetX,
			offsetY: this.offsetY,
		});
		if (nodeId) {
			this.clickCallback?.(nodeId);
		}
	};

	private handleWheel = (e: WheelEvent) => {
		const canvas = this.canvas;
		if (!canvas) return;
		e.preventDefault();
		const rect = canvas.getBoundingClientRect();
		const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
		this.applyZoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
	};

	private setupEvents() {
		if (!this.canvas) return;
		this.canvas.addEventListener('pointermove', this.handlePointerMove);
		this.canvas.addEventListener('pointerdown', this.handlePointerDown);
		this.canvas.addEventListener('pointerup', this.handlePointerUp);
		this.canvas.addEventListener('pointercancel', this.handlePointerUp);
		this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
	}
}
