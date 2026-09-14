import type { ViewerSnapshot } from "../viewer/types/ViewerSnapshot";

export function RendererDiagnostics({
	snapshot,
	objects,
}: {
	snapshot: ViewerSnapshot | null;
	objects: number;
}) {
	if (!snapshot?.backend || snapshot.backend === "Renderer unavailable")
		return null;
	const { backend, diagnostics, viewport, camera, zoom, highlighted } =
		snapshot;
	return (
		<dl
			aria-label="Renderer diagnostics"
			className="pointer-events-none absolute top-3 right-3 m-0 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 rounded bg-slate-900/90 px-3 py-2 text-xs text-slate-200 tabular-nums"
		>
			<dt>FPS</dt>
			<dd className="m-0 text-right">{diagnostics.fps}</dd>
			<dt>CPU draw avg</dt>
			<dd className="m-0 text-right">{diagnostics.averageMs.toFixed(2)} ms</dd>
			<dt>CPU draw peak</dt>
			<dd className="m-0 text-right">{diagnostics.peakMs.toFixed(2)} ms</dd>
			<dt>Canvas</dt>
			<dd className="m-0 text-right">
				{diagnostics.width} × {diagnostics.height} px
			</dd>
			<dt>Pixel ratio</dt>
			<dd className="m-0 text-right">
				{(diagnostics.width / Math.max(1, viewport.width)).toFixed(2)}×
			</dd>
			<dt>Objects</dt>
			<dd className="m-0 text-right">{objects.toLocaleString()}</dd>
			{backend.includes("Three.js") && (
				<>
					<dt>Draw calls</dt>
					<dd className="m-0 text-right">
						{diagnostics.drawCalls.toLocaleString()}
					</dd>
					<dt>Triangles</dt>
					<dd className="m-0 text-right">
						{diagnostics.triangles.toLocaleString()}
					</dd>
					<dt>Geometries / textures</dt>
					<dd className="m-0 text-right">
						{diagnostics.geometries} / {diagnostics.textures}
					</dd>
				</>
			)}
			<dt>Highlighted</dt>
			<dd className="m-0 text-right">{highlighted.toLocaleString()}</dd>
			<dt>Zoom</dt>
			<dd className="m-0 text-right">{Math.round(zoom * 100)}%</dd>
			<dt>Center X / Y</dt>
			<dd className="m-0 text-right">
				{camera.x.toFixed(2)} / {camera.y.toFixed(2)} mm
			</dd>
			<dt className="sr-only">Sampling</dt>
			<dd className="col-span-2 m-0 text-slate-400">
				CPU: last active sample · FPS: 0 when idle
			</dd>
		</dl>
	);
}
