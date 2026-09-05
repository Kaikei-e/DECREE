import type { GraphModel } from '$lib/graph/model';

/**
 * Camera movement in view-relative units, where 1 is one step scaled to the scene's size.
 * As a velocity the same units are per second.
 */
export interface CameraMove {
	/** Strafe perpendicular to the view direction; positive is right. */
	right?: number;
	/** Travel along the view direction; positive moves into the scene. */
	forward?: number;
	/** Altitude; positive rises. 2D has no altitude and ignores it. */
	up?: number;
}

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
	moveCamera(move: CameraMove): void;
	setCameraVelocity(move: CameraMove): void;
	onNodeClick(callback: (nodeId: string) => void): void;
	onNodeHover(callback: (nodeId: string | null, position?: { x: number; y: number }) => void): void;
	setSelectedNode(nodeId: string | null): void;
	resize(): void;
}

export type RendererCapability = 'webgl2' | 'canvas2d';
