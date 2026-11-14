import type { Camera } from "#/engine/types.ts";
import type { ViewProjection } from "#/engine/view-projection.ts";

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
	/** The top view, or the top view a turned camera returns to. */
	camera: Camera;
	/** Set while a top view is turned in 3D. */
	projection?: ViewProjection;
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
