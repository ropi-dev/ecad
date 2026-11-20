import { symbolCategories } from "@ecad/default-symbols";
import {
	createEffect,
	createMemo,
	createProjection,
	createSignal,
	createUniqueId,
	For,
	Show,
} from "solid-js";
import { SymbolThumbnail } from "#/components/editor/SymbolThumbnail.tsx";
import type { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { ChevronRight, Cpu, Search } from "#/components/ui/icons.tsx";
import { Popover } from "#/components/ui/primitives.tsx";
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

type SymbolEntry = { kind: "symbol"; id: string; definition: SymbolDefinition };
type PartEntry = {
	kind: "part";
	id: string;
	part: string;
	symbols: SymbolDefinition[];
};
type PickerEntry = SymbolEntry | PartEntry;

const asSymbol = (entry: PickerEntry) =>
	entry.kind === "symbol" ? entry : undefined;
const asPart = (entry: PickerEntry) =>
	entry.kind === "part" ? entry : undefined;

const optionClassName =
	"flex scroll-mt-8 cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40 data-highlighted:bg-hover pointer-coarse:min-h-11";
const optionNameClassName = "block truncate text-sm leading-[1.125rem]";
const optionDetailClassName =
	"block truncate text-2xs leading-[0.875rem] text-fg-faint";

function SymbolOption(props: {
	definition: SymbolDefinition;
	optionId: string | undefined;
	highlighted: boolean;
	components: boolean;
	onChoose: (definition: SymbolDefinition) => void;
	onHighlight: (id: string) => void;
}) {
	const reason = createMemo(() =>
		unavailableReason(props.definition, props.components),
	);
	const detail = () =>
		props.definition.packaging?.description ?? props.definition.description;
	return (
		<button
			type="button"
			aria-label={`${props.components ? "Place" : "Insert"} ${props.definition.name}`}
			id={props.optionId}
			data-highlighted={props.highlighted ? "" : undefined}
			disabled={!!reason()}
			title={reason()}
			class={optionClassName}
			onPointerMove={() => {
				if (!reason() && !props.highlighted)
					props.onHighlight(props.definition.id);
			}}
			onFocus={() => {
				if (!reason()) props.onHighlight(props.definition.id);
			}}
			onClick={() => props.onChoose(props.definition)}
		>
			<SymbolThumbnail definition={props.definition} />
			<span class="min-w-0">
				<span class={optionNameClassName}>
					{props.definition.packaging?.name ?? props.definition.name}
				</span>
				{(!props.components || props.definition.packaging) && (
					<span title={detail()} class={optionDetailClassName}>
						{detail()}
					</span>
				)}
			</span>
		</button>
	);
}

function PartOption(props: {
	entry: PartEntry;
	optionId: string | undefined;
	highlighted: boolean;
	expanded: boolean;
	available: boolean;
	onHighlight: (id: string) => void;
}) {
	const count = () => props.entry.symbols.length;
	return (
		<button
			type="button"
			aria-label={`${props.entry.part} packagings`}
			id={props.optionId}
			data-highlighted={props.highlighted || props.expanded ? "" : undefined}
			disabled={!props.available}
			class={optionClassName}
			onPointerMove={() => {
				if (props.available && !props.highlighted)
					props.onHighlight(props.entry.id);
			}}
			onFocus={() => {
				if (props.available) props.onHighlight(props.entry.id);
			}}
		>
			<SymbolThumbnail definition={props.entry.symbols[0]} />
			<span class="min-w-0 flex-1">
				<span class={optionNameClassName}>{props.entry.part}</span>
				<span class={optionDetailClassName}>
					{count()} {count() === 1 ? "packaging" : "packagings"}
				</span>
			</span>
			<ChevronRight
				size={14}
				aria-hidden="true"
				class="shrink-0 text-fg-faint"
			/>
		</button>
	);
}

export function SymbolPicker(props: {
	disabled: boolean;
	active: boolean;
	onChoose: (definition: SymbolDefinition) => void;
	library: Pick<ReturnType<typeof useSymbolLibrary>, "definitions" | "error">;
	mode?: "symbol" | "component";
	allowNetSymbols?: boolean;
	onOpen?: () => void;
}) {
	const components = () => props.mode === "component";
	const label = () => (components() ? "Components" : "Symbols");
	const searchLabel = () =>
		components() ? "Search components" : "Search symbols";
	const [open, setOpen] = createSignal(false);
	let chosenComponent = false;
	const [query, setQuery] = createSignal("");
	let searchInput!: HTMLInputElement;
	const groups = createMemo(() => {
		const search = query().trim().toLowerCase();
		const component = components();
		const allowNetSymbols = props.allowNetSymbols ?? true;
		const matches = props.library.definitions.filter(
			(definition) =>
				((!component && allowNetSymbols) || !definition.netSymbol) &&
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
	});
	const listId = createUniqueId();
	const packagingListId = `${listId}-packagings`;
	const [activeId, setActiveId] = createSignal<string>();
	const [openPartId, setOpenPartId] = createSignal<string>();
	const [activePackageId, setActivePackageId] = createSignal<string>();
	const choices = createMemo(() => {
		const component = components();
		return groups()
			.flatMap(({ entries }) => entries)
			.filter((entry) =>
				entry.kind === "symbol"
					? !unavailableReason(entry.definition, component)
					: entry.symbols.some(
							(definition) => !unavailableReason(definition, component),
						),
			);
	});
	const optionIds = createMemo(
		() =>
			new Map(
				choices().map((entry, index) => [
					entry.id,
					`${listId}-option-${index}`,
				]),
			),
	);
	const highlighted = createMemo(
		() => choices().find((entry) => entry.id === activeId()) ?? choices()[0],
	);
	const highlightedIds = createProjection<Record<string, true>>((draft) => {
		const id = highlighted()?.id;
		for (const key of Object.keys(draft)) if (key !== id) delete draft[key];
		if (id !== undefined) draft[id] = true;
	}, {});
	const openPart = createMemo(() =>
		choices().find(
			(entry) => entry.kind === "part" && entry.id === openPartId(),
		),
	);
	const packageChoices = createMemo(() => {
		const part = openPart();
		const component = components();
		return part?.kind === "part"
			? part.symbols.filter(
					(definition) => !unavailableReason(definition, component),
				)
			: [];
	});
	const packageOptionIds = createMemo(
		() =>
			new Map(
				packageChoices().map((definition, index) => [
					definition.id,
					`${listId}-packaging-${index}`,
				]),
			),
	);
	const highlightedPackage = createMemo(
		() =>
			packageChoices().find(
				(definition) => definition.id === activePackageId(),
			) ?? packageChoices()[0],
	);
	let pickerContent: HTMLDivElement | undefined;
	const [submenuSide, setSubmenuSide] = createSignal<"right" | "bottom">(
		"right",
	);
	const measureSubmenuSide = () => {
		const bounds = pickerContent?.getBoundingClientRect();
		const needed = SUBMENU_WIDTH + SUBMENU_OFFSET + COLLISION_PADDING;
		setSubmenuSide(
			!bounds ||
				window.innerWidth - bounds.right >= needed ||
				bounds.left >= needed
				? "right"
				: "bottom",
		);
	};
	const submenuOpen = createMemo(() => open() && openPart() !== undefined);
	createEffect(submenuOpen, (submenu) => {
		if (!submenu) return;
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
	});
	const scrollToOption = (id: string | undefined) => {
		if (id) document.getElementById(id)?.scrollIntoView({ block: "nearest" });
	};
	const openPackagings = (entry: PickerEntry) => {
		scrollToOption(optionIds().get(entry.id));
		measureSubmenuSide();
		setOpenPartId(entry.id);
		setActiveId(entry.id);
		setActivePackageId(undefined);
	};
	const highlightEntry = (id: string) => {
		if (openPartId() === undefined) setActiveId(id);
	};
	const choose = (definition: SymbolDefinition) => {
		if (components()) chosenComponent = true;
		props.onChoose(definition);
		setOpen(false);
	};
	const focusSearch = () => searchInput.focus({ preventScroll: true });
	const step = <T,>(list: readonly T[], current: T, key: string) =>
		list[
			Math.min(
				Math.max(list.indexOf(current) + (key === "ArrowDown" ? 1 : -1), 0),
				list.length - 1,
			)
		];
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.isComposing) return;
		const part = openPart();
		const entry = highlighted();
		const vertical = event.key === "ArrowDown" || event.key === "ArrowUp";
		if (part && vertical) {
			event.preventDefault();
			focusSearch();
			const current = highlightedPackage();
			if (!current) return;
			const next = step(packageChoices(), current, event.key);
			setActivePackageId(next.id);
			scrollToOption(packageOptionIds().get(next.id));
			return;
		}
		if (part && event.key === "ArrowLeft") {
			event.preventDefault();
			setOpenPartId(undefined);
			focusSearch();
			return;
		}
		if (
			!part &&
			event.key === "ArrowRight" &&
			entry?.kind === "part" &&
			(event.target !== searchInput ||
				searchInput.selectionStart === query().length)
		) {
			event.preventDefault();
			openPackagings(entry);
			focusSearch();
			return;
		}
		if (vertical) {
			event.preventDefault();
			focusSearch();
			if (!entry) return;
			const next = step(choices(), entry, event.key);
			setActiveId(next.id);
			scrollToOption(optionIds().get(next.id));
			return;
		}
		if (event.target === searchInput) {
			if (event.key !== "Enter") return;
			if (part) {
				const current = highlightedPackage();
				if (!current) return;
				event.preventDefault();
				choose(current);
			} else if (entry) {
				event.preventDefault();
				if (entry.kind === "part") openPackagings(entry);
				else choose(entry.definition);
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
			searchInput.focus();
	};
	const activeDescendant = createMemo(() => {
		if (openPart()) {
			const current = highlightedPackage();
			return current && packageOptionIds().get(current.id);
		}
		const current = highlighted();
		return current && optionIds().get(current.id);
	});
	const categoryLabel = (category: string) =>
		components() && category === "Custom symbols"
			? "Custom components"
			: category;
	return (
		<Popover.Root
			open={open()}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (nextOpen) {
					setQuery("");
					setActiveId(undefined);
					setOpenPartId(undefined);
					props.onOpen?.();
				}
			}}
		>
			<Popover.Trigger>
				<TooltipButton
					type="button"
					disabled={props.disabled}
					aria-label={label()}
					tooltip={components() ? "Insert a component" : "Insert a symbol"}
					aria-pressed={props.active ? "true" : "false"}
					class={viewControlButtonClassName}
				>
					<Cpu size={18} aria-hidden="true" />
				</TooltipButton>
			</Popover.Trigger>
			<Popover.Content
				ref={(element: HTMLDivElement) => {
					pickerContent = element;
				}}
				onCloseAutoFocus={(event: Event) => {
					if (chosenComponent) {
						event.preventDefault();
						chosenComponent = false;
					}
				}}
				side="top"
				sideOffset={8}
				collisionPadding={COLLISION_PADDING}
				aria-label={components() ? "Component library" : "Symbol library"}
				onOpenAutoFocus={() => searchInput.focus()}
				onKeyDown={onKeyDown}
				class="ui-popover z-50 flex max-h-[min(26rem,calc(100dvh-6rem))] w-[22.5rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden"
			>
				<div class="m-2 flex h-8 shrink-0 items-center gap-2 rounded-md border border-line bg-field px-2 focus-within:border-accent">
					<Search size={14} aria-hidden="true" class="shrink-0 text-fg-faint" />
					<input
						ref={searchInput}
						type="search"
						aria-label={searchLabel()}
						placeholder={searchLabel()}
						autocomplete="off"
						aria-controls={openPart() ? packagingListId : listId}
						aria-activedescendant={activeDescendant()}
						value={query()}
						onInput={(event) => {
							setQuery(event.currentTarget.value);
							setActiveId(undefined);
							setOpenPartId(undefined);
						}}
						class="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
					/>
				</div>
				<div
					id={listId}
					data-symbol-picker=""
					onScroll={(event) => {
						const part = openPart();
						if (!part) return;
						const row = document.getElementById(optionIds().get(part.id) ?? "");
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
					class="min-h-0 flex-1 overflow-auto px-2 pb-2"
				>
					<Show when={props.library.error}>
						<p
							role="alert"
							class="m-0 mb-2 whitespace-pre-wrap text-xs text-danger"
						>
							{props.library.error}
						</p>
					</Show>
					{groups().length === 0 && (
						<output
							aria-live="polite"
							class="block px-1.5 py-2 text-xs text-fg-muted"
						>
							{query().trim()
								? components()
									? "No components found."
									: "No symbols match your search."
								: components()
									? "No components available."
									: "No symbols available. Open Project actions, then Symbol libraries to enable a library."}
						</output>
					)}
					<div class="space-y-2">
						<For each={groups()} keyed={(group) => group.category}>
							{(group) => (
								<section aria-label={categoryLabel(group().category)}>
									<h3 class="ui-section-label sticky top-0 z-10 -mx-2 mt-0 mb-0.5 border-b border-line-subtle bg-raised px-3.5 py-1.5">
										{categoryLabel(group().category)}
									</h3>
									<div class="flex flex-col">
										<For each={group().entries} keyed={(entry) => entry.id}>
											{(entry) => (
												<Show
													when={asSymbol(entry())}
													fallback={
														<Show when={asPart(entry())}>
															{(part) => (
																<PartPicker
																	entry={part()}
																	optionId={optionIds().get(part().id)}
																	highlighted={
																		highlightedIds[part().id] === true
																	}
																	expanded={openPart()?.id === part().id}
																	available={optionIds().has(part().id)}
																	submenuSide={submenuSide()}
																	packagingListId={packagingListId}
																	packageOptionIds={packageOptionIds()}
																	highlightedPackage={highlightedPackage()}
																	components={components()}
																	onOpenPackagings={() =>
																		openPackagings(part())
																	}
																	onClosePackagings={() =>
																		setOpenPartId(undefined)
																	}
																	onHighlight={highlightEntry}
																	onHighlightPackage={setActivePackageId}
																	onChoose={choose}
																	onFocusSearch={focusSearch}
																	isSearch={(target) => target === searchInput}
																/>
															)}
														</Show>
													}
												>
													{(symbol) => (
														<SymbolOption
															definition={symbol().definition}
															optionId={optionIds().get(symbol().id)}
															highlighted={highlightedIds[symbol().id] === true}
															components={components()}
															onChoose={choose}
															onHighlight={highlightEntry}
														/>
													)}
												</Show>
											)}
										</For>
									</div>
								</section>
							)}
						</For>
					</div>
				</div>
				<p
					aria-hidden="true"
					class="m-0 flex shrink-0 items-center gap-3 border-t border-line-subtle px-3 py-1.5 text-2xs text-fg-faint"
				>
					<span class="flex items-center gap-1">
						<kbd class="ui-kbd">↑</kbd>
						<kbd class="ui-kbd">↓</kbd>
						Browse
					</span>
					<span class="flex items-center gap-1">
						<kbd class="ui-kbd">Enter</kbd>
						{components() ? "Place" : "Insert"}
					</span>
					<span class="flex items-center gap-1">
						<kbd class="ui-kbd">Esc</kbd>
						Close
					</span>
				</p>
			</Popover.Content>
		</Popover.Root>
	);
}

function PartPicker(props: {
	entry: PartEntry;
	optionId: string | undefined;
	highlighted: boolean;
	expanded: boolean;
	available: boolean;
	submenuSide: "right" | "bottom";
	packagingListId: string;
	packageOptionIds: ReadonlyMap<string, string>;
	highlightedPackage: SymbolDefinition | undefined;
	components: boolean;
	onOpenPackagings: () => void;
	onClosePackagings: () => void;
	onHighlight: (id: string) => void;
	onHighlightPackage: (id: string) => void;
	onChoose: (definition: SymbolDefinition) => void;
	onFocusSearch: () => void;
	isSearch: (target: EventTarget | null) => boolean;
}) {
	return (
		<Popover.Root
			open={props.expanded}
			onOpenChange={(nextOpen) => {
				if (nextOpen) props.onOpenPackagings();
				else if (props.expanded) props.onClosePackagings();
			}}
		>
			<Popover.Trigger>
				<PartOption
					entry={props.entry}
					optionId={props.optionId}
					highlighted={props.highlighted}
					expanded={props.expanded}
					available={props.available}
					onHighlight={props.onHighlight}
				/>
			</Popover.Trigger>
			<Popover.Content
				side={props.submenuSide}
				align={props.submenuSide === "right" ? "start" : "end"}
				sideOffset={props.submenuSide === "right" ? SUBMENU_OFFSET : 2}
				collisionPadding={COLLISION_PADDING}
				aria-label={`${props.entry.part} packagings`}
				onOpenAutoFocus={props.onFocusSearch}
				keepOpenOnFocus={props.isSearch}
				onCloseAutoFocus={(event: Event) => {
					event.preventDefault();
					props.onFocusSearch();
				}}
				class="ui-popover z-50 flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-64 max-w-[calc(100vw-2rem)] flex-col overflow-auto p-2"
			>
				<h4 class="ui-section-label -mx-2 -mt-2 mb-1 border-b border-line-subtle px-3.5 py-1.5">
					{props.entry.part}
				</h4>
				<div id={props.packagingListId} class="flex flex-col">
					<For each={props.entry.symbols}>
						{(definition) => (
							<SymbolOption
								definition={definition}
								optionId={props.packageOptionIds.get(definition.id)}
								highlighted={definition === props.highlightedPackage}
								components={props.components}
								onChoose={props.onChoose}
								onHighlight={props.onHighlightPackage}
							/>
						)}
					</For>
				</div>
			</Popover.Content>
		</Popover.Root>
	);
}
