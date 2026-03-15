import type { GraphModel } from '$lib/graph/model';

export interface SceneRenderer {
	mount(container: HTMLElement): void;
	dispose(): void;
	setGraphModel(model: GraphModel): void;
	focusCluster(clusterId: string): void;
	focusNode(nodeId: string): void;
	resetView(): void;
	onNodeClick(callback: (nodeId: string) => void): void;
	onNodeHover(callback: (nodeId: string | null, position?: { x: number; y: number }) => void): void;
	resize(): void;
}

export type RendererCapability = 'webgpu' | 'webgl2' | 'canvas2d';
