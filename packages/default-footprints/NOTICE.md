# Footprint attribution

This collection adapts footprints by the KiCad library contributors from
https://gitlab.com/kicad/libraries/kicad-footprints at commit
`a0dcd398e7ea4b00cdeb91efc35f09cceaa9097d`.

Upstream source files are available at
https://gitlab.com/kicad/libraries/kicad-footprints/-/tree/a0dcd398e7ea4b00cdeb91efc35f09cceaa9097d.
The KiCad library license is included in LICENSE.md. The full CC BY-SA 4.0 text
is included in CC-BY-SA-4.0.txt. The electronic-design exception is retained.

ECAD modifications flip the Y axis, store rotations in radians, draw rounded
rectangle and oval pads as rectangles (or circles when an oval is round), split
custom pads into rectangles that share the pad number, approximate arcs with
lines, draw pin 1 markers as triangles and other polygons as outlines, link a
model from ECAD's 3D model library in place of KiCad's model path, and omit
text, solder mask openings, and the User.Drawings layer. Separate
paste openings over exposed pads become filled rectangles on the paste layer.

The source footprints are:

- `Resistor_SMD:R_0402_1005Metric`
- `Resistor_SMD:R_0603_1608Metric`
- `Resistor_SMD:R_0805_2012Metric`
- `Resistor_SMD:R_1206_3216Metric`
- `Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal`
- `Capacitor_SMD:C_0402_1005Metric`
- `Capacitor_SMD:C_0603_1608Metric`
- `Capacitor_SMD:C_0805_2012Metric`
- `Capacitor_SMD:C_1206_3216Metric`
- `Capacitor_SMD:CP_Elec_6.3x5.4`
- `Capacitor_SMD:C_Trimmer_Murata_TZB4-A`
- `Capacitor_THT:CP_Radial_D5.0mm_P2.00mm`
- `Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P5.00mm`
- `Inductor_SMD:L_0603_1608Metric`
- `Inductor_SMD:L_0805_2012Metric`
- `Inductor_SMD:L_1206_3216Metric`
- `Fuse:Fuse_1206_3216Metric`
- `Potentiometer_THT:Potentiometer_Bourns_3386P_Vertical`
- `OptoDevice:R_LDR_5.1x4.3mm_P3.4mm_Vertical`
- `Crystal:Crystal_HC49-U_Vertical`
- `Crystal:Crystal_SMD_3215-2Pin_3.2x1.5mm`
- `Diode_SMD:D_SOD-123`
- `Diode_SMD:D_SOD-323`
- `Diode_SMD:D_SMA`
- `Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal`
- `LED_SMD:LED_0603_1608Metric`
- `LED_SMD:LED_0805_2012Metric`
- `LED_THT:LED_D3.0mm`
- `LED_THT:LED_D5.0mm`
- `Package_TO_SOT_SMD:SOT-23`
- `Package_TO_SOT_SMD:SOT-23-5`
- `Package_TO_SOT_SMD:SOT-89-3`
- `Package_TO_SOT_SMD:SOT-223-3_TabPin2`
- `Package_TO_SOT_THT:TO-92_Inline`
- `Package_TO_SOT_THT:TO-220-3_Vertical`
- `Button_Switch_THT:SW_PUSH_6mm`
- `Button_Switch_THT:SW_DIP_SPSTx01_Slide_9.78x4.72mm_W7.62mm_P2.54mm`
- `Button_Switch_THT:SW_Slide_SPDT_Straight_CK_OS102011MS2Q`
- `Battery:BatteryHolder_Keystone_3034_1x20mm`
- `Battery:BatteryHolder_Keystone_1060_1x2032`
- `Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical`
- `Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical`
- `Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical`
- `Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical`
- `Buzzer_Beeper:Buzzer_12x9.5RM7.6`
- `Package_DFN_QFN:QFN-16-1EP_4x4mm_P0.65mm_EP2.1x2.1mm`
- `Package_DFN_QFN:QFN-40-1EP_5x5mm_P0.4mm_EP3.6x3.6mm`
- `Package_DFN_QFN:QFN-48-1EP_6x6mm_P0.4mm_EP4.6x4.6mm`
- `Package_DFN_QFN:VQFN-52-1EP_6x6mm_P0.4mm_EP4.7x4.7mm`
- `Package_DFN_QFN:QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm`
- `Package_DFN_QFN:QFN-60-1EP_7x7mm_P0.4mm_EP3.4x3.4mm`
- `Package_DFN_QFN:QFN-80-1EP_10x10mm_P0.4mm_EP3.4x3.4mm`
- `Package_SO:SOIC-8_5.23x5.23mm_P1.27mm`
- `Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm`
- `Connector_USB:USB_Micro-B_Molex-105017-0001`
- `Connector_PinHeader_2.54mm:PinHeader_1x20_P2.54mm_Vertical`

The USB Micro-B receptacle's oval shell holes are round drills here, the
smallest dimension of each oval.

## Raspberry Pi minimal design footprints

`src/raspberry-pi-minimal.ts` adapts six land patterns from Raspberry Pi's
RPI-RP2350A-MINIMAL R4 board, `RPI-RP2350A-MINIMAL_R4-S1.kicad_pcb` in
https://datasheets.raspberrypi.com/rp2350/Minimal-KiCAD.zip, downloaded on
2026-11-15. They are under the MIT license below, not CC BY-SA 4.0. The
conversion is the same as for the KiCad footprints. The USB receptacle's
custom shell pads become two rectangles each.

- `RPI_COMPILED:amphenol_10103594-0001lf` as `USB_Micro-B_Amphenol_10103594-0001LF`
- `RPI_COMPILED:samtec_tsw-118-07-l-d` as `PinHeader_2x18_Samtec_TSW-118-07-L-D`
- `RPI_COMPILED:jst_sm03b-srss-tb-lf--sn-` as `JST_SH_SM03B-SRSS-TB_1x03-1MP_P1.00mm_Horizontal`
- `RPI_COMPILED:wurthelek_434133025816` as `SW_Push_1P1T_NO_Wuerth_434133025816`
- `RPI_COMPILED:onsemi_ncp1117st33t3g` as `SOT-223-3_TabPin4`
- `RPI_COMPILED:abracon_aota-b201610s3r3-101-t` as `L_Abracon_AOTA-B201610`

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

Raspberry Pi provides the design for guidance only and without guarantee. Check
the land patterns against the manufacturers' drawings before ordering boards.
