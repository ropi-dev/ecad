import {
	type DrawingPage,
	nextPageId,
	nextPageName,
	PAGE_NAME_LIMIT,
} from "@ecad/drawing-core/drawing/pages.ts";
import {
	createEffect,
	createSignal,
	createUniqueId,
	For,
	onSettled,
	Show,
} from "solid-js";
import {
	ChevronDown,
	ChevronUp,
	Files,
	Pencil,
	Plus,
	Trash2,
	X,
} from "#/components/ui/icons.tsx";
import { quietFocus } from "#/components/viewer/ToolbarGroup.tsx";
import {
	panelIconButtonClassName,
	toolbarSurfaceClassName,
} from "#/components/viewer/viewControlStyles.ts";

const focusClassName =
	"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";
// The open page carries the accent, which eases in and out (see `.ui-toggle`).
const tabClassName = `ui-toggle flex h-8 max-w-44 shrink-0 cursor-pointer items-center rounded-md px-2.5 text-xs font-medium disabled:cursor-default disabled:opacity-50 disabled:[--toggle-fg:var(--color-fg-muted)] ${focusClassName}`;
const iconButtonClassName = `grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg aria-expanded:bg-pressed aria-expanded:text-fg disabled:cursor-default disabled:text-fg-disabled disabled:hover:bg-transparent ${focusClassName}`;
const smallIconButtonClassName = `grid size-7 shrink-0 cursor-pointer place-items-center rounded-sm text-fg-faint hover:bg-hover hover:text-fg disabled:cursor-default disabled:text-fg-disabled disabled:hover:bg-transparent ${focusClassName}`;
const inputClassName = "ui-input h-7 min-w-0 flex-1";

export type PageEdit = (pages: DrawingPage[], label: string) => boolean;

/**
 * The schematic's pages at the top center of the editor. Tabs show every
 * page name and switch pages; the page list adds, renames, reorders and
 * deletes pages. Each change is one undoable drawing edit.
 */
export function PageBar(props: {
	pages: readonly DrawingPage[];
	current: number;
	/** Shapes on each page by ID, so the list can say what a delete removes. */
	shapeCounts: ReadonlyMap<number, number>;
	disabled?: boolean;
	/**
	 * Places itself at the top centre of the canvas. Otherwise the document
	 * bar lays it out.
	 */
	floating?: boolean | "pane";
	onSelect: (page: number) => void;
	onEdit: PageEdit;
}) {
	const [listOpen, setListOpen] = createSignal(false);
	const [renaming, setRenaming] = createSignal<number | null>(null);
	const listId = createUniqueId();
	let toggle: HTMLButtonElement | undefined;
	let panel: HTMLElement | undefined;
	let tabs!: HTMLDivElement;
	const disabled = () => props.disabled ?? false;

	createEffect(
		() => [listOpen(), renaming()] as const,
		([open, renamingId]) => {
			if (!open) return;
			const closeOutside = (event: PointerEvent) => {
				if (
					event.target instanceof Node &&
					!panel?.contains(event.target) &&
					!toggle?.contains(event.target)
				) {
					// Save a rename in progress before its input unmounts.
					if (
						document.activeElement instanceof HTMLInputElement &&
						panel?.contains(document.activeElement)
					)
						document.activeElement.blur();
					setListOpen(false);
				}
			};
			const closeOnEscape = (event: KeyboardEvent) => {
				if (event.key !== "Escape" || renamingId !== null) return;
				event.preventDefault();
				event.stopPropagation();
				setListOpen(false);
				quietFocus(toggle ?? null);
			};
			document.addEventListener("pointerdown", closeOutside, true);
			document.addEventListener("keydown", closeOnEscape, true);
			return () => {
				document.removeEventListener("pointerdown", closeOutside, true);
				document.removeEventListener("keydown", closeOnEscape, true);
			};
		},
	);

	createEffect(
		() => props.current,
		(current) => {
			tabs
				.querySelector(`[data-page-id="${current}"]`)
				?.scrollIntoView({ block: "nearest", inline: "nearest" });
		},
	);

	const addPage = () => {
		const pages = props.pages;
		const page = { id: nextPageId(pages), name: nextPageName(pages) };
		if (props.onEdit([...pages, page], `Add page ${page.name}`))
			props.onSelect(page.id);
	};
	const rename = (id: number, name: string) => {
		setRenaming(null);
		const pages = props.pages;
		const trimmed = name.trim();
		const page = pages.find((item) => item.id === id);
		if (!page || !trimmed || trimmed === page.name) return;
		props.onEdit(
			pages.map((item) => (item.id === id ? { ...item, name: trimmed } : item)),
			`Rename page ${page.name} to ${trimmed}`,
		);
	};
	const remove = (id: number) => {
		const pages = props.pages;
		const index = pages.findIndex((item) => item.id === id);
		if (index < 0 || pages.length < 2) return;
		const remaining = pages.filter((item) => item.id !== id);
		if (!props.onEdit(remaining, `Delete page ${pages[index].name}`)) return;
		if (id === props.current)
			props.onSelect(remaining[Math.min(index, remaining.length - 1)].id);
	};
	const move = (id: number, offset: -1 | 1) => {
		const pages = props.pages;
		const index = pages.findIndex((item) => item.id === id);
		const target = index + offset;
		if (index < 0 || target < 0 || target >= pages.length) return;
		const reordered = [...pages];
		[reordered[index], reordered[target]] = [
			reordered[target],
			reordered[index],
		];
		props.onEdit(reordered, `Move page ${pages[index].name}`);
	};
	const itemCount = (count: number) =>
		`${count} ${count === 1 ? "item" : "items"}`;

	return (
		<nav
			aria-label="Schematic pages"
			class={[
				"flex h-[var(--chrome-control)] items-center gap-0.5 p-1",
				props.floating === "pane"
					? "absolute top-[var(--chrome-top)] left-1/2 z-3 max-w-[calc(100%-2*var(--chrome-gap))] -translate-x-1/2"
					: props.floating
						? "absolute top-10 left-1/2 z-3 max-w-[min(40rem,calc(100%-5rem))] -translate-x-1/2 max-[600px]:top-22"
						: "relative max-w-[40rem] min-w-0",
				toolbarSurfaceClassName,
			]}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<button
				ref={(button) => {
					toggle = button;
				}}
				type="button"
				class={iconButtonClassName}
				aria-label="Page list"
				aria-expanded={listOpen() ? "true" : "false"}
				aria-controls={listOpen() ? listId : undefined}
				title="Page list"
				onClick={() => setListOpen((open) => !open)}
			>
				<Files size={16} aria-hidden="true" />
			</button>
			<div
				ref={tabs}
				class="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
			>
				<For each={props.pages} keyed={(page) => page.id}>
					{(page) => (
						<Show
							when={renaming() === page().id && !listOpen()}
							fallback={
								<button
									type="button"
									data-page-id={page().id}
									class={tabClassName}
									aria-current={
										page().id === props.current ? "page" : undefined
									}
									title={`${page().name}. Double-click to rename.`}
									disabled={disabled()}
									onClick={() => props.onSelect(page().id)}
									onDblClick={() => setRenaming(page().id)}
								>
									<span class="truncate">{page().name}</span>
								</button>
							}
						>
							<RenameInput
								name={page().name}
								class={`${inputClassName} max-w-44 flex-none`}
								onDone={(name) => rename(page().id, name)}
								onCancel={() => setRenaming(null)}
							/>
						</Show>
					)}
				</For>
			</div>
			<button
				type="button"
				class={iconButtonClassName}
				aria-label="Add page"
				title="Add page"
				disabled={disabled()}
				onClick={addPage}
			>
				<Plus size={16} aria-hidden="true" />
			</button>
			{listOpen() && (
				<section
					ref={panel}
					id={listId}
					aria-label="Pages"
					class={[
						"ui-popover absolute top-[calc(100%+0.5rem)] left-1/2 z-20 flex max-h-[min(28rem,calc(100dvh-12rem))] -translate-x-1/2 flex-col",
						props.floating === "pane"
							? "w-[min(320px,calc(100cqw-1.5rem))]"
							: "w-[min(320px,calc(100vw-1.5rem))]",
					]}
				>
					<header class="flex shrink-0 items-center justify-between gap-3 border-b border-line-subtle py-1.5 pr-1.5 pl-3">
						<h2 class="m-0 text-sm font-semibold">Pages</h2>
						<button
							type="button"
							class={panelIconButtonClassName}
							aria-label="Close page list"
							onClick={() => {
								setListOpen(false);
								quietFocus(toggle ?? null);
							}}
						>
							<X size={16} aria-hidden="true" />
						</button>
					</header>
					<ol class="m-0 min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 pb-0">
						<For each={props.pages} keyed={(page) => page.id}>
							{(page, index) => {
								const count = () => props.shapeCounts.get(page().id) ?? 0;
								return (
									<li class="flex list-none items-center gap-1 py-0.5">
										<span class="w-5 shrink-0 text-right text-2xs text-fg-faint tabular-nums">
											{index() + 1}
										</span>
										{renaming() === page().id ? (
											<RenameInput
												name={page().name}
												class={inputClassName}
												label={`Name of ${page().name}`}
												onDone={(name) => rename(page().id, name)}
												onCancel={() => setRenaming(null)}
											/>
										) : (
											<button
												type="button"
												class={`${tabClassName} h-7 min-w-0 max-w-none flex-1 justify-between gap-2`}
												aria-current={
													page().id === props.current ? "page" : undefined
												}
												aria-label={`Open ${page().name}`}
												disabled={disabled()}
												onClick={() => props.onSelect(page().id)}
												onDblClick={() => setRenaming(page().id)}
											>
												<span class="truncate">{page().name}</span>
												<span class="shrink-0 text-2xs font-normal tabular-nums opacity-70">
													{itemCount(count())}
												</span>
											</button>
										)}
										<button
											type="button"
											class={smallIconButtonClassName}
											aria-label={`Rename ${page().name}`}
											title="Rename"
											disabled={disabled()}
											onClick={() => setRenaming(page().id)}
										>
											<Pencil size={13} aria-hidden="true" />
										</button>
										<button
											type="button"
											class={smallIconButtonClassName}
											aria-label={`Move ${page().name} up`}
											title="Move up"
											disabled={disabled() || index() === 0}
											onClick={() => move(page().id, -1)}
										>
											<ChevronUp size={14} aria-hidden="true" />
										</button>
										<button
											type="button"
											class={smallIconButtonClassName}
											aria-label={`Move ${page().name} down`}
											title="Move down"
											disabled={
												disabled() || index() === props.pages.length - 1
											}
											onClick={() => move(page().id, 1)}
										>
											<ChevronDown size={14} aria-hidden="true" />
										</button>
										<button
											type="button"
											class={`${smallIconButtonClassName} hover:text-danger`}
											aria-label={`Delete ${page().name}`}
											title={
												count()
													? `Delete page and its ${itemCount(count())}. Undo restores them.`
													: "Delete page"
											}
											disabled={disabled() || props.pages.length < 2}
											onClick={() => remove(page().id)}
										>
											<Trash2 size={13} aria-hidden="true" />
										</button>
									</li>
								);
							}}
						</For>
					</ol>
					<button
						type="button"
						class={`m-1.5 flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 text-xs text-fg-muted hover:bg-hover hover:text-fg disabled:cursor-default disabled:opacity-50 ${focusClassName}`}
						disabled={disabled()}
						onClick={addPage}
					>
						<Plus size={14} aria-hidden="true" />
						Add page
					</button>
				</section>
			)}
		</nav>
	);
}

function RenameInput(props: {
	name: string;
	class: string;
	label?: string;
	onDone: (name: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = createSignal(() => props.name);
	let done = false;
	let input!: HTMLInputElement;
	onSettled(() => input.focus());
	return (
		<input
			ref={input}
			aria-label={props.label ?? "Page name"}
			class={props.class}
			value={value()}
			maxlength={PAGE_NAME_LIMIT}
			onFocus={(event) => event.currentTarget.select()}
			onInput={(event) => setValue(event.currentTarget.value)}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Enter") {
					event.preventDefault();
					done = true;
					props.onDone(event.currentTarget.value);
				} else if (event.key === "Escape") {
					event.preventDefault();
					done = true;
					props.onCancel();
				}
			}}
			onBlur={(event) => {
				if (!done) props.onDone(event.currentTarget.value);
			}}
		/>
	);
}
