import { symbolCategories } from "@ecad/default-symbols";
import { ChevronRight, Cpu, Search } from "lucide-react";
import { Popover } from "radix-ui";
import {
	type ComponentProps,
	memo,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { SymbolThumbnail } from "#/components/editor/SymbolThumbnail.tsx";
import type { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { viewControlButtonClassName } from "#/components/viewer/ViewControls3D.tsx";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

function unavailableReason(definition: SymbolDefinition, components: boolean) {
	if (components)
		return definition.children.some((child) => child.kind === "pin")
			? undefined
			: "No pins";
	return definition.children.length
		? undefined
		: "Add shapes in the symbol editor before placing this symbol.";
}

const SUBMENU_WIDTH = 256;
const SUBMENU_OFFSET = 10;
const COLLISION_PADDING = 12;

type PickerEntry =
	| { kind: "symbol"; id: string; definition: SymbolDefinition }
	| { kind: "part"; id: string; part: string; symbols: SymbolDefinition[] };

const optionClassName =
	"flex scroll-mt-8 cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40 data-highlighted:bg-hover pointer-coarse:min-h-11";
const optionNameClassName = "block truncate text-sm leading-[1.125rem]";
const optionDetailClassName =
	"block truncate text-2xs leading-[0.875rem] text-fg-faint";

const SymbolOption = memo(function SymbolOption({
	definition,
	optionId,
	highlighted,
	components,
	onChoose,
	onHighlight,
}: {
	definition: SymbolDefinition;
	optionId: string | undefined;
	highlighted: boolean;
	components: boolean;
	onChoose: (definition: SymbolDefinition) => void;
	onHighlight: (id: string) => void;
}) {
	const reason = unavailableReason(definition, components);
	return (
		<button
			type="button"
			aria-label={`${components ? "Place" : "Insert"} ${definition.name}`}
			id={optionId}
			data-highlighted={highlighted ? "" : undefined}
			disabled={!!reason}
			title={reason}
			className={optionClassName}
			onPointerMove={() => {
				if (!reason && !highlighted) onHighlight(definition.id);
			}}
			onFocus={() => {
				if (!reason) onHighlight(definition.id);
			}}
			onClick={() => onChoose(definition)}
		>
			<SymbolThumbnail definition={definition} />
			<span className="min-w-0">
				<span className={optionNameClassName}>
					{definition.packaging?.name ?? definition.name}
				</span>
				{(!components || definition.packaging) && (
					<span
						title={definition.packaging?.description ?? definition.description}
						className={optionDetailClassName}
					>
						{definition.packaging?.description ?? definition.description}
					</span>
				)}
			</span>
		</button>
	);
});

const PartOption = memo(function PartOption({
	entry,
	optionId,
	highlighted,
	expanded,
	available,
	onHighlight,
	...trigger
}: {
	entry: Extract<PickerEntry, { kind: "part" }>;
	optionId: string | undefined;
	highlighted: boolean;
	expanded: boolean;
	available: boolean;
	onHighlight: (id: string) => void;
} & ComponentProps<"button">) {
	const count = entry.symbols.length;
	return (
		<button
			{...trigger}
			type="button"
			aria-label={`${entry.part} packagings`}
			id={optionId}
			data-highlighted={highlighted || expanded ? "" : undefined}
			disabled={!available}
			className={optionClassName}
			onPointerMove={() => {
				if (available && !highlighted) onHighlight(entry.id);
			}}
			onFocus={() => {
				if (available) onHighlight(entry.id);
			}}
		>
			<SymbolThumbnail definition={entry.symbols[0]} />
			<span className="min-w-0 flex-1">
				<span className={optionNameClassName}>{entry.part}</span>
				<span className={optionDetailClassName}>
					{count} {count === 1 ? "packaging" : "packagings"}
				</span>
			</span>
			<ChevronRight
				size={14}
				aria-hidden="true"
				className="shrink-0 text-fg-faint"
			/>
		</button>
	);
});

export function SymbolPicker({
	disabled,
	active,
	onChoose,
	library,
	mode = "symbol",
	allowNetSymbols = true,
	onOpen,
}: {
	disabled: boolean;
	active: boolean;
	onChoose: (definition: SymbolDefinition) => void;
	library: Pick<ReturnType<typeof useSymbolLibrary>, "definitions" | "error">;
	mode?: "symbol" | "component";
	allowNetSymbols?: boolean;
	onOpen?: () => void;
}) {
	const components = mode === "component";
	const label = components ? "Components" : "Symbols";
	const searchLabel = components ? "Search components" : "Search symbols";
	const [open, setOpen] = useState(false);
	const chosenComponent = useRef(false);
	const [query, setQuery] = useState("");
	const searchInput = useRef<HTMLInputElement>(null);
	const { definitions } = library;
	const groups = useMemo(() => {
		const search = query.trim().toLowerCase();
		const matches = definitions.filter(
			(definition) =>
				((!components && allowNetSymbols) || !definition.netSymbol) &&
				[
					definition.name,
					definition.description,
					definition.value,
					definition.prefix,
					definition.id,
					definition.category ?? "Custom symbols",
					definition.packaging?.part ?? "",
					definition.packaging?.name ?? "",
					definition.packaging?.description ?? "",
				].some((value) => value.toLowerCase().includes(search)),
		);
		return [...symbolCategories, "Custom symbols"].flatMap((category) => {
			const parts = new Map<string, SymbolDefinition[]>();
			const entries: PickerEntry[] = [];
			for (const definition of matches) {
				if ((definition.category ?? "Custom symbols") !== category) continue;
				const part = definition.packaging?.part;
				if (part === undefined) {
					entries.push({ kind: "symbol", id: definition.id, definition });
					continue;
				}
				const existing = parts.get(part);
				if (existing) {
					existing.push(definition);
					continue;
				}
				const symbols = [definition];
				parts.set(part, symbols);
				entries.push({
					kind: "part",
					id: `part:${category}:${part}`,
					part,
					symbols,
				});
			}
			return entries.length ? [{ category, entries }] : [];
		});
	}, [definitions, query, components, allowNetSymbols]);
	const listId = useId();
	const packagingListId = `${listId}-packagings`;
	const [activeId, setActiveId] = useState<string>();
	const [openPartId, setOpenPartId] = useState<string>();
	const [activePackageId, setActivePackageId] = useState<string>();
	const { choices, optionIds } = useMemo(() => {
		const choices = groups
			.flatMap(({ entries }) => entries)
			.filter((entry) =>
				entry.kind === "symbol"
					? !unavailableReason(entry.definition, components)
					: entry.symbols.some(
							(definition) => !unavailableReason(definition, components),
						),
			);
		return {
			choices,
			optionIds: new Map(
				choices.map((entry, index) => [entry.id, `${listId}-option-${index}`]),
			),
		};
	}, [groups, components, listId]);
	const highlighted =
		choices.find((entry) => entry.id === activeId) ?? choices[0];
	const openPart = choices.find(
		(entry) => entry.kind === "part" && entry.id === openPartId,
	);
	const { packageChoices, packageOptionIds } = useMemo(() => {
		const packageChoices =
			openPart?.kind === "part"
				? openPart.symbols.filter(
						(definition) => !unavailableReason(definition, components),
					)
				: [];
		return {
			packageChoices,
			packageOptionIds: new Map(
				packageChoices.map((definition, index) => [
					definition.id,
					`${listId}-packaging-${index}`,
				]),
			),
		};
	}, [openPart, components, listId]);
	const highlightedPackage =
		packageChoices.find((definition) => definition.id === activePackageId) ??
		packageChoices[0];
	const pickerContent = useRef<HTMLDivElement>(null);
	const [submenuSide, setSubmenuSide] = useState<"right" | "bottom">("right");
	const measureSubmenuSide = useCallback(() => {
		const bounds = pickerContent.current?.getBoundingClientRect();
		const needed = SUBMENU_WIDTH + SUBMENU_OFFSET + COLLISION_PADDING;
		setSubmenuSide(
			!bounds ||
				window.innerWidth - bounds.right >= needed ||
				bounds.left >= needed
				? "right"
				: "bottom",
		);
	}, []);
	const submenuOpen = open && openPart !== undefined;
	useEffect(() => {
		if (!submenuOpen) return;
		let frame = 0;
		const remeasure = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measureSubmenuSide);
		};
		window.addEventListener("resize", remeasure);
		return () => {
			window.removeEventListener("resize", remeasure);
			cancelAnimationFrame(frame);
		};
	}, [submenuOpen, measureSubmenuSide]);
	const openPackagings = (entry: PickerEntry) => {
		const id = optionIds.get(entry.id);
		if (id) document.getElementById(id)?.scrollIntoView({ block: "nearest" });
		measureSubmenuSide();
		setOpenPartId(entry.id);
		setActiveId(entry.id);
		setActivePackageId(undefined);
	};
	const latestChoose = useRef(onChoose);
	const latestOpenPartId = useRef(openPartId);
	useLayoutEffect(() => {
		latestChoose.current = onChoose;
		latestOpenPartId.current = openPartId;
	});
	const highlightEntry = useCallback((id: string) => {
		if (latestOpenPartId.current === undefined) setActiveId(id);
	}, []);
	const choose = useCallback(
		(definition: SymbolDefinition) => {
			if (components) chosenComponent.current = true;
			latestChoose.current(definition);
			setOpen(false);
		},
		[components],
	);
	return (
		<Popover.Root
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (nextOpen) {
					setQuery("");
					setActiveId(undefined);
					setOpenPartId(undefined);
					onOpen?.();
				}
			}}
		>
			<Popover.Trigger asChild>
				<TooltipButton
					type="button"
					disabled={disabled}
					aria-label={label}
					tooltip={components ? "Insert a component" : "Insert a symbol"}
					aria-pressed={active}
					className={viewControlButtonClassName}
				>
					<Cpu size={18} aria-hidden="true" />
				</TooltipButton>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					ref={pickerContent}
					onCloseAutoFocus={(event) => {
						if (chosenComponent.current) {
							event.preventDefault();
							chosenComponent.current = false;
						}
					}}
					side="top"
					sideOffset={8}
					collisionPadding={COLLISION_PADDING}
					aria-label={components ? "Component library" : "Symbol library"}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						searchInput.current?.focus();
					}}
					onKeyDown={(event) => {
						if (event.nativeEvent.isComposing) return;
						if (
							openPart &&
							(event.key === "ArrowDown" || event.key === "ArrowUp")
						) {
							event.preventDefault();
							searchInput.current?.focus({ preventScroll: true });
							if (!highlightedPackage) return;
							const next =
								packageChoices[
									Math.min(
										Math.max(
											packageChoices.indexOf(highlightedPackage) +
												(event.key === "ArrowDown" ? 1 : -1),
											0,
										),
										packageChoices.length - 1,
									)
								];
							setActivePackageId(next.id);
							const id = packageOptionIds.get(next.id);
							if (id)
								document
									.getElementById(id)
									?.scrollIntoView({ block: "nearest" });
							return;
						}
						if (openPart && event.key === "ArrowLeft") {
							event.preventDefault();
							setOpenPartId(undefined);
							searchInput.current?.focus({ preventScroll: true });
							return;
						}
						if (
							!openPart &&
							event.key === "ArrowRight" &&
							highlighted?.kind === "part" &&
							(event.target !== searchInput.current ||
								searchInput.current.selectionStart === query.length)
						) {
							event.preventDefault();
							openPackagings(highlighted);
							searchInput.current?.focus({ preventScroll: true });
							return;
						}
						if (event.key === "ArrowDown" || event.key === "ArrowUp") {
							event.preventDefault();
							searchInput.current?.focus({ preventScroll: true });
							if (!highlighted) return;
							const next =
								choices[
									Math.min(
										Math.max(
											choices.indexOf(highlighted) +
												(event.key === "ArrowDown" ? 1 : -1),
											0,
										),
										choices.length - 1,
									)
								];
							setActiveId(next.id);
							const id = optionIds.get(next.id);
							if (id)
								document
									.getElementById(id)
									?.scrollIntoView({ block: "nearest" });
							return;
						}
						if (event.target === searchInput.current) {
							if (event.key !== "Enter") return;
							if (openPart) {
								if (!highlightedPackage) return;
								event.preventDefault();
								choose(highlightedPackage);
							} else if (highlighted) {
								event.preventDefault();
								if (highlighted.kind === "part") openPackagings(highlighted);
								else choose(highlighted.definition);
							}
							return;
						}
						if (
							event.key === "Backspace" ||
							(event.key.length === 1 &&
								!event.ctrlKey &&
								!event.metaKey &&
								!event.altKey)
						)
							searchInput.current?.focus();
					}}
					className="ui-popover z-50 flex max-h-[min(26rem,calc(100dvh-6rem))] w-[22.5rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden"
				>
					<div className="m-2 flex h-8 shrink-0 items-center gap-2 rounded-md border border-line bg-field px-2 focus-within:border-accent">
						<Search
							size={14}
							aria-hidden="true"
							className="shrink-0 text-fg-faint"
						/>
						<input
							ref={searchInput}
							type="search"
							aria-label={searchLabel}
							placeholder={searchLabel}
							autoComplete="off"
							aria-controls={openPart ? packagingListId : listId}
							aria-activedescendant={
								openPart
									? highlightedPackage &&
										packageOptionIds.get(highlightedPackage.id)
									: highlighted && optionIds.get(highlighted.id)
							}
							value={query}
							onChange={(event) => {
								setQuery(event.currentTarget.value);
								setActiveId(undefined);
								setOpenPartId(undefined);
							}}
							className="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
						/>
					</div>
					<div
						id={listId}
						data-symbol-picker=""
						onScroll={(event) => {
							if (!openPart) return;
							const row = document.getElementById(
								optionIds.get(openPart.id) ?? "",
							);
							const list = event.currentTarget.getBoundingClientRect();
							const bounds = row?.getBoundingClientRect();
							const top = Math.max(
								list.top,
								row
									?.closest("section")
									?.querySelector("h3")
									?.getBoundingClientRect().bottom ?? list.top,
							);
							if (!bounds || bounds.bottom <= top || bounds.top >= list.bottom)
								setOpenPartId(undefined);
						}}
						className="min-h-0 flex-1 overflow-auto px-2 pb-2"
					>
						{library.error && (
							<p
								role="alert"
								className="m-0 mb-2 whitespace-pre-wrap text-xs text-danger"
							>
								{library.error}
							</p>
						)}
						{groups.length === 0 && (
							<output
								aria-live="polite"
								className="block px-1.5 py-2 text-xs text-fg-muted"
							>
								{query.trim()
									? components
										? "No components found."
										: "No symbols match your search."
									: components
										? "No components available."
										: "No symbols available. Open Project actions, then Symbol libraries to enable a library."}
							</output>
						)}
						<div className="space-y-2">
							{groups.map(({ category, entries }) => (
								<section
									key={category}
									aria-label={
										components && category === "Custom symbols"
											? "Custom components"
											: category
									}
								>
									<h3 className="ui-section-label sticky top-0 z-10 -mx-2 mt-0 mb-0.5 border-b border-line-subtle bg-raised px-3.5 py-1.5">
										{components && category === "Custom symbols"
											? "Custom components"
											: category}
									</h3>
									<div className="flex flex-col">
										{entries.map((entry) => {
											if (entry.kind === "symbol")
												return (
													<SymbolOption
														key={entry.id}
														definition={entry.definition}
														optionId={optionIds.get(entry.id)}
														highlighted={entry === highlighted}
														components={components}
														onChoose={choose}
														onHighlight={highlightEntry}
													/>
												);
											const expanded = entry === openPart;
											return (
												<Popover.Root
													key={entry.id}
													open={expanded}
													onOpenChange={(nextOpen) => {
														if (nextOpen) openPackagings(entry);
														else if (expanded) setOpenPartId(undefined);
													}}
												>
													<Popover.Trigger asChild>
														<PartOption
															entry={entry}
															optionId={optionIds.get(entry.id)}
															highlighted={entry === highlighted}
															expanded={expanded}
															available={optionIds.has(entry.id)}
															onHighlight={highlightEntry}
														/>
													</Popover.Trigger>
													<Popover.Portal>
														<Popover.Content
															side={submenuSide}
															align={submenuSide === "right" ? "start" : "end"}
															sideOffset={
																submenuSide === "right" ? SUBMENU_OFFSET : 2
															}
															collisionPadding={COLLISION_PADDING}
															aria-label={`${entry.part} packagings`}
															onOpenAutoFocus={(event) => {
																event.preventDefault();
																searchInput.current?.focus({
																	preventScroll: true,
																});
															}}
															onFocusOutside={(event) => {
																if (event.target === searchInput.current)
																	event.preventDefault();
															}}
															onCloseAutoFocus={(event) => {
																event.preventDefault();
																searchInput.current?.focus({
																	preventScroll: true,
																});
															}}
															className="ui-popover z-50 flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-64 max-w-[calc(100vw-2rem)] flex-col overflow-auto p-2"
														>
															<h4 className="ui-section-label -mx-2 -mt-2 mb-1 border-b border-line-subtle px-3.5 py-1.5">
																{entry.part}
															</h4>
															<div
																id={expanded ? packagingListId : undefined}
																className="flex flex-col"
															>
																{entry.symbols.map((definition) => (
																	<SymbolOption
																		key={definition.id}
																		definition={definition}
																		optionId={packageOptionIds.get(
																			definition.id,
																		)}
																		highlighted={
																			definition === highlightedPackage
																		}
																		components={components}
																		onChoose={choose}
																		onHighlight={setActivePackageId}
																	/>
																))}
															</div>
														</Popover.Content>
													</Popover.Portal>
												</Popover.Root>
											);
										})}
									</div>
								</section>
							))}
						</div>
					</div>
					<p
						aria-hidden="true"
						className="m-0 flex shrink-0 items-center gap-3 border-t border-line-subtle px-3 py-1.5 text-2xs text-fg-faint"
					>
						<span className="flex items-center gap-1">
							<kbd className="ui-kbd">↑</kbd>
							<kbd className="ui-kbd">↓</kbd>
							Browse
						</span>
						<span className="flex items-center gap-1">
							<kbd className="ui-kbd">Enter</kbd>
							{components ? "Place" : "Insert"}
						</span>
						<span className="flex items-center gap-1">
							<kbd className="ui-kbd">Esc</kbd>
							Close
						</span>
					</p>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
