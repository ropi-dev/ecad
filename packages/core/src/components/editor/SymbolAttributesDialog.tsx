import {
	attributeEntriesError,
	SYMBOL_ATTRIBUTE_LIMIT,
	SYMBOL_ATTRIBUTE_NAME_LIMIT,
	SYMBOL_ATTRIBUTE_VALUE_LIMIT,
} from "@ecad/drawing-core/drawing/symbol-attributes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { Plus, Tags, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { AppDialog, dialogBodyClassName } from "#/components/ui/Dialog.tsx";

interface Row {
	key: number;
	name: string;
	value: string;
}

export function SymbolAttributesDialog({
	attributes,
	onSave,
	onClose,
}: {
	attributes: Readonly<Record<string, string>> | undefined;
	onSave: (attributes: Record<string, string>) => void | Promise<void>;
	onClose: () => void;
}) {
	const formId = useId();
	const nextKey = useRef(0);
	const [rows, setRows] = useState<Row[]>(() =>
		Object.entries(attributes ?? {}).map(([name, value]) => ({
			key: nextKey.current++,
			name,
			value,
		})),
	);
	const [error, setError] = useState("");
	const focusKey = useRef<number | undefined>(undefined);
	const change = (key: number, field: "name" | "value", text: string) =>
		setRows((current) =>
			current.map((row) => (row.key === key ? { ...row, [field]: text } : row)),
		);

	return (
		<AppDialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title="Symbol attributes"
			description="Every new placement of this symbol gets these attributes with their default values. Name, reference and value are always present."
			footer={
				<>
					<button
						type="button"
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
						className="ui-button"
						data-variant="primary"
						data-size="md"
					>
						Save
					</button>
				</>
			}
		>
			<form
				id={formId}
				className={`${dialogBodyClassName} flex max-h-[min(36rem,calc(100dvh-12rem))] flex-col gap-3`}
				noValidate
				onSubmit={async (event) => {
					event.preventDefault();
					const entries = rows.map(
						({ name, value }) => [name.trim(), value] as const,
					);
					const problem = attributeEntriesError(entries);
					if (problem) {
						setError(problem.message);
						return;
					}
					try {
						await onSave(Object.fromEntries(entries));
						onClose();
					} catch (cause) {
						setError(errorMessage(cause, "Unable to save the attributes."));
					}
				}}
			>
				{rows.length > 0 ? (
					<div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-x-2 gap-y-2">
						<span className="text-xs font-medium text-fg-muted">Name</span>
						<span className="text-xs font-medium text-fg-muted">
							Default value
						</span>
						<span />
						{rows.map((row, index) => (
							<div key={row.key} className="contents">
								<input
									ref={(input) => {
										if (input && focusKey.current === row.key) {
											focusKey.current = undefined;
											input.focus();
										}
									}}
									aria-label={`Attribute ${index + 1} name`}
									className="ui-input h-8 w-full"
									maxLength={SYMBOL_ATTRIBUTE_NAME_LIMIT}
									value={row.name}
									placeholder="Manufacturer"
									onChange={(event) =>
										change(row.key, "name", event.target.value)
									}
								/>
								<input
									aria-label={`Attribute ${index + 1} default value`}
									className="ui-input h-8 w-full"
									maxLength={SYMBOL_ATTRIBUTE_VALUE_LIMIT}
									value={row.value}
									onChange={(event) =>
										change(row.key, "value", event.target.value)
									}
								/>
								<button
									type="button"
									className="ui-button"
									data-variant="ghost"
									data-size="md"
									aria-label={`Remove attribute ${index + 1}`}
									title="Remove attribute"
									onClick={() =>
										setRows((current) =>
											current.filter((entry) => entry.key !== row.key),
										)
									}
								>
									<Trash2 size={14} aria-hidden="true" />
								</button>
							</div>
						))}
					</div>
				) : (
					<p className="m-0 text-sm text-fg-muted">
						This symbol has no attributes of its own yet.
					</p>
				)}
				<div>
					<button
						type="button"
						className="ui-button"
						data-variant="secondary"
						data-size="md"
						disabled={rows.length >= SYMBOL_ATTRIBUTE_LIMIT}
						onClick={() => {
							const key = nextKey.current++;
							focusKey.current = key;
							setRows((current) => [...current, { key, name: "", value: "" }]);
						}}
					>
						<Plus size={14} aria-hidden="true" />
						Add attribute
					</button>
				</div>
				{error && (
					<p role="alert" className="m-0 text-sm text-danger">
						{error}
					</p>
				)}
			</form>
		</AppDialog>
	);
}

export function SymbolAttributesButton({
	attributes,
	onSave,
}: {
	attributes: Readonly<Record<string, string>> | undefined;
	onSave: (attributes: Record<string, string>) => void | Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				className="ui-button"
				data-variant="secondary"
				onClick={() => setOpen(true)}
			>
				<Tags size={14} aria-hidden="true" />
				Attributes
			</button>
			{open && (
				<SymbolAttributesDialog
					attributes={attributes}
					onSave={onSave}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}
