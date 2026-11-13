import { Tooltip } from "radix-ui";
import {
	type ComponentProps,
	type ReactElement,
	type ReactNode,
	useState,
} from "react";
import { formatShortcut } from "#/components/viewer/shortcutModifier.ts";

const tooltipClassName =
	"z-60 max-w-[min(18rem,calc(100vw-1.5rem))] animate-fade-in rounded-md border border-line bg-raised px-2 py-1.5 text-xs font-medium text-fg shadow-pop motion-reduce:animate-none";

type TooltipSide = "top" | "right" | "bottom" | "left";

export function TooltipTrigger({
	tooltip,
	shortcut,
	side = "top",
	children,
}: {
	tooltip: ReactNode;
	shortcut?: string;
	side?: TooltipSide;
	children: ReactElement;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Tooltip.Root
			open={open}
			onOpenChange={(next) => {
				// Focus moved back here by code, not by the user: skip the tooltip.
				if (
					next &&
					document.activeElement instanceof HTMLElement &&
					document.activeElement.dataset.quietFocus === "true"
				)
					return;
				setOpen(next);
			}}
		>
			<Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					data-slot="toolbar-tooltip"
					side={side}
					sideOffset={8}
					collisionPadding={12}
					className={tooltipClassName}
				>
					<span className="flex items-center gap-2">
						<span>{tooltip}</span>
						{shortcut && (
							<kbd className="ui-kbd">{formatShortcut(shortcut)}</kbd>
						)}
					</span>
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}

export function TooltipButton({
	tooltip,
	shortcut,
	side,
	...props
}: Omit<ComponentProps<"button">, "title"> & {
	tooltip: ReactNode;
	shortcut?: string;
	side?: TooltipSide;
}) {
	return (
		<TooltipTrigger tooltip={tooltip} shortcut={shortcut} side={side}>
			<button type="button" {...props} />
		</TooltipTrigger>
	);
}
