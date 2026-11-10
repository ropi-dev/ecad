import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type ReactNode, useRef } from "react";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";

const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg" } as const;

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

/**
 * The app's one dialog: a titled card over a dimmed page, with a close
 * button and a footer for its actions.
 */
export function AppDialog({
	open,
	onOpenChange,
	title,
	description,
	size = "md",
	focusDialog = false,
	children,
	footer,
}: {
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
}) {
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
