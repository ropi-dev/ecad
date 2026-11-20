import { type JSX, Portal } from "@solidjs/web";
import {
	children,
	createEffect,
	createSignal,
	createUniqueId,
	onSettled,
	Show,
} from "solid-js";
import {
	dialogWindowsEnabled,
	dialogWindowWidths,
	fitDialogWindow,
	focusDialogWindow,
	mirrorPageStyles,
	openDialogWindow,
} from "#/components/ui/dialog-window.ts";
import { X } from "#/components/ui/icons.tsx";
import {
	attachLayer,
	createLayer,
	focusElement,
	hideOthers,
	LayerProvider,
	returnFocusLater,
	tabbables,
	useParentLayer,
} from "#/components/ui/primitives.tsx";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";

const widths = {
	sm: "max-w-sm",
	md: "max-w-md",
	lg: "max-w-lg",
	xl: "max-w-3xl",
} as const;

/** Title and optional description shared by every dialog. */
export function DialogHeader(props: {
	title: JSX.Element;
	description?: JSX.Element;
}) {
	return (
		<header class="shrink-0 pt-4 pr-12 pb-1 pl-5">
			{props.title}
			{props.description}
		</header>
	);
}

/**
 * Place for a dialog's close button. The button follows the dialog's content
 * in the document, so focus starts on the first field instead of on Close.
 */
export const dialogCloseClassName = `${panelIconButtonClassName} absolute top-3 right-3`;

export const dialogTitleClassName = "m-0 text-lg font-semibold text-fg";
export const dialogDescriptionClassName = "m-0 mt-1 text-sm text-fg-muted";
export const dialogBodyClassName = "min-h-0 flex-1 overflow-y-auto px-5 py-4";
export const dialogFooterClassName =
	"flex shrink-0 flex-wrap justify-end gap-2 border-t border-line-subtle px-5 py-3";

interface AppDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: JSX.Element;
	size?: keyof typeof widths;
	/**
	 * Focus the dialog itself on opening, instead of its first control. For a
	 * dialog whose content loads after it opens.
	 */
	focusDialog?: boolean;
	children?: JSX.Element;
	footer?: JSX.Element;
}

/**
 * The app's one dialog: a titled card with a close button and a footer for
 * its actions. The web app shows it over a dimmed page, and the desktop app
 * in a window of its own.
 */
export function AppDialog(props: AppDialogProps) {
	return (
		<Show when={dialogWindowsEnabled()} fallback={<PageDialog {...props} />}>
			<WindowDialog {...props} />
		</Show>
	);
}

function PageDialog(props: AppDialogProps) {
	return (
		<Show when={props.open}>
			<PageDialogCard {...props} />
		</Show>
	);
}

function DialogCard(props: {
	titleId: string;
	descriptionId: string;
	description: JSX.Element;
	dialog: AppDialogProps;
	close: () => void;
}) {
	const footer = children(() => props.dialog.footer);
	return (
		<>
			<DialogHeader
				title={
					<h2 id={props.titleId} class={dialogTitleClassName}>
						{props.dialog.title}
					</h2>
				}
				description={
					<Show when={props.description}>
						<p id={props.descriptionId} class={dialogDescriptionClassName}>
							{props.description}
						</p>
					</Show>
				}
			/>
			{props.dialog.children}
			<Show when={footer.toArray().length}>
				<footer class={dialogFooterClassName}>{footer()}</footer>
			</Show>
			<button
				type="button"
				aria-label="Close dialog"
				class={dialogCloseClassName}
				onClick={() => props.close()}
			>
				<X size={16} aria-hidden="true" />
			</button>
		</>
	);
}

function PageDialogCard(props: AppDialogProps) {
	const titleId = createUniqueId();
	const descriptionId = createUniqueId();
	const description = children(() => props.description);
	let scrim!: HTMLDivElement;
	let content!: HTMLDivElement;
	let lastFocused: HTMLElement | undefined;
	const close = () => props.onOpenChange(false);
	const layer = createLayer(useParentLayer(), {
		escape(event) {
			event.preventDefault();
			close();
		},
		pointerDownOutside(event) {
			if (event.button === 2 || (event.button === 0 && event.ctrlKey)) return;
			close();
		},
		focusOutside() {
			(lastFocused?.isConnected ? lastFocused : content).focus({
				preventScroll: true,
			});
		},
	});
	onSettled(() => {
		const opener = document.activeElement;
		const detach = attachLayer(layer, content);
		const restore = hideOthers([scrim, content]);
		if (props.focusDialog) content.focus({ preventScroll: true });
		else {
			const first = tabbables(content, false)[0];
			if (first) focusElement(first, true);
			else content.focus({ preventScroll: true });
		}
		return () => {
			detach();
			restore();
			returnFocusLater(opener);
		};
	});
	return (
		<Portal>
			<div ref={scrim} class="ui-scrim" data-state="open" />
			<div
				ref={content}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={description() ? descriptionId : undefined}
				data-state="open"
				tabindex="-1"
				class={`ui-dialog fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none ${widths[props.size ?? "md"]}`}
				onFocusIn={(event) => {
					if (content.contains(event.target))
						lastFocused = event.target as HTMLElement;
				}}
				onKeyDown={(event) => {
					if (
						event.key !== "Tab" ||
						event.altKey ||
						event.ctrlKey ||
						event.metaKey
					)
						return;
					const focusable = tabbables(content);
					const first = focusable[0];
					const last = focusable.at(-1);
					if (!first || !last) {
						event.preventDefault();
						return;
					}
					const active = document.activeElement;
					if (!event.shiftKey && active === last) {
						event.preventDefault();
						focusElement(first, true);
					} else if (
						event.shiftKey &&
						(active === first || active === content)
					) {
						event.preventDefault();
						focusElement(last, true);
					}
				}}
			>
				<LayerProvider layer={layer}>
					<DialogCard
						titleId={titleId}
						descriptionId={descriptionId}
						description={description()}
						dialog={props}
						close={close}
					/>
				</LayerProvider>
			</div>
		</Portal>
	);
}

function WindowDialog(props: AppDialogProps) {
	const [popup, setPopup] = createSignal<Window | null>(null);
	const [failed, setFailed] = createSignal(false);
	const close = () => props.onOpenChange(false);
	createEffect(
		() => ({ open: props.open, failed: failed(), size: props.size ?? "md" }),
		({ open, failed, size }) => {
			if (!open || failed) return;
			const child = openDialogWindow(dialogWindowWidths[size]);
			if (!child) {
				setFailed(true);
				return;
			}
			let closing = false;
			const stopMirroring = mirrorPageStyles(child);
			const beforeUnload = (event: BeforeUnloadEvent) => {
				if (closing) return;
				event.preventDefault();
				close();
			};
			const pageHide = () => {
				if (closing) return;
				closing = true;
				setPopup(null);
				close();
			};
			child.addEventListener("beforeunload", beforeUnload);
			child.addEventListener("pagehide", pageHide);
			setPopup(child);
			return () => {
				closing = true;
				stopMirroring();
				setPopup(null);
				child.close();
			};
		},
	);
	createEffect(
		() => ({ child: popup(), title: props.title }),
		({ child, title }) => {
			if (child) child.document.title = title;
		},
	);
	return (
		<Show when={!failed()} fallback={<PageDialog {...props} />}>
			<Show when={popup()}>
				{(child) => (
					<Portal mount={child().document.body}>
						<div class="contents" {...isolated}>
							<WindowCard {...props} popup={child()} />
						</div>
					</Portal>
				)}
			</Show>
		</Show>
	);
}

const stop = (event: Event) => event.stopPropagation();

const isolated = Object.fromEntries(
	[
		"onBeforeInput",
		"onClick",
		"onContextMenu",
		"onDblClick",
		"onFocusIn",
		"onFocusOut",
		"onInput",
		"onKeyDown",
		"onKeyUp",
		"onMouseDown",
		"onMouseMove",
		"onMouseOut",
		"onMouseOver",
		"onMouseUp",
		"onPointerDown",
		"onPointerMove",
		"onPointerOut",
		"onPointerOver",
		"onPointerUp",
		"onTouchEnd",
		"onTouchMove",
		"onTouchStart",
	].map((name) => [name, stop]),
);

function WindowCard(props: AppDialogProps & { popup: Window }) {
	let card!: HTMLDivElement;
	const titleId = createUniqueId();
	const descriptionId = createUniqueId();
	const description = children(() => props.description);
	const width = () => dialogWindowWidths[props.size ?? "md"];
	createEffect(
		() => ({ popup: props.popup, width: width() }),
		({ popup, width }) => fitDialogWindow(popup, card, width),
	);
	createEffect(
		() => ({ popup: props.popup, focusCard: props.focusDialog ?? false }),
		({ popup, focusCard }) => {
			focusDialogWindow(popup, card, focusCard);
		},
	);
	return (
		<div
			ref={card}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={description() ? descriptionId : undefined}
			tabindex="-1"
			class="ui-dialog relative outline-none"
			style={{ width: `${width()}px` }}
			onKeyDown={(event) => {
				if (event.key !== "Escape" || event.defaultPrevented) return;
				event.preventDefault();
				props.onOpenChange(false);
			}}
		>
			<DialogCard
				titleId={titleId}
				descriptionId={descriptionId}
				description={description()}
				dialog={props}
				close={() => props.onOpenChange(false)}
			/>
		</div>
	);
}
