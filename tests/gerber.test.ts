import assert from 'node:assert/strict'
import test from 'node:test'
import { demoFiles } from './fixtures/demo-gerbers'
import { GERBER_SPEC_REVISION, gerberParser, parseGerber } from '#/formats/gerber/index.ts'
import { evaluateExpression } from '#/formats/gerber/macros.ts'

const header='%FSLAX46Y46*%\n%MOMM*%\n'
const parse=(body:string)=>parseGerber(header+body+'\nM02*','test.gbr')
const clean=(body:string)=> { const result=parse(body);assert.deepEqual(result.diagnostics,[]);return result.object }
const close=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`)

test('declares the latest Gerber specification and detects common extensions by content',()=> {
  assert.equal(GERBER_SPEC_REVISION,'2026.05')
  assert.equal(gerberParser.detect(header,'unknown.txt'),true)
  assert.equal(gerberParser.detect('plain text','notes.txt'),false)
  assert.equal(gerberParser.detect('M48\nMETRIC,TZ\nT01C0.8\n%\nT01\nX1Y1\nM30','drill.drl'),false)
})

test('returns a planar scene object with parse metadata',()=> {
  const result=parse('%ADD10C,1*%D10*X0Y0D03*')
  assert.equal(result.object.type,'planar')
  assert.equal(result.object.name,'test.gbr')
  assert.equal(result.object.objects.length,1)
  assert.equal(result.units,'mm')
  assert.equal(result.format,'Gerber RS-274X')
  assert.deepEqual(result.diagnostics,[])
  assert.equal('layer' in result,false)
})

test('normalizes flashes and modal coordinates to millimetres',()=> {
  const layer=clean('%ADD10C,0.8*%\nD10*\nX12500000Y-2000000D03*\nY3000000D03*')
  assert.equal(layer.objects.length,2)
  assert.deepEqual(layer.objects[0].geometry,{type:'circle',x:0,y:0,radius:0.4})
  assert.deepEqual(layer.objects[0].transform,[1,0,0,1,12.5,-2])
  assert.deepEqual(layer.objects[1].bounds,{minX:12.1,minY:2.6,maxX:12.9,maxY:3.4})
})

test('normalizes inch coordinates, aperture sizes and bounds',()=> {
  const result=parseGerber('%FSLAX25Y25*%%MOIN*%%ADD10R,0.1X0.2*%D10*X100000Y200000D03*M02*','inch.gbr')
  assert.deepEqual(result.diagnostics,[])
  assert.equal(result.units,'in')
  const object=result.object.objects[0]
  close(object.transform![4],25.4);close(object.transform![5],50.8)
  assert.equal(object.geometry.type,'rect')
  if(object.geometry.type==='rect') { close(object.geometry.width,2.54);close(object.geometry.height,5.08) }
})

test('supports legacy trailing zero suppression and incremental coordinates with a warning',()=> {
  const result=parseGerber('%FSTIX24Y24*%%MOMM*%%ADD10C,1*%D10*X01Y02D03*X005Y-005D03*M02*','legacy.gbr')
  assert.equal(result.diagnostics.filter(d=>d.severity==='error').length,0)
  assert.ok(result.diagnostics.some(d=>d.message.includes('incremental')))
  close(result.object.objects[0].transform![4],1);close(result.object.objects[0].transform![5],2)
  close(result.object.objects[1].transform![4],1.5);close(result.object.objects[1].transform![5],1.5)
})

test('X3 component metadata survives scoped attribute deletion and decodes escapes',()=> {
  const result=parse(`%TF.FileFunction,Component,L1,Top*%
%TA.AperFunction,ComponentMain*%
%ADD10C,0.3*%
%TD*%
D10*
%TO.C,U1*%
%TO.CRot,90*%
%TO.CMfr,Acme\\u002C Inc*%
%TO.CMPN,MCU-42*%
%TO.CVal,\\u03A9 10k*%
%TO.CFtp,QFN-32*%
%TO.CMnt,Pressfit*%
X10000000Y12000000D03*
%TD.CVal*%
%TO.C,U2*%
X20000000Y12000000D03*
%TD*%`)
  assert.deepEqual(result.diagnostics,[])
  assert.equal(result.format,'Gerber X3')
  assert.deepEqual(result.object.metadata['.FileFunction'],['Component','L1','Top'])
  assert.deepEqual(result.object.objects[0].attributes,{'.AperFunction':['ComponentMain'],'.C':['U1'],'.CRot':['90'],'.CMfr':['Acme, Inc'],'.CMPN':['MCU-42'],'.CVal':['Ω 10k'],'.CFtp':['QFN-32'],'.CMnt':['Pressfit']})
  assert.equal(result.object.objects[1].attributes['.CVal'],undefined)
  assert.deepEqual(result.object.objects[1].attributes['.C'],['U2'])
})

test('comment attributes have the same semantics as extended attributes',()=> {
  const layer=clean('G04 #@! TF.FileFunction,Copper,L1,Top*\nG04 #@! TA.AperFunction,SMDPad,CuDef*\n%ADD10C,1*%\nD10*\nG04 #@! TO.P,U1,2*\nX0Y0D03*')
  assert.deepEqual(layer.metadata['.FileFunction'],['Copper','L1','Top'])
  assert.deepEqual(layer.objects[0].attributes['.P'],['U1','2'])
  assert.deepEqual(layer.objects[0].attributes['.AperFunction'],['SMDPad','CuDef'])
})

test('file attributes are immutable and TD cannot delete them',()=> {
  const result=parse('%TF.Part,Single*%%TD.Part*%%TF.Part,Array*%')
  assert.deepEqual(result.object.metadata['.Part'],['Single'])
  assert.ok(result.diagnostics.some(d=>d.severity==='error' && d.message.includes('immutable')))
})

test('preserves unknown user attributes without assigning them geometry semantics',()=> {
  const layer=clean('%TFVendorMetadata,board42*%%TAFinish,gold*%%ADD10C,1*%%TOAssemblyNote,populate*%D10*X0Y0D03*')
  assert.deepEqual(layer.metadata.VendorMetadata,['board42'])
  assert.deepEqual(layer.objects[0].attributes,{Finish:['gold'],AssemblyNote:['populate']})
})

test('standard aperture holes are isolated transparent geometry and layer polarity stays separate',()=> {
  const layer=clean('%ADD10C,4X2*%%ADD11R,3X2X1*%%ADD12O,3X2*%%ADD13P,4X6X30X1*%D10*X0Y0D03*D11*X5000000Y0D03*D12*X10000000Y0D03*%LPC*%D13*X15000000Y0D03*')
  assert.equal(layer.objects.length,4)
  for(const i of [0,1,3]) {
    const geometry=layer.objects[i].geometry
    assert.equal(geometry.type,'group')
    if(geometry.type==='group') assert.deepEqual(geometry.children.map(child=>child.polarity),['dark','clear'])
  }
  assert.equal(layer.objects[3].polarity,'clear')
  assert.equal(layer.objects[2].geometry.type,'path')
})

test('aperture transforms apply mirror, rotation, scale, then flash translation',()=> {
  const layer=clean('%AMOffCenter*1,1,2,3,0*%%ADD10OffCenter*%%LMX*%%LR90*%%LS2*%D10*X10000000Y20000000D03*')
  const object=layer.objects[0],m=object.transform!
  close(m[0],0);close(m[1],-2);close(m[2],-2);close(m[3],0);close(m[4],10);close(m[5],20)
  close(object.bounds.minX,8);close(object.bounds.maxX,12);close(object.bounds.minY,12);close(object.bounds.maxY,16)
})

test('aperture transformations do not rotate draw centerlines',()=> {
  const layer=clean('%ADD10C,1*%%LR90*%%LS2*%D10*X0Y0D02*X10000000Y0D01*')
  assert.deepEqual(layer.objects[0].geometry,{type:'path',d:'M0 0 L10 0',fill:false,strokeWidth:2})
  assert.deepEqual(layer.objects[0].bounds,{minX:-1,minY:-1,maxX:11,maxY:1})
})

test('clockwise and counterclockwise arcs preserve sweep and exact bounds',()=> {
  const layer=clean('%ADD10C,0.2*%D10*G75*X1000000Y0D02*G03*X0Y1000000I-1000000J0D01*G02*X1000000Y0I0J-1000000D01*')
  const [ccw,cw]=layer.objects
  assert.equal(ccw.geometry.type,'path');assert.equal(cw.geometry.type,'path')
  if(ccw.geometry.type==='path' && cw.geometry.type==='path') { assert.match(ccw.geometry.d,/A1 1 0 0 1 /);assert.match(cw.geometry.d,/A1 1 0 0 0 /) }
  close(ccw.bounds.minX,-0.1);close(ccw.bounds.minY,-0.1);close(ccw.bounds.maxX,1.1);close(ccw.bounds.maxY,1.1)
})

test('full circles are two SVG arcs instead of a zero-length arc',()=> {
  const layer=clean('%ADD10C,0.2*%D10*G75*X1000000Y0D02*G03*I-1000000J0D01*')
  const object=layer.objects[0]
  assert.equal(object.geometry.type,'path')
  if(object.geometry.type==='path') assert.equal((object.geometry.d.match(/ A/g)??[]).length,2)
  close(object.bounds.minX,-1.1);close(object.bounds.minY,-1.1);close(object.bounds.maxX,1.1);close(object.bounds.maxY,1.1)
})

test('single-quadrant arcs find the center from unsigned offsets',()=> {
  const result=parse('%ADD10C,0.2*%D10*G74*X1000000Y0D02*G03*X0Y1000000I1000000J0D01*')
  assert.equal(result.diagnostics.filter(d=>d.severity==='error').length,0)
  const object=result.object.objects[0]
  close(object.bounds.minX,-0.1);close(object.bounds.minY,-0.1);close(object.bounds.maxX,1.1)
})

test('a region unions separate contours and uses current TA attributes, not selected aperture attributes',()=> {
  const layer=clean(`%TA.AperFunction,ViaPad*%%ADD10C,1*%D10*%TA.AperFunction,Conductor*%
G36*X0Y0D02*X4000000Y0D01*X4000000Y4000000D01*X0Y4000000D01*X0Y0D01*
X1000000Y1000000D02*X2000000Y1000000D01*X2000000Y2000000D01*X1000000Y2000000D01*X1000000Y1000000D01*G37*`)
  assert.equal(layer.objects.length,1)
  assert.deepEqual(layer.objects[0].attributes['.AperFunction'],['Conductor'])
  const geometry=layer.objects[0].geometry
  assert.equal(geometry.type,'group')
  if(geometry.type==='group') { assert.equal(geometry.children.length,2);assert.ok(geometry.children.every(child=>child.polarity==='dark')) }
})

test('step and repeat copies complete ordered blocks, Y first, and resets current point',()=> {
  const layer=clean('%ADD10C,1*%D10*%SRX2Y2I10J20*%X0Y0D03*%LPC*%X1000000Y0D03*%SR*%')
  assert.equal(layer.objects.length,8)
  assert.deepEqual(layer.objects.map(object=>object.polarity),['dark','clear','dark','clear','dark','clear','dark','clear'])
  assert.deepEqual(layer.objects.map(object=>object.transform!.slice(4)),[[0,0],[1,0],[0,20],[1,20],[10,0],[11,0],[10,20],[11,20]])
  const result=parse('%ADD10C,1*%D10*%SRX1Y1I0J0*%X0Y0D03*%SR*%X1000000D03*')
  assert.ok(result.diagnostics.some(d=>d.message.includes('current point is undefined')))
})

test('AB expands dark and clear objects and toggles each polarity at LPC flash',()=> {
  const layer=clean('%ADD10C,2*%D10*%ABD20*%X0Y0D03*%LPC*%X1000000Y0D03*%AB*%D20*X10000000Y0D03*')
  assert.equal(layer.objects.length,2)
  assert.deepEqual(layer.objects.map(object=>object.polarity),['clear','dark'])
  assert.deepEqual(layer.objects.map(object=>object.transform!.slice(4)),[[10,0],[11,0]])
})

test('nested AB preserves defined apertures and graphics state instead of restoring a stack',()=> {
  const layer=clean('%ADD10C,2*%D10*%ABD20*%%ABD21*%X0Y0D03*%AB*%D21*X1000000Y0D03*%AB*%D20*%LR90*%X10000000Y0D03*D21*X20000000Y0D03*')
  assert.equal(layer.objects.length,2)
  close(layer.objects[0].transform![4],10);close(layer.objects[0].transform![5],1)
  close(layer.objects[1].transform![4],20);close(layer.objects[1].transform![5],0)
})

test('safe macro arithmetic handles precedence, signs, variables and assignments',()=> {
  assert.equal(evaluateExpression('-($1+2)x3/2+$9',new Map([[1,4]])),-9)
  assert.equal(evaluateExpression('1--2',new Map()),3)
  assert.throws(()=>evaluateExpression('globalThis.process.exit()',new Map()),/Invalid macro expression/)
  assert.throws(()=>evaluateExpression('1/0',new Map()),/Invalid macro expression/)
  const layer=clean('%AMCalculated*$2=$1/2*1,1,$2,0,0*1,0,$2/2,0,0*%%ADD10Calculated,4*%D10*X0Y0D03*')
  close(layer.bounds.minX,-1);close(layer.bounds.maxX,1)
})

test('all current macro primitives and overlapping thermal exposure are supported',()=> {
  const layer=clean(`%AMAll*
1,1,1,0,0,0*
20,1,1,0,0,2,0,30*
21,1,3,2,0,0,90*
4,1,3,0,0,2,0,1,1,0,0,45*
5,1,6,0,0,3,30*
7,0,0,4,2,0.5,45*%
%ADD10All*%D10*X0Y0D03*`)
  const geometry=layer.objects[0].geometry
  assert.equal(geometry.type,'group')
  if(geometry.type==='group') {
    assert.equal(geometry.children.length,6)
    assert.ok(geometry.children.every(child=>child.polarity==='dark'))
    assert.equal(geometry.children[5].geometry.type,'group')
  }
})

test('macro primitive rotation is around the macro origin',()=> {
  const layer=clean('%AMOffset*21,1,2,1,3,0,90*%%ADD10Offset*%D10*X0Y0D03*')
  close(layer.bounds.minX,-0.5);close(layer.bounds.maxX,0.5);close(layer.bounds.minY,2);close(layer.bounds.maxY,4)
})

test('unsupported macro geometry and malformed files produce explicit errors',()=> {
  const result=parse('%AMBad*99,1,2*%%ADD10Bad*%D10*X0Y0D03*')
  assert.equal(result.object.objects.length,0)
  assert.ok(result.diagnostics.some(d=>d.severity==='error' && d.message.includes('Unsupported aperture macro primitive 99')))
  const truncated=parseGerber(header+'%ADD10C,1*%D10*X0Y0D03*','truncated.gbr')
  assert.ok(truncated.diagnostics.some(d=>d.message.includes('Missing M02')))
  const unsupported=parse('%IPNEG*%')
  assert.ok(unsupported.diagnostics.some(d=>d.severity==='error' && d.message.includes('IPNEG')))
})

test('rejects non-circular modern draws without approximating their aperture as a circle',()=> {
  const result=parse('%ADD10P,2X6*%D10*X0Y0D02*X1000000Y1000000D01*')
  assert.equal(result.object.objects.length,0)
  assert.ok(result.diagnostics.some(d=>d.severity==='error' && d.message.includes('modern Gerber draws require')))
})

test('legacy rectangular draws sweep a fixed rectangle, including diagonal strokes',()=> {
  const result=parse('%ADD10R,2X1*%D10*X0Y0D02*X1000000Y1000000D01*')
  assert.equal(result.diagnostics.filter(d=>d.severity==='error').length,0)
  assert.deepEqual(result.object.bounds,{minX:-1,minY:-0.5,maxX:2,maxY:1.5})
  assert.equal(result.object.objects[0].geometry.type,'path')
})

test('rejects unclosed regions, unmatched blocks, invalid holes and excessive repeats',()=> {
  for(const body of ['G36*X0Y0D02*X1000000Y0D01*','%AB*%','%ADD10C,1X2*%','%SRX999999999Y2I1J1*%']) {
    const result=parse(body)
    assert.ok(result.diagnostics.some(d=>d.severity==='error'),body)
  }
})

test('diagnostic line numbers identify malformed commands',()=> {
  const result=parseGerber('%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,1*%\nD10*\nG99*\nM02*')
  assert.deepEqual(result.diagnostics,[{severity:'error',message:'Unsupported G-code G99',line:5}])
})

test('all six bundled demo layers parse without warnings or errors',()=> {
  assert.equal(demoFiles.length,6)
  for(const file of demoFiles) {
    const result=parseGerber(file.source,file.name)
    assert.deepEqual(result.diagnostics,[],file.name)
    assert.ok(result.object.objects.length>0,file.name)
    assert.ok(result.object.bounds.maxX>result.object.bounds.minX,file.name)
  }
  assert.equal(parseGerber(demoFiles[5].source,demoFiles[5].name).format,'Gerber X3')
})
