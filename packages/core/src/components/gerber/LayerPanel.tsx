import { createMemo, createSignal, createUniqueId, For } from "solid-js";
import {
	ChevronDown,
	ChevronUp,
	Eye,
	EyeOff,
	GripVertical,
	OctagonAlert,
	TriangleAlert,
	X,
} from "#/components/ui/icons.tsx";
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

export function LayerPanel(props: {
	layers: readonly (SceneLayer & { diagnostics?: readonly Diagnostic[] })[];
	focusedLayerId?: string | undefined;
	onFocus: (id?: string) => void;
	onVisibility: (id: string) => void;
	onMove: (id: string, targetId: string, after: boolean) => void;
	onRemove?: ((id: string) => void) | undefined;
}) {
	const [dragged, setDragged] = createSignal<string>();
	const [drop, setDrop] = createSignal<{ id: string; after: boolean }>();
	const [announcement, setAnnouncement] = createSignal("");
	const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
	const [collapsed, setCollapsed] = createSignal(false);
	const listId = createUniqueId();
	const ordered = createMemo(() => [...props.layers].reverse());
	const finishDrag = () => {
		setDragged(undefined);
		setDrop(undefined);
	};
	return (
		<FloatingPanel label="Layers" position="top-right" raised>
			<header
				class={[
					"flex shrink-0 items-center justify-between gap-3 py-1.5 pr-1.5 pl-3",
					{ "border-b border-line-subtle": !collapsed() },
				]}
			>
				<h2 class="m-0 text-sm font-semibold">
					Layers{" "}
					<span class="font-normal text-fg-muted tabular-nums">
						{props.layers.length}
					</span>
				</h2>
				<button
					type="button"
					class={panelIconButtonClassName}
					aria-label={collapsed() ? "Expand layers" : "Collapse layers"}
					title={collapsed() ? "Expand" : "Collapse"}
					aria-expanded={collapsed() ? "false" : "true"}
					aria-controls={listId}
					onClick={() => setCollapsed(!collapsed())}
				>
					{collapsed() ? (
						<ChevronDown size={16} aria-hidden="true" />
					) : (
						<ChevronUp size={16} aria-hidden="true" />
					)}
				</button>
			</header>
			<ol
				id={listId}
				hidden={collapsed()}
				class="m-0 min-h-0 list-none overflow-y-auto overscroll-contain p-1.5"
				onDragOver={(event) => {
					if (dragged()) event.preventDefault();
				}}
			>
				<For each={ordered()} keyed={(layer) => layer.id}>
					{(layer, index) => {
						const focused = () => props.focusedLayerId === layer().id;
						const diagnostics = () => layer().diagnostics ?? [];
						const open = () => expanded().has(layer().id);
						const counts = createMemo(() => countDiagnostics(diagnostics()));
						const errors = () => counts().error > 0;
						const total = () =>
							(counts().error + counts().warning).toLocaleString();
						// The accessible name includes the visible count (WCAG 2.5.3).
						const summary = () =>
							counts().error && counts().warning
								? `${total()} problems (${describeDiagnostics(diagnostics())})`
								: describeDiagnostics(diagnostics());
						const diagnosticsId = () => `${listId}-${index()}`;
						return (
							<li
								class={[
									"group relative mb-0.5 grid min-h-11 items-center gap-1.5 rounded-md border border-transparent px-1 py-1 last:mb-0 hover:bg-hover data-[focused=true]:border-accent-line data-[focused=true]:bg-accent-tint data-[dragging=true]:opacity-35 after:pointer-events-none after:absolute after:inset-x-0 after:hidden after:h-0.5 after:rounded-full after:bg-accent data-[drop]:after:block data-[drop=before]:after:-top-[3px] data-[drop=after]:after:-bottom-[3px]",
									columns[diagnostics().length ? 1 : 0][props.onRemove ? 1 : 0],
								]}
								data-layer-id={layer().id}
								data-focused={focused() ? "true" : "false"}
								data-hidden={layer().visible ? "false" : "true"}
								data-dragging={dragged() === layer().id ? "true" : "false"}
								data-drop={(() => {
									const target = drop();
									return target?.id === layer().id
										? target.after
											? "after"
											: "before"
										: undefined;
								})()}
								onDragOver={(event) => {
									const id = layer().id;
									if (!dragged() || dragged() === id) return;
									event.preventDefault();
									if (event.dataTransfer)
										event.dataTransfer.dropEffect = "move";
									const rect = event.currentTarget.getBoundingClientRect();
									setDrop({
										id,
										after: event.clientY > rect.top + rect.height / 2,
									});
								}}
								onDrop={(event) => {
									event.preventDefault();
									const moving = dragged();
									const target = drop();
									if (moving && target) {
										props.onMove(moving, target.id, target.after);
										setAnnouncement("Layer order updated.");
									}
									finishDrag();
								}}
							>
								<button
									type="button"
									class="relative z-1 grid h-7 w-4 cursor-grab pointer-coarse:h-11 place-items-center rounded-sm border-0 bg-transparent p-0 text-fg-faint hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing"
									draggable="true"
									aria-label={`Reorder ${layer().name}`}
									title="Drag to reorder, or use the up and down arrow keys"
									aria-describedby="layer-reorder-help"
									onDragStart={(event) => {
										const id = layer().id;
										setDragged(id);
										const transfer = event.dataTransfer;
										if (!transfer) return;
										transfer.effectAllowed = "move";
										transfer.setData("text/plain", id);
										transfer.setDragImage(
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
										const position = index();
										const target = ordered()[position + offset];
										if (target) {
											props.onMove(layer().id, target.id, offset > 0);
											setAnnouncement(
												`${layer().name} moved to position ${position + offset + 1} of ${props.layers.length}.`,
											);
										}
									}}
								>
									<GripVertical size={16} />
								</button>
								<button
									type="button"
									data-testid="layer-select"
									class="grid w-full min-w-0 cursor-pointer grid-cols-[7px_minmax(0,1fr)] items-center gap-2 border-0 bg-transparent p-0 text-left text-inherit before:absolute before:inset-0 before:rounded-[inherit] before:content-[''] focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:-outline-offset-2 focus-visible:before:outline-accent"
									aria-label={`Focus ${layer().name}`}
									title={
										focused() ? "Exit layer focus" : `Focus ${layer().name}`
									}
									aria-pressed={focused() ? "true" : "false"}
									onClick={() =>
										props.onFocus(focused() ? undefined : layer().id)
									}
								>
									<span
										data-testid="layer-swatch"
										class="block h-4 w-[7px] shrink-0 rounded-xs border group-data-[hidden=true]:opacity-40"
										style={{
											"background-color": layer().color,
											"border-color": layer().color,
										}}
									/>
									<span
										data-testid="layer-name"
										class="block min-w-0 truncate text-xs font-medium text-fg group-data-[hidden=true]:opacity-40"
										title={layer().name}
									>
										{layer().name}
									</span>
								</button>
								{diagnostics().length > 0 && (
									<button
										type="button"
										data-testid="layer-diagnostics"
										class={[
											"relative z-1 inline-flex h-7 cursor-pointer items-center gap-1 rounded-md pointer-coarse:h-11 border-0 bg-transparent px-1.5 text-2xs font-medium tabular-nums group-data-[hidden=true]:opacity-40 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent",
											errors()
												? severityStyle.error.className
												: severityStyle.warning.className,
										]}
										aria-label={`Diagnostics for ${layer().name}: ${summary()}`}
										title={summary()}
										aria-expanded={open() ? "true" : "false"}
										aria-controls={open() ? diagnosticsId() : undefined}
										onClick={() =>
											setExpanded((current) => {
												const next = new Set(current);
												const id = layer().id;
												if (!next.delete(id)) next.add(id);
												return next;
											})
										}
									>
										{errors() ? (
											<OctagonAlert size={14} aria-hidden="true" />
										) : (
											<TriangleAlert size={14} aria-hidden="true" />
										)}
										{total()}
									</button>
								)}
								<button
									type="button"
									class="relative z-1 grid h-7 w-full cursor-pointer place-items-center pointer-coarse:h-11 rounded-md border-0 bg-transparent p-0 text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
									aria-label={`${layer().visible ? "Hide" : "Show"} ${layer().name}`}
									title={layer().visible ? "Hide layer" : "Show layer"}
									aria-pressed={layer().visible ? "true" : "false"}
									onClick={() => props.onVisibility(layer().id)}
								>
									{layer().visible ? <Eye size={17} /> : <EyeOff size={17} />}
								</button>
								{props.onRemove && (
									<button
										type="button"
										class="relative z-1 grid h-7 w-6 cursor-pointer place-items-center pointer-coarse:h-11 rounded-md border-0 bg-transparent p-0 text-fg-faint hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
										aria-label={`Remove ${layer().name}`}
										title="Remove layer"
										onClick={() => props.onRemove?.(layer().id)}
									>
										<X size={14} />
									</button>
								)}
								{open() && diagnostics().length > 0 && (
									<ul
										id={diagnosticsId()}
										data-testid="layer-diagnostics-list"
										aria-label={`Diagnostics for ${layer().name}`}
										class="relative z-1 col-span-full m-0 mt-1 max-h-48 list-none overflow-y-auto overscroll-contain rounded-md bg-field px-2 py-1.5 text-2xs leading-4 text-fg-muted"
									>
										<For each={diagnostics()} keyed={false}>
											{(diagnostic) => (
												<li class="py-0.5">
													<span
														class={[
															"font-medium",
															severityStyle[diagnostic().severity].className,
														]}
													>
														{severityStyle[diagnostic().severity].label}
													</span>
													{diagnostic().line !== undefined && (
														<span class="text-fg-faint">
															{" "}
															· Line {diagnostic().line}
														</span>
													)}
													<span class="block break-words">
														{diagnostic().message}
													</span>
												</li>
											)}
										</For>
									</ul>
								)}
							</li>
						);
					}}
				</For>
			</ol>
			<p id="layer-reorder-help" class="sr-only">
				Use the up and down arrow keys to reorder a layer.
			</p>
			<output class="sr-only" aria-live="polite">
				{announcement()}
			</output>
		</FloatingPanel>
	);
}
