import { Dialog } from "radix-ui";

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
	const button =
		"rounded border border-slate-700 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50";
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(value) => {
				if (!value && !busy) onCancel();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
				<Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-700 bg-slate-900 p-5 text-slate-200 shadow-xl">
					<Dialog.Title className="text-base">
						Save this project first?
					</Dialog.Title>
					<Dialog.Description className="my-4 text-sm leading-6 text-slate-400">
						This untitled project is stored in memory. Save it before opening
						another project, or discard it.
					</Dialog.Description>
					{error && (
						<p role="alert" className="mb-4 text-sm text-amber-300">
							{error}
						</p>
					)}
					<div className="flex flex-wrap justify-end gap-2">
						<button
							type="button"
							className={button}
							disabled={busy}
							onClick={onCancel}
						>
							Cancel
						</button>
						<button
							type="button"
							className={button}
							disabled={busy}
							onClick={onDiscard}
						>
							Discard and open
						</button>
						<button
							type="button"
							className={button}
							disabled={busy}
							onClick={onSave}
						>
							Save and open
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
