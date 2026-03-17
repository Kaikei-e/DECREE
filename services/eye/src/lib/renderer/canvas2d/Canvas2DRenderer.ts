import type { GraphModel } from '$lib/graph/model';
import type { SceneRenderer } from '../types';

const PADDING = 40;
const NODE_MIN_RADIUS = 4;
const NODE_MAX_RADIUS = 16;
const LABEL_FONT = '11px monospace';

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

	// View transform
	private offsetX = 0;
	private offsetY = 0;
	private scale = 1;

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
		cancelAnimationFrame(this.animationId);
		// Remove event listeners
		this.canvas?.removeEventListener('pointermove', this.handlePointerMove);
		this.canvas?.removeEventListener('click', this.handleClick);
		// DOM cleanup
		if (this.canvas && this.container) {
			this.container.removeChild(this.canvas);
		}
		this.canvas = null;
		this.ctx = null;
	}

	setGraphModel(model: GraphModel) {
		this.graph = model;
		this.fitView();
		this.draw();
	}

	focusCluster(clusterId: string) {
		const cluster = this.graph?.clusters.find((c) => c.id === clusterId);
		if (cluster && this.canvas) {
			this.offsetX = this.canvas.width / 2 - cluster.centerX * this.scale;
			this.draw();
		}
	}

	focusNode(nodeId: string) {
		const node = this.graph?.nodes.get(nodeId);
		if (node && this.canvas) {
			this.offsetX = this.canvas.width / 2 - node.position.x * this.scale;
			this.offsetY = this.canvas.height / 2 - node.position.y * this.scale;
			this.draw();
		}
	}

	resetView() {
		this.fitView();
		this.draw();
	}

	zoomIn(): void {
		if (!this.canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const cx = this.canvas.width / dpr / 2;
		const cy = this.canvas.height / dpr / 2;
		const factor = 1.25;
		this.offsetX = cx - (cx - this.offsetX) * factor;
		this.offsetY = cy - (cy - this.offsetY) * factor;
		this.scale *= factor;
		this.draw();
	}

	zoomOut(): void {
		if (!this.canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const cx = this.canvas.width / dpr / 2;
		const cy = this.canvas.height / dpr / 2;
		const factor = 0.8;
		this.offsetX = cx - (cx - this.offsetX) * factor;
		this.offsetY = cy - (cy - this.offsetY) * factor;
		this.scale *= factor;
		this.draw();
	}

	setViewPreset(_preset: 'top' | 'front'): void {
		this.fitView();
		this.draw();
	}

	setSelectedNode(_nodeId: string | null): void {}

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
		this.ctx?.scale(dpr, dpr);
		this.draw();
	}

	private fitView() {
		if (!this.graph || !this.canvas) return;
		const nodes = Array.from(this.graph.nodes.values());
		if (nodes.length === 0) return;

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

		const dpr = window.devicePixelRatio || 1;
		const canvasW = this.canvas.width / dpr;
		const canvasH = this.canvas.height / dpr;
		const spanX = maxX - minX || 1;
		const spanY = maxY - minY || 1;
		this.scale = Math.min((canvasW - PADDING * 2) / spanX, (canvasH - PADDING * 2) / spanY);
		this.offsetX = PADDING - minX * this.scale;
		this.offsetY = PADDING - minY * this.scale;
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
		ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
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

		// Draw nodes
		const nodes = Array.from(this.graph.nodes.values());
		for (const node of nodes) {
			const { sx, sy } = this.worldToScreen(node.position.x, node.position.y);
			const radius = NODE_MIN_RADIUS + (NODE_MAX_RADIUS - NODE_MIN_RADIUS) * (node.visual.size / 3);

			ctx.globalAlpha = node.visual.opacity;
			ctx.fillStyle = node.visual.color;
			ctx.beginPath();
			ctx.arc(sx, sy, radius, 0, Math.PI * 2);
			ctx.fill();

			// Hover highlight
			if (node.id === this.hoveredNodeId) {
				ctx.strokeStyle = '#00e5ff';
				ctx.lineWidth = 2;
				ctx.stroke();
			}

			ctx.globalAlpha = 1;
		}

		// Draw labels for high-score nodes
		ctx.font = LABEL_FONT;
		ctx.fillStyle = '#7a9ab5';
		ctx.textAlign = 'center';
		const sortedByScore = [...nodes].sort((a, b) => b.decreeScore - a.decreeScore);
		const labelCount = Math.min(sortedByScore.length, 15);
		for (let i = 0; i < labelCount; i++) {
			const node = sortedByScore[i];
			if (!node) continue;
			const { sx, sy } = this.worldToScreen(node.position.x, node.position.y);
			ctx.fillText(node.advisoryId, sx, sy - 12);
		}

		ctx.restore();
	}

	private hitTest(sx: number, sy: number): string | null {
		if (!this.graph) return null;
		const nodes = Array.from(this.graph.nodes.values());
		// Reverse order so top-drawn nodes are tested first
		for (let i = nodes.length - 1; i >= 0; i--) {
			const node = nodes[i];
			if (!node) continue;
			const pos = this.worldToScreen(node.position.x, node.position.y);
			const radius = NODE_MIN_RADIUS + (NODE_MAX_RADIUS - NODE_MIN_RADIUS) * (node.visual.size / 3);
			const dx = sx - pos.sx;
			const dy = sy - pos.sy;
			if (dx * dx + dy * dy <= radius * radius) {
				return node.id;
			}
		}
		return null;
	}

	private handlePointerMove = (e: PointerEvent) => {
		const canvas = this.canvas;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;
		const nodeId = this.hitTest(sx, sy);
		if (nodeId !== this.hoveredNodeId) {
			this.hoveredNodeId = nodeId;
			this.hoverCallback?.(nodeId, nodeId ? { x: e.clientX, y: e.clientY } : undefined);
			this.draw();
		}
	};

	private handleClick = (e: MouseEvent) => {
		const canvas = this.canvas;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;
		const nodeId = this.hitTest(sx, sy);
		if (nodeId) {
			this.clickCallback?.(nodeId);
		}
	};

	private setupEvents() {
		if (!this.canvas) return;
		this.canvas.addEventListener('pointermove', this.handlePointerMove);
		this.canvas.addEventListener('click', this.handleClick);
	}
}
