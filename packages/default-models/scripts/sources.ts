export const kicadCommit = "afa6aab16f43a736cd062b8c853863e753653921";
export const raspberryPiArchive = {
	url: "https://datasheets.raspberrypi.com/rp2350/Minimal-KiCAD.zip",
	sha256: "c0b858d78f56fa271a827064198e8ee81e4ec246234ce6659be8a1fcd877d06b",
	board: "RPI-RP2350A-MINIMAL_R4-S1_public/RPI-RP2350A-MINIMAL_R4-S1.kicad_pcb",
};

export interface Placement {
	offset?: readonly [number, number, number];
	rotate?: readonly [number, number, number];
}

export type ModelSource =
	| ({ kind: "kicad"; path: string } & Placement)
	| ({ kind: "raspberry-pi"; file: string } & Placement)
	| { kind: "ecad" };

export interface SourceModel {
	id: string;
	name: string;
	category: string;
	source: ModelSource;
}

const kicad = (
	category: string,
	name: string,
	placement: Placement = {},
): SourceModel => ({
	id: name.toLowerCase(),
	name,
	category,
	source: {
		kind: "kicad",
		path: `${category}.3dshapes/${name}.step`,
		...placement,
	},
});

const raspberryPi = (
	category: string,
	name: string,
	file: string,
	placement: Placement = {},
): SourceModel => ({
	id: name.toLowerCase(),
	name,
	category,
	source: { kind: "raspberry-pi", file, ...placement },
});

const ecad = (category: string, name: string): SourceModel => ({
	id: name.toLowerCase(),
	name,
	category,
	source: { kind: "ecad" },
});

export const sourceModels: readonly SourceModel[] = [
	kicad("Resistor_SMD", "R_0402_1005Metric"),
	kicad("Resistor_SMD", "R_0603_1608Metric"),
	kicad("Resistor_SMD", "R_0805_2012Metric"),
	kicad("Resistor_SMD", "R_1206_3216Metric"),
	kicad("Resistor_THT", "R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal"),
	kicad("Capacitor_SMD", "C_0402_1005Metric"),
	kicad("Capacitor_SMD", "C_0603_1608Metric"),
	kicad("Capacitor_SMD", "C_0805_2012Metric"),
	kicad("Capacitor_SMD", "C_1206_3216Metric"),
	kicad("Capacitor_SMD", "CP_Elec_6.3x5.4"),
	kicad("Capacitor_SMD", "C_Trimmer_Murata_TZB4-A"),
	kicad("Capacitor_THT", "CP_Radial_D5.0mm_P2.00mm"),
	kicad("Capacitor_THT", "C_Disc_D5.0mm_W2.5mm_P5.00mm"),
	kicad("Inductor_SMD", "L_0603_1608Metric"),
	kicad("Inductor_SMD", "L_0805_2012Metric"),
	kicad("Inductor_SMD", "L_1206_3216Metric"),
	kicad("Fuse", "Fuse_1206_3216Metric"),
	ecad("Potentiometer_THT", "Potentiometer_Bourns_3386P_Vertical"),
	kicad("OptoDevice", "R_LDR_5.1x4.3mm_P3.4mm_Vertical"),
	kicad("Crystal", "Crystal_HC49-U_Vertical"),
	kicad("Crystal", "Crystal_SMD_3215-2Pin_3.2x1.5mm"),
	kicad("Crystal", "Crystal_SMD_3225-4Pin_3.2x2.5mm"),
	kicad("Diode_SMD", "D_SOD-123"),
	kicad("Diode_SMD", "D_SOD-323"),
	kicad("Diode_SMD", "D_SMA"),
	kicad("Diode_THT", "D_DO-41_SOD81_P10.16mm_Horizontal"),
	kicad("LED_SMD", "LED_0603_1608Metric"),
	kicad("LED_SMD", "LED_0805_2012Metric"),
	kicad("LED_THT", "LED_D3.0mm"),
	kicad("LED_THT", "LED_D5.0mm"),
	kicad("Package_TO_SOT_SMD", "SOT-23"),
	kicad("Package_TO_SOT_SMD", "SOT-23-5"),
	kicad("Package_TO_SOT_SMD", "SOT-89-3"),
	kicad("Package_TO_SOT_SMD", "SOT-223"),
	raspberryPi(
		"Package_TO_SOT_SMD",
		"SOT-223-3_Onsemi_NCP1117ST33T3G",
		"onsemi_ncp1117st33t3g.step",
		{ rotate: [0, 0, -90] },
	),
	kicad("Package_TO_SOT_THT", "TO-92_Inline"),
	kicad("Package_TO_SOT_THT", "TO-220-3_Vertical"),
	kicad("Package_SO", "SOIC-8_5.3x5.3mm_P1.27mm"),
	kicad("Package_DFN_QFN", "QFN-16-1EP_4x4mm_P0.65mm_EP2.1x2.1mm"),
	kicad("Package_DFN_QFN", "QFN-40-1EP_5x5mm_P0.4mm_EP3.6x3.6mm"),
	ecad("Package_DFN_QFN", "QFN-48-1EP_6x6mm_P0.4mm_EP4.6x4.6mm"),
	kicad("Package_DFN_QFN", "VQFN-52-1EP_6x6mm_P0.4mm_EP4.7x4.7mm"),
	kicad("Package_DFN_QFN", "QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm"),
	ecad("Package_DFN_QFN", "QFN-60-1EP_7x7mm_P0.4mm_EP3.4x3.4mm"),
	ecad("Package_DFN_QFN", "QFN-80-1EP_10x10mm_P0.4mm_EP3.4x3.4mm"),
	kicad("Button_Switch_THT", "SW_PUSH_6mm"),
	kicad(
		"Button_Switch_THT",
		"SW_DIP_SPSTx01_Slide_9.78x4.72mm_W7.62mm_P2.54mm",
		{ rotate: [0, 0, 90] },
	),
	kicad("Button_Switch_THT", "SW_Slide_SPDT_Straight_CK_OS102011MS2Q"),
	raspberryPi(
		"Button_Switch_SMD",
		"SW_Push_1P1T_NO_Wuerth_434133025816",
		"wurthelek_434133025816.step",
	),
	kicad("Battery", "BatteryHolder_Keystone_3034_1x20mm"),
	kicad("Battery", "BatteryHolder_Keystone_1060_1x2032"),
	kicad("Connector_PinHeader_2.54mm", "PinHeader_1x02_P2.54mm_Vertical"),
	kicad("Connector_PinHeader_2.54mm", "PinHeader_1x03_P2.54mm_Vertical"),
	kicad("Connector_PinHeader_2.54mm", "PinHeader_1x04_P2.54mm_Vertical"),
	kicad("Connector_PinHeader_2.54mm", "PinHeader_1x08_P2.54mm_Vertical"),
	kicad("Connector_PinHeader_2.54mm", "PinHeader_1x20_P2.54mm_Vertical"),
	raspberryPi(
		"Connector_PinHeader_2.54mm",
		"PinHeader_2x18_Samtec_TSW-118-07-L-D",
		"samtec_tsw-118-07-l-d.step",
		{ rotate: [0, 0, -90] },
	),
	kicad("Buzzer_Beeper", "Buzzer_12x9.5RM7.6"),
	ecad("Connector_USB", "USB_Micro-B_Molex-105017-0001"),
	raspberryPi(
		"Connector_USB",
		"USB_Micro-B_Amphenol_10103594-0001LF",
		"amphenol_10103594-0001lf.step",
		{ offset: [0, 0.3, 0] },
	),
	raspberryPi(
		"Connector_JST",
		"JST_SH_SM03B-SRSS-TB_1x03-1MP_P1.00mm_Horizontal",
		"jst_sm03b-srss-tb-lf--sn-.step",
	),
	raspberryPi(
		"Inductor_SMD",
		"L_Abracon_AOTA-B201610",
		"abracon_aota-b201610s3r3-101-t.step",
	),
];
