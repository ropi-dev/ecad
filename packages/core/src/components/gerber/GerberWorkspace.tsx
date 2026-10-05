import { useState } from "react";
import { useProject } from "#/projects/ProjectProvider.tsx";
import { GerberHeader } from "./GerberHeader";
import { GerberViewer } from "./GerberViewer";
import { LayerPanel } from "./LayerPanel";
import { useGerberFile } from "./useGerberFile";

export function GerberWorkspace() {
	const project = useProject();
	const {
		layers,
		loading,
		message: fileMessage,
		openFile,
		setLayers,
	} = useGerberFile();
	const [focusedLayerId, setFocusedLayerId] = useState<string>();
	const [rendererError, setRendererError] = useState("");
	const message = [fileMessage, rendererError].filter(Boolean).join("; ");
	return (
		<main className="relative flex h-dvh flex-col overflow-hidden">
			<GerberHeader
				loading={loading}
				onOpenFile={(files) => {
					setRendererError("");
					void openFile(files);
				}}
			/>
			{message && (
				<output
					data-testid="viewer-message"
					className="absolute top-22 left-10 z-3 m-0 max-h-25 max-w-[min(560px,calc(100%-56px))] overflow-auto rounded-lg border border-[#72543a] bg-[#392e25f5] px-3 py-2.5 text-[13px] text-[#edc49a]"
				>
					{message}
				</output>
			)}
			<div className="relative flex min-h-0 flex-1">
				{!project && layers.length > 0 && (
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
					<GerberViewer
						scene={layers}
						focusedLayerId={focusedLayerId}
						onError={setRendererError}
					/>
				</div>
			</div>
		</main>
	);
}
