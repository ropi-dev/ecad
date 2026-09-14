import { Eye, EyeOff, Focus, GripVertical, Layers, X } from "lucide-react";
import { useState } from "react";
import type { SceneLayer } from "../../engine/types";

export function LayerPanel({
	layers,
	focusedLayerId,
	onFocus,
	onVisibility,
	onMove,
	onRemove,
}: {
	layers: readonly SceneLayer[];
	focusedLayerId?: string;
	onFocus: (id?: string) => void;
	onVisibility: (id: string) => void;
	onMove: (id: string, targetId: string, after: boolean) => void;
	onRemove: (id: string) => void;
}) {
	const [dragged, setDragged] = useState<string>();
	const [drop, setDrop] = useState<{ id: string; after: boolean }>();
	const [announcement, setAnnouncement] = useState("");
	const ordered = [...layers].reverse();
	const finishDrag = () => {
		setDragged(undefined);
		setDrop(undefined);
	};
	return (
		<aside className="layer-panel" aria-label="Layers">
			<div className="layer-panel-heading">
				<h2>
					<Layers size={16} /> Layers <span>{layers.length}</span>
				</h2>
				<span className="layer-stack-label">Top to bottom</span>
			</div>
			<p className="layer-panel-hint">
				Drag to reorder. Focus to see through other layers.
			</p>
			<ol
				className="layer-list"
				onDragOver={(event) => {
					if (dragged) event.preventDefault();
				}}
			>
				{ordered.map((layer, index) => {
					const focused = focusedLayerId === layer.id;
					return (
						<li
							key={layer.id}
							className="layer-row"
							data-layer-id={layer.id}
							data-focused={focused}
							data-hidden={!layer.visible}
							data-dragging={dragged === layer.id}
							data-drop={
								drop?.id === layer.id
									? drop.after
										? "after"
										: "before"
									: undefined
							}
							onDragOver={(event) => {
								if (!dragged || dragged === layer.id) return;
								event.preventDefault();
								event.dataTransfer.dropEffect = "move";
								const rect = event.currentTarget.getBoundingClientRect();
								setDrop({
									id: layer.id,
									after: event.clientY > rect.top + rect.height / 2,
								});
							}}
							onDrop={(event) => {
								event.preventDefault();
								if (dragged && drop) {
									onMove(dragged, drop.id, drop.after);
									setAnnouncement("Layer order updated.");
								}
								finishDrag();
							}}
						>
							<button
								type="button"
								className="layer-icon layer-grip"
								draggable
								aria-label={`Reorder ${layer.name}`}
								title="Drag to reorder, or use the up and down arrow keys"
								aria-describedby="layer-reorder-help"
								onDragStart={(event) => {
									setDragged(layer.id);
									event.dataTransfer.effectAllowed = "move";
									event.dataTransfer.setData("text/plain", layer.id);
									event.dataTransfer.setDragImage(
										event.currentTarget.parentElement ?? event.currentTarget,
										24,
										24,
									);
								}}
								onDragEnd={finishDrag}
								onKeyDown={(event) => {
									const offset =
										event.key === "ArrowUp"
											? -1
											: event.key === "ArrowDown"
												? 1
												: 0;
									if (!offset) return;
									event.preventDefault();
									const target = ordered[index + offset];
									if (target) {
										onMove(layer.id, target.id, offset > 0);
										setAnnouncement(
											`${layer.name} moved to position ${index + offset + 1} of ${layers.length}.`,
										);
									}
								}}
							>
								<GripVertical size={16} />
							</button>
							<span
								className="layer-swatch"
								style={{
									backgroundColor: layer.color,
									borderColor: layer.color,
								}}
							/>
							<div className="layer-info">
								<span className="layer-name" title={layer.name}>
									{layer.name}
								</span>
							</div>
							<button
								type="button"
								className="layer-icon layer-focus"
								aria-label={`Focus ${layer.name}`}
								title={focused ? "Exit layer focus" : `Focus ${layer.name}`}
								aria-pressed={focused}
								onClick={() => onFocus(focused ? undefined : layer.id)}
							>
								<Focus size={17} />
							</button>
							<button
								type="button"
								className="layer-icon"
								aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
								title={layer.visible ? "Hide layer" : "Show layer"}
								aria-pressed={layer.visible}
								onClick={() => onVisibility(layer.id)}
							>
								{layer.visible ? <Eye size={17} /> : <EyeOff size={17} />}
							</button>
							<button
								type="button"
								className="layer-icon layer-remove"
								aria-label={`Remove ${layer.name}`}
								title="Remove layer"
								onClick={() => onRemove(layer.id)}
							>
								<X size={14} />
							</button>
						</li>
					);
				})}
			</ol>
			<div className="layer-panel-footer">
				<span>{layers.filter((layer) => layer.visible).length} visible</span>
				<span>{focusedLayerId ? "Focus mode" : "All layers filled"}</span>
			</div>
			<p id="layer-reorder-help" className="sr-only">
				Use the up and down arrow keys to reorder a layer.
			</p>
			<output className="sr-only" aria-live="polite">
				{announcement}
			</output>
		</aside>
	);
}
