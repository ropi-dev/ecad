import type { DefaultModel } from "./types.ts";

export const catalog: readonly DefaultModel[] = [
	{
		id: "r_0402_1005metric",
		name: "R_0402_1005Metric",
		category: "Resistor_SMD",
		url: new URL("../models/r_0402_1005metric.glb", import.meta.url).href,
	},
	{
		id: "r_0603_1608metric",
		name: "R_0603_1608Metric",
		category: "Resistor_SMD",
		url: new URL("../models/r_0603_1608metric.glb", import.meta.url).href,
	},
	{
		id: "r_0805_2012metric",
		name: "R_0805_2012Metric",
		category: "Resistor_SMD",
		url: new URL("../models/r_0805_2012metric.glb", import.meta.url).href,
	},
	{
		id: "r_1206_3216metric",
		name: "R_1206_3216Metric",
		category: "Resistor_SMD",
		url: new URL("../models/r_1206_3216metric.glb", import.meta.url).href,
	},
	{
		id: "r_axial_din0207_l6.3mm_d2.5mm_p10.16mm_horizontal",
		name: "R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal",
		category: "Resistor_THT",
		url: new URL(
			"../models/r_axial_din0207_l6.3mm_d2.5mm_p10.16mm_horizontal.glb",
			import.meta.url,
		).href,
	},
	{
		id: "c_0402_1005metric",
		name: "C_0402_1005Metric",
		category: "Capacitor_SMD",
		url: new URL("../models/c_0402_1005metric.glb", import.meta.url).href,
	},
	{
		id: "c_0603_1608metric",
		name: "C_0603_1608Metric",
		category: "Capacitor_SMD",
		url: new URL("../models/c_0603_1608metric.glb", import.meta.url).href,
	},
	{
		id: "c_0805_2012metric",
		name: "C_0805_2012Metric",
		category: "Capacitor_SMD",
		url: new URL("../models/c_0805_2012metric.glb", import.meta.url).href,
	},
	{
		id: "c_1206_3216metric",
		name: "C_1206_3216Metric",
		category: "Capacitor_SMD",
		url: new URL("../models/c_1206_3216metric.glb", import.meta.url).href,
	},
	{
		id: "cp_elec_6.3x5.4",
		name: "CP_Elec_6.3x5.4",
		category: "Capacitor_SMD",
		url: new URL("../models/cp_elec_6.3x5.4.glb", import.meta.url).href,
	},
	{
		id: "c_trimmer_murata_tzb4-a",
		name: "C_Trimmer_Murata_TZB4-A",
		category: "Capacitor_SMD",
		url: new URL("../models/c_trimmer_murata_tzb4-a.glb", import.meta.url).href,
	},
	{
		id: "cp_radial_d5.0mm_p2.00mm",
		name: "CP_Radial_D5.0mm_P2.00mm",
		category: "Capacitor_THT",
		url: new URL("../models/cp_radial_d5.0mm_p2.00mm.glb", import.meta.url)
			.href,
	},
	{
		id: "c_disc_d5.0mm_w2.5mm_p5.00mm",
		name: "C_Disc_D5.0mm_W2.5mm_P5.00mm",
		category: "Capacitor_THT",
		url: new URL("../models/c_disc_d5.0mm_w2.5mm_p5.00mm.glb", import.meta.url)
			.href,
	},
	{
		id: "l_0603_1608metric",
		name: "L_0603_1608Metric",
		category: "Inductor_SMD",
		url: new URL("../models/l_0603_1608metric.glb", import.meta.url).href,
	},
	{
		id: "l_0805_2012metric",
		name: "L_0805_2012Metric",
		category: "Inductor_SMD",
		url: new URL("../models/l_0805_2012metric.glb", import.meta.url).href,
	},
	{
		id: "l_1206_3216metric",
		name: "L_1206_3216Metric",
		category: "Inductor_SMD",
		url: new URL("../models/l_1206_3216metric.glb", import.meta.url).href,
	},
	{
		id: "fuse_1206_3216metric",
		name: "Fuse_1206_3216Metric",
		category: "Fuse",
		url: new URL("../models/fuse_1206_3216metric.glb", import.meta.url).href,
	},
	{
		id: "potentiometer_bourns_3386p_vertical",
		name: "Potentiometer_Bourns_3386P_Vertical",
		category: "Potentiometer_THT",
		url: new URL(
			"../models/potentiometer_bourns_3386p_vertical.glb",
			import.meta.url,
		).href,
	},
	{
		id: "r_ldr_5.1x4.3mm_p3.4mm_vertical",
		name: "R_LDR_5.1x4.3mm_P3.4mm_Vertical",
		category: "OptoDevice",
		url: new URL(
			"../models/r_ldr_5.1x4.3mm_p3.4mm_vertical.glb",
			import.meta.url,
		).href,
	},
	{
		id: "crystal_hc49-u_vertical",
		name: "Crystal_HC49-U_Vertical",
		category: "Crystal",
		url: new URL("../models/crystal_hc49-u_vertical.glb", import.meta.url).href,
	},
	{
		id: "crystal_smd_3215-2pin_3.2x1.5mm",
		name: "Crystal_SMD_3215-2Pin_3.2x1.5mm",
		category: "Crystal",
		url: new URL(
			"../models/crystal_smd_3215-2pin_3.2x1.5mm.glb",
			import.meta.url,
		).href,
	},
	{
		id: "crystal_smd_3225-4pin_3.2x2.5mm",
		name: "Crystal_SMD_3225-4Pin_3.2x2.5mm",
		category: "Crystal",
		url: new URL(
			"../models/crystal_smd_3225-4pin_3.2x2.5mm.glb",
			import.meta.url,
		).href,
	},
	{
		id: "d_sod-123",
		name: "D_SOD-123",
		category: "Diode_SMD",
		url: new URL("../models/d_sod-123.glb", import.meta.url).href,
	},
	{
		id: "d_sod-323",
		name: "D_SOD-323",
		category: "Diode_SMD",
		url: new URL("../models/d_sod-323.glb", import.meta.url).href,
	},
	{
		id: "d_sma",
		name: "D_SMA",
		category: "Diode_SMD",
		url: new URL("../models/d_sma.glb", import.meta.url).href,
	},
	{
		id: "d_do-41_sod81_p10.16mm_horizontal",
		name: "D_DO-41_SOD81_P10.16mm_Horizontal",
		category: "Diode_THT",
		url: new URL(
			"../models/d_do-41_sod81_p10.16mm_horizontal.glb",
			import.meta.url,
		).href,
	},
	{
		id: "led_0603_1608metric",
		name: "LED_0603_1608Metric",
		category: "LED_SMD",
		url: new URL("../models/led_0603_1608metric.glb", import.meta.url).href,
	},
	{
		id: "led_0805_2012metric",
		name: "LED_0805_2012Metric",
		category: "LED_SMD",
		url: new URL("../models/led_0805_2012metric.glb", import.meta.url).href,
	},
	{
		id: "led_d3.0mm",
		name: "LED_D3.0mm",
		category: "LED_THT",
		url: new URL("../models/led_d3.0mm.glb", import.meta.url).href,
	},
	{
		id: "led_d5.0mm",
		name: "LED_D5.0mm",
		category: "LED_THT",
		url: new URL("../models/led_d5.0mm.glb", import.meta.url).href,
	},
	{
		id: "sot-23",
		name: "SOT-23",
		category: "Package_TO_SOT_SMD",
		url: new URL("../models/sot-23.glb", import.meta.url).href,
	},
	{
		id: "sot-23-5",
		name: "SOT-23-5",
		category: "Package_TO_SOT_SMD",
		url: new URL("../models/sot-23-5.glb", import.meta.url).href,
	},
	{
		id: "sot-89-3",
		name: "SOT-89-3",
		category: "Package_TO_SOT_SMD",
		url: new URL("../models/sot-89-3.glb", import.meta.url).href,
	},
	{
		id: "sot-223",
		name: "SOT-223",
		category: "Package_TO_SOT_SMD",
		url: new URL("../models/sot-223.glb", import.meta.url).href,
	},
	{
		id: "sot-223-3_onsemi_ncp1117st33t3g",
		name: "SOT-223-3_Onsemi_NCP1117ST33T3G",
		category: "Package_TO_SOT_SMD",
		url: new URL(
			"../models/sot-223-3_onsemi_ncp1117st33t3g.glb",
			import.meta.url,
		).href,
	},
	{
		id: "to-92_inline",
		name: "TO-92_Inline",
		category: "Package_TO_SOT_THT",
		url: new URL("../models/to-92_inline.glb", import.meta.url).href,
	},
	{
		id: "to-220-3_vertical",
		name: "TO-220-3_Vertical",
		category: "Package_TO_SOT_THT",
		url: new URL("../models/to-220-3_vertical.glb", import.meta.url).href,
	},
	{
		id: "soic-8_5.3x5.3mm_p1.27mm",
		name: "SOIC-8_5.3x5.3mm_P1.27mm",
		category: "Package_SO",
		url: new URL("../models/soic-8_5.3x5.3mm_p1.27mm.glb", import.meta.url)
			.href,
	},
	{
		id: "qfn-16-1ep_4x4mm_p0.65mm_ep2.1x2.1mm",
		name: "QFN-16-1EP_4x4mm_P0.65mm_EP2.1x2.1mm",
		category: "Package_DFN_QFN",
		url: new URL(
			"../models/qfn-16-1ep_4x4mm_p0.65mm_ep2.1x2.1mm.glb",
			import.meta.url,
		).href,
	},
	{
		id: "qfn-40-1ep_5x5mm_p0.4mm_ep3.6x3.6mm",
		name: "QFN-40-1EP_5x5mm_P0.4mm_EP3.6x3.6mm",
		category: "Package_DFN_QFN",
		url: new URL(
			"../models/qfn-40-1ep_5x5mm_p0.4mm_ep3.6x3.6mm.glb",
			import.meta.url,
		).href,
	},
	{
		id: "qfn-48-1ep_6x6mm_p0.4mm_ep4.6x4.6mm",
		name: "QFN-48-1EP_6x6mm_P0.4mm_EP4.6x4.6mm",
		category: "Package_DFN_QFN",
		url: new URL(
			"../models/qfn-48-1ep_6x6mm_p0.4mm_ep4.6x4.6mm.glb",
			import.meta.url,
		).href,
	},
	{
		id: "vqfn-52-1ep_6x6mm_p0.4mm_ep4.7x4.7mm",
		name: "VQFN-52-1EP_6x6mm_P0.4mm_EP4.7x4.7mm",
		category: "Package_DFN_QFN",
		url: new URL(
			"../models/vqfn-52-1ep_6x6mm_p0.4mm_ep4.7x4.7mm.glb",
			import.meta.url,
		).href,
	},
	{
		id: "qfn-56-1ep_7x7mm_p0.4mm_ep3.2x3.2mm",
		name: "QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm",
		category: "Package_DFN_QFN",
		url: new URL(
			"../models/qfn-56-1ep_7x7mm_p0.4mm_ep3.2x3.2mm.glb",
			import.meta.url,
		).href,
	},
	{
		id: "qfn-60-1ep_7x7mm_p0.4mm_ep3.4x3.4mm",
		name: "QFN-60-1EP_7x7mm_P0.4mm_EP3.4x3.4mm",
		category: "Package_DFN_QFN",
		url: new URL(
			"../models/qfn-60-1ep_7x7mm_p0.4mm_ep3.4x3.4mm.glb",
			import.meta.url,
		).href,
	},
	{
		id: "qfn-80-1ep_10x10mm_p0.4mm_ep3.4x3.4mm",
		name: "QFN-80-1EP_10x10mm_P0.4mm_EP3.4x3.4mm",
		category: "Package_DFN_QFN",
		url: new URL(
			"../models/qfn-80-1ep_10x10mm_p0.4mm_ep3.4x3.4mm.glb",
			import.meta.url,
		).href,
	},
	{
		id: "sw_push_6mm",
		name: "SW_PUSH_6mm",
		category: "Button_Switch_THT",
		url: new URL("../models/sw_push_6mm.glb", import.meta.url).href,
	},
	{
		id: "sw_dip_spstx01_slide_9.78x4.72mm_w7.62mm_p2.54mm",
		name: "SW_DIP_SPSTx01_Slide_9.78x4.72mm_W7.62mm_P2.54mm",
		category: "Button_Switch_THT",
		url: new URL(
			"../models/sw_dip_spstx01_slide_9.78x4.72mm_w7.62mm_p2.54mm.glb",
			import.meta.url,
		).href,
	},
	{
		id: "sw_slide_spdt_straight_ck_os102011ms2q",
		name: "SW_Slide_SPDT_Straight_CK_OS102011MS2Q",
		category: "Button_Switch_THT",
		url: new URL(
			"../models/sw_slide_spdt_straight_ck_os102011ms2q.glb",
			import.meta.url,
		).href,
	},
	{
		id: "sw_push_1p1t_no_wuerth_434133025816",
		name: "SW_Push_1P1T_NO_Wuerth_434133025816",
		category: "Button_Switch_SMD",
		url: new URL(
			"../models/sw_push_1p1t_no_wuerth_434133025816.glb",
			import.meta.url,
		).href,
	},
	{
		id: "batteryholder_keystone_3034_1x20mm",
		name: "BatteryHolder_Keystone_3034_1x20mm",
		category: "Battery",
		url: new URL(
			"../models/batteryholder_keystone_3034_1x20mm.glb",
			import.meta.url,
		).href,
	},
	{
		id: "batteryholder_keystone_1060_1x2032",
		name: "BatteryHolder_Keystone_1060_1x2032",
		category: "Battery",
		url: new URL(
			"../models/batteryholder_keystone_1060_1x2032.glb",
			import.meta.url,
		).href,
	},
	{
		id: "pinheader_1x02_p2.54mm_vertical",
		name: "PinHeader_1x02_P2.54mm_Vertical",
		category: "Connector_PinHeader_2.54mm",
		url: new URL(
			"../models/pinheader_1x02_p2.54mm_vertical.glb",
			import.meta.url,
		).href,
	},
	{
		id: "pinheader_1x03_p2.54mm_vertical",
		name: "PinHeader_1x03_P2.54mm_Vertical",
		category: "Connector_PinHeader_2.54mm",
		url: new URL(
			"../models/pinheader_1x03_p2.54mm_vertical.glb",
			import.meta.url,
		).href,
	},
	{
		id: "pinheader_1x04_p2.54mm_vertical",
		name: "PinHeader_1x04_P2.54mm_Vertical",
		category: "Connector_PinHeader_2.54mm",
		url: new URL(
			"../models/pinheader_1x04_p2.54mm_vertical.glb",
			import.meta.url,
		).href,
	},
	{
		id: "pinheader_1x08_p2.54mm_vertical",
		name: "PinHeader_1x08_P2.54mm_Vertical",
		category: "Connector_PinHeader_2.54mm",
		url: new URL(
			"../models/pinheader_1x08_p2.54mm_vertical.glb",
			import.meta.url,
		).href,
	},
	{
		id: "pinheader_1x20_p2.54mm_vertical",
		name: "PinHeader_1x20_P2.54mm_Vertical",
		category: "Connector_PinHeader_2.54mm",
		url: new URL(
			"../models/pinheader_1x20_p2.54mm_vertical.glb",
			import.meta.url,
		).href,
	},
	{
		id: "pinheader_2x18_samtec_tsw-118-07-l-d",
		name: "PinHeader_2x18_Samtec_TSW-118-07-L-D",
		category: "Connector_PinHeader_2.54mm",
		url: new URL(
			"../models/pinheader_2x18_samtec_tsw-118-07-l-d.glb",
			import.meta.url,
		).href,
	},
	{
		id: "buzzer_12x9.5rm7.6",
		name: "Buzzer_12x9.5RM7.6",
		category: "Buzzer_Beeper",
		url: new URL("../models/buzzer_12x9.5rm7.6.glb", import.meta.url).href,
	},
	{
		id: "usb_micro-b_molex-105017-0001",
		name: "USB_Micro-B_Molex-105017-0001",
		category: "Connector_USB",
		url: new URL("../models/usb_micro-b_molex-105017-0001.glb", import.meta.url)
			.href,
	},
	{
		id: "usb_micro-b_amphenol_10103594-0001lf",
		name: "USB_Micro-B_Amphenol_10103594-0001LF",
		category: "Connector_USB",
		url: new URL(
			"../models/usb_micro-b_amphenol_10103594-0001lf.glb",
			import.meta.url,
		).href,
	},
	{
		id: "jst_sh_sm03b-srss-tb_1x03-1mp_p1.00mm_horizontal",
		name: "JST_SH_SM03B-SRSS-TB_1x03-1MP_P1.00mm_Horizontal",
		category: "Connector_JST",
		url: new URL(
			"../models/jst_sh_sm03b-srss-tb_1x03-1mp_p1.00mm_horizontal.glb",
			import.meta.url,
		).href,
	},
	{
		id: "l_abracon_aota-b201610",
		name: "L_Abracon_AOTA-B201610",
		category: "Inductor_SMD",
		url: new URL("../models/l_abracon_aota-b201610.glb", import.meta.url).href,
	},
];
