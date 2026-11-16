import {
	type ModelReference,
	modelKey,
} from "@ecad/drawing-core/footprint/model.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { Box } from "lucide-react";
import { useState } from "react";
import { toastManager } from "#/components/ui/toast.ts";
import { useBuiltinModels } from "#/footprint/models.ts";

export function FootprintModelField({
	model,
	onChange,
}: {
	model: ModelReference | undefined;
	onChange: (model: ModelReference | undefined) => Promise<void>;
}) {
	const { library, failed } = useBuiltinModels();
	const [saving, setSaving] = useState(false);
	const current = model && library?.byId.get(model.id);
	const missing = model !== undefined && library !== undefined && !current;
	return (
		<label className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
			<Box size={14} aria-hidden="true" className="shrink-0" />
			<select
				aria-label="3D model"
				className="ui-select w-56 max-w-full overflow-clip whitespace-nowrap [overflow-clip-margin:content-box]"
				title={
					current?.name ??
					(failed ? "The 3D model library did not load" : undefined)
				}
				value={model ? modelKey(model) : ""}
				disabled={saving || (!library && !failed)}
				onChange={(event) => {
					const [source, id] = event.currentTarget.value.split(/:(.*)/s);
					const next: ModelReference | undefined =
						source === "builtin" && id ? { library: source, id } : undefined;
					setSaving(true);
					onChange(next)
						.catch((cause: unknown) =>
							toastManager.add({
								type: "error",
								title: "Unable to change the 3D model",
								description: errorMessage(
									cause,
									"Unable to change the 3D model",
								),
							}),
						)
						.finally(() => setSaving(false));
				}}
			>
				<option value="">No 3D model</option>
				{missing && model && (
					<option value={modelKey(model)}>{model.id} (missing)</option>
				)}
				{!library && model && (
					<option value={modelKey(model)}>{model.id}</option>
				)}
				{library?.categories.map((category) => (
					<optgroup key={category} label={category}>
						{library.models
							.filter((entry) => entry.category === category)
							.map((entry) => (
								<option key={entry.id} value={`builtin:${entry.id}`}>
									{entry.name}
								</option>
							))}
					</optgroup>
				))}
			</select>
		</label>
	);
}
