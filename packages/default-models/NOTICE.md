# 3D model attribution

## KiCad models

This collection adapts 3D models by the KiCad library contributors from
https://gitlab.com/kicad/libraries/kicad-packages3D at commit
`afa6aab16f43a736cd062b8c853863e753653921`.

Upstream source files are available at
https://gitlab.com/kicad/libraries/kicad-packages3D/-/tree/afa6aab16f43a736cd062b8c853863e753653921.
The KiCad library license is included in LICENSE.md. The full CC BY-SA 4.0 text
is included in CC-BY-SA-4.0.txt. The electronic-design exception is retained.

ECAD modifications tessellate each STEP model into triangles with
occt-import-js, apply the model rotation the KiCad footprint names, merge faces
of the same colour into one mesh, give light grey and gold faces a metal finish,
and store the result as binary glTF in millimetres with Z up.

The source models are:

- `Resistor_SMD.3dshapes/R_0402_1005Metric.step`
- `Resistor_SMD.3dshapes/R_0603_1608Metric.step`
- `Resistor_SMD.3dshapes/R_0805_2012Metric.step`
- `Resistor_SMD.3dshapes/R_1206_3216Metric.step`
- `Resistor_THT.3dshapes/R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal.step`
- `Capacitor_SMD.3dshapes/C_0402_1005Metric.step`
- `Capacitor_SMD.3dshapes/C_0603_1608Metric.step`
- `Capacitor_SMD.3dshapes/C_0805_2012Metric.step`
- `Capacitor_SMD.3dshapes/C_1206_3216Metric.step`
- `Capacitor_SMD.3dshapes/CP_Elec_6.3x5.4.step`
- `Capacitor_SMD.3dshapes/C_Trimmer_Murata_TZB4-A.step`
- `Capacitor_THT.3dshapes/CP_Radial_D5.0mm_P2.00mm.step`
- `Capacitor_THT.3dshapes/C_Disc_D5.0mm_W2.5mm_P5.00mm.step`
- `Inductor_SMD.3dshapes/L_0603_1608Metric.step`
- `Inductor_SMD.3dshapes/L_0805_2012Metric.step`
- `Inductor_SMD.3dshapes/L_1206_3216Metric.step`
- `Fuse.3dshapes/Fuse_1206_3216Metric.step`
- `OptoDevice.3dshapes/R_LDR_5.1x4.3mm_P3.4mm_Vertical.step`
- `Crystal.3dshapes/Crystal_HC49-U_Vertical.step`
- `Crystal.3dshapes/Crystal_SMD_3215-2Pin_3.2x1.5mm.step`
- `Crystal.3dshapes/Crystal_SMD_3225-4Pin_3.2x2.5mm.step`
- `Diode_SMD.3dshapes/D_SOD-123.step`
- `Diode_SMD.3dshapes/D_SOD-323.step`
- `Diode_SMD.3dshapes/D_SMA.step`
- `Diode_THT.3dshapes/D_DO-41_SOD81_P10.16mm_Horizontal.step`
- `LED_SMD.3dshapes/LED_0603_1608Metric.step`
- `LED_SMD.3dshapes/LED_0805_2012Metric.step`
- `LED_THT.3dshapes/LED_D3.0mm.step`
- `LED_THT.3dshapes/LED_D5.0mm.step`
- `Package_TO_SOT_SMD.3dshapes/SOT-23.step`
- `Package_TO_SOT_SMD.3dshapes/SOT-23-5.step`
- `Package_TO_SOT_SMD.3dshapes/SOT-89-3.step`
- `Package_TO_SOT_SMD.3dshapes/SOT-223.step`
- `Package_TO_SOT_THT.3dshapes/TO-92_Inline.step`
- `Package_TO_SOT_THT.3dshapes/TO-220-3_Vertical.step`
- `Package_SO.3dshapes/SOIC-8_5.3x5.3mm_P1.27mm.step`
- `Package_DFN_QFN.3dshapes/QFN-16-1EP_4x4mm_P0.65mm_EP2.1x2.1mm.step`
- `Package_DFN_QFN.3dshapes/QFN-40-1EP_5x5mm_P0.4mm_EP3.6x3.6mm.step`
- `Package_DFN_QFN.3dshapes/VQFN-52-1EP_6x6mm_P0.4mm_EP4.7x4.7mm.step`
- `Package_DFN_QFN.3dshapes/QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm.step`
- `Button_Switch_THT.3dshapes/SW_PUSH_6mm.step`
- `Button_Switch_THT.3dshapes/SW_DIP_SPSTx01_Slide_9.78x4.72mm_W7.62mm_P2.54mm.step`
- `Button_Switch_THT.3dshapes/SW_Slide_SPDT_Straight_CK_OS102011MS2Q.step`
- `Battery.3dshapes/BatteryHolder_Keystone_3034_1x20mm.step`
- `Battery.3dshapes/BatteryHolder_Keystone_1060_1x2032.step`
- `Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x02_P2.54mm_Vertical.step`
- `Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x03_P2.54mm_Vertical.step`
- `Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x04_P2.54mm_Vertical.step`
- `Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x08_P2.54mm_Vertical.step`
- `Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x20_P2.54mm_Vertical.step`
- `Buzzer_Beeper.3dshapes/Buzzer_12x9.5RM7.6.step`

## Raspberry Pi models

6 models come from Raspberry Pi's RPI-RP2350A-MINIMAL R4 board, which embeds
them in `RPI-RP2350A-MINIMAL_R4-S1.kicad_pcb` in
https://datasheets.raspberrypi.com/rp2350/Minimal-KiCAD.zip, downloaded on
2026-11-16 (SHA-256
`c0b858d78f56fa271a827064198e8ee81e4ec246234ce6659be8a1fcd877d06b`). They are
under the MIT license below, not CC BY-SA 4.0. The conversion is the same as for
the KiCad models, with the offset and rotation Raspberry Pi's board gives each
one.

- `onsemi_ncp1117st33t3g.step` as `SOT-223-3_Onsemi_NCP1117ST33T3G`
- `wurthelek_434133025816.step` as `SW_Push_1P1T_NO_Wuerth_434133025816`
- `samtec_tsw-118-07-l-d.step` as `PinHeader_2x18_Samtec_TSW-118-07-L-D`
- `amphenol_10103594-0001lf.step` as `USB_Micro-B_Amphenol_10103594-0001LF`
- `jst_sm03b-srss-tb-lf--sn-.step` as `JST_SH_SM03B-SRSS-TB_1x03-1MP_P1.00mm_Horizontal`
- `abracon_aota-b201610s3r3-101-t.step` as `L_Abracon_AOTA-B201610`

Copyright (c) 2026 Raspberry Pi Ltd

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Raspberry Pi provides the design for guidance only and without guarantee.

## ECAD models

KiCad's library has no model for these footprints at the commit above, so ECAD
builds them from boxes and cylinders in `scripts/ecad-models.ts`, sized from each
footprint's pads and fabrication outline. They are original ECAD work under the
repository's MIT license.

- `Potentiometer_Bourns_3386P_Vertical`
- `QFN-48-1EP_6x6mm_P0.4mm_EP4.6x4.6mm`
- `QFN-60-1EP_7x7mm_P0.4mm_EP3.4x3.4mm`
- `QFN-80-1EP_10x10mm_P0.4mm_EP3.4x3.4mm`
- `USB_Micro-B_Molex-105017-0001`
