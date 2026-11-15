// Adapted from the KiCad footprint libraries, commit a0dcd398e7ea4b00cdeb91efc35f09cceaa9097d.
// Copyright KiCad library contributors. See ../LICENSE.md and ../NOTICE.md.
// Coordinates are KiCad's: millimetres, Y down, angles in degrees.
import type { SourceFootprint, SourceItem } from "./types.ts";

function pinHeader(pins: number): SourceFootprint {
	const end = (pins - 1) * 2.54;
	const items: SourceItem[] = [
		["line", "F.SilkS", -1.38, -1.38, 0, -1.38, 0.12],
		["line", "F.SilkS", -1.38, 0, -1.38, -1.38, 0.12],
		["line", "F.SilkS", -1.38, 1.27, -1.38, end + 1.38, 0.12],
		["line", "F.SilkS", -1.38, 1.27, 1.38, 1.27, 0.12],
		["line", "F.SilkS", -1.38, end + 1.38, 1.38, end + 1.38, 0.12],
		["line", "F.SilkS", 1.38, 1.27, 1.38, end + 1.38, 0.12],
		["rect", "F.CrtYd", -1.77, -1.77, 1.77, end + 1.77, 0.05, false],
		["line", "F.Fab", -1.27, -0.635, -0.635, -1.27, 0.1],
		["line", "F.Fab", -1.27, end + 1.27, -1.27, -0.635, 0.1],
		["line", "F.Fab", -0.635, -1.27, 1.27, -1.27, 0.1],
		["line", "F.Fab", 1.27, -1.27, 1.27, end + 1.27, 0.1],
		["line", "F.Fab", 1.27, end + 1.27, -1.27, end + 1.27, 0.1],
	];
	for (let pin = 1; pin <= pins; pin++)
		items.push([
			"tht",
			String(pin),
			pin === 1 ? "rect" : "circle",
			0,
			Number(((pin - 1) * 2.54).toFixed(2)),
			1.7,
			1.7,
			0,
			1,
		]);
	const count = String(pins).padStart(2, "0");
	return {
		id: `pinheader_1x${count}_p2.54mm_vertical`,
		category: "Connector_PinHeader_2.54mm",
		name: `PinHeader_1x${count}_P2.54mm_Vertical`,
		description: `Through hole straight pin header, 1x${count}, 2.54mm pitch, single row`,
		items,
	};
}

export const referenceFootprints: readonly SourceFootprint[] = [
	{
		id: "soic-8_5.23x5.23mm_p1.27mm",
		category: "Package_SO",
		name: "SOIC-8_5.23x5.23mm_P1.27mm",
		description:
			"SOIC, 8 Pin (http://www.winbond.com/resource-files/w25q32jv%20revg%2003272018%20plus.pdf#page=68), generated with kicad-footprint-generator ipc_gullwing_generator.py",
		items: [
			["line", "F.SilkS", 0, -2.725, -2.725, -2.725, 0.12],
			["line", "F.SilkS", 0, -2.725, 2.725, -2.725, 0.12],
			["line", "F.SilkS", 0, 2.725, -2.725, 2.725, 0.12],
			["line", "F.SilkS", 0, 2.725, 2.725, 2.725, 0.12],
			[
				"poly",
				"F.SilkS",
				0.12,
				true,
				[-3.4, -2.5],
				[-3.64, -2.83],
				[-3.16, -2.83],
				[-3.4, -2.5],
			],
			["rect", "F.CrtYd", -4.65, -2.86, 4.65, 2.86, 0.05, false],
			["line", "F.Fab", -2.615, -1.615, -1.615, -2.615, 0.1],
			["line", "F.Fab", -2.615, 2.615, -2.615, -1.615, 0.1],
			["line", "F.Fab", -1.615, -2.615, 2.615, -2.615, 0.1],
			["line", "F.Fab", 2.615, -2.615, 2.615, 2.615, 0.1],
			["line", "F.Fab", 2.615, 2.615, -2.615, 2.615, 0.1],
			["smd", "1", "rect", -3.6, -1.905, 1.6, 0.6, 0, true],
			["smd", "2", "rect", -3.6, -0.635, 1.6, 0.6, 0, true],
			["smd", "3", "rect", -3.6, 0.635, 1.6, 0.6, 0, true],
			["smd", "4", "rect", -3.6, 1.905, 1.6, 0.6, 0, true],
			["smd", "5", "rect", 3.6, 1.905, 1.6, 0.6, 0, true],
			["smd", "6", "rect", 3.6, 0.635, 1.6, 0.6, 0, true],
			["smd", "7", "rect", 3.6, -0.635, 1.6, 0.6, 0, true],
			["smd", "8", "rect", 3.6, -1.905, 1.6, 0.6, 0, true],
		],
	},
	{
		id: "crystal_smd_3225-4pin_3.2x2.5mm",
		category: "Crystal",
		name: "Crystal_SMD_3225-4Pin_3.2x2.5mm",
		description:
			"SMD Crystal SERIES SMD3225/4 http://www.txccrystal.com/images/pdf/7m-accuracy.pdf, 3.2x2.5mm^2 package",
		items: [
			["line", "F.SilkS", -2, -1.65, -2, 1.65, 0.12],
			["line", "F.SilkS", -2, 1.65, 2, 1.65, 0.12],
			["rect", "F.CrtYd", -2.1, -1.7, 2.1, 1.7, 0.05, false],
			["line", "F.Fab", -1.6, -1.25, -1.6, 1.25, 0.1],
			["line", "F.Fab", -1.6, -1.25, 1.6, -1.25, 0.1],
			["line", "F.Fab", -1.6, 0.25, -0.6, 1.25, 0.1],
			["line", "F.Fab", -1.6, 1.25, 1.6, 1.25, 0.1],
			["line", "F.Fab", 1.6, -1.25, 1.6, 1.25, 0.1],
			["smd", "1", "rect", -1.1, 0.85, 1.4, 1.2, 0, true],
			["smd", "2", "rect", 1.1, 0.85, 1.4, 1.2, 0, true],
			["smd", "3", "rect", 1.1, -0.85, 1.4, 1.2, 0, true],
			["smd", "4", "rect", -1.1, -0.85, 1.4, 1.2, 0, true],
		],
	},
	{
		id: "usb_micro-b_molex-105017-0001",
		category: "Connector_USB",
		name: "USB_Micro-B_Molex-105017-0001",
		description:
			"Micro USB B receptacle, right angle, surface mount with through-hole shell legs (http://www.molex.com/pdm_docs/sd/1050170001_sd.pdf). Oval shell holes are round here.",
		items: [
			["line", "F.SilkS", -3.9, -2.25, -3.9, -2.75, 0.12],
			["line", "F.SilkS", -3.9, 2.4, -3.9, 2.65, 0.12],
			["line", "F.SilkS", 3.9, -2.25, 3.9, -2.75, 0.12],
			["line", "F.SilkS", 3.9, 2.4, 3.9, 2.65, 0.12],
			["line", "F.SilkS", -1.8, -2.75, -2.1, -3.05, 0.12],
			["rect", "F.CrtYd", -4.4, -3.3, 4.4, 3.35, 0.05, false],
			["rect", "F.Fab", -3.75, -2.6, 3.75, 2.65, 0.1, false],
			["line", "F.Fab", -3.75, 2.2, 3.75, 2.2, 0.1],
			["smd", "1", "rect", -1.3, -2.675, 0.4, 1.35, 0, true],
			["smd", "2", "rect", -0.65, -2.675, 0.4, 1.35, 0, true],
			["smd", "3", "rect", 0, -2.675, 0.4, 1.35, 0, true],
			["smd", "4", "rect", 0.65, -2.675, 0.4, 1.35, 0, true],
			["smd", "5", "rect", 1.3, -2.675, 0.4, 1.35, 0, true],
			["tht", "6", "rect", -2.5, -2.475, 1.45, 2, 0, 0.85],
			["tht", "6", "rect", 2.5, -2.475, 1.45, 2, 0, 0.85],
			["smd", "6", "rect", -1, 0.225, 1.5, 1.9, 0, true],
			["smd", "6", "rect", 1, 0.225, 1.5, 1.9, 0, true],
			["tht", "6", "rect", -3.5, 0.225, 1.2, 1.9, 0, 0.6],
			["tht", "6", "rect", 3.5, 0.225, 1.2, 1.9, 0, 0.6],
		],
	},
	pinHeader(20),
];
