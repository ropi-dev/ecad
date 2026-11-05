import type { History } from "@ecad/drawing-core/drawing/history.ts";
import { History as HistoryIcon, Redo2, Undo2, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { quietFocus } from "#/components/viewer/ToolbarGroup.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { viewControlButtonClassName } from "#/components/viewer/ViewControls3D.tsx";

export function HistoryControls({
	history,
	disabled = false,
	onUndo,
	onRedo,
	onRestore,
}: {
	history: History<unknown>;
	disabled?: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onRestore: (id: number) => void;
}) {
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const toggle = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLElement>(null);
	const current = history.nodes[history.currentId];
	const roots = Object.values(history.nodes).filter(
		(node) => node.parentId === null,
	);
	const redoId = current.preferredChildId ?? current.childIds.at(-1);
	const redo = redoId === undefined ? undefined : history.nodes[redoId];
	useEffect(() => {
		if (!open) return;
		const closeOutside = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!panel.current?.contains(event.target) &&
				!toggle.current?.contains(event.target)
			)
				setOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
			quietFocus(toggle.current);
		};
		document.addEventListener("pointerdown", closeOutside, true);
		document.addEventListener("keydown", closeOnEscape, true);
		return () => {
			document.removeEventListener("pointerdown", closeOutside, true);
			document.removeEventListener("keydown", closeOnEscape, true);
		};
	}, [open]);
	useEffect(() => {
		if (open)
			panel.current
				?.querySelector(`[data-history-node-id="${history.currentId}"]`)
				?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [open, history.currentId]);
	const renderNode = (id: number): ReactNode => {
		const node = history.nodes[id];
		const isCurrent = id === history.currentId;
		return (
			<li key={id} className="list-none">
				<button
					type="button"
					className="my-0.5 flex min-w-48 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-[#b7c1cf] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#e8b77e] aria-[current=step]:bg-[#e8b77e1c] aria-[current=step]:text-[#e8b77e] disabled:cursor-default disabled:opacity-50"
					disabled={disabled}
					aria-label={`Restore #${id}: ${node.label}`}
					aria-current={isCurrent ? "step" : undefined}
					data-history-node-id={id}
					title={
						node.parentId === null
							? node.label
							: `${node.label}, follows #${node.parentId}`
					}
					onClick={() => onRestore(id)}
				>
					<span className="text-[10px] tabular-nums opacity-65">#{id}</span>
					<span className="whitespace-nowrap">{node.label}</span>
					{isCurrent && <span className="ml-auto text-[10px]">Current</span>}
				</button>
				{node.childIds.length > 0 && (
					<ol className="m-0 ml-3 border-l border-white/15 pl-2">
						{node.childIds.map(renderNode)}
					</ol>
				)}
			</li>
		);
	};
	return (
		<>
			<TooltipButton
				type="button"
				className={viewControlButtonClassName}
				disabled={disabled || current.parentId === null}
				aria-label="Undo"
				data-shortcut-keeps-focus
				tooltip="Undo"
				shortcut="Ctrl/Cmd + Z"
				onClick={onUndo}
			>
				<Undo2 size={17} aria-hidden="true" />
			</TooltipButton>
			<TooltipButton
				type="button"
				className={viewControlButtonClassName}
				disabled={disabled || !redo}
				aria-label="Redo"
				data-shortcut-keeps-focus
				tooltip="Redo"
				shortcut="Ctrl/Cmd + Shift + Z"
				onClick={onRedo}
			>
				<Redo2 size={17} aria-hidden="true" />
			</TooltipButton>
			<TooltipButton
				ref={toggle}
				type="button"
				className={viewControlButtonClassName}
				disabled={disabled}
				aria-label="History"
				aria-expanded={open}
				aria-controls={panelId}
				tooltip="Drawing history"
				onClick={() => setOpen((value) => !value)}
			>
				<HistoryIcon size={17} aria-hidden="true" />
			</TooltipButton>
			{open && (
				<section
					ref={panel}
					id={panelId}
					aria-label="Drawing history"
					className="absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+0.5rem)] z-20 flex max-h-[min(28rem,calc(100dvh-10rem))] w-[min(360px,calc(100vw-1.5rem))] flex-col rounded-lg border border-[#414955] bg-[#191c22] p-2 shadow-[0_8px_32px_#0008]"
				>
					<header className="flex items-center justify-between gap-3 pb-1 pl-2">
						<h2 className="m-0 text-[11px] font-semibold text-[#98a4b6]">
							Drawing history
						</h2>
						<button
							type="button"
							aria-label="Close drawing history"
							className="grid size-7 cursor-pointer place-items-center rounded text-[#98a4b6] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
							onClick={() => {
								setOpen(false);
								quietFocus(toggle.current);
							}}
						>
							<X size={16} aria-hidden="true" />
						</button>
					</header>
					<div className="min-h-0 overflow-auto overscroll-contain">
						<ol className="m-0 min-w-max list-none p-0">
							{roots.map((node) => renderNode(node.id))}
						</ol>
					</div>
				</section>
			)}
		</>
	);
}
