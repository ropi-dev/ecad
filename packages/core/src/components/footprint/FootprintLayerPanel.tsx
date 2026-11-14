import {
	type FootprintLayer,
	footprintLayerLabels,
	footprintLayers,
} from "@ecad/drawing-core/footprint/layers.ts";
import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { FloatingPanel } from "#/components/viewer/FloatingPanel.tsx";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";

export function useFootprintLayers() {
	const [active, setActive] = useState<FootprintLayer>("F.Cu");
	const [hidden, setHidden] = useState<ReadonlySet<FootprintLayer>>(
		() => new Set(),
	);
	const toggle = useCallback(
		(layer: FootprintLayer) =>
			setHidden((current) => {
				const next = new Set(current);
				if (!next.delete(layer)) next.add(layer);
				return next;
			}),
		[],
	);
	const activate = useCallback((layer: FootprintLayer) => {
		setActive(layer);
		setHidden((current) =>
			current.has(layer)
				? new Set([...current].filter((item) => item !== layer))
				: current,
		);
	}, []);
	return { active, hidden, activate, toggle };
}

export function FootprintLayerPanel({
	active,
	hidden,
	itemCounts,
	onActivate,
	onToggle,
}: {
	active: FootprintLayer;
	hidden: ReadonlySet<FootprintLayer>;
	itemCounts: ReadonlyMap<FootprintLayer, number>;
	onActivate: (layer: FootprintLayer) => void;
	onToggle: (layer: FootprintLayer) => void;
}) {
	const [collapsed, setCollapsed] = useState(false);
	const listId = useId();
	return (
		<FloatingPanel label="Layers" position="top-left" narrow>
			<header
				className={`flex shrink-0 items-center justify-between gap-3 py-1.5 pr-1.5 pl-3 ${collapsed ? "" : "border-b border-line-subtle"}`}
			>
				<h2 className="m-0 flex min-w-0 items-baseline gap-2 text-sm font-semibold">
					Layers
					<span className="truncate text-xs font-normal text-fg-muted">
						{footprintLayerLabels[active]}
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
			>
				{footprintLayers.map((layer) => {
					const visible = !hidden.has(layer);
					const count = itemCounts.get(layer) ?? 0;
					const color = darkSchematicTheme.appearance[layer];
					return (
						<li
							key={layer}
							className="group relative grid min-h-7 grid-cols-[minmax(0,1fr)_auto_28px] items-center gap-1.5 rounded-md border border-transparent px-1.5 hover:bg-hover data-[active=true]:border-accent-line data-[active=true]:bg-accent-tint pointer-coarse:min-h-11"
							data-layer={layer}
							data-active={active === layer}
							data-hidden={!visible}
						>
							<button
								type="button"
								className="grid w-full min-w-0 cursor-pointer grid-cols-[7px_minmax(0,1fr)] items-center gap-2 border-0 bg-transparent p-0 text-left text-inherit before:absolute before:inset-0 before:rounded-[inherit] before:content-[''] focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:-outline-offset-2 focus-visible:before:outline-accent"
								aria-label={`Draw on ${footprintLayerLabels[layer]}`}
								aria-pressed={active === layer}
								title={`${footprintLayerLabels[layer]} (${layer})`}
								onClick={() => onActivate(layer)}
							>
								<span
									className="block h-4 w-[7px] shrink-0 rounded-xs group-data-[hidden=true]:opacity-40"
									style={{ backgroundColor: color }}
								/>
								<span className="block min-w-0 truncate text-xs font-medium text-fg group-data-[hidden=true]:opacity-40">
									{footprintLayerLabels[layer]}
								</span>
							</button>
							<span
								className="text-2xs text-fg-faint tabular-nums group-data-[hidden=true]:opacity-40"
								title={`${count} ${count === 1 ? "item" : "items"}`}
							>
								{count || ""}
							</span>
							<button
								type="button"
								className="relative z-1 grid h-7 w-full cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:text-fg-disabled disabled:hover:bg-transparent pointer-coarse:h-11"
								aria-label={`${visible ? "Hide" : "Show"} ${footprintLayerLabels[layer]}`}
								title={
									active === layer
										? "The layer you draw on stays visible"
										: visible
											? "Hide layer"
											: "Show layer"
								}
								aria-pressed={visible}
								disabled={active === layer}
								onClick={() => onToggle(layer)}
							>
								{visible ? (
									<Eye size={16} aria-hidden="true" />
								) : (
									<EyeOff size={16} aria-hidden="true" />
								)}
							</button>
						</li>
					);
				})}
			</ol>
		</FloatingPanel>
	);
}
