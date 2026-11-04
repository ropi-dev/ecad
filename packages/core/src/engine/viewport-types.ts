import type { Camera } from "./types";

export interface RenderDiagnostics {
	width: number;
	height: number;
	drawCalls: number;
	triangles: number;
	geometries: number;
	textures: number;
}

export interface Viewer2DSnapshot {
	backend: string;
	message: string;
	camera: Camera;
	zoom: number;
	viewport: { width: number; height: number };
	highlighted: number;
	diagnostics: RenderDiagnostics;
}

export interface Viewer3DHandle {
	fit: () => void;
	zoom: (factor: number) => void;
	view: (direction: "iso" | "top" | "front") => void;
}
