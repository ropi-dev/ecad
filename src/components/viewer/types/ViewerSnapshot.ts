import type { Camera } from "../../../engine/types";
import type { RenderDiagnostics } from "./RenderDiagnostics";

export interface ViewerSnapshot {
	backend: string;
	message: string;
	camera: Camera;
	zoom: number;
	viewport: { width: number; height: number };
	highlighted: number;
	diagnostics: RenderDiagnostics;
}
