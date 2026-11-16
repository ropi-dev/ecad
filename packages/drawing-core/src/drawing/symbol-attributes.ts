import { symbolAttributes } from "#/drawing/shape-kinds.ts";

export const SYMBOL_ATTRIBUTE_LIMIT = 32;
export const SYMBOL_ATTRIBUTE_NAME_LIMIT = 64;
export const SYMBOL_ATTRIBUTE_VALUE_LIMIT = 2000;

const builtIn = new Set<string>(symbolAttributes);

export function extraAttributes(
	attributes: Readonly<Record<string, string>> | undefined,
): [name: string, value: string][] {
	return Object.entries(attributes ?? {}).filter(
		([name]) => !builtIn.has(name),
	);
}

export function mergeAttributes<T extends Readonly<Record<string, string>>>(
	placement: T,
	definition: Readonly<Record<string, string>> | undefined,
): T {
	const own = extraAttributes(placement);
	const taken = new Set(own.map(([name]) => name.toLowerCase()));
	let room = SYMBOL_ATTRIBUTE_LIMIT - own.length;
	const merged: Record<string, string> = {};
	for (const name of symbolAttributes)
		if (name in placement) merged[name] = placement[name];
	for (const [name, value] of extraAttributes(definition)) {
		if (Object.hasOwn(placement, name)) merged[name] = placement[name];
		else if (room > 0 && !taken.has(name.toLowerCase())) {
			merged[name] = value;
			taken.add(name.toLowerCase());
			room--;
		}
	}
	for (const [name, value] of own) merged[name] ??= value;
	return merged as unknown as T;
}

export function attributeNameError(name: string): string | undefined {
	if (!name.trim()) return "Enter an attribute name.";
	if (name !== name.trim())
		return "Attribute names cannot start or end with a space.";
	if (name.length > SYMBOL_ATTRIBUTE_NAME_LIMIT)
		return `Attribute names can have at most ${SYMBOL_ATTRIBUTE_NAME_LIMIT} characters.`;
	if (!/\D/.test(name)) return "Attribute names cannot be only digits.";
	if (name === "__proto__") return "__proto__ cannot be an attribute name.";
	if (builtIn.has(name.toLowerCase()))
		return `${name} is already an attribute of every symbol.`;
	return undefined;
}

export function attributesError(
	attributes: Readonly<Record<string, string>>,
	{ definition = false } = {},
): { name?: string; message: string } | undefined {
	return attributeEntriesError(
		definition ? Object.entries(attributes) : extraAttributes(attributes),
	);
}

export function attributeEntriesError(
	entries: readonly (readonly [name: string, value: string])[],
): { name?: string; message: string } | undefined {
	if (entries.length > SYMBOL_ATTRIBUTE_LIMIT)
		return {
			message: `Symbols can have at most ${SYMBOL_ATTRIBUTE_LIMIT} attributes besides name, reference and value.`,
		};
	const seen = new Set<string>();
	for (const [name, value] of entries) {
		const error = attributeNameError(name);
		if (error) return { name, message: error };
		const folded = name.toLowerCase();
		if (seen.has(folded))
			return { name, message: `The ${name} attribute is repeated.` };
		seen.add(folded);
		if (value.length > SYMBOL_ATTRIBUTE_VALUE_LIMIT)
			return {
				name,
				message: `Attribute values can have at most ${SYMBOL_ATTRIBUTE_VALUE_LIMIT} characters.`,
			};
	}
	return undefined;
}
