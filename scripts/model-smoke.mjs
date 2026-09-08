import { Box3, BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

import {
  BUILD_PLATE_CHAMFER,
  buildHolderModel,
  depthForStickerCapacity,
  disposeHolderModel,
  LID_HEIGHT,
  LID_PLUG_HEIGHT,
  LOGO_LAYER_HEIGHT,
  makeLogoModifierExportModel,
  makePrintableExportModel,
  OUTER_WIDTH,
  stickerStackHeight,
} from '../lib/holder-model.ts';

const cases = [
  { name: '50-sticker engraved set', depth: depthForStickerCapacity(50), cellWidth: 3.9, embossed: false, texture: true, part: 'both' },
  { name: '100-sticker maximum-detail body', depth: depthForStickerCapacity(100), cellWidth: 1.8, embossed: true, texture: true, part: 'body' },
  { name: '25-sticker plain body', depth: depthForStickerCapacity(25), cellWidth: 8, embossed: false, texture: false, part: 'body' },
  { name: '100-sticker lid', depth: depthForStickerCapacity(100), cellWidth: 3.9, embossed: false, texture: true, part: 'lid' },
];

function validateGeometry(name, geometry) {
  const checked = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = checked.getAttribute('position');
  if (!position || position.count < 3) throw new Error(`${name} has no triangles.`);
  const edges = new Map();
  let signedVolume = 0;
  const vertexKey = (index) => [position.getX(index), position.getY(index), position.getZ(index)]
    .map((value) => Math.round(value * 100_000))
    .join(',');
  for (let index = 0; index < position.count; index += 1) {
    if (![position.getX(index), position.getY(index), position.getZ(index)].every(Number.isFinite)) {
      throw new Error(`${name} contains a non-finite vertex.`);
    }
  }
  for (let index = 0; index < position.count; index += 3) {
    const ax = position.getX(index);
    const ay = position.getY(index);
    const az = position.getZ(index);
    const bx = position.getX(index + 1);
    const by = position.getY(index + 1);
    const bz = position.getZ(index + 1);
    const cx = position.getX(index + 2);
    const cy = position.getY(index + 2);
    const cz = position.getZ(index + 2);
    signedVolume += (
      ax * (by * cz - bz * cy)
      - ay * (bx * cz - bz * cx)
      + az * (bx * cy - by * cx)
    ) / 6;

    const triangle = [vertexKey(index), vertexKey(index + 1), vertexKey(index + 2)];
    for (const [start, end] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
      const key = start < end ? `${start}|${end}` : `${end}|${start}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const openEdges = [...edges.values()].filter((count) => count !== 2).length;
  if (openEdges) throw new Error(`${name} is not watertight (${openEdges} unmatched edges).`);
  if (signedVolume <= 0.001) throw new Error(`${name} has inverted or degenerate face winding.`);
  if (checked !== geometry) checked.dispose();
}

function flatToFlatAtY(mesh, y) {
  const position = mesh.geometry.getAttribute('position');
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < position.count; index += 1) {
    if (Math.abs(position.getY(index) - y) > 0.0001) continue;
    minimum = Math.min(minimum, position.getX(index));
    maximum = Math.max(maximum, position.getX(index));
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new Error(`${mesh.name} has no perimeter at y=${y}.`);
  }
  return maximum - minimum;
}

for (const testCase of cases) {
  const model = buildHolderModel(testCase, { arrangement: 'print', preview: false });
  let meshes = 0;
  let sourceTriangles = 0;
  model.traverse((object) => {
    if (!object.isMesh) return;
    meshes += 1;
    validateGeometry(`${testCase.name}/${object.name || `mesh-${meshes}`}`, object.geometry);
    const position = object.geometry.getAttribute('position');
    sourceTriangles += object.geometry.index ? object.geometry.index.count / 3 : position.count / 3;
  });
  if (meshes === 0 || sourceTriangles === 0) throw new Error(`${testCase.name} produced an empty model.`);

  const printableModel = makePrintableExportModel(model);
  const printableMeshes = [];
  printableModel.traverse((object) => {
    if (object instanceof Mesh) printableMeshes.push(object);
  });
  const expectedMeshCount = testCase.part === 'both' ? 2 : 1;
  if (printableMeshes.length !== expectedMeshCount) {
    throw new Error(`${testCase.name} exported ${printableMeshes.length} meshes instead of ${expectedMeshCount}.`);
  }

  printableModel.rotation.x = Math.PI / 2;
  printableModel.updateMatrixWorld(true);
  const stl = new STLExporter().parse(printableModel, { binary: true });
  const exportedTriangles = stl.getUint32(80, true);
  if (stl.byteLength !== 84 + exportedTriangles * 50) throw new Error(`${testCase.name} produced a malformed binary STL.`);
  if (exportedTriangles !== sourceTriangles) throw new Error(`${testCase.name} lost triangles during export.`);

  console.log(`${testCase.name}: ${printableMeshes.length} printable meshes, ${exportedTriangles.toLocaleString()} triangles, ${(stl.byteLength / 1024).toFixed(0)} KB`);
  disposeHolderModel(printableModel);
  disposeHolderModel(model);
}

const lidSizes = [25, 100].map((capacity) => {
  const model = buildHolderModel({
    depth: depthForStickerCapacity(capacity),
    cellWidth: 3.9,
    embossed: false,
    texture: true,
    part: 'lid',
  });
  const size = new Box3().setFromObject(model).getSize(new Vector3());
  disposeHolderModel(model);
  return size;
});

for (const axis of ['x', 'y', 'z']) {
  if (Math.abs(lidSizes[0][axis] - lidSizes[1][axis]) > 0.0001) {
    throw new Error(`Lid ${axis}-dimension changes with sticker capacity.`);
  }
}

if (Math.abs(lidSizes[0].y - LID_HEIGHT) > 0.0001) {
  throw new Error(`Lid height is ${lidSizes[0].y} mm instead of ${LID_HEIGHT} mm.`);
}

for (const capacity of [25, 50, 75, 100]) {
  const usableDepth = depthForStickerCapacity(capacity) - LID_PLUG_HEIGHT;
  if (Math.abs(usableDepth - stickerStackHeight(capacity)) > 0.0001) {
    throw new Error(`${capacity}-sticker body does not preserve the requested sticker space.`);
  }
}

console.log('6 mm fixed lid dimensions and sticker-space allowance verified');

const chamferModel = buildHolderModel({
  depth: depthForStickerCapacity(25),
  cellWidth: 3.9,
  embossed: false,
  texture: false,
  part: 'both',
}, { arrangement: 'print', preview: false });
const chamferedBody = chamferModel.getObjectByName('body-core');
const chamferedLid = chamferModel.getObjectByName('lid-flange');
if (!(chamferedBody instanceof Mesh) || !(chamferedLid instanceof Mesh)) {
  throw new Error('Build-plate chamfer is missing a holder or lid perimeter.');
}
const bedWidth = OUTER_WIDTH - BUILD_PLATE_CHAMFER * 2;
for (const mesh of [chamferedBody, chamferedLid]) {
  if (Math.abs(flatToFlatAtY(mesh, 0) - bedWidth) > 0.0001) {
    throw new Error(`${mesh.name} does not inset the build-plate edge by ${BUILD_PLATE_CHAMFER} mm.`);
  }
  if (Math.abs(flatToFlatAtY(mesh, BUILD_PLATE_CHAMFER) - OUTER_WIDTH) > 0.0001) {
    throw new Error(`${mesh.name} does not return to the specified outer width above the chamfer.`);
  }
}
disposeHolderModel(chamferModel);

const texturedChamferModel = buildHolderModel({
  depth: depthForStickerCapacity(25),
  cellWidth: 3.9,
  embossed: false,
  texture: true,
  part: 'body',
}, { arrangement: 'print', preview: false });
let lowestEngravedSkin = Infinity;
texturedChamferModel.traverse((object) => {
  if (!(object instanceof Mesh) || object.name !== 'engraved-honeycomb-ridges') return;
  const positions = object.geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index += 1) lowestEngravedSkin = Math.min(lowestEngravedSkin, positions.getY(index));
});
if (Math.abs(lowestEngravedSkin - BUILD_PLATE_CHAMFER) > 0.0001) {
  throw new Error('The engraved honeycomb skin obscures the body build-plate chamfer.');
}
disposeHolderModel(texturedChamferModel);
console.log('0.6 mm build-plate chamfers verified');

const transformedLogoModel = buildHolderModel({
  depth: depthForStickerCapacity(50),
  cellWidth: 3.9,
  embossed: false,
  texture: false,
  part: 'both',
});
const transformedLid = transformedLogoModel.getObjectByName('holder-lid');
if (!transformedLid) throw new Error('Logo transform test is missing the lid.');
const logoTransform = new Group();
logoTransform.name = 'lid-svg-logo';
logoTransform.position.set(4.5, 0, -3.25);
logoTransform.scale.setScalar(1.7);
logoTransform.rotation.y = 0.42;
const sourceLogo = new Mesh(new BoxGeometry(2, LOGO_LAYER_HEIGHT, 1), new MeshBasicMaterial());
sourceLogo.name = 'lid-svg-modifier';
logoTransform.add(sourceLogo);
transformedLid.add(logoTransform);
transformedLogoModel.updateMatrixWorld(true);
const exportedLogoModel = makeLogoModifierExportModel(transformedLogoModel);
const exportedLogo = exportedLogoModel?.getObjectByName('lid-svg-modifier');
if (!(sourceLogo instanceof Mesh) || !(exportedLogo instanceof Mesh)) {
  throw new Error('SVG logo modifier export model was not created.');
}
sourceLogo.updateWorldMatrix(true, false);
exportedLogoModel.rotation.x = Math.PI / 2;
exportedLogoModel.updateMatrixWorld(true);
const expectedLogoMatrix = new Matrix4().makeRotationX(Math.PI / 2).multiply(sourceLogo.matrixWorld);
for (let index = 0; index < 16; index += 1) {
  if (Math.abs(exportedLogo.matrixWorld.elements[index] - expectedLogoMatrix.elements[index]) > 0.0001) {
    throw new Error('SVG modifier export does not preserve preview position, scale, and rotation.');
  }
}
disposeHolderModel(transformedLogoModel);
console.log('SVG modifier export transform verified');

if (typeof DOMParser === 'undefined') {
  console.log('SVG logo modifier test requires a browser DOM and is covered in preview QA');
} else {
  const logoModel = buildHolderModel({
    depth: depthForStickerCapacity(50),
    cellWidth: 3.9,
    embossed: false,
    texture: true,
    part: 'lid',
    logoSvg: '<svg viewBox="0 0 20 20"><path fill="#000" d="M2 2h16v16H2z"/></svg>',
    logoScale: 1,
    logoX: 0,
    logoZ: 0,
  });
  const logoModifier = logoModel.getObjectByName('lid-svg-modifier');
  if (!(logoModifier instanceof Mesh)) throw new Error('SVG logo modifier was not added to the lid.');
  logoModifier.geometry.computeBoundingBox();
  const logoBox = logoModifier.geometry.boundingBox;
  if (!logoBox) throw new Error('SVG logo modifier has no bounds.');
  const logoLayerHeight = logoBox.getSize(new Vector3()).y;
  if (Math.abs(logoLayerHeight - LOGO_LAYER_HEIGHT) > 0.0001) {
    throw new Error(`SVG logo layer is ${logoLayerHeight} mm instead of ${LOGO_LAYER_HEIGHT} mm.`);
  }
  disposeHolderModel(logoModel);
  console.log('SVG logo modifier layer verified');
}

const assembledModel = buildHolderModel({
  depth: depthForStickerCapacity(50),
  cellWidth: 3.9,
  embossed: false,
  texture: true,
  part: 'both',
}, { arrangement: 'assembled' });
const assembledBody = assembledModel.getObjectByName('holder-body');
const assembledLid = assembledModel.getObjectByName('holder-lid');
const assembledPlug = assembledModel.getObjectByName('lid-plug');
const assembledFlange = assembledModel.getObjectByName('lid-flange');
if (!assembledBody || !assembledLid || !assembledPlug || !assembledFlange) throw new Error('Assembly is missing a required part.');

const bodyBox = new Box3().setFromObject(assembledBody);
const lidBox = new Box3().setFromObject(assembledLid);
const plugBox = new Box3().setFromObject(assembledPlug);
const flangeBox = new Box3().setFromObject(assembledFlange);
const bodyCenter = bodyBox.getCenter(new Vector3());
const lidCenter = lidBox.getCenter(new Vector3());
if (Math.abs(bodyCenter.x - lidCenter.x) > 0.0001 || Math.abs(bodyCenter.z - lidCenter.z) > 0.0001) {
  throw new Error('Assembled lid is not centered over the body opening.');
}
if (Math.abs(flangeBox.min.y - bodyBox.max.y) > 0.0001) throw new Error('Assembled lid flange does not rest on the body rim.');
if (plugBox.min.y >= bodyBox.max.y) throw new Error('Assembled lid plug does not enter the opening.');
if (plugBox.min.y >= flangeBox.min.y) throw new Error('Assembled lid plug does not point down toward the opening.');
if (lidBox.max.y <= bodyBox.max.y) throw new Error('Assembled lid top is not above the body rim.');
disposeHolderModel(assembledModel);
console.log('assembled lid fit, alignment, and orientation verified');
