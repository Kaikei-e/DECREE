export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export const SEVERITY_COLORS: Record<Severity, string> = {
	CRITICAL: '#FF1744',
	HIGH: '#FF9100',
	MEDIUM: '#FFD600',
	LOW: '#448AFF',
	INFO: '#00E676',
};

export interface GraphNode {
	id: string; // instance_id
	targetId: string;
	targetName: string;
	packageName: string;
	packageVersion: string;
	ecosystem: string;
	advisoryId: string;
	severity: Severity;
	decreeScore: number;
	epssScore: number;
	cvssScore: number;
	depDepth: number;
	isActive: boolean;
	lastObservedAt: string | null;
	// Visual state
	position: { x: number; y: number; z: number };
	visual: NodeVisualState;
}

export interface NodeVisualState {
	color: string;
	opacity: number; // 0.3–1.0, based on EPSS
	size: number; // based on edge count
	pulse: boolean; // observed within 24h
	isNew: boolean; // just appeared
	isDisappearing: boolean; // just disappeared
}

export interface GraphEdge {
	id: string;
	source: string; // node id
	target: string; // node id
	depType: string;
}

export interface GraphCluster {
	id: string; // target id
	name: string;
	nodes: string[]; // node ids
	centerX: number;
}

export interface GraphModel {
	nodes: Map<string, GraphNode>;
	edges: GraphEdge[];
	clusters: GraphCluster[];
}

export function createEmptyGraph(): GraphModel {
	return { nodes: new Map(), edges: [], clusters: [] };
}
