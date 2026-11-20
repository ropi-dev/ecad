import { createSignal, createUniqueId, Show } from "solid-js";
import { AppDialog, dialogBodyClassName } from "#/components/ui/Dialog.tsx";

export function CreateFileDialog(props: {
	kind: "symbol" | "footprint" | "circuit";
	onClose: () => void;
	onCreate: (name: string) => Promise<string | undefined>;
	description?: string;
}) {
	const inputId = createUniqueId();
	const formId = createUniqueId();
	const [name, setName] = createSignal("");
	const [error, setError] = createSignal("");
	const [saving, setSaving] = createSignal(false);
	return (
		<AppDialog
			open
			onOpenChange={(open) => {
				if (!open && !saving()) props.onClose();
			}}
			size="sm"
			title={`Create ${props.kind}`}
			description={
				props.description ??
				(props.kind === "symbol"
					? "Name this symbol to add it to your Symbols list."
					: `Name this ${props.kind} to add it to your project.`)
			}
			footer={
				<>
					<button
						type="button"
						disabled={saving()}
						class="ui-button"
						data-variant="ghost"
						data-size="md"
						onClick={() => props.onClose()}
					>
						Cancel
					</button>
					<button
						type="submit"
						form={formId}
						disabled={!name().trim() || saving()}
						class="ui-button"
						data-variant="primary"
						data-size="md"
					>
						{saving() ? "Creating..." : `Create ${props.kind}`}
					</button>
				</>
			}
		>
			<form
				id={formId}
				class={dialogBodyClassName}
				onSubmit={async (event) => {
					event.preventDefault();
					const trimmed = name().trim();
					if (!trimmed || saving()) return;
					setSaving(true);
					try {
						setError((await props.onCreate(trimmed)) ?? "");
					} finally {
						setSaving(false);
					}
				}}
			>
				<label for={inputId} class="block text-xs font-medium text-fg-muted">
					{props.kind[0].toUpperCase() + props.kind.slice(1)} name
				</label>
				<input
					id={inputId}
					value={name()}
					onInput={(event) => setName(event.currentTarget.value)}
					maxlength={100}
					required
					disabled={saving()}
					autocomplete="off"
					class="ui-input mt-1.5 h-8 w-full text-sm"
				/>
				<Show when={error()}>
					<p role="alert" class="m-0 mt-3 text-sm text-danger">
						{error()}
					</p>
				</Show>
			</form>
		</AppDialog>
	);
}
