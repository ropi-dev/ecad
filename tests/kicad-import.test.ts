import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { importKiCadSchematic } from '#/formats/kicad/import.ts';
import { parseSExpr, nodes, node } from '#/formats/kicad/sexpr.ts';
import { symbolTextShapes } from '#/drawing/shapes.ts';
import { validateProjectDocument } from '#/projects/format.ts';

const source = readFileSync(new URL('./fixtures/kicad/RPI-RP2350A-MINIMAL_R4-S1.kicad_sch',import.meta.url),'utf8');

test('RP2350A imports all instances, terminal positions, values, wires and visible labels', () => {
 const result = importKiCadSchematic(source);
 const symbols = result.shapes.filter(s=>s.kind==='symbol');
 assert.equal(symbols.length,87);
 const expected = JSON.parse(readFileSync(new URL('./fixtures/kicad/pins.json',import.meta.url),'utf8'));
 const actual = symbols.flatMap(s=>s.children.filter(c=>c.kind==='pin').map(p=>({reference:s.attributes.reference,number:p.number,name:p.name,x:Number((s.x+p.x).toFixed(6)),y:Number((s.y+p.y).toFixed(6))})));
 assert.equal(actual.length,272);
 assert.deepEqual(actual,expected);
 assert.equal(new Set(actual.filter(p=>p.reference==='U1').map(p=>p.number)).size,61);
 const root = parseSExpr(source);
 assert.deepEqual(symbols.map(s=>[s.attributes.reference,s.attributes.value]),result.report.components.map(c=>[c.properties.Reference,c.properties.Value]));
 const wires = result.shapes.filter(s=>s.kind==='wire');
 assert.equal(wires.length,346);
 for(const [i,wire] of nodes(root,'wire').entries()) {
  const expected = nodes(node(wire,'pts'),'xy').map(p=>({x:Number(p[1])-210,y:148.5-Number(p[2])}));
  const w = wires[i]; const ends = [-1,1].map(sign=>({x:w.x+sign*Math.cos(w.rotation)*w.width/2,y:w.y+sign*Math.sin(w.rotation)*w.width/2}));
  for(let j=0;j<2;j++) {assert.ok(Math.abs(ends[j].x-expected[j].x)<1e-8);assert.ok(Math.abs(ends[j].y-expected[j].y)<1e-8);}
 }
 assert.equal(result.report.labels.length,94);
 assert.equal(result.shapes.filter(s=>s.kind==='circle').length,83);
 assert.ok(result.report.warnings.some(w=>w.includes('embedded_files')));
 assert.ok(result.report.metadata.some(n=>n[0]==='lib_symbols'));
 assert.equal(validateProjectDocument({shapes:result.shapes,symbols:[]}).shapes.length,622);
});

const fixture = (extra: string, at='10 20 0', mirror='') => `(kicad_sch (version 20250114) (paper "A4") (lib_symbols (symbol "Test" (symbol "Test_1_1" (pin input line (at 2 3 0) (length 2) (name "IN") (number "01"))))) (symbol (lib_id "Test") (at ${at}) ${mirror} (unit 1) (uuid "test") (property "Reference" "X1" (at 10 20 0) (effects hide))) ${extra})`;
test('rotation and mirrors preserve terminal positions and lead directions', () => {
 for(const angle of [0,90,180,270]) for(const mirror of ['', 'x','y']) {
  const r=importKiCadSchematic(fixture('',`10 20 ${angle}`,mirror?`(mirror ${mirror})`:''));
  const s=r.shapes[0]; assert.equal(s.kind,'symbol');if(s.kind!=='symbol') return;
  const p=s.children.find(c=>c.kind==='pin')!;
  const x=mirror==='y'?-2:2,y=mirror==='x'?-3:3,a=angle*Math.PI/180;
  assert.ok(Math.abs(p.x-(Math.cos(a)*x-Math.sin(a)*y))<1e-9);
  assert.ok(Math.abs(p.y-(Math.sin(a)*x+Math.cos(a)*y))<1e-9);
  assert.equal(p.kind==='pin'&&p.number,'01');
 }
});
test('unsupported constructs produce reports and broken documents fail without partial results', () => {
 assert.ok(importKiCadSchematic(fixture('(sheet (uuid "child"))')).report.warnings.some(w=>w.includes('sheet')));
 for(const s of ['(kicad_sch','(kicad_sch))','(other)','(kicad_sch) trailing',fixture('').replace('(lib_id "Test")','(lib_id "Missing")')]) assert.throws(()=>importKiCadSchematic(s));
 assert.equal(parseSExpr('(text "hello\\n\\\"world\\\"")')[1],'hello\n"world"');
});


test('rotated reference and value labels stay bound after edits and serialization', () => {
 const input = fixture('').replace('(property "Reference" "X1" (at 10 20 0) (effects hide))', '(property "Reference" "U1" (at 12 18 90)) (property "Value" "Original" (at 14 18 90))');
 const symbol = importKiCadSchematic(input).shapes[0];
 assert.equal(symbol.kind,'symbol'); if(symbol.kind!=='symbol') return;
 assert.equal(symbol.children.filter(child=>child.kind==='text'&&['U1','Original'].includes(child.text)).length,0);
 const updated = {...symbol,attributes:{...symbol.attributes,reference:'U2',value:'Changed'}};
 const saved = validateProjectDocument(JSON.parse(JSON.stringify({shapes:[updated],symbols:[]}))).shapes[0];
 assert.equal(saved.kind,'symbol'); if(saved.kind!=='symbol') return;
 const labels = symbolTextShapes(saved);
 assert.deepEqual(labels.map(label=>label.text),['U2','Changed']);
 assert.deepEqual(labels.map(label=>label.rotation),[Math.PI/2,Math.PI/2]);
 assert.deepEqual(labels.map(label=>({x:label.x,y:label.y})),[{x:12-148.5,y:105-18},{x:14-148.5,y:105-18}]);
});
