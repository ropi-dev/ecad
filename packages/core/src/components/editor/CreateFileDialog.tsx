import { useId, useState } from "react";
import { AppDialog, dialogBodyClassName } from "#/components/ui/Dialog.tsx";

export function CreateFileDialog({
	kind,
	onClose,
	onCreate,
	description = kind === "symbol"
		? "Name this symbol to add it to your Symbols list."
		: "Name this drawing to add it to your project.",
}: {
	kind: "drawing" | "symbol" | "circuit";
	onClose: () => void;
	onCreate: (name: string) => Promise<string | undefined>;
	description?: string;
}) {
	const inputId = useId();
	const formId = useId();
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	return (
		<AppDialog
			open
			onOpenChange={(open) => {
				if (!open && !saving) onClose();
			}}
			size="sm"
			title={`Create ${kind}`}
			description={description}
			footer={
				<>
					<button
						type="button"
						disabled={saving}
						className="ui-button"
						data-variant="ghost"
						data-size="md"
						onClick={onClose}
					>
						Cancel
					</button>
					<button
						type="submit"
						form={formId}
						disabled={!name.trim() || saving}
						className="ui-button"
						data-variant="primary"
						data-size="md"
					>
						{saving ? "Creating..." : `Create ${kind}`}
					</button>
				</>
			}
		>
			<form
				id={formId}
				className={dialogBodyClassName}
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
				<label
					htmlFor={inputId}
					className="block text-xs font-medium text-fg-muted"
				>
					{kind === "drawing"
						? "Drawing"
						: kind === "circuit"
							? "Circuit"
							: "Symbol"}{" "}
					name
				</label>
				<input
					id={inputId}
					value={name}
					onChange={(event) => setName(event.currentTarget.value)}
					maxLength={100}
					required
					disabled={saving}
					autoComplete="off"
					className="ui-input mt-1.5 h-8 w-full text-sm"
				/>
				{error && (
					<p role="alert" className="m-0 mt-3 text-sm text-danger">
						{error}
					</p>
				)}
			</form>
		</AppDialog>
	);
}
