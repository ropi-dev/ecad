import { Dynamic, type JSX, Portal } from "@solidjs/web";
import {
	type Accessor,
	createContext,
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	omit,
	onSettled,
	Show,
	useContext,
} from "solid-js";
import {
	ChevronLeft,
	ChevronRight,
	type LucideIcon,
} from "#/components/ui/icons.tsx";
import { TooltipProvider } from "#/components/ui/primitives.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { useButtonShortcuts } from "#/components/viewer/useButtonShortcuts.ts";
import {
	scrollFadeClassName,
	useScrollEdges,
} from "#/components/viewer/useScrollEdges.ts";
import {
	toolbarPopoverClassName,
	toolbarSurfaceClassName,
	viewControlButtonClassName,
} from "#/components/viewer/viewControlStyles.ts";

const GroupContext = createContext<{
	openId: Accessor<string | null>;
	setOpenId: (
		next: string | null | ((current: string | null) => string | null),
	) => void;
	panelHost: Accessor<HTMLElement | null>;
} | null>(null);

export function ToolbarGroups(props: {
	children: JSX.Element;
	panelHost: HTMLElement | null;
}) {
	useButtonShortcuts();
	const [openId, setOpenId] = createSignal<string | null>(null);
	const groups = {
		openId,
		setOpenId,
		panelHost: () => props.panelHost,
	};
	return (
		<TooltipProvider delayDuration={350} skipDelayDuration={150}>
			<GroupContext value={groups}>{props.children}</GroupContext>
		</TooltipProvider>
	);
}

/** Floating toolbar at the bottom centre of a canvas. */
export function ToolbarDock(props: {
	label: string;
	scrollable?: boolean;
	children: JSX.Element;
}) {
	const scrollable = () => props.scrollable ?? true;
	const [host, setHost] = createSignal<HTMLDivElement | null>(null);
	const [row, setRow] = createSignal<HTMLDivElement | null>(null);
	let hostElement!: HTMLDivElement;
	let rowElement!: HTMLDivElement;
	onSettled(() => {
		setHost(hostElement);
		setRow(rowElement);
	});
	// Fade the clipped edge so a narrow screen shows the row scrolls.
	useScrollEdges(() => (scrollable() ? row() : null));
	return (
		<ToolbarGroups panelHost={host()}>
			<div
				ref={hostElement}
				role="toolbar"
				aria-label={props.label}
				class={`group absolute bottom-[calc(var(--chrome-bottom)+env(safe-area-inset-bottom))] left-1/2 z-10 w-max max-w-[calc(100%-2*var(--chrome-right))] -translate-x-1/2 p-1 ${toolbarSurfaceClassName}`}
			>
				<div
					ref={rowElement}
					class={[
						"flex items-center gap-0.5",
						scrollable()
							? `touch-pan-x flex-nowrap overflow-x-auto overscroll-x-contain [scrollbar-width:thin] ${scrollFadeClassName}`
							: "flex-wrap justify-center",
					]}
				>
					{props.children}
				</div>
				{scrollable() && (
					<>
						<span
							aria-hidden="true"
							class="pointer-events-none absolute inset-y-0 left-0 hidden w-5 items-center justify-center text-fg group-data-[fade=both]:flex group-data-[fade=start]:flex"
						>
							<ChevronLeft size={14} strokeWidth={2.5} />
						</span>
						<span
							aria-hidden="true"
							class="pointer-events-none absolute inset-y-0 right-0 hidden w-5 items-center justify-center text-fg group-data-[fade=both]:flex group-data-[fade=end]:flex"
						>
							<ChevronRight size={14} strokeWidth={2.5} />
						</span>
					</>
				)}
			</div>
		</ToolbarGroups>
	);
}

export function ToolbarSeparator() {
	return (
		<hr
			aria-orientation="vertical"
			class="mx-1.5 my-0 h-5 w-px shrink-0 self-center border-0 bg-line"
		/>
	);
}

/** Move focus to a button by code without opening its tooltip. */
export function quietFocus(button: HTMLElement | null | undefined) {
	if (!button) return;
	button.dataset.quietFocus = "true";
	button.focus({ preventScroll: true });
	delete button.dataset.quietFocus;
}

/**
 * Focus the chosen item in a panel, or its first enabled item. A quiet focus
 * leaves the item's tooltip closed.
 */
function focusChoice(panel: HTMLElement | undefined, quiet = false) {
	const button =
		panel?.querySelector<HTMLButtonElement>(
			'button[aria-pressed="true"]:not(:disabled)',
		) ?? panel?.querySelector<HTMLButtonElement>("button:not(:disabled)");
	if (quiet) quietFocus(button);
	else button?.focus();
}

const panelKeys = [
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"ArrowDown",
	"Home",
	"End",
];

/**
 * A toolbar button that opens a row of icon buttons above itself. The row
 * closes after a choice unless `closeOnChoose` is false, which suits repeated
 * actions such as panning.
 */
export function ToolbarGroup(props: {
	label: string;
	icon: LucideIcon;
	active?: boolean;
	/** Name of the chosen item, shown in the trigger's tooltip. */
	activeLabel?: string;
	disabled?: boolean;
	closeOnChoose?: boolean;
	children: JSX.Element;
}) {
	const groups = useContext(GroupContext);
	if (!groups) throw new Error("ToolbarGroup requires ToolbarGroups.");
	const id = createUniqueId();
	const open = () => groups.openId() === id;
	let root!: HTMLDivElement;
	let trigger: HTMLButtonElement | undefined;
	let panel: HTMLDivElement | undefined;
	// Opened with the keyboard, the focused tool names itself in its tooltip.
	// Opened by pointer or shortcut, tooltips wait for a hover.
	let quietOpen = false;
	const shownHost = createMemo(() => (open() ? groups.panelHost() : null));
	const [left, setLeft] = createSignal<number | null>(() => {
		shownHost();
		return null;
	});
	const [maxWidth, setMaxWidth] = createSignal<number | null>(null);

	createEffect(shownHost, () => {
		const host = panel?.parentElement;
		if (!host) return;
		const place = () => {
			const button = trigger?.getBoundingClientRect();
			const box = panel?.getBoundingClientRect();
			if (!button || !box) return;
			const bounds = host.getBoundingClientRect();
			const splitPane = host.closest<HTMLElement>(
				'[data-editor-pane][data-split="true"]',
			);
			const paneBounds = splitPane?.getBoundingClientRect();
			const areaLeft = paneBounds ? paneBounds.left : 0;
			const areaRight = paneBounds ? paneBounds.right : innerWidth;
			setMaxWidth(paneBounds ? Math.max(120, paneBounds.width - 24) : null);
			const margin = 12;
			const minLeft = areaLeft + margin;
			const maxLeft = Math.max(minLeft, areaRight - margin - box.width);
			const centered = button.left + button.width / 2 - box.width / 2;
			const clamped = Math.max(minLeft, Math.min(centered, maxLeft));
			setLeft(clamped - bounds.left);
		};
		place();
		const row = host.firstElementChild;
		row?.addEventListener("scroll", place, { passive: true });
		addEventListener("resize", place);
		return () => {
			row?.removeEventListener("scroll", place);
			removeEventListener("resize", place);
		};
	});

	const focusTrigger = () => quietFocus(trigger);
	const placed = createMemo(() => open() && left() !== null);
	createEffect(placed, (placed) => {
		// The panel stays hidden, and so unfocusable, until it has been placed.
		if (placed) focusChoice(panel, quietOpen);
	});

	createEffect(open, (isOpen) => {
		if (!isOpen) return;
		const closeOutside = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!root.contains(event.target) &&
				!panel?.contains(event.target)
			)
				groups.setOpenId(null);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			groups.setOpenId(null);
			quietFocus(trigger);
		};
		document.addEventListener("pointerdown", closeOutside, true);
		document.addEventListener("keydown", closeOnEscape, true);
		return () => {
			document.removeEventListener("pointerdown", closeOutside, true);
			document.removeEventListener("keydown", closeOnEscape, true);
		};
	});

	return (
		<div ref={root} class="contents">
			<TooltipButton
				ref={(button: HTMLButtonElement) => (trigger = button)}
				type="button"
				aria-label={props.label}
				aria-expanded={open() ? "true" : "false"}
				aria-controls={id}
				data-active={props.active ? "true" : "false"}
				disabled={props.disabled ?? false}
				tooltip={
					props.activeLabel
						? `${props.label}: ${props.activeLabel}`
						: props.label
				}
				class={viewControlButtonClassName}
				onClick={(event) => {
					// A key press on the button is a trusted click with no detail.
					quietOpen = event.detail > 0 || !event.isTrusted;
					groups.setOpenId(open() ? null : id);
				}}
				onKeyDown={(event) => {
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
					event.preventDefault();
					quietOpen = false;
					if (open()) focusChoice(panel);
					else groups.setOpenId(id);
				}}
			>
				<Dynamic component={props.icon} size={18} aria-hidden="true" />
				{/* Corner mark: this button opens a panel of tools. */}
				<span
					aria-hidden="true"
					class="absolute right-1 bottom-1 size-[5px] bg-current opacity-55 [clip-path:polygon(100%_0,100%_100%,0_100%)]"
				/>
			</TooltipButton>
			<Show when={shownHost()}>
				{(host) => (
					<Portal mount={host()}>
						<div
							ref={(element) => (panel = element)}
							onFocusOut={(event) => {
								const outside = (node: Node | null) =>
									!!node && !panel?.contains(node) && !root.contains(node);
								const next = event.relatedTarget;
								if (next instanceof Node) {
									if (outside(next)) groups.setOpenId(null);
									return;
								}
								setTimeout(() => {
									if (outside(document.activeElement))
										groups.setOpenId((current) =>
											current === id ? null : current,
										);
								});
							}}
							tabindex="-1"
							id={id}
							role="toolbar"
							aria-label={`${props.label} toolbar`}
							aria-orientation="horizontal"
							style={{
								left: `${left() ?? 0}px`,
								visibility: left() === null ? "hidden" : undefined,
								...(maxWidth() !== null
									? { "max-width": `${maxWidth()}px` }
									: {}),
							}}
							class={`absolute bottom-[calc(100%+0.5rem)] z-20 flex w-max max-w-[calc(100vw-1.5rem)] items-center gap-0.5 overflow-x-auto overscroll-contain p-1 outline-none [scrollbar-width:thin] ${toolbarPopoverClassName}`}
							onClick={(event) => {
								if (
									props.closeOnChoose === false ||
									!(event.target instanceof Element) ||
									!event.target.closest("button:not(:disabled)")
								)
									return;
								groups.setOpenId(null);
								// Keep focus inside the editor so its shortcuts keep working.
								focusTrigger();
							}}
							onKeyDown={(event) => {
								if (!panelKeys.includes(event.key)) return;
								const buttons = [
									...(panel?.querySelectorAll<HTMLButtonElement>(
										"button:not(:disabled)",
									) ?? []),
								];
								const index = buttons.indexOf(
									document.activeElement as HTMLButtonElement,
								);
								if (index < 0) return;
								event.preventDefault();
								const forward =
									event.key === "ArrowRight" || event.key === "ArrowDown";
								const next =
									event.key === "Home"
										? 0
										: event.key === "End"
											? buttons.length - 1
											: (index + (forward ? 1 : -1) + buttons.length) %
												buttons.length;
								buttons[next]?.focus();
							}}
						>
							{props.children}
						</div>
					</Portal>
				)}
			</Show>
		</div>
	);
}

/** Icon button in a toolbar group panel. Its name shows in its tooltip. */
export function ToolbarGroupButton(
	props: Omit<Parameters<typeof TooltipButton>[0], "children" | "tooltip"> & {
		icon: LucideIcon;
		label: string;
	},
) {
	const rest = omit(props, "icon", "label", "shortcut");
	return (
		<TooltipButton
			type="button"
			aria-label={props.label}
			aria-keyshortcuts={props.shortcut}
			tooltip={props.label}
			shortcut={props.shortcut}
			class={viewControlButtonClassName}
			{...rest}
		>
			<Dynamic component={props.icon} size={18} aria-hidden="true" />
		</TooltipButton>
	);
}
