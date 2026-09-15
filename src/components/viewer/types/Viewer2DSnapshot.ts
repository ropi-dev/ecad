import type { Camera } from "#/engine";
import type { RenderDiagnostics } from "./RenderDiagnostics";

export interface Viewer2DSnapshot {
	backend: string;
	message: string;
	camera: Camera;
	zoom: number;
	viewport: { width: number; height: number };
	highlighted: number;
	diagnostics: RenderDiagnostics;
}
