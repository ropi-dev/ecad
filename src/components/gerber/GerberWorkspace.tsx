import { useRef, useState } from "react";
import type { Viewer2DHandle } from "../viewer/types/Viewer2DHandle";
import { GerberFooter } from "./GerberFooter";
import { GerberHeader } from "./GerberHeader";
import { GerberViewer } from "./GerberViewer";
import { LayerPanel } from "./LayerPanel";
import { useGerberFile } from "./useGerberFile";

export function GerberWorkspace() {
	const {
		layers,
		loading,
		message: fileMessage,
		openFile,
		setLayers,
	} = useGerberFile();
	const [focusedLayerId, setFocusedLayerId] = useState<string>();
	const viewer = useRef<Viewer2DHandle>(null);
	const [ready, setReady] = useState(false);
	const [rendererError, setRendererError] = useState("");
	const message = [fileMessage, rendererError].filter(Boolean).join("; ");
	return (
		<main className="gerber-workspace">
			<GerberHeader
				loading={loading}
				onOpenFile={(files) => {
					setRendererError("");
					void openFile(files);
				}}
			/>
			{message && <output className="viewer-message">{message}</output>}
			<div className="workspace-body">
				{layers.length > 0 && (
					<LayerPanel
						layers={layers}
						focusedLayerId={focusedLayerId}
						onFocus={(id) => {
							setFocusedLayerId(id);
							if (id)
								setLayers((current) =>
									current.map((layer) =>
										layer.id === id ? { ...layer, visible: true } : layer,
									),
								);
						}}
						onVisibility={(id) => {
							if (focusedLayerId === id) setFocusedLayerId(undefined);
							setLayers((current) =>
								current.map((layer) =>
									layer.id === id
										? { ...layer, visible: !layer.visible }
										: layer,
								),
							);
						}}
						onRemove={(id) => {
							if (focusedLayerId === id) setFocusedLayerId(undefined);
							setLayers((current) =>
								current.filter((layer) => layer.id !== id),
							);
						}}
						onMove={(id, targetId, after) =>
							setLayers((current) => {
								if (id === targetId) return current;
								const ordered = [...current].reverse();
								const moving = ordered.find((layer) => layer.id === id);
								const remaining = ordered.filter((layer) => layer.id !== id);
								const target = remaining.findIndex(
									(layer) => layer.id === targetId,
								);
								if (!moving || target < 0) return current;
								remaining.splice(target + Number(after), 0, moving);
								return remaining.reverse();
							})
						}
					/>
				)}
				<div className="relative min-h-0 min-w-0 flex-1">
					{layers.length ? (
						<GerberViewer
							ref={viewer}
							scene={layers}
							focusedLayerId={focusedLayerId}
							onReady={setReady}
							onError={setRendererError}
						/>
					) : (
						<p className="empty-message">
							{loading
								? "Reading file…"
								: message
									? ""
									: "Choose Gerber files or a ZIP archive to view them."}
						</p>
					)}
					<GerberFooter
						enabled={layers.length > 0 && ready}
						resetView={() => viewer.current?.resetView()}
						zoomView={(factor) => viewer.current?.zoomView(factor)}
					/>
				</div>
			</div>
		</main>
	);
}
