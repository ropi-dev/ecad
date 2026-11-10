import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { Tooltip } from "radix-ui";
import {
	type ComponentProps,
	createContext,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
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
	openId: string | null;
	setOpenId: Dispatch<SetStateAction<string | null>>;
	panelHost: HTMLElement | null;
} | null>(null);

export function ToolbarGroups({
	children,
	panelHost,
}: {
	children: ReactNode;
	panelHost: HTMLElement | null;
}) {
	useButtonShortcuts();
	const [openId, setOpenId] = useState<string | null>(null);
	const groups = useMemo(
		() => ({ openId, setOpenId, panelHost }),
		[openId, panelHost],
	);
	return (
		<Tooltip.Provider delayDuration={350} skipDelayDuration={150}>
			<GroupContext value={groups}>{children}</GroupContext>
		</Tooltip.Provider>
	);
}

/** Floating toolbar at the bottom centre of a canvas. */
export function ToolbarDock({
	label,
	scrollable = true,
	children,
}: {
	label: string;
	scrollable?: boolean;
	children: ReactNode;
}) {
	const [host, setHost] = useState<HTMLDivElement | null>(null);
	const [row, setRow] = useState<HTMLDivElement | null>(null);
	// Fade the clipped edge so a narrow screen shows the row scrolls.
	useScrollEdges(scrollable ? row : null);
	return (
		<ToolbarGroups panelHost={host}>
			<div
				ref={setHost}
				role="toolbar"
				aria-label={label}
				className={`group absolute bottom-[calc(var(--chrome-gap)+env(safe-area-inset-bottom))] left-1/2 z-10 w-max max-w-[calc(100%-2*var(--chrome-right))] -translate-x-1/2 p-1 ${toolbarSurfaceClassName}`}
			>
				<div
					ref={setRow}
					className={`flex items-center gap-0.5 ${scrollable ? `touch-pan-x flex-nowrap overflow-x-auto overscroll-x-contain [scrollbar-width:thin] ${scrollFadeClassName}` : "flex-wrap justify-center"}`}
				>
					{children}
				</div>
				{scrollable && (
					<>
						<span
							aria-hidden="true"
							className="pointer-events-none absolute inset-y-0 left-0 hidden w-5 items-center justify-center text-fg group-data-[fade=both]:flex group-data-[fade=start]:flex"
						>
							<ChevronLeft size={14} strokeWidth={2.5} />
						</span>
						<span
							aria-hidden="true"
							className="pointer-events-none absolute inset-y-0 right-0 hidden w-5 items-center justify-center text-fg group-data-[fade=both]:flex group-data-[fade=end]:flex"
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
			className="mx-1.5 my-0 h-5 w-px shrink-0 self-center border-0 bg-line"
		/>
	);
}

/** Move focus to a button by code without opening its tooltip. */
export function quietFocus(button: HTMLElement | null) {
	if (!button) return;
	button.dataset.quietFocus = "true";
	button.focus({ preventScroll: true });
	delete button.dataset.quietFocus;
}

/**
 * Focus the chosen item in a panel, or its first enabled item. A quiet focus
 * leaves the item's tooltip closed.
 */
function focusChoice(panel: HTMLElement | null, quiet = false) {
	const button =
		panel?.querySelector<HTMLButtonElement>(
			'button[aria-pressed="true"]:not(:disabled)',
		) ?? panel?.querySelector<HTMLButtonElement>("button:not(:disabled)");
	if (quiet) quietFocus(button ?? null);
	else button?.focus();
}

/**
 * A toolbar button that opens a row of icon buttons above itself. The row
 * closes after a choice unless `closeOnChoose` is false, which suits repeated
 * actions such as panning.
 */
export function ToolbarGroup({
	label,
	icon: Icon,
	active = false,
	activeLabel,
	disabled = false,
	closeOnChoose = true,
	children,
}: {
	label: string;
	icon: LucideIcon;
	active?: boolean;
	/** Name of the chosen item, shown in the trigger's tooltip. */
	activeLabel?: string;
	disabled?: boolean;
	closeOnChoose?: boolean;
	children: ReactNode;
}) {
	const groups = useContext(GroupContext);
	if (!groups) throw new Error("ToolbarGroup requires ToolbarGroups.");
	const { openId, setOpenId, panelHost } = groups;
	const id = useId();
	const open = openId === id;
	const root = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	// Opened with the keyboard, the focused tool names itself in its tooltip.
	// Opened by pointer or shortcut, tooltips wait for a hover.
	const quietOpen = useRef(false);
	const [left, setLeft] = useState<number | null>(null);

	useLayoutEffect(() => {
		if (!open || !panelHost) {
			setLeft(null);
			return;
		}
		const place = () => {
			const button = trigger.current?.getBoundingClientRect();
			const box = panel.current?.getBoundingClientRect();
			if (!button || !box) return;
			const host = panelHost.getBoundingClientRect();
			const margin = 12;
			const centered = button.left + button.width / 2 - box.width / 2;
			const clamped = Math.max(
				margin,
				Math.min(centered, innerWidth - margin - box.width),
			);
			setLeft(clamped - host.left);
		};
		place();
		const row = panelHost.firstElementChild;
		row?.addEventListener("scroll", place, { passive: true });
		addEventListener("resize", place);
		return () => {
			row?.removeEventListener("scroll", place);
			removeEventListener("resize", place);
		};
	}, [open, panelHost]);

	const focusPanel = () => focusChoice(panel.current);
	const focusTrigger = () => quietFocus(trigger.current);
	const placed = left !== null;
	useEffect(() => {
		// The panel stays hidden, and so unfocusable, until it has been placed.
		if (open && placed) focusChoice(panel.current, quietOpen.current);
	}, [open, placed]);

	useEffect(() => {
		if (!open) return;
		const closeOutside = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!root.current?.contains(event.target) &&
				!panel.current?.contains(event.target)
			)
				setOpenId(null);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			setOpenId(null);
			quietFocus(trigger.current);
		};
		document.addEventListener("pointerdown", closeOutside, true);
		document.addEventListener("keydown", closeOnEscape, true);
		return () => {
			document.removeEventListener("pointerdown", closeOutside, true);
			document.removeEventListener("keydown", closeOnEscape, true);
		};
	}, [open, setOpenId]);

	return (
		<div ref={root} className="contents">
			<TooltipButton
				ref={trigger}
				type="button"
				aria-label={label}
				aria-expanded={open}
				aria-controls={id}
				data-active={active}
				disabled={disabled}
				tooltip={activeLabel ? `${label}: ${activeLabel}` : label}
				className={viewControlButtonClassName}
				onClick={(event) => {
					// A key press on the button is a trusted click with no detail.
					quietOpen.current = event.detail > 0 || !event.isTrusted;
					setOpenId(open ? null : id);
				}}
				onKeyDown={(event) => {
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
					event.preventDefault();
					quietOpen.current = false;
					if (open) focusPanel();
					else setOpenId(id);
				}}
			>
				<Icon size={18} aria-hidden="true" />
				{/* Corner mark: this button opens a panel of tools. */}
				<span
					aria-hidden="true"
					className="absolute right-1 bottom-1 size-[5px] bg-current opacity-55 [clip-path:polygon(100%_0,100%_100%,0_100%)]"
				/>
			</TooltipButton>
			{open &&
				panelHost &&
				createPortal(
					<div
						ref={panel}
						onBlur={(event) => {
							const outside = (node: Node | null) =>
								!!node &&
								!panel.current?.contains(node) &&
								!root.current?.contains(node);
							const next = event.relatedTarget;
							if (next instanceof Node) {
								if (outside(next)) setOpenId(null);
								return;
							}
							setTimeout(() => {
								if (outside(document.activeElement))
									setOpenId((current) => (current === id ? null : current));
							});
						}}
						tabIndex={-1}
						id={id}
						role="toolbar"
						aria-label={`${label} toolbar`}
						aria-orientation="horizontal"
						style={{
							left: left ?? 0,
							visibility: left === null ? "hidden" : undefined,
						}}
						className={`absolute bottom-[calc(100%+0.5rem)] z-20 flex w-max max-w-[calc(100vw-1.5rem)] items-center gap-0.5 overflow-x-auto overscroll-contain p-1 outline-none [scrollbar-width:thin] ${toolbarPopoverClassName}`}
						onClick={(event) => {
							if (
								!closeOnChoose ||
								!(event.target instanceof Element) ||
								!event.target.closest("button:not(:disabled)")
							)
								return;
							setOpenId(null);
							// Keep focus inside the editor so its shortcuts keep working.
							focusTrigger();
						}}
						onKeyDown={(event) => {
							const keys = [
								"ArrowLeft",
								"ArrowRight",
								"ArrowUp",
								"ArrowDown",
								"Home",
								"End",
							];
							if (!keys.includes(event.key)) return;
							const buttons = [
								...(panel.current?.querySelectorAll<HTMLButtonElement>(
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
						{children}
					</div>,
					panelHost,
				)}
		</div>
	);
}

/** Icon button in a toolbar group panel. Its name shows in its tooltip. */
export function ToolbarGroupButton({
	icon: Icon,
	label,
	shortcut,
	...props
}: Omit<ComponentProps<typeof TooltipButton>, "children" | "tooltip"> & {
	icon: LucideIcon;
	label: string;
}) {
	return (
		<TooltipButton
			type="button"
			aria-label={label}
			aria-keyshortcuts={shortcut}
			tooltip={label}
			shortcut={shortcut}
			className={viewControlButtonClassName}
			{...props}
		>
			<Icon size={18} aria-hidden="true" />
		</TooltipButton>
	);
}
