import type { GraphModel } from '$lib/graph/model';

export interface SceneRenderer {
	mount(container: HTMLElement): void;
	dispose(): void;
	setGraphModel(model: GraphModel): void;
	focusCluster(clusterId: string): void;
	focusNode(nodeId: string): void;
	resetView(): void;
	zoomIn(): void;
	zoomOut(): void;
	setViewPreset(preset: 'top' | 'front'): void;
	onNodeClick(callback: (nodeId: string) => void): void;
	onNodeHover(callback: (nodeId: string | null, position?: { x: number; y: number }) => void): void;
	setSelectedNode(nodeId: string | null): void;
	resize(): void;
}

export type RendererCapability = 'webgl2' | 'canvas2d';
