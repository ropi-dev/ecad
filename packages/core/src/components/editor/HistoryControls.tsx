import type { History as DrawingHistory } from "@ecad/drawing-core/drawing/history.ts";
import type { JSX } from "@solidjs/web";
import {
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	For,
	Show,
} from "solid-js";
import { History, Redo2, Undo2, X } from "#/components/ui/icons.tsx";
import { quietFocus } from "#/components/viewer/ToolbarGroup.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import {
	panelIconButtonClassName,
	viewControlButtonClassName,
} from "#/components/viewer/viewControlStyles.ts";

export function HistoryControls(props: {
	history: DrawingHistory<unknown>;
	disabled?: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onRestore: (id: number) => void;
}) {
	const [open, setOpen] = createSignal(false);
	const panelId = createUniqueId();
	let toggle: HTMLButtonElement | undefined;
	let panel: HTMLElement | undefined;
	const disabled = () => props.disabled ?? false;
	const current = () => props.history.nodes[props.history.currentId];
	const roots = createMemo(() =>
		Object.values(props.history.nodes)
			.filter((node) => node.parentId === null)
			.map((node) => node.id),
	);
	const canRedo = createMemo(() => {
		const node = current();
		const redoId = node.preferredChildId ?? node.childIds.at(-1);
		return redoId !== undefined && !!props.history.nodes[redoId];
	});
	createEffect(open, (isOpen) => {
		if (!isOpen) return;
		const closeOutside = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!panel?.contains(event.target) &&
				!toggle?.contains(event.target)
			)
				setOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
			quietFocus(toggle ?? null);
		};
		document.addEventListener("pointerdown", closeOutside, true);
		document.addEventListener("keydown", closeOnEscape, true);
		return () => {
			document.removeEventListener("pointerdown", closeOutside, true);
			document.removeEventListener("keydown", closeOnEscape, true);
		};
	});
	createEffect(
		() => (open() ? props.history.currentId : undefined),
		(id) => {
			if (id !== undefined)
				panel
					?.querySelector(`[data-history-node-id="${id}"]`)
					?.scrollIntoView({ block: "nearest", inline: "nearest" });
		},
	);
	const renderNode = (id: number): JSX.Element => {
		const node = () => props.history.nodes[id];
		const isCurrent = () => id === props.history.currentId;
		return (
			<Show when={node()}>
				{(entry) => (
					<li class="list-none">
						<button
							type="button"
							class="ui-toggle my-px flex h-7 w-full min-w-48 cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40 disabled:[--toggle-fg:var(--color-fg-muted)] aria-[current=step]:font-medium pointer-coarse:h-11"
							disabled={disabled()}
							aria-label={`Restore #${id}: ${entry().label}`}
							aria-current={isCurrent() ? "step" : undefined}
							data-history-node-id={id}
							title={
								entry().parentId === null
									? entry().label
									: `${entry().label}, follows #${entry().parentId}`
							}
							onClick={() => props.onRestore(id)}
						>
							<span class="w-7 shrink-0 text-2xs tabular-nums opacity-70">
								#{id}
							</span>
							<span class="whitespace-nowrap">{entry().label}</span>
							<Show when={isCurrent()}>
								<span class="ml-auto pl-3 text-2xs">Current</span>
							</Show>
						</button>
						<Show when={entry().childIds.length > 0}>
							<ol class="m-0 ml-3.5 border-l border-line p-0 pl-1.5">
								<For each={entry().childIds}>
									{(child) => renderNode(child)}
								</For>
							</ol>
						</Show>
					</li>
				)}
			</Show>
		);
	};
	return (
		<>
			<TooltipButton
				type="button"
				class={viewControlButtonClassName}
				disabled={disabled() || current().parentId === null}
				aria-label="Undo"
				data-shortcut-keeps-focus
				tooltip="Undo"
				shortcut="Ctrl/Cmd + Z"
				onClick={() => props.onUndo()}
			>
				<Undo2 size={17} aria-hidden="true" />
			</TooltipButton>
			<TooltipButton
				type="button"
				class={viewControlButtonClassName}
				disabled={disabled() || !canRedo()}
				aria-label="Redo"
				data-shortcut-keeps-focus
				tooltip="Redo"
				shortcut="Ctrl/Cmd + Shift + Z"
				onClick={() => props.onRedo()}
			>
				<Redo2 size={17} aria-hidden="true" />
			</TooltipButton>
			<TooltipButton
				ref={(button: HTMLButtonElement) => {
					toggle = button;
				}}
				type="button"
				class={viewControlButtonClassName}
				disabled={disabled()}
				aria-label="History"
				aria-expanded={open() ? "true" : "false"}
				aria-controls={panelId}
				tooltip="Drawing history"
				onClick={() => setOpen((value) => !value)}
			>
				<History size={17} aria-hidden="true" />
			</TooltipButton>
			<Show when={open()}>
				<section
					ref={panel}
					id={panelId}
					aria-label="Drawing history"
					class="ui-popover absolute bottom-[calc(100%+0.5rem)] left-1/2 z-20 flex max-h-[min(28rem,calc(100dvh-10rem))] w-[min(360px,calc(100vw-1.5rem))] -translate-x-1/2 flex-col"
				>
					<header class="flex shrink-0 items-center justify-between gap-3 border-b border-line-subtle py-1.5 pr-1.5 pl-3">
						<h2 class="m-0 text-sm font-semibold">History</h2>
						<button
							type="button"
							aria-label="Close drawing history"
							class={panelIconButtonClassName}
							onClick={() => {
								setOpen(false);
								quietFocus(toggle ?? null);
							}}
						>
							<X size={16} aria-hidden="true" />
						</button>
					</header>
					<div class="min-h-0 overflow-auto overscroll-contain p-1.5">
						<ol class="m-0 min-w-max list-none p-0">
							<For each={roots()}>{(id) => renderNode(id)}</For>
						</ol>
						<Show when={Object.keys(props.history.nodes).length < 2}>
							<p class="m-0 px-2 pt-1 pb-1.5 text-xs text-fg-faint">
								Each edit is listed here. Choose one to go back to it.
							</p>
						</Show>
					</div>
				</section>
			</Show>
		</>
	);
}
