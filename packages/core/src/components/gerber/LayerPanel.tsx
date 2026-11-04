import {
	Eye,
	EyeOff,
	GripVertical,
	OctagonAlert,
	TriangleAlert,
	X,
} from "lucide-react";
import { useId, useState } from "react";
import type { Diagnostic, SceneLayer } from "#/engine/types.ts";
import {
	countDiagnostics,
	describeDiagnostics,
} from "#/formats/diagnostics.ts";
import { FloatingPanel } from "../viewer/FloatingPanel";

const severityStyle = {
	warning: { label: "Warning", className: "text-amber-200" },
	error: { label: "Error", className: "text-red-300" },
	fatal: { label: "Fatal", className: "text-red-300" },
} as const;

export function LayerPanel({
	layers,
	focusedLayerId,
	onFocus,
	onVisibility,
	onMove,
	onRemove,
}: {
	layers: readonly (SceneLayer & { diagnostics?: readonly Diagnostic[] })[];
	focusedLayerId?: string;
	onFocus: (id?: string) => void;
	onVisibility: (id: string) => void;
	onMove: (id: string, targetId: string, after: boolean) => void;
	onRemove: (id: string) => void;
}) {
	const [dragged, setDragged] = useState<string>();
	const [drop, setDrop] = useState<{ id: string; after: boolean }>();
	const [announcement, setAnnouncement] = useState("");
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const listId = useId();
	const ordered = [...layers].reverse();
	const finishDrag = () => {
		setDragged(undefined);
		setDrop(undefined);
	};
	return (
		<FloatingPanel label="Layers" position="left-center">
			<ol
				className="m-0 min-h-0 list-none overflow-y-auto overscroll-contain p-0.5"
				onDragOver={(event) => {
					if (dragged) event.preventDefault();
				}}
			>
				{ordered.map((layer, index) => {
					const focused = focusedLayerId === layer.id;
					const diagnostics = layer.diagnostics ?? [];
					const open = expanded.has(layer.id);
					const errors = countDiagnostics(diagnostics).error > 0;
					const summary = describeDiagnostics(diagnostics);
					const diagnosticsId = `${listId}-${index}`;
					return (
						<li
							key={layer.id}
							className={`group relative mb-[3px] grid min-h-11 ${diagnostics.length ? "grid-cols-[16px_minmax(0,1fr)_auto_28px_24px]" : "grid-cols-[16px_minmax(0,1fr)_28px_24px]"} items-center gap-1.5 rounded-md border border-transparent px-1 py-1.5 transition-[background,border-color] duration-150 ease-[ease] last:mb-0 hover:bg-[#ffffff08] data-[focused=true]:border-[#b88f6170] data-[focused=true]:bg-[#e8b77e0c] data-[dragging=true]:opacity-35 after:pointer-events-none after:absolute after:inset-x-0 after:hidden after:h-0.5 after:rounded-[3px] after:bg-[#e8b77e] data-[drop]:after:block data-[drop=before]:after:-top-[3px] data-[drop=after]:after:-bottom-[3px]`}
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
								className="relative z-1 grid h-[30px] place-items-center rounded-[5px] border-0 bg-transparent p-0 hover:bg-[#ffffff10] hover:text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b77e] w-4 cursor-grab text-[#657183] active:cursor-grabbing"
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
							<button
								type="button"
								data-testid="layer-select"
								className="grid w-full min-w-0 cursor-pointer grid-cols-[7px_minmax(0,1fr)] items-center gap-2 border-0 bg-transparent p-0 text-left text-inherit before:absolute before:inset-0 before:rounded-[inherit] before:content-[''] focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:-outline-offset-2 focus-visible:before:outline-[#e8b77e]"
								aria-label={`Focus ${layer.name}`}
								title={focused ? "Exit layer focus" : `Focus ${layer.name}`}
								aria-pressed={focused}
								onClick={() => onFocus(focused ? undefined : layer.id)}
							>
								<span
									data-testid="layer-swatch"
									className="block h-[18px] w-[7px] shrink-0 rounded-[2px] border group-data-[hidden=true]:opacity-40"
									style={{
										backgroundColor: layer.color,
										borderColor: layer.color,
									}}
								/>
								<span
									data-testid="layer-name"
									className="block min-w-0 truncate text-[12px] font-medium text-[#e1e6ee] group-data-[hidden=true]:opacity-40"
									title={layer.name}
								>
									{layer.name}
								</span>
							</button>
							{diagnostics.length > 0 && (
								<button
									type="button"
									data-testid="layer-diagnostics"
									className={`relative z-1 inline-flex h-[30px] cursor-pointer items-center gap-1 rounded-[5px] border-0 bg-transparent px-1.5 text-[11px] font-medium tabular-nums hover:bg-[#ffffff10] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b77e] ${errors ? severityStyle.error.className : severityStyle.warning.className}`}
									aria-label={`${open ? "Hide" : "Show"} ${summary} for ${layer.name}`}
									title={summary}
									aria-expanded={open}
									aria-controls={diagnosticsId}
									onClick={() =>
										setExpanded((current) => {
											const next = new Set(current);
											if (!next.delete(layer.id)) next.add(layer.id);
											return next;
										})
									}
								>
									{errors ? (
										<OctagonAlert size={14} aria-hidden="true" />
									) : (
										<TriangleAlert size={14} aria-hidden="true" />
									)}
									{diagnostics.length}
								</button>
							)}
							<button
								type="button"
								className="relative z-1 grid h-[30px] place-items-center rounded-[5px] border-0 bg-transparent p-0 hover:bg-[#ffffff10] hover:text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b77e] w-full cursor-pointer text-[#98a4b6]"
								aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
								title={layer.visible ? "Hide layer" : "Show layer"}
								aria-pressed={layer.visible}
								onClick={() => onVisibility(layer.id)}
							>
								{layer.visible ? <Eye size={17} /> : <EyeOff size={17} />}
							</button>
							<button
								type="button"
								className="relative z-1 grid h-[30px] place-items-center rounded-[5px] border-0 bg-transparent p-0 hover:bg-[#ffffff10] hover:text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b77e] w-6 cursor-pointer text-[#748093]"
								aria-label={`Remove ${layer.name}`}
								title="Remove layer"
								onClick={() => onRemove(layer.id)}
							>
								<X size={14} />
							</button>
							{open && diagnostics.length > 0 && (
								<ul
									id={diagnosticsId}
									data-testid="layer-diagnostics-list"
									aria-label={`Diagnostics for ${layer.name}`}
									className="relative z-1 col-span-full m-0 mt-1 max-h-48 list-none overflow-y-auto overscroll-contain rounded-[5px] bg-[#0f1115] px-2 py-1.5 text-[11px] leading-[1.4] text-[#c7d0dc]"
								>
									{diagnostics.map((diagnostic, position) => (
										<li
											// Diagnostics never reorder, and messages can repeat.
											// biome-ignore lint/suspicious/noArrayIndexKey: see above
											key={position}
											className="py-0.5"
										>
											<span
												className={`font-medium ${severityStyle[diagnostic.severity].className}`}
											>
												{severityStyle[diagnostic.severity].label}
											</span>
											{diagnostic.line !== undefined && (
												<span className="text-[#8892a2]">
													{" "}
													· Line {diagnostic.line}
												</span>
											)}
											<span className="block break-words">
												{diagnostic.message}
											</span>
										</li>
									))}
								</ul>
							)}
						</li>
					);
				})}
			</ol>
			<p id="layer-reorder-help" className="sr-only">
				Use the up and down arrow keys to reorder a layer.
			</p>
			<output className="sr-only" aria-live="polite">
				{announcement}
			</output>
		</FloatingPanel>
	);
}
