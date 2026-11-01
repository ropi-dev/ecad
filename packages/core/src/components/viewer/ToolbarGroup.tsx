import { ChevronUp, type LucideIcon } from "lucide-react";
import { Tooltip } from "radix-ui";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { useButtonShortcuts } from "#/components/viewer/useButtonShortcuts.ts";
import { viewControlButtonClassName } from "./viewControlStyles";

const GroupContext = createContext<{
	openId: string | null;
	setOpenId: (id: string | null) => void;
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
	return (
		<Tooltip.Provider delayDuration={350} skipDelayDuration={150}>
			<GroupContext value={{ openId, setOpenId, panelHost }}>
				{children}
			</GroupContext>
		</Tooltip.Provider>
	);
}

export function ToolbarGroup({
	label,
	icon: Icon,
	active = false,
	disabled = false,
	children,
}: {
	label: string;
	icon: LucideIcon;
	active?: boolean;
	disabled?: boolean;
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

	useEffect(() => {
		if (!open) return;
		panel.current
			?.querySelector<HTMLButtonElement>("button:not(:disabled)")
			?.focus();
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
			trigger.current?.focus();
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
				data-active={active || open}
				disabled={disabled}
				tooltip={label}
				className={`${viewControlButtonClassName} relative data-[active=true]:border-[#b88f61] data-[active=true]:bg-[#e8b77e12] data-[active=true]:text-[#e8b77e]`}
				onClick={() => setOpenId(open ? null : id)}
				onKeyDown={(event) => {
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
					event.preventDefault();
					if (open)
						panel.current
							?.querySelector<HTMLButtonElement>("button:not(:disabled)")
							?.focus();
					else setOpenId(id);
				}}
			>
				<Icon size={18} aria-hidden="true" />
				<ChevronUp
					size={9}
					aria-hidden="true"
					className="absolute right-0.5 bottom-0.5"
				/>
			</TooltipButton>
			{open &&
				panelHost &&
				createPortal(
					<div
						ref={panel}
						id={id}
						role="toolbar"
						aria-label={`${label} toolbar`}
						className="absolute bottom-[calc(100%+0.5rem)] left-1/2 z-20 flex w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border border-[#414955] bg-slate-900/95 p-1.5 shadow-lg"
						onKeyDown={(event) => {
							if (
								!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
							)
								return;
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
							const next =
								event.key === "Home"
									? 0
									: event.key === "End"
										? buttons.length - 1
										: (index +
												(event.key === "ArrowRight" ? 1 : -1) +
												buttons.length) %
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
