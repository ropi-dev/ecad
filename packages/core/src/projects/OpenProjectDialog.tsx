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
		"cursor-pointer rounded border border-[#414955] px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#e8b77e] disabled:cursor-default disabled:opacity-50";
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(value) => {
				if (!value && !busy) onCancel();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
				<Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#414955] bg-[#191c22] p-5 text-[#e8edf5] shadow-xl">
					<Dialog.Title className="m-0 text-base font-semibold">
						Save this project first?
					</Dialog.Title>
					<Dialog.Description className="my-4 text-sm leading-6 text-[#9ba7b8]">
						This untitled project is stored in memory. Save it before opening
						another project, or discard it.
					</Dialog.Description>
					{error && (
						<p role="alert" className="mb-4 text-sm text-[#ffb4ab]">
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
