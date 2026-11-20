import type { JSX } from "@solidjs/web";
import { createSignal, omit, Show } from "solid-js";
import { Tooltip } from "#/components/ui/primitives.tsx";
import { formatShortcut } from "#/components/viewer/shortcutModifier.ts";

const tooltipClassName =
	"z-60 max-w-[min(18rem,calc(100vw-1.5rem))] animate-fade-in rounded-md border border-line bg-raised px-2 py-1.5 text-xs font-medium text-fg shadow-pop motion-reduce:animate-none";

type TooltipSide = "top" | "right" | "bottom" | "left";

export function TooltipTrigger(props: {
	tooltip: JSX.Element;
	shortcut?: string;
	side?: TooltipSide;
	children: JSX.Element;
}) {
	const [open, setOpen] = createSignal(false);
	return (
		<Tooltip.Root
			open={open()}
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
			<Tooltip.Trigger>{props.children}</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					data-slot="toolbar-tooltip"
					side={props.side ?? "top"}
					sideOffset={8}
					collisionPadding={12}
					class={tooltipClassName}
				>
					<span class="flex items-center gap-2">
						<span>{props.tooltip}</span>
						<Show when={props.shortcut}>
							{(shortcut) => (
								<kbd class="ui-kbd">{formatShortcut(shortcut())}</kbd>
							)}
						</Show>
					</span>
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}

export function TooltipButton(
	props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
		tooltip: JSX.Element;
		shortcut?: string;
		side?: TooltipSide;
	},
) {
	const rest = omit(props, "tooltip", "shortcut", "side");
	return (
		<TooltipTrigger
			tooltip={props.tooltip}
			shortcut={props.shortcut}
			side={props.side}
		>
			<button type="button" {...rest} />
		</TooltipTrigger>
	);
}
