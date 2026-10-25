import {
	Cable,
	ChevronDown,
	ChevronRight,
	Circle,
	Layers,
	ListTree,
	LockKeyhole,
	MapPin,
	Minus,
	PanelLeftClose,
	Square,
	Triangle,
	Type,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	canSelectShape,
	canSelectSymbolChild,
	type EditorShape,
	symbolChildren,
} from "#/drawing/shapes.ts";
import { measurePerformance } from "#/performance/runtime.ts";

interface HierarchyItem {
	key: string;
	label: string;
	kind: EditorShape["kind"];
	shapeId: number;
	childKey?: string;
	locked: boolean;
	disabled: boolean;
	children: HierarchyItem[];
}

const icons = {
	symbol: Layers,
	rectangle: Square,
	circle: Circle,
	triangle: Triangle,
	line: Minus,
	wire: Cable,
	pin: MapPin,
	text: Type,
};
const rowHeight = 32;

function itemLabel(shape: EditorShape) {
	if (shape.kind === "symbol")
		return [shape.attributes.reference, shape.attributes.name]
			.filter(Boolean)
			.join(" · ");
	if (shape.kind === "text") return shape.text.trim() || "Empty text";
	if (shape.kind === "pin")
		return shape.number || shape.name
			? ["Pin", shape.number, shape.name].filter(Boolean).join(" · ")
			: `Pin ${shape.id}`;
	return `${shape.kind[0].toUpperCase()}${shape.kind.slice(1)} ${shape.id}`;
}

export function ItemHierarchy({
	shapes,
	selectedIds,
	selectedChildKey,
	allowLocked,
	disabled,
	onSelect,
}: {
	shapes: EditorShape[];
	selectedIds: ReadonlySet<number>;
	selectedChildKey: string | null;
	allowLocked: boolean;
	disabled: boolean;
	onSelect: (
		shapeId: number,
		childKey: string | undefined,
		additive: boolean,
	) => void;
}) {
	const [open, setOpen] = useState(false);
	const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(
		() => new Set(),
	);
	const [scrollTop, setScrollTop] = useState(0);
	const [height, setHeight] = useState(480);
	const [activeKey, setActiveKey] = useState<string | null>(null);
	const viewport = useRef<HTMLDivElement>(null);
	const toggle = useRef<HTMLButtonElement>(null);
	const panelId = useId();
	const items = useMemo(
		() =>
			measurePerformance(
				"editor.item-hierarchy",
				() =>
					shapes.map(
						(shape): HierarchyItem => ({
							key: String(shape.id),
							label: itemLabel(shape),
							kind: shape.kind,
							shapeId: shape.id,
							locked: shape.locked === true,
							disabled: !canSelectShape(shape, allowLocked),
							children:
								shape.kind === "symbol"
									? symbolChildren(shape).map((child) => ({
											key: `${shape.id}/${child.key}`,
											label: child.key.startsWith("attribute:")
												? `${child.key.slice(10)} · ${child.shape.kind === "text" ? child.shape.text : ""}`
												: itemLabel(child.shape),
											kind: child.shape.kind,
											shapeId: shape.id,
											childKey: child.key,
											locked: child.shape.locked === true,
											disabled: !canSelectSymbolChild(
												shape,
												child,
												allowLocked,
											),
											children: [],
										}))
									: [],
						}),
					),
				{ shapes: shapes.length },
			),
		[shapes, allowLocked],
	);
	const rows = useMemo(
		() =>
			items.flatMap((item, index) => [
				{ item, level: 1, position: index + 1, size: items.length },
				...(collapsed.has(item.shapeId)
					? []
					: item.children.map((child, index) => ({
							item: child,
							level: 2,
							position: index + 1,
							size: item.children.length,
						}))),
			]),
		[items, collapsed],
	);
	const selectedKey =
		selectedIds.size === 1
			? `${[...selectedIds][0]}${selectedChildKey ? `/${selectedChildKey}` : ""}`
			: undefined;
	const focusKey =
		activeKey && rows.some(({ item }) => item.key === activeKey)
			? activeKey
			: (selectedKey ?? rows[0]?.item.key);
	const start = Math.max(
		0,
		Math.min(Math.floor(scrollTop / rowHeight) - 4, rows.length - 1),
	);
	const visible = rows.slice(start, start + Math.ceil(height / rowHeight) + 8);
	const reveal = useCallback((index: number) => {
		const container = viewport.current;
		if (!container || index < 0) return;
		const top = index * rowHeight;
		if (top < container.scrollTop) container.scrollTop = top;
		else if (top + rowHeight > container.scrollTop + container.clientHeight)
			container.scrollTop = top + rowHeight - container.clientHeight;
	}, []);
	useEffect(() => setOpen(window.innerWidth >= 800), []);
	useEffect(() => {
		if (!open || !viewport.current) return;
		const observer = new ResizeObserver(([entry]) =>
			setHeight(entry.contentRect.height),
		);
		observer.observe(viewport.current);
		return () => observer.disconnect();
	}, [open]);
	useEffect(() => {
		if (!selectedKey) return;
		const id = Number(selectedKey.split("/")[0]);
		if (selectedChildKey)
			setCollapsed((previous) => {
				if (!previous.has(id)) return previous;
				const next = new Set(previous);
				next.delete(id);
				return next;
			});
		setActiveKey(selectedKey);
	}, [selectedKey, selectedChildKey]);
	useEffect(() => {
		if (open && selectedKey)
			reveal(rows.findIndex(({ item }) => item.key === selectedKey));
	}, [selectedKey, rows, open, reveal]);
	const expand = (id: number, expanded: boolean) =>
		setCollapsed((previous) => {
			const next = new Set(previous);
			if (expanded) next.delete(id);
			else next.add(id);
			return next;
		});
	const select = (item: HierarchyItem, additive = false) => {
		setActiveKey(item.key);
		if (!disabled && !item.disabled)
			onSelect(item.shapeId, item.childKey, additive);
	};
	return (
		<>
			<button
				ref={toggle}
				type="button"
				aria-label="Item hierarchy"
				aria-expanded={open}
				aria-controls={panelId}
				title="Item hierarchy"
				onClick={() => setOpen((value) => !value)}
				className={`${open ? "hidden" : "flex"} absolute top-26 left-10 z-3 h-10 items-center gap-2 rounded-lg border border-[#414955] bg-[#191c22f5] px-3 text-xs text-[#c7d0dc] hover:bg-[#303741] max-[600px]:top-34 max-[600px]:left-9`}
			>
				<ListTree size={17} aria-hidden="true" /> Items
			</button>
			{open && (
				<aside
					id={panelId}
					aria-label="Item hierarchy"
					className="absolute top-26 bottom-24 left-10 z-3 flex w-64 max-w-[calc(100%-5rem)] flex-col overflow-hidden rounded-xl border border-[#414955] bg-[#191c22f5] text-[#c7d0dc] shadow-[0_8px_32px_#0003] max-[600px]:top-34 max-[600px]:left-9"
				>
					<header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3">
						<ListTree size={17} aria-hidden="true" className="text-[#98a4b6]" />
						<h2 className="m-0 text-[13px] font-semibold">Items</h2>
						<span className="text-[11px] text-[#98a4b6]">{shapes.length}</span>
						<button
							type="button"
							aria-label="Hide item hierarchy"
							title="Hide item hierarchy"
							onClick={() => {
								setOpen(false);
								requestAnimationFrame(() => toggle.current?.focus());
							}}
							className="ml-auto grid size-7 cursor-pointer place-items-center rounded text-[#98a4b6] hover:bg-white/10 hover:text-white"
						>
							<PanelLeftClose size={16} aria-hidden="true" />
						</button>
					</header>
					{!rows.length && (
						<p className="px-4 text-xs text-[#98a4b6]">
							No items in this drawing.
						</p>
					)}
					<div
						ref={viewport}
						role="tree"
						aria-label="Drawing items"
						aria-multiselectable="true"
						aria-activedescendant={
							visible.some(({ item }) => item.key === focusKey)
								? `${panelId}-${focusKey}`
								: undefined
						}
						tabIndex={0}
						className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#e8b77e]"
						onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
						onKeyDown={(event) => {
							const index = Math.max(
								0,
								rows.findIndex(({ item }) => item.key === focusKey),
							);
							const row = rows[index];
							if (!row) return;
							let next = index;
							if (event.key === "ArrowDown")
								next = Math.min(rows.length - 1, index + 1);
							else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
							else if (event.key === "Home") next = 0;
							else if (event.key === "End") next = rows.length - 1;
							else if (event.key === "ArrowRight") {
								if (row.item.children.length && collapsed.has(row.item.shapeId))
									expand(row.item.shapeId, true);
								else if (row.item.children.length) next = index + 1;
							} else if (event.key === "ArrowLeft") {
								if (row.item.childKey)
									next = rows.findIndex(
										({ item }) => item.key === String(row.item.shapeId),
									);
								else if (row.item.children.length)
									expand(row.item.shapeId, false);
							} else if (event.key === "Enter" || event.key === " ")
								select(
									row.item,
									event.ctrlKey || event.metaKey || event.shiftKey,
								);
							else return;
							event.preventDefault();
							event.stopPropagation();
							setActiveKey(rows[next].item.key);
							reveal(next);
						}}
					>
						<div
							className="relative"
							style={{ height: rows.length * rowHeight }}
						>
							{visible.map(({ item, level, position, size }, index) => {
								const Icon = icons[item.kind];
								const expanded = !collapsed.has(item.shapeId);
								const selected =
									selectedIds.has(item.shapeId) &&
									(item.childKey
										? selectedChildKey === item.childKey &&
											selectedIds.size === 1
										: !selectedChildKey || !expanded);
								return (
									<div
										id={`${panelId}-${item.key}`}
										key={item.key}
										role="treeitem"
										tabIndex={-1}
										aria-label={item.label}
										aria-level={level}
										aria-posinset={position}
										aria-setsize={size}
										aria-selected={selected}
										aria-expanded={item.children.length ? expanded : undefined}
										aria-disabled={disabled || item.disabled}
										data-shape-id={item.shapeId}
										data-child-key={item.childKey}
										data-active={item.key === focusKey}
										title={`${item.label}${item.locked ? " · Locked" : item.disabled ? " · Not selectable" : ""}`}
										className="absolute inset-x-0 flex cursor-pointer items-center gap-2 pr-3 text-xs hover:bg-white/5 aria-selected:bg-[#e8b77e1c] aria-selected:text-[#e8b77e] aria-disabled:cursor-default aria-disabled:text-[#67717f] [[role=tree]:focus-visible_&]:data-[active=true]:outline [[role=tree]:focus-visible_&]:data-[active=true]:outline-1 [[role=tree]:focus-visible_&]:data-[active=true]:-outline-offset-1 [[role=tree]:focus-visible_&]:data-[active=true]:outline-[#e8b77e80]"
										style={{
											top: (start + index) * rowHeight,
											height: rowHeight,
											paddingLeft: level === 1 ? 8 : 32,
										}}
										onClick={(event) => {
											viewport.current?.focus();
											select(
												item,
												event.ctrlKey || event.metaKey || event.shiftKey,
											);
										}}
										onKeyDown={(event) => {
											if (event.key !== "Enter" && event.key !== " ") return;
											event.preventDefault();
											event.stopPropagation();
											select(
												item,
												event.ctrlKey || event.metaKey || event.shiftKey,
											);
										}}
									>
										{item.children.length ? (
											<button
												type="button"
												tabIndex={-1}
												aria-label={`${expanded ? "Collapse" : "Expand"} ${item.label}`}
												className="grid size-5 shrink-0 cursor-pointer place-items-center rounded hover:bg-white/10"
												onClick={(event) => {
													event.stopPropagation();
													expand(item.shapeId, !expanded);
													setActiveKey(item.key);
													viewport.current?.focus();
												}}
											>
												{expanded ? (
													<ChevronDown size={14} aria-hidden="true" />
												) : (
													<ChevronRight size={14} aria-hidden="true" />
												)}
											</button>
										) : (
											<span className="w-5 shrink-0" />
										)}
										<Icon
											size={14}
											aria-hidden="true"
											className="shrink-0 opacity-70"
										/>
										<span className="truncate">{item.label}</span>
										{item.locked && (
											<LockKeyhole
												size={12}
												aria-hidden="true"
												className="ml-auto shrink-0"
											/>
										)}
									</div>
								);
							})}
						</div>
					</div>
				</aside>
			)}
		</>
	);
}
