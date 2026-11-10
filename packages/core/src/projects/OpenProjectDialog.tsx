import { AppDialog, dialogBodyClassName } from "#/components/ui/Dialog.tsx";

export function OpenProjectDialog({
	open,
	busy,
	error,
	onCancel,
	onSave,
	onDiscard,
}: {
	open: boolean;
	busy: boolean;
	error: string;
	onCancel(): void;
	onSave(): void;
	onDiscard(): void;
}) {
	return (
		<AppDialog
			open={open}
			onOpenChange={(value) => {
				if (!value && !busy) onCancel();
			}}
			title="Save this project first?"
			description="This untitled project is stored in memory. Save it before opening another project, or discard it."
			footer={
				<>
					<button
						type="button"
						className="ui-button"
						data-variant="ghost"
						data-size="md"
						disabled={busy}
						onClick={onCancel}
					>
						Cancel
					</button>
					<button
						type="button"
						className="ui-button"
						data-variant="secondary"
						data-size="md"
						disabled={busy}
						onClick={onDiscard}
					>
						Discard and open
					</button>
					<button
						type="button"
						className="ui-button"
						data-variant="primary"
						data-size="md"
						disabled={busy}
						onClick={onSave}
					>
						Save and open
					</button>
				</>
			}
		>
			{error ? (
				<div className={dialogBodyClassName}>
					<p role="alert" className="m-0 text-sm text-danger">
						{error}
					</p>
				</div>
			) : (
				<div className="h-3" />
			)}
		</AppDialog>
	);
}
