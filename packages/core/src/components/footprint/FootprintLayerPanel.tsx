import {
	allLayers,
	type FootprintLayer,
	footprintLayerLabels,
	footprintLayers,
} from "@ecad/drawing-core/footprint/layers.ts";
import {
	type Accessor,
	createMemo,
	createSignal,
	createUniqueId,
	For,
	Show,
} from "solid-js";
import {
	Box,
	ChevronDown,
	ChevronUp,
	Eye,
	EyeOff,
	Sparkles,
} from "#/components/ui/icons.tsx";
import { FloatingPanel } from "#/components/viewer/FloatingPanel.tsx";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import { useSchematicTheme } from "#/settings/theme.ts";

export function useFootprintLayers(
	layers: Accessor<readonly FootprintLayer[]> = () => footprintLayers,
) {
	const [chosen, setActive] = createSignal<FootprintLayer>("F.Cu");
	const [hiddenChoice, setHidden] = createSignal<ReadonlySet<FootprintLayer>>(
		new Set(["F.Paste", "B.Paste"]),
	);
	const hidden = createMemo(() => {
		const available = layers();
		const absent = allLayers.filter((layer) => !available.includes(layer));
		return absent.length
			? new Set([...hiddenChoice(), ...absent])
			: hiddenChoice();
	});
	const active = createMemo(() =>
		layers().includes(chosen()) ? chosen() : "F.Cu",
	);
	const [focused, setFocused] = createSignal(false);
	function toggle(layer: FootprintLayer) {
		setHidden((current) => {
			const next = new Set(current);
			if (!next.delete(layer)) next.add(layer);
			return next;
		});
	}
	function activate(layer: FootprintLayer) {
		setActive(layer);
		setHidden((current) =>
			current.has(layer)
				? new Set([...current].filter((item) => item !== layer))
				: current,
		);
	}
	function select(layer: FootprintLayer) {
		if (layer === active()) setFocused((current) => !current);
		else {
			activate(layer);
			setFocused(true);
		}
	}
	return {
		get layers() {
			return layers();
		},
		get active() {
			return active();
		},
		get hidden() {
			return hidden();
		},
		get focused() {
			return focused() ? active() : undefined;
		},
		activate,
		select,
		toggle,
	};
}

export function FootprintLayerPanel(props: {
	layers?: readonly FootprintLayer[];
	active: FootprintLayer;
	hidden: ReadonlySet<FootprintLayer>;
	focused: FootprintLayer | undefined;
	itemCounts: ReadonlyMap<FootprintLayer, number>;
	onSelect: (layer: FootprintLayer) => void;
	onToggle: (layer: FootprintLayer) => void;
	realistic?: { shown: boolean; onToggle: () => void };
	models?: { shown: boolean; onToggle: () => void };
}) {
	const [collapsed, setCollapsed] = createSignal(false);
	const theme = useSchematicTheme();
	const listId = createUniqueId();
	const focusNoteId = createUniqueId();
	return (
		<FloatingPanel label="Layers" position="top-left" narrow>
			<header
				class={[
					"flex shrink-0 items-center justify-between gap-3 py-1.5 pr-1.5 pl-3",
					{ "border-b border-line-subtle": !collapsed() },
				]}
			>
				<h2 class="m-0 flex min-w-0 items-baseline gap-2 text-sm font-semibold">
					Layers
					<span class="truncate text-xs font-normal text-fg-muted">
						{footprintLayerLabels[props.active]}
					</span>
				</h2>
				<Show when={props.realistic}>
					{(realistic) => (
						<button
							type="button"
							class={[
								panelIconButtonClassName,
								"-mr-2 ml-auto aria-pressed:bg-pressed aria-pressed:text-accent",
							]}
							aria-label="Realistic board"
							aria-pressed={realistic().shown ? "true" : "false"}
							title={
								realistic().shown
									? "Show the layer colors"
									: "Show the board as manufactured"
							}
							onClick={() => realistic().onToggle()}
						>
							<Sparkles size={16} aria-hidden="true" />
						</button>
					)}
				</Show>
				<Show when={props.realistic?.shown && props.models}>
					{(models) => (
						<button
							type="button"
							class={[
								panelIconButtonClassName,
								"-mr-2 aria-pressed:bg-pressed aria-pressed:text-accent",
							]}
							aria-label="3D models"
							aria-pressed={models().shown ? "true" : "false"}
							title={
								models().shown ? "Hide the 3D models" : "Show the 3D models"
							}
							onClick={() => models().onToggle()}
						>
							<Box size={16} aria-hidden="true" />
						</button>
					)}
				</Show>
				<button
					type="button"
					class={panelIconButtonClassName}
					aria-label={collapsed() ? "Expand layers" : "Collapse layers"}
					title={collapsed() ? "Expand" : "Collapse"}
					aria-expanded={collapsed() ? "false" : "true"}
					aria-controls={listId}
					onClick={() => setCollapsed(!collapsed())}
				>
					<Show
						when={collapsed()}
						fallback={<ChevronUp size={16} aria-hidden="true" />}
					>
						<ChevronDown size={16} aria-hidden="true" />
					</Show>
				</button>
			</header>
			<ol
				id={listId}
				hidden={collapsed()}
				class="m-0 min-h-0 list-none overflow-y-auto overscroll-contain p-1.5"
			>
				<For each={props.layers ?? footprintLayers}>
					{(layer) => {
						const visible = () => !props.hidden.has(layer);
						const count = () => props.itemCounts.get(layer) ?? 0;
						return (
							<li
								class="group relative grid min-h-7 grid-cols-[minmax(0,1fr)_auto_28px] items-center gap-1.5 rounded-md border border-transparent px-1.5 hover:bg-hover data-[active=true]:border-accent-line data-[focused=true]:bg-accent-tint pointer-coarse:min-h-11"
								data-layer={layer}
								data-active={props.active === layer ? "true" : "false"}
								data-focused={props.focused === layer ? "true" : "false"}
								data-hidden={visible() ? "false" : "true"}
							>
								<button
									type="button"
									class="grid w-full min-w-0 cursor-pointer grid-cols-[7px_minmax(0,1fr)] items-center gap-2 border-0 bg-transparent p-0 text-left text-inherit before:absolute before:inset-0 before:rounded-[inherit] before:content-[''] focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:-outline-offset-2 focus-visible:before:outline-accent"
									aria-label={`Draw on ${footprintLayerLabels[layer]}`}
									aria-pressed={props.active === layer ? "true" : "false"}
									aria-describedby={
										props.focused === layer ? focusNoteId : undefined
									}
									title={
										props.focused === layer
											? "Exit layer focus"
											: props.active === layer
												? `Focus ${footprintLayerLabels[layer]} (${layer})`
												: `Draw on and focus ${footprintLayerLabels[layer]} (${layer})`
									}
									onClick={() => props.onSelect(layer)}
								>
									<span
										class="block h-4 w-[7px] shrink-0 rounded-xs group-data-[hidden=true]:opacity-40"
										style={{ "background-color": theme().appearance[layer] }}
									/>
									<span class="block min-w-0 truncate text-xs font-medium text-fg group-data-[hidden=true]:opacity-40">
										{footprintLayerLabels[layer]}
									</span>
								</button>
								<span
									class="text-2xs text-fg-faint tabular-nums group-data-[hidden=true]:opacity-40"
									title={`${count()} ${count() === 1 ? "item" : "items"}`}
								>
									{count() || ""}
								</span>
								<button
									type="button"
									class="relative z-1 grid h-7 w-full cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:text-fg-disabled disabled:hover:bg-transparent pointer-coarse:h-11"
									aria-label={`${visible() ? "Hide" : "Show"} ${footprintLayerLabels[layer]}`}
									title={
										props.active === layer
											? "The layer you draw on stays visible"
											: visible()
												? "Hide layer"
												: "Show layer"
									}
									aria-pressed={visible() ? "true" : "false"}
									disabled={props.active === layer}
									onClick={() => props.onToggle(layer)}
								>
									<Show
										when={visible()}
										fallback={<EyeOff size={16} aria-hidden="true" />}
									>
										<Eye size={16} aria-hidden="true" />
									</Show>
								</button>
							</li>
						);
					}}
				</For>
			</ol>
			<p id={focusNoteId} class="sr-only">
				Focused. The other layers are dimmed.
			</p>
		</FloatingPanel>
	);
}
