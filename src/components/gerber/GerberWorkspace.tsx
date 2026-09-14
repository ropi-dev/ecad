import { useRef, useState } from "react";
import { GerberViewer } from "../viewer/GerberViewer";
import type { GerberViewerHandle } from "../viewer/types/GerberViewerHandle";
import type { ViewerSnapshot } from "../viewer/types/ViewerSnapshot";
import { GerberFooter } from "./GerberFooter";
import { GerberHeader } from "./GerberHeader";
import { RendererDiagnostics } from "./RendererDiagnostics";
import { useGerberFile } from "./useGerberFile";

export function GerberWorkspace() {
	const { layer, loading, message: fileMessage, openFile } = useGerberFile();
	const viewer = useRef<GerberViewerHandle>(null);
	const [snapshot, setSnapshot] = useState<ViewerSnapshot | null>(null);
	const message = [fileMessage, snapshot?.message].filter(Boolean).join("; ");
	return (
		<main className="gerber-workspace">
			<GerberHeader
				filename={layer?.name}
				loading={loading}
				backend={snapshot?.backend ?? ""}
				onOpenFile={(file) => {
					setSnapshot(null);
					void openFile(file);
				}}
			/>
			{message && <output className="viewer-message">{message}</output>}
			<div className="relative min-h-0 flex-1">
				{layer ? (
					<GerberViewer ref={viewer} layer={layer} onChange={setSnapshot} />
				) : (
					<p className="empty-message">
						{loading
							? "Reading file…"
							: message
								? ""
								: "Choose a Gerber file to view it."}
					</p>
				)}
				<RendererDiagnostics
					snapshot={snapshot}
					objects={layer?.objects.length ?? 0}
				/>
				<GerberFooter
					enabled={
						!!layer &&
						!!snapshot?.backend &&
						snapshot.backend !== "Renderer unavailable"
					}
					zoom={snapshot?.zoom ?? 1}
					resetView={() => viewer.current?.resetView()}
					zoomView={(factor) => viewer.current?.zoomView(factor)}
					panView={(x, y) => viewer.current?.panView(x, y)}
				/>
			</div>
		</main>
	);
}
