import {
	ChevronDown,
	ChevronUp,
	Eye,
	EyeOff,
	GripVertical,
	OctagonAlert,
	TriangleAlert,
	X,
} from "lucide-react";
import { useId, useState } from "react";
import { FloatingPanel } from "#/components/viewer/FloatingPanel.tsx";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import type { Diagnostic, SceneLayer } from "#/engine/types.ts";
import {
	countDiagnostics,
	describeDiagnostics,
} from "#/formats/diagnostics.ts";

const severityStyle = {
	warning: { label: "Warning", className: "text-warning" },
	error: { label: "Error", className: "text-danger" },
	fatal: { label: "Fatal", className: "text-danger" },
} as const;

const columns = [
	[
		"grid-cols-[16px_minmax(0,1fr)_28px]",
		"grid-cols-[16px_minmax(0,1fr)_28px_24px]",
	],
	[
		"grid-cols-[16px_minmax(0,1fr)_auto_28px]",
		"grid-cols-[16px_minmax(0,1fr)_auto_28px_24px]",
	],
] as const;

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
	onRemove?: (id: string) => void;
}) {
	const [dragged, setDragged] = useState<string>();
	const [drop, setDrop] = useState<{ id: string; after: boolean }>();
	const [announcement, setAnnouncement] = useState("");
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [collapsed, setCollapsed] = useState(false);
	const listId = useId();
	const ordered = [...layers].reverse();
	const finishDrag = () => {
		setDragged(undefined);
		setDrop(undefined);
	};
	return (
		<FloatingPanel label="Layers" position="top-right" raised>
			<header
				className={`flex shrink-0 items-center justify-between gap-3 py-1.5 pr-1.5 pl-3 ${collapsed ? "" : "border-b border-line-subtle"}`}
			>
				<h2 className="m-0 text-sm font-semibold">
					Layers{" "}
					<span className="font-normal text-fg-muted tabular-nums">
						{layers.length}
					</span>
				</h2>
				<button
					type="button"
					className={panelIconButtonClassName}
					aria-label={collapsed ? "Expand layers" : "Collapse layers"}
					title={collapsed ? "Expand" : "Collapse"}
					aria-expanded={!collapsed}
					aria-controls={listId}
					onClick={() => setCollapsed(!collapsed)}
				>
					{collapsed ? (
						<ChevronDown size={16} aria-hidden="true" />
					) : (
						<ChevronUp size={16} aria-hidden="true" />
					)}
				</button>
			</header>
			<ol
				id={listId}
				hidden={collapsed}
				className="m-0 min-h-0 list-none overflow-y-auto overscroll-contain p-1.5"
				onDragOver={(event) => {
					if (dragged) event.preventDefault();
				}}
			>
				{ordered.map((layer, index) => {
					const focused = focusedLayerId === layer.id;
					const diagnostics = layer.diagnostics ?? [];
					const open = expanded.has(layer.id);
					const counts = countDiagnostics(diagnostics);
					const errors = counts.error > 0;
					const total = (counts.error + counts.warning).toLocaleString();
					// The accessible name includes the visible count (WCAG 2.5.3).
					const summary =
						counts.error && counts.warning
							? `${total} problems (${describeDiagnostics(diagnostics)})`
							: describeDiagnostics(diagnostics);
					const diagnosticsId = `${listId}-${index}`;
					return (
						<li
							key={layer.id}
							className={`group relative mb-0.5 grid min-h-11 ${columns[diagnostics.length ? 1 : 0][onRemove ? 1 : 0]} items-center gap-1.5 rounded-md border border-transparent px-1 py-1 last:mb-0 hover:bg-hover data-[focused=true]:border-accent-line data-[focused=true]:bg-accent-tint data-[dragging=true]:opacity-35 after:pointer-events-none after:absolute after:inset-x-0 after:hidden after:h-0.5 after:rounded-full after:bg-accent data-[drop]:after:block data-[drop=before]:after:-top-[3px] data-[drop=after]:after:-bottom-[3px]`}
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
								className="relative z-1 grid h-7 w-4 cursor-grab pointer-coarse:h-11 place-items-center rounded-sm border-0 bg-transparent p-0 text-fg-faint hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing"
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
								className="grid w-full min-w-0 cursor-pointer grid-cols-[7px_minmax(0,1fr)] items-center gap-2 border-0 bg-transparent p-0 text-left text-inherit before:absolute before:inset-0 before:rounded-[inherit] before:content-[''] focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:-outline-offset-2 focus-visible:before:outline-accent"
								aria-label={`Focus ${layer.name}`}
								title={focused ? "Exit layer focus" : `Focus ${layer.name}`}
								aria-pressed={focused}
								onClick={() => onFocus(focused ? undefined : layer.id)}
							>
								<span
									data-testid="layer-swatch"
									className="block h-4 w-[7px] shrink-0 rounded-xs border group-data-[hidden=true]:opacity-40"
									style={{
										backgroundColor: layer.color,
										borderColor: layer.color,
									}}
								/>
								<span
									data-testid="layer-name"
									className="block min-w-0 truncate text-xs font-medium text-fg group-data-[hidden=true]:opacity-40"
									title={layer.name}
								>
									{layer.name}
								</span>
							</button>
							{diagnostics.length > 0 && (
								<button
									type="button"
									data-testid="layer-diagnostics"
									className={`relative z-1 inline-flex h-7 cursor-pointer items-center gap-1 rounded-md pointer-coarse:h-11 border-0 bg-transparent px-1.5 text-2xs font-medium tabular-nums group-data-[hidden=true]:opacity-40 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent ${errors ? severityStyle.error.className : severityStyle.warning.className}`}
									aria-label={`Diagnostics for ${layer.name}: ${summary}`}
									title={summary}
									aria-expanded={open}
									aria-controls={open ? diagnosticsId : undefined}
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
									{total}
								</button>
							)}
							<button
								type="button"
								className="relative z-1 grid h-7 w-full cursor-pointer place-items-center pointer-coarse:h-11 rounded-md border-0 bg-transparent p-0 text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
								aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
								title={layer.visible ? "Hide layer" : "Show layer"}
								aria-pressed={layer.visible}
								onClick={() => onVisibility(layer.id)}
							>
								{layer.visible ? <Eye size={17} /> : <EyeOff size={17} />}
							</button>
							{onRemove && (
								<button
									type="button"
									className="relative z-1 grid h-7 w-6 cursor-pointer place-items-center pointer-coarse:h-11 rounded-md border-0 bg-transparent p-0 text-fg-faint hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
									aria-label={`Remove ${layer.name}`}
									title="Remove layer"
									onClick={() => onRemove(layer.id)}
								>
									<X size={14} />
								</button>
							)}
							{open && diagnostics.length > 0 && (
								<ul
									id={diagnosticsId}
									data-testid="layer-diagnostics-list"
									aria-label={`Diagnostics for ${layer.name}`}
									className="relative z-1 col-span-full m-0 mt-1 max-h-48 list-none overflow-y-auto overscroll-contain rounded-md bg-field px-2 py-1.5 text-2xs leading-4 text-fg-muted"
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
												<span className="text-fg-faint">
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
