import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import {
	type ReactNode,
	type SyntheticEvent,
	useEffect,
	useEffectEvent,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	dialogWindowsEnabled,
	dialogWindowWidths,
	fitDialogWindow,
	focusDialogWindow,
	mirrorPageStyles,
	openDialogWindow,
} from "#/components/ui/dialog-window.ts";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";

const widths = {
	sm: "max-w-sm",
	md: "max-w-md",
	lg: "max-w-lg",
	xl: "max-w-3xl",
} as const;

/** Title and optional description shared by every dialog. */
export function DialogHeader({
	title,
	description,
}: {
	title: ReactNode;
	description?: ReactNode;
}) {
	return (
		<header className="shrink-0 pt-4 pr-12 pb-1 pl-5">
			{title}
			{description}
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
	description?: ReactNode;
	size?: keyof typeof widths;
	/**
	 * Focus the dialog itself on opening, instead of its first control. For a
	 * dialog whose content loads after it opens.
	 */
	focusDialog?: boolean;
	children?: ReactNode;
	footer?: ReactNode;
}

/**
 * The app's one dialog: a titled card with a close button and a footer for
 * its actions. The web app shows it over a dimmed page, and the desktop app
 * in a window of its own.
 */
export function AppDialog(props: AppDialogProps) {
	return dialogWindowsEnabled() ? (
		<WindowDialog {...props} />
	) : (
		<PageDialog {...props} />
	);
}

function PageDialog({
	open,
	onOpenChange,
	title,
	description,
	size = "md",
	focusDialog = false,
	children,
	footer,
}: AppDialogProps) {
	const content = useRef<HTMLDivElement>(null);
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="ui-scrim" />
				<Dialog.Content
					ref={content}
					aria-describedby={description ? undefined : ""}
					className={`ui-dialog fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none ${widths[size]}`}
					onOpenAutoFocus={(event) => {
						if (!focusDialog) return;
						event.preventDefault();
						content.current?.focus();
					}}
				>
					<DialogHeader
						title={
							<Dialog.Title className={dialogTitleClassName}>
								{title}
							</Dialog.Title>
						}
						description={
							description && (
								<Dialog.Description className={dialogDescriptionClassName}>
									{description}
								</Dialog.Description>
							)
						}
					/>
					{children}
					{footer && (
						<footer className={dialogFooterClassName}>{footer}</footer>
					)}
					<Dialog.Close
						aria-label="Close dialog"
						className={dialogCloseClassName}
					>
						<X size={16} aria-hidden="true" />
					</Dialog.Close>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function WindowDialog(props: AppDialogProps) {
	const { open, title, size = "md" } = props;
	const [popup, setPopup] = useState<Window | null>(null);
	const [failed, setFailed] = useState(false);
	const close = useEffectEvent(() => props.onOpenChange(false));
	useEffect(() => {
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
	}, [open, failed, size]);
	useEffect(() => {
		if (popup) popup.document.title = title;
	}, [popup, title]);
	if (failed) return <PageDialog {...props} />;
	if (!popup) return null;
	return createPortal(
		<div className="contents" {...isolated}>
			<WindowCard {...props} popup={popup} />
		</div>,
		popup.document.body,
	);
}

const stop = (event: SyntheticEvent) => event.stopPropagation();

const isolated = Object.fromEntries(
	[
		"onBlur",
		"onChange",
		"onClick",
		"onContextMenu",
		"onCopy",
		"onCut",
		"onDoubleClick",
		"onDragEnd",
		"onDragEnter",
		"onDragLeave",
		"onDragOver",
		"onDragStart",
		"onDrop",
		"onFocus",
		"onInput",
		"onKeyDown",
		"onKeyUp",
		"onMouseDown",
		"onMouseUp",
		"onPaste",
		"onPointerDown",
		"onPointerMove",
		"onPointerUp",
		"onSubmit",
		"onTouchEnd",
		"onTouchMove",
		"onTouchStart",
		"onWheel",
	].map((name) => [name, stop]),
);

function WindowCard({
	popup,
	onOpenChange,
	title,
	description,
	size = "md",
	focusDialog = false,
	children,
	footer,
}: AppDialogProps & { popup: Window }) {
	const card = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const descriptionId = useId();
	const width = dialogWindowWidths[size];
	useLayoutEffect(() => {
		if (card.current) return fitDialogWindow(popup, card.current, width);
	}, [popup, width]);
	useLayoutEffect(() => {
		if (card.current) focusDialogWindow(popup, card.current, focusDialog);
	}, [popup, focusDialog]);
	return (
		<div
			ref={card}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={description ? descriptionId : undefined}
			tabIndex={-1}
			className="ui-dialog relative outline-none"
			style={{ width }}
			onKeyDown={(event) => {
				if (event.key !== "Escape" || event.defaultPrevented) return;
				event.preventDefault();
				onOpenChange(false);
			}}
		>
			<DialogHeader
				title={
					<h2 id={titleId} className={dialogTitleClassName}>
						{title}
					</h2>
				}
				description={
					description && (
						<p id={descriptionId} className={dialogDescriptionClassName}>
							{description}
						</p>
					)
				}
			/>
			{children}
			{footer && <footer className={dialogFooterClassName}>{footer}</footer>}
			<button
				type="button"
				aria-label="Close dialog"
				className={dialogCloseClassName}
				onClick={() => onOpenChange(false)}
			>
				<X size={16} aria-hidden="true" />
			</button>
		</div>
	);
}
