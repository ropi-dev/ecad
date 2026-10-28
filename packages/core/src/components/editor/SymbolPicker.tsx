import { symbolCategories } from "@ecad/default-symbols";
import { Shapes } from "lucide-react";
import { Popover } from "radix-ui";
import { useMemo, useRef, useState } from "react";
import { SymbolThumbnail } from "#/components/editor/SymbolThumbnail.tsx";
import type { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { viewControlButtonClassName } from "#/components/viewer/ViewControls3D.tsx";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

export function SymbolPicker({
	disabled,
	active,
	onChoose,
	library,
}: {
	disabled: boolean;
	active: boolean;
	onChoose: (definition: SymbolDefinition) => void;
	library: ReturnType<typeof useSymbolLibrary>;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const searchInput = useRef<HTMLInputElement>(null);
	const { definitions } = library;
	const groups = useMemo(() => {
		const search = query.trim().toLowerCase();
		const matches = definitions.filter((definition) =>
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
	}, [definitions, query]);
	return (
		<Popover.Root
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (nextOpen) setQuery("");
			}}
		>
			<Popover.Trigger asChild>
				<TooltipButton
					type="button"
					disabled={disabled}
					aria-label="Symbols"
					tooltip="Insert a symbol"
					aria-pressed={active}
					className={`${viewControlButtonClassName} aria-pressed:border-[#b88f61] aria-pressed:text-[#e8b77e]`}
				>
					<Shapes size={18} aria-hidden="true" />
				</TooltipButton>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					data-symbol-picker=""
					side="top"
					sideOffset={8}
					collisionPadding={12}
					aria-label="Symbol library"
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						searchInput.current?.focus();
					}}
					className="z-50 w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-6rem)] overflow-auto rounded-lg border border-[#414955] bg-[#191c22] p-3 text-[#e8edf5] shadow-[0_8px_32px_#0008]"
				>
					<h2 className="m-0 text-sm font-semibold">Symbols</h2>
					<p className="mt-1 mb-3 text-xs text-[#9ba7b8]">
						Choose a symbol, then click the drawing to place it.
					</p>
					<input
						ref={searchInput}
						type="search"
						aria-label="Search symbols"
						placeholder="Search symbols"
						autoComplete="off"
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
						className="mb-3 block w-full rounded-md border border-[#414955] bg-[#191c22] px-3 py-2 text-sm text-[#e8edf5] placeholder:text-[#9ba7b8] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
					/>
					{library.error && (
						<p
							role="alert"
							className="mb-3 whitespace-pre-wrap text-xs text-[#f0aaa5]"
						>
							{library.error}
						</p>
					)}
					{groups.length === 0 && (
						<output aria-live="polite" className="block text-xs text-[#9ba7b8]">
							{query.trim()
								? "No symbols match your search."
								: "No symbols available. Enable a library on the Projects page."}
						</output>
					)}
					<div className="space-y-3">
						{groups.map(({ category, symbols }) => (
							<section key={category} aria-label={category}>
								<h3 className="sticky top-0 z-10 m-0 mb-1 border-b border-[#414955] bg-[#191c22] py-1 text-xs font-semibold text-[#9ba7b8]">
									{category}
								</h3>
								<div className="flex flex-col gap-1">
									{symbols.map((definition) => (
										<button
											key={definition.id}
											type="button"
											aria-label={`Insert ${definition.name}`}
											disabled={definition.children.length === 0}
											title={
												definition.children.length === 0
													? "Add shapes in the symbol editor before placing this symbol."
													: undefined
											}
											className="flex cursor-pointer items-center gap-3 rounded-md p-2 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#e8b77e] disabled:cursor-default disabled:opacity-50"
											onClick={() => {
												onChoose(definition);
												setOpen(false);
											}}
										>
											<SymbolThumbnail definition={definition} />
											<span className="min-w-0">
												<span className="block break-words text-sm">
													{definition.name}
												</span>
												<span className="block break-words text-xs text-[#9ba7b8]">
													{definition.description}
												</span>
											</span>
										</button>
									))}
								</div>
							</section>
						))}
					</div>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
