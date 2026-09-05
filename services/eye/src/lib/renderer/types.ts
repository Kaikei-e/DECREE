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

export type RendererChoice = '3d' | '2d';

/**
 * Why the 3D scene is not on screen. A blocked driver is permanent and a failed
 * initialisation may not be, so the two never share wording.
 */
export type FallbackReason = 'webgl2-unavailable' | 'scene-init-failed';

export interface RendererFallback {
	reason: FallbackReason;
	/** The underlying message, short enough for a tooltip; never a stack trace. */
	detail: string;
}

/** What actually mounted, which is not always what was asked for. */
export interface RendererStatus {
	kind: RendererChoice;
	fallback: RendererFallback | null;
}
