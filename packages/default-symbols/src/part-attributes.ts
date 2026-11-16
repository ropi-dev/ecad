export const partAttributes = [
	"Manufacturer",
	"Part number",
	"Datasheet",
	"Distributor part number",
] as const;

export type PartAttribute = (typeof partAttributes)[number];

export function partAttributeValues(
	values: Readonly<Partial<Record<PartAttribute, string>>> = {},
): Record<PartAttribute, string> {
	for (const name of Object.keys(values))
		if (!partAttributes.includes(name as PartAttribute))
			throw new Error(`${name} is not a part attribute.`);
	return Object.fromEntries(
		partAttributes.map((name) => [name, values[name] ?? ""]),
	) as Record<PartAttribute, string>;
}
