type LayerOrder = readonly [group: number, innerLayer: number];

const TOP_COPPER: LayerOrder = [3, 0];
const BOTTOM_COPPER: LayerOrder = [5, 0];
const PROFILE: LayerOrder = [9, 0];
const DRILL: LayerOrder = [10, 0];
const UNKNOWN: LayerOrder = [11, 0];

function attributeOrder(value: string): LayerOrder | undefined {
	const [kind, ...parameters] = value
		.toLowerCase()
		.split(",")
		.map((part) => part.trim());
	if (kind === "copper") {
		if (parameters.includes("top")) return TOP_COPPER;
		if (parameters.includes("bot")) return BOTTOM_COPPER;
		const layer = parameters.find((part) => /^l\d+$/.test(part));
		if (layer)
			return Number(layer.slice(1)) === 1
				? TOP_COPPER
				: [4, Number(layer.slice(1))];
	}
	const top = parameters.includes("top");
	const bottom = parameters.includes("bot");
	if (top || bottom) {
		if (kind === "legend") return [top ? 0 : 8, 0];
		if (kind === "paste") return [top ? 1 : 7, 0];
		if (kind === "soldermask") return [top ? 2 : 6, 0];
	}
	if (kind === "profile") return PROFILE;
	if (["drillmap", "plated", "nonplated", "mixedplating"].includes(kind))
		return DRILL;
	return undefined;
}

/** Top-to-bottom panel order; Gerber attributes take precedence over filenames. */
export function gerberLayerOrder(filename: string, source: string): LayerOrder {
	const attribute =
		/(?:%TF\.FileFunction,|G04\s+#@!\s*TF\.FileFunction,)([^*]+)\*/i.exec(
			source,
		);
	if (attribute) {
		const order = attributeOrder(attribute[1]);
		if (order) return order;
	}
	const name = filename.slice(filename.lastIndexOf("/") + 1).toLowerCase();
	const stem = name.replace(/\.[^.]+$/, "");
	if (/(?:^|[._ -])(?:n?pth|drl|drill)(?:[._ -]|$)/.test(stem)) return DRILL;
	if (/(?:^|[._ -])(?:edge[._ -]cuts|outline|profile)$/.test(stem))
		return PROFILE;
	const inner = /(?:^|[._ -])in(?:ner)?(\d+)[._ -](?:cu|copper)$/.exec(stem);
	if (inner) return [4, Number(inner[1])];
	const side =
		/(?:^|[._ -])(f|b|top|bottom|front|back)[._ -](cu|copper|mask|soldermask|paste|silkscreen|silks|silk|legend)$/.exec(
			stem,
		);
	if (side) {
		const top = ["f", "top", "front"].includes(side[1]);
		if (["cu", "copper"].includes(side[2]))
			return top ? TOP_COPPER : BOTTOM_COPPER;
		if (["mask", "soldermask"].includes(side[2])) return [top ? 2 : 6, 0];
		if (side[2] === "paste") return [top ? 1 : 7, 0];
		return [top ? 0 : 8, 0];
	}
	const extension = name.slice(name.lastIndexOf(".") + 1);
	const extensions: Record<string, LayerOrder> = {
		gto: [0, 0],
		plc: [0, 0],
		gtp: [1, 0],
		gts: [2, 0],
		stc: [2, 0],
		gtl: TOP_COPPER,
		cmp: TOP_COPPER,
		gbl: BOTTOM_COPPER,
		sol: BOTTOM_COPPER,
		gbs: [6, 0],
		sts: [6, 0],
		gbp: [7, 0],
		gbo: [8, 0],
		gko: PROFILE,
		gml: PROFILE,
	};
	if (Object.hasOwn(extensions, extension)) return extensions[extension];
	const numbered = /^gl?(\d+)$/.exec(extension);
	return numbered ? [4, Number(numbered[1])] : UNKNOWN;
}
