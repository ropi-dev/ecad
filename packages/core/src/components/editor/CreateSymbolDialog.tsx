import { Dialog } from "radix-ui";
import { useId, useState } from "react";

export function CreateSymbolDialog({
	onClose,
	onCreate,
}: {
	onClose: () => void;
	onCreate: (name: string) => Promise<string | undefined>;
}) {
	const inputId = useId();
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open && !saving) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
				<Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#414955] bg-[#191c22] p-5 text-[#e8edf5] shadow-xl">
					<Dialog.Title className="m-0 text-base font-semibold">
						Create symbol
					</Dialog.Title>
					<Dialog.Description className="mt-2 text-sm text-[#9ba7b8]">
						Name this symbol to add it to your Symbols list.
					</Dialog.Description>
					<form
						onSubmit={async (event) => {
							event.preventDefault();
							if (!name.trim() || saving) return;
							setSaving(true);
							try {
								setError((await onCreate(name.trim())) ?? "");
							} finally {
								setSaving(false);
							}
						}}
					>
						<label htmlFor={inputId} className="mt-4 block text-sm">
							Symbol name
						</label>
						<input
							id={inputId}
							value={name}
							onChange={(event) => setName(event.currentTarget.value)}
							maxLength={100}
							required
							disabled={saving}
							className="mt-2 w-full rounded border border-[#414955] bg-[#111318] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
						/>
						{error && (
							<p role="alert" className="mt-3 text-sm text-[#ffb4ab]">
								{error}
							</p>
						)}
						<div className="mt-5 flex justify-end gap-2">
							<Dialog.Close asChild>
								<button
									type="button"
									disabled={saving}
									className="cursor-pointer rounded border border-[#414955] px-3 py-2 text-sm hover:bg-white/10"
								>
									Cancel
								</button>
							</Dialog.Close>
							<button
								type="submit"
								disabled={!name.trim() || saving}
								className="cursor-pointer rounded border border-[#e8b77e60] bg-[#e8b77e15] px-3 py-2 text-sm text-[#e8b77e] hover:bg-[#e8b77e25] disabled:cursor-default disabled:opacity-50"
							>
								{saving ? "Saving..." : "Create symbol"}
							</button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
