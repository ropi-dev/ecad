import { createMemo, createSignal, Show } from "solid-js";
import { GerberHeader } from "#/components/gerber/GerberHeader.tsx";
import { GerberViewer } from "#/components/gerber/GerberViewer.tsx";
import { LayerPanel } from "#/components/gerber/LayerPanel.tsx";
import { useGerberFile } from "#/components/gerber/useGerberFile.ts";
import { Layers } from "#/components/ui/icons.tsx";
import { DocumentBar } from "#/projects/DocumentBar.tsx";
import {
	useProjectActions,
	useProjectSelection,
} from "#/projects/ProjectProvider.tsx";

export function GerberWorkspace() {
	const project = useProjectActions();
	// Project messages, such as assets a new project left out, show here too.
	const projectError = useProjectSelection((value) => value.error);
	const selectedAsset = useProjectSelection((value) => value.selectedAsset);
	const gerberAsset = () => {
		const asset = selectedAsset();
		return asset?.kind === "gerber" ? asset : null;
	};
	const gerber = useGerberFile();
	const [focusedLayerId, setFocusedLayerId] = createSignal<string>();
	const focusedLayerIds = createMemo(() => {
		const id = focusedLayerId();
		return id ? new Set([id]) : undefined;
	});
	const [rendererError, setRendererError] = createSignal("");
	const message = createMemo(() =>
		[projectError() ?? "", ...gerber.messages, rendererError()]
			.filter(Boolean)
			.join("\n"),
	);
	const clearFocus = (id: string) => {
		if (focusedLayerId() === id) setFocusedLayerId(undefined);
	};
	return (
		<main class="relative flex h-dvh flex-col overflow-hidden">
			<DocumentBar
				icon={Layers}
				title={
					gerberAsset()?.name ??
					(gerber.layers.length ? "All Gerber layers" : "Gerber viewer")
				}
				path={gerberAsset()?.path ?? "gerber:all-layers"}
			/>
			<GerberHeader
				loading={gerber.loading}
				onOpenFile={(files) => {
					setRendererError("");
					void gerber.openFile(files);
				}}
			/>
			<Show when={message()}>
				<output
					data-testid="viewer-message"
					class="ui-notice absolute top-[calc(var(--chrome-top)+var(--chrome-bar))] left-[var(--chrome-gap)] z-3 m-0 max-h-25 max-w-[min(560px,calc(100%-2*var(--chrome-gap)))] overflow-auto px-3 py-2 whitespace-pre-line"
				>
					{message()}
				</output>
			</Show>
			<div class="relative flex min-h-0 flex-1">
				{gerber.layers.length > 0 && (
					<LayerPanel
						layers={gerber.layers}
						focusedLayerId={focusedLayerId()}
						onFocus={(id) => {
							setFocusedLayerId(id);
							if (id)
								gerber.setLayers((current) =>
									current.map((layer) =>
										layer.id === id ? { ...layer, visible: true } : layer,
									),
								);
						}}
						onVisibility={(id) => {
							clearFocus(id);
							gerber.setLayers((current) =>
								current.map((layer) =>
									layer.id === id
										? { ...layer, visible: !layer.visible }
										: layer,
								),
							);
						}}
						onRemove={
							project()
								? undefined
								: (id) => {
										clearFocus(id);
										gerber.setLayers((current) =>
											current.filter((layer) => layer.id !== id),
										);
									}
						}
						onMove={(id, targetId, after) =>
							gerber.setLayers((current) => {
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
				<div class="relative min-h-0 min-w-0 flex-1">
					<GerberViewer
						scene={gerber.layers}
						focusedLayerIds={focusedLayerIds()}
						onError={setRendererError}
					/>
				</div>
			</div>
		</main>
	);
}
