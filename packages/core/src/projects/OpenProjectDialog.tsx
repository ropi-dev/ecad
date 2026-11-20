import { Show } from "solid-js";
import { AppDialog, dialogBodyClassName } from "#/components/ui/Dialog.tsx";

export function OpenProjectDialog(props: {
	open: boolean;
	busy: boolean;
	error: string;
	onCancel(): void;
	onSave(): void;
	onDiscard(): void;
}) {
	return (
		<AppDialog
			open={props.open}
			onOpenChange={(value) => {
				if (!value && !props.busy) props.onCancel();
			}}
			title="Save this project first?"
			description="This untitled project is stored in memory. Save it before opening another project, or discard it."
			footer={
				<>
					<button
						type="button"
						class="ui-button"
						data-variant="ghost"
						data-size="md"
						disabled={props.busy}
						onClick={() => props.onCancel()}
					>
						Cancel
					</button>
					<button
						type="button"
						class="ui-button"
						data-variant="secondary"
						data-size="md"
						disabled={props.busy}
						onClick={() => props.onDiscard()}
					>
						Discard and open
					</button>
					<button
						type="button"
						class="ui-button"
						data-variant="primary"
						data-size="md"
						disabled={props.busy}
						onClick={() => props.onSave()}
					>
						Save and open
					</button>
				</>
			}
		>
			<Show when={props.error} fallback={<div class="h-3" />}>
				<div class={dialogBodyClassName}>
					<p role="alert" class="m-0 text-sm text-danger">
						{props.error}
					</p>
				</div>
			</Show>
		</AppDialog>
	);
}
