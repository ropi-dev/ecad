import { Layers } from "lucide-react";
import { useState } from "react";
import { GerberHeader } from "#/components/gerber/GerberHeader.tsx";
import { GerberViewer } from "#/components/gerber/GerberViewer.tsx";
import { LayerPanel } from "#/components/gerber/LayerPanel.tsx";
import { useGerberFile } from "#/components/gerber/useGerberFile.ts";
import { DocumentBar } from "#/projects/DocumentBar.tsx";
import {
	useProjectActions,
	useProjectSelection,
} from "#/projects/ProjectProvider.tsx";

export function GerberWorkspace() {
	const project = useProjectActions();
	// Project messages, such as assets a new project left out, show here too.
	const projectError = useProjectSelection((value) => value.error) ?? "";
	const selectedAsset = useProjectSelection((value) => value.selectedAsset);
	const gerberAsset = selectedAsset?.kind === "gerber" ? selectedAsset : null;
	const {
		layers,
		loading,
		messages: fileMessages,
		openFile,
		setLayers,
	} = useGerberFile();
	const [focusedLayerId, setFocusedLayerId] = useState<string>();
	const [rendererError, setRendererError] = useState("");
	const message = [projectError, ...fileMessages, rendererError]
		.filter(Boolean)
		.join("\n");
	return (
		<main className="relative flex h-dvh flex-col overflow-hidden">
			<DocumentBar
				icon={Layers}
				title={
					gerberAsset?.name ??
					(layers.length ? "All Gerber layers" : "Gerber viewer")
				}
				path={gerberAsset?.path ?? "gerber:all-layers"}
			/>
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
					className="ui-notice absolute top-[calc(var(--chrome-top)+var(--chrome-bar))] left-[var(--chrome-gap)] z-3 m-0 max-h-25 max-w-[min(560px,calc(100%-2*var(--chrome-gap)))] overflow-auto px-3 py-2 whitespace-pre-line"
				>
					{message}
				</output>
			)}
			<div className="relative flex min-h-0 flex-1">
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
						onRemove={
							project
								? undefined
								: (id) => {
										if (focusedLayerId === id) setFocusedLayerId(undefined);
										setLayers((current) =>
											current.filter((layer) => layer.id !== id),
										);
									}
						}
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
