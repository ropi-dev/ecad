export interface RenderDiagnostics {
	fps: number;
	averageMs: number;
	peakMs: number;
	width: number;
	height: number;
	drawCalls: number;
	triangles: number;
	geometries: number;
	textures: number;
}
