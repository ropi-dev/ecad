import { symbolCategories } from "@ecad/default-symbols";
import { Shapes } from "lucide-react";
import { Popover } from "radix-ui";
import {
	memo,
	useCallback,
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
			className="flex scroll-mt-8 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left focus-visible:outline-2 focus-visible:outline-[#e8b77e] disabled:cursor-default disabled:opacity-50 data-highlighted:bg-white/10"
			onPointerMove={() => {
				if (!reason && !highlighted) onHighlight(definition.id);
			}}
			onClick={() => onChoose(definition)}
		>
			<SymbolThumbnail definition={definition} />
			<span className="min-w-0">
				<span className="block truncate text-[13px] leading-tight">
					{definition.name}
				</span>
				{!components && (
					<span
						title={definition.description}
						className="block truncate text-[11px] leading-tight text-[#7c8696]"
					>
						{definition.description}
					</span>
				)}
			</span>
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
				].some((value) => value.toLowerCase().includes(search)),
		);
		return [...symbolCategories, "Custom symbols"].flatMap((category) => {
			const symbols = matches.filter(
				(definition) => (definition.category ?? "Custom symbols") === category,
			);
			return symbols.length ? [{ category, symbols }] : [];
		});
	}, [definitions, query, components, allowNetSymbols]);
	const listId = useId();
	const [activeId, setActiveId] = useState<string>();
	const { choices, optionIds } = useMemo(() => {
		const choices = groups
			.flatMap(({ symbols }) => symbols)
			.filter((definition) => !unavailableReason(definition, components));
		return {
			choices,
			optionIds: new Map(
				choices.map((definition, index) => [
					definition.id,
					`${listId}-option-${index}`,
				]),
			),
		};
	}, [groups, components, listId]);
	const highlighted =
		choices.find((definition) => definition.id === activeId) ?? choices[0];
	const latestChoose = useRef(onChoose);
	useLayoutEffect(() => {
		latestChoose.current = onChoose;
	});
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
					onOpen?.();
				}
			}}
		>
			<Popover.Trigger asChild>
				<TooltipButton
					type="button"
					disabled={disabled}
					aria-label={label}
					tooltip={components ? "Components" : "Insert a symbol"}
					aria-pressed={active}
					className={`${viewControlButtonClassName} aria-pressed:border-[#b88f61] aria-pressed:text-[#e8b77e]`}
				>
					<Shapes size={18} aria-hidden="true" />
				</TooltipButton>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					onCloseAutoFocus={(event) => {
						if (chosenComponent.current) {
							event.preventDefault();
							chosenComponent.current = false;
						}
					}}
					side="top"
					sideOffset={8}
					collisionPadding={12}
					aria-label={components ? "Component library" : "Symbol library"}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						searchInput.current?.focus();
					}}
					onKeyDown={(event) => {
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
							if (
								event.key === "Enter" &&
								!event.nativeEvent.isComposing &&
								highlighted
							) {
								event.preventDefault();
								choose(highlighted);
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
					className="z-50 flex w-72 max-w-[calc(100vw-2rem)] max-h-[min(22rem,calc(100dvh-6rem))] flex-col overflow-hidden rounded-lg border border-[#414955] bg-[#191c22] text-[#e8edf5] shadow-[0_8px_32px_#0008]"
				>
					<input
						ref={searchInput}
						type="search"
						aria-label={searchLabel}
						placeholder={searchLabel}
						autoComplete="off"
						aria-controls={listId}
						aria-activedescendant={
							highlighted ? optionIds.get(highlighted.id) : undefined
						}
						value={query}
						onChange={(event) => {
							setQuery(event.currentTarget.value);
							setActiveId(undefined);
						}}
						className="m-2 block shrink-0 rounded-md border border-[#414955] bg-[#191c22] px-2.5 py-1.5 text-[13px] text-[#e8edf5] placeholder:text-[#9ba7b8] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
					/>
					<div
						id={listId}
						data-symbol-picker=""
						className="min-h-0 flex-1 overflow-auto px-2 pb-2"
					>
						{library.error && (
							<p
								role="alert"
								className="mb-2 whitespace-pre-wrap text-xs text-[#f0aaa5]"
							>
								{library.error}
							</p>
						)}
						{groups.length === 0 && (
							<output
								aria-live="polite"
								className="block text-xs text-[#9ba7b8]"
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
							{groups.map(({ category, symbols }) => (
								<section
									key={category}
									aria-label={
										components && category === "Custom symbols"
											? "Custom components"
											: category
									}
								>
									<h3 className="sticky top-0 z-10 -mx-2 mt-0 mb-0.5 border-t border-b border-[#414955] bg-[#191c22] px-2 py-1 text-[11px] font-semibold text-[#9ba7b8]">
										{components && category === "Custom symbols"
											? "Custom components"
											: category}
									</h3>
									<div className="flex flex-col">
										{symbols.map((definition) => (
											<SymbolOption
												key={definition.id}
												definition={definition}
												optionId={optionIds.get(definition.id)}
												highlighted={definition === highlighted}
												components={components}
												onChoose={choose}
												onHighlight={setActiveId}
											/>
										))}
									</div>
								</section>
							))}
						</div>
					</div>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
