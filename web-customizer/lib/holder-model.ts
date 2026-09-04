import * as THREE from 'three';

export type HolderPart = 'body' | 'lid' | 'both';
export type HolderArrangement = 'print' | 'assembled';
export const STICKER_THICKNESS = 0.25;
export const STICKER_CAPACITIES = [25, 50, 75, 100] as const;
export type StickerCapacity = (typeof STICKER_CAPACITIES)[number];
export const LID_HEIGHT = 6;
export const LID_FLANGE_HEIGHT = 1.6;
export const LID_PLUG_HEIGHT = LID_HEIGHT - LID_FLANGE_HEIGHT;
const LID_TIP_CHAMFER = LID_PLUG_HEIGHT * 0.1;

export type HolderConfig = {
  depth: number;
  cellWidth: number;
  embossed: boolean;
  texture: boolean;
  part: HolderPart;
};

export const INSIDE_WIDTH = 46;
export const WALL = INSIDE_WIDTH * (1.5 / 45.3);
export const OUTER_WIDTH = INSIDE_WIDTH + 2 * WALL;
const OUTER_RADIUS = OUTER_WIDTH / Math.sqrt(3);
const OUTER_APOTHEM = OUTER_WIDTH / 2;
const EPSILON = 0.02;

type Point = THREE.Vector3;
type LoftLayer = { y: number; flatToFlat: number };

export function stickerStackHeight(capacity: StickerCapacity) {
  return capacity * STICKER_THICKNESS;
}

export function depthForStickerCapacity(capacity: StickerCapacity) {
  return stickerStackHeight(capacity) + LID_PLUG_HEIGHT;
}

export function holderMetrics(depth: number) {
  return {
    insideWidth: INSIDE_WIDTH,
    outerWidth: OUTER_WIDTH,
    wall: WALL,
    floor: depth * (1.8 / 30),
    height: depth + depth * (1.8 / 30),
  };
}

function hexLoop(flatToFlat: number, y: number) {
  const radius = flatToFlat / Math.sqrt(3);
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 6 + index * Math.PI / 3;
    return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  });
}

function triangleNormal(a: Point, b: Point, c: Point) {
  return new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
}

function pushTriangle(positions: number[], a: Point, b: Point, c: Point, outward: THREE.Vector3) {
  const normal = triangleNormal(a, b, c);
  const points = normal.dot(outward) >= 0 ? [a, b, c] : [a, c, b];
  for (const point of points) positions.push(point.x, point.y, point.z);
}

function pushQuad(positions: number[], a: Point, b: Point, c: Point, d: Point, outward: THREE.Vector3) {
  pushTriangle(positions, a, b, c, outward);
  pushTriangle(positions, a, c, d, outward);
}

function geometryFromPositions(positions: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function connectLoops(
  positions: number[],
  lower: Point[],
  upper: Point[],
  normalForSide: (index: number) => THREE.Vector3,
) {
  for (let index = 0; index < 6; index += 1) {
    const next = (index + 1) % 6;
    pushQuad(positions, lower[index], lower[next], upper[next], upper[index], normalForSide(index));
  }
}

function pushHexCap(positions: number[], loop: Point[], y: number, up: boolean) {
  const center = new THREE.Vector3(0, y, 0);
  const normal = new THREE.Vector3(0, up ? 1 : -1, 0);
  for (let index = 0; index < 6; index += 1) {
    pushTriangle(positions, center, loop[index], loop[(index + 1) % 6], normal);
  }
}

function uniqueLayers(layers: LoftLayer[]) {
  return layers
    .sort((a, b) => a.y - b.y)
    .filter((layer, index, sorted) => index === 0 || Math.abs(layer.y - sorted[index - 1].y) > 0.001);
}

function cavityWidthAt(y: number, depth: number) {
  const floor = depth * (1.8 / 30);
  const bodyHeight = depth + floor;
  const baseBevel = WALL * (0.8 / 1.5);
  const openingHeight = WALL * (1 / 1.5);
  const openingWidth = WALL * (0.6 / 1.5);
  const plugHeight = LID_PLUG_HEIGHT;
  const plugStraightHeight = plugHeight - plugHeight * (0.6 / 6);
  const beadCenterFromRim = 0.55 * plugStraightHeight;
  const grooveCenter = bodyHeight - beadCenterFromRim;
  const grooveBand = plugHeight * (1.7 / 6);
  const grooveHalf = grooveBand / 2;
  const plugWidth = INSIDE_WIDTH - 2 * WALL * (0.12 / 1.5);
  const grooveWidth = plugWidth + 2 * (WALL * (0.3 / 1.5) + WALL * (0.15 / 1.5));

  const baseWidth = y < floor + baseBevel
    ? INSIDE_WIDTH - 2 * baseBevel + 2 * baseBevel * ((y - floor) / baseBevel)
    : INSIDE_WIDTH;
  const grooveWidthAtY = Math.abs(y - grooveCenter) <= grooveHalf
    ? INSIDE_WIDTH + (grooveWidth - INSIDE_WIDTH) * (1 - Math.abs(y - grooveCenter) / grooveHalf)
    : INSIDE_WIDTH;
  const openingStart = bodyHeight - openingHeight;
  const openingWidthAtY = y >= openingStart
    ? INSIDE_WIDTH + 2 * openingWidth * ((y - openingStart) / openingHeight)
    : INSIDE_WIDTH;

  return Math.max(baseWidth, grooveWidthAtY, openingWidthAtY);
}

function createBodyCoreGeometry(depth: number, engraved: boolean) {
  const floor = depth * (1.8 / 30);
  const bodyHeight = depth + floor;
  const textureDepth = WALL * (0.5 / 1.5);
  const shellWidth = engraved ? OUTER_WIDTH - 2 * textureDepth : OUTER_WIDTH;
  const outerLayers = uniqueLayers([
    { y: 0, flatToFlat: OUTER_WIDTH },
    { y: floor, flatToFlat: OUTER_WIDTH },
    { y: Math.min(bodyHeight, floor + EPSILON), flatToFlat: shellWidth },
    { y: bodyHeight, flatToFlat: shellWidth },
  ]);

  const plugHeight = LID_PLUG_HEIGHT;
  const straightHeight = plugHeight - plugHeight * (0.6 / 6);
  const grooveCenter = bodyHeight - 0.55 * straightHeight;
  const grooveHalf = plugHeight * (1.7 / 6) / 2;
  const baseBevel = WALL * (0.8 / 1.5);
  const openingStart = bodyHeight - WALL * (1 / 1.5);
  const cavityBreaks = [
    floor,
    floor + baseBevel,
    grooveCenter - grooveHalf,
    grooveCenter,
    grooveCenter + grooveHalf,
    openingStart,
    bodyHeight,
  ].filter((value) => value >= floor && value <= bodyHeight);
  const innerLayers = uniqueLayers(cavityBreaks.map((y) => ({ y, flatToFlat: cavityWidthAt(y, depth) })));
  const positions: number[] = [];
  const outerLoops = outerLayers.map((layer) => hexLoop(layer.flatToFlat, layer.y));
  const innerLoops = innerLayers.map((layer) => hexLoop(layer.flatToFlat, layer.y));

  for (let index = 0; index < outerLoops.length - 1; index += 1) {
    connectLoops(positions, outerLoops[index], outerLoops[index + 1], (side) => {
      const angle = Math.PI / 3 + side * Math.PI / 3;
      return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    });
  }
  for (let index = 0; index < innerLoops.length - 1; index += 1) {
    connectLoops(positions, innerLoops[index], innerLoops[index + 1], (side) => {
      const angle = Math.PI / 3 + side * Math.PI / 3;
      return new THREE.Vector3(-Math.cos(angle), 0, -Math.sin(angle));
    });
  }

  pushHexCap(positions, outerLoops[0], outerLayers[0].y, false);
  pushHexCap(positions, innerLoops[0], innerLayers[0].y, true);

  const outerTop = outerLoops.at(-1)!;
  const innerTop = innerLoops.at(-1)!;
  for (let index = 0; index < 6; index += 1) {
    const next = (index + 1) % 6;
    pushQuad(positions, outerTop[index], outerTop[next], innerTop[next], innerTop[index], new THREE.Vector3(0, 1, 0));
  }

  return geometryFromPositions(positions);
}

function createHexLoftGeometry(layers: LoftLayer[]) {
  const cleanLayers = uniqueLayers(layers);
  const loops = cleanLayers.map((layer) => hexLoop(layer.flatToFlat, layer.y));
  const positions: number[] = [];
  for (let index = 0; index < loops.length - 1; index += 1) {
    connectLoops(positions, loops[index], loops[index + 1], (side) => {
      const angle = Math.PI / 3 + side * Math.PI / 3;
      return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    });
  }
  pushHexCap(positions, loops[0], cleanLayers[0].y, false);
  pushHexCap(positions, loops.at(-1)!, cleanLayers.at(-1)!.y, true);
  return geometryFromPositions(positions);
}

function honeycombCenters(depth: number, cellWidth: number) {
  const floor = depth * (1.8 / 30);
  const bodyHeight = depth + floor;
  const marginTop = depth * (2 / 30);
  const marginBottom = marginTop + LID_FLANGE_HEIGHT;
  const marginSide = INSIDE_WIDTH * (2.2 / 45.3);
  const faceWidth = OUTER_RADIUS;
  const availableWidth = faceWidth - 2 * marginSide;
  const availableHeight = bodyHeight - marginTop - marginBottom;
  const radius = cellWidth / Math.sqrt(3);
  const rowSpacing = 1.5 * radius;
  const rows = availableHeight >= 2 * radius ? Math.floor((availableHeight - 2 * radius) / rowSpacing) + 1 : 0;
  const rowBlock = (rows - 1) * rowSpacing + 2 * radius;
  const firstY = marginBottom + (availableHeight - rowBlock) / 2 + radius;
  const halfWidth = availableWidth / 2;
  const centers: Array<{ u: number; y: number }> = [];

  for (let row = 0; row < rows; row += 1) {
    const y = firstY + row * rowSpacing;
    const offset = row % 2 ? cellWidth / 2 : 0;
    const maxColumn = Math.ceil(halfWidth / cellWidth) + 2;
    for (let column = -maxColumn; column <= maxColumn; column += 1) {
      const u = column * cellWidth + offset;
      if (u - cellWidth / 2 >= -halfWidth && u + cellWidth / 2 <= halfWidth) centers.push({ u, y });
    }
  }
  return centers;
}

function hexShape(flatToFlat: number, centerX: number, centerY: number, clockwise = false) {
  const radius = flatToFlat / Math.sqrt(3);
  const path = new THREE.Shape();
  for (let index = 0; index <= 6; index += 1) {
    const direction = clockwise ? -1 : 1;
    const angle = Math.PI / 2 + direction * index * Math.PI / 3;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  return path;
}

function faceTransform(geometry: THREE.BufferGeometry, side: number, normalOffset: number) {
  const theta = side * Math.PI / 3;
  const normal = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta));
  // Keep the local (horizontal, vertical, extrusion) axes right-handed so
  // transformed face winding and normals continue to point out of the body.
  const tangent = new THREE.Vector3(Math.sin(theta), 0, -Math.cos(theta));
  const matrix = new THREE.Matrix4().makeBasis(tangent, new THREE.Vector3(0, 1, 0), normal);
  matrix.setPosition(normal.clone().multiplyScalar(normalOffset));
  geometry.applyMatrix4(matrix);
  geometry.computeVertexNormals();
  return geometry;
}

function createTextureGeometry(depth: number, cellWidth: number, embossed: boolean, side: number) {
  const textureDepth = WALL * (0.5 / 1.5);
  const bodyHeight = holderMetrics(depth).height;
  const cutWidth = Math.max(1, cellWidth - 0.8);
  const centers = honeycombCenters(depth, cellWidth);
  let geometry: THREE.ExtrudeGeometry;

  if (embossed) {
    const cells = centers.map(({ u, y }) => hexShape(cutWidth, u, y));
    geometry = new THREE.ExtrudeGeometry(cells, {
      depth: textureDepth + EPSILON,
      bevelEnabled: false,
      curveSegments: 1,
      steps: 1,
    });
    return faceTransform(geometry, side, OUTER_APOTHEM - EPSILON);
  }

  const face = new THREE.Shape();
  face.moveTo(-OUTER_RADIUS / 2, 0);
  face.lineTo(OUTER_RADIUS / 2, 0);
  face.lineTo(OUTER_RADIUS / 2, bodyHeight);
  face.lineTo(-OUTER_RADIUS / 2, bodyHeight);
  face.closePath();
  face.holes = centers.map(({ u, y }) => hexShape(cutWidth, u, y, true));
  geometry = new THREE.ExtrudeGeometry(face, {
    depth: textureDepth + EPSILON,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  return faceTransform(geometry, side, OUTER_APOTHEM - textureDepth - EPSILON);
}

function createTextureOutlineGeometry(depth: number, cellWidth: number, embossed: boolean, side: number) {
  const textureDepth = WALL * (0.5 / 1.5);
  const cutWidth = Math.max(1, cellWidth - 0.8);
  const radius = cutWidth / Math.sqrt(3);
  const positions: number[] = [];

  for (const { u, y } of honeycombCenters(depth, cellWidth)) {
    for (let index = 0; index < 6; index += 1) {
      const angle = Math.PI / 2 + index * Math.PI / 3;
      const nextAngle = Math.PI / 2 + (index + 1) * Math.PI / 3;
      positions.push(
        u + Math.cos(angle) * radius,
        y + Math.sin(angle) * radius,
        0,
        u + Math.cos(nextAngle) * radius,
        y + Math.sin(nextAngle) * radius,
        0,
      );
    }
  }

  const geometry = geometryFromPositions(positions);
  const surfaceOffset = OUTER_APOTHEM + (embossed ? textureDepth : 0) + EPSILON;
  return faceTransform(geometry, side, surfaceOffset);
}

function standardMaterial(color: string) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.04, roughness: 0.52 });
}

function addEdges(mesh: THREE.Mesh, opacity = 0.18) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 24),
    new THREE.LineBasicMaterial({ color: '#e8fff7', transparent: true, opacity }),
  );
  mesh.add(edges);
}

function makeBody(config: HolderConfig, preview: boolean) {
  const group = new THREE.Group();
  group.name = 'holder-body';
  const engraved = config.texture && !config.embossed;
  const core = new THREE.Mesh(createBodyCoreGeometry(config.depth, engraved), standardMaterial('#9fd5b9'));
  core.name = 'body-core';
  core.castShadow = true;
  core.receiveShadow = true;
  if (preview) addEdges(core, 0.16);
  group.add(core);

  if (config.texture) {
    for (let side = 0; side < 6; side += 1) {
      const feature = new THREE.Mesh(
        createTextureGeometry(config.depth, config.cellWidth, config.embossed, side),
        standardMaterial(config.embossed ? '#d6f2ca' : '#b9e8cd'),
      );
      feature.name = config.embossed ? 'raised-honeycomb' : 'engraved-honeycomb-ridges';
      feature.castShadow = true;
      group.add(feature);

      if (preview) {
        const outlines = new THREE.LineSegments(
          createTextureOutlineGeometry(config.depth, config.cellWidth, config.embossed, side),
          new THREE.LineBasicMaterial({
            color: config.embossed ? '#4b8d7a' : '#397c70',
            transparent: true,
            opacity: config.embossed ? 0.68 : 0.82,
          }),
        );
        outlines.name = 'honeycomb-preview-outlines';
        outlines.renderOrder = 2;
        group.add(outlines);
      }
    }
  }
  return group;
}

function makeLid(preview: boolean) {
  const group = new THREE.Group();
  group.name = 'holder-lid';
  const flangeHeight = LID_FLANGE_HEIGHT;
  // Include the small mesh overlap so the modeled tip still lands at exactly
  // the requested overall lid height.
  const plugHeight = LID_PLUG_HEIGHT + EPSILON;
  const tipChamfer = LID_TIP_CHAMFER;
  const straightHeight = plugHeight - tipChamfer;
  const plugWidth = INSIDE_WIDTH - 2 * WALL * (0.12 / 1.5);
  const bead = WALL * (0.3 / 1.5);
  const beadCenter = 0.55 * straightHeight;
  const beadHalf = plugHeight * (1.4 / 6) / 2;
  const material = standardMaterial('#b8dfc8');

  const flange = new THREE.Mesh(createHexLoftGeometry([
    { y: 0, flatToFlat: OUTER_WIDTH },
    { y: flangeHeight, flatToFlat: OUTER_WIDTH },
  ]), material);
  flange.name = 'lid-flange';
  flange.castShadow = true;
  flange.receiveShadow = true;
  if (preview) addEdges(flange, 0.18);
  group.add(flange);

  const base = flangeHeight - EPSILON;
  const plug = new THREE.Mesh(createHexLoftGeometry([
    { y: base, flatToFlat: plugWidth },
    { y: base + Math.max(0, beadCenter - beadHalf), flatToFlat: plugWidth },
    { y: base + beadCenter, flatToFlat: plugWidth + 2 * bead },
    { y: base + Math.min(straightHeight, beadCenter + beadHalf), flatToFlat: plugWidth },
    { y: base + straightHeight, flatToFlat: plugWidth },
    { y: base + plugHeight, flatToFlat: plugWidth - 2 * tipChamfer },
  ]), material);
  plug.name = 'lid-plug';
  plug.castShadow = true;
  if (preview) addEdges(plug, 0.16);
  group.add(plug);
  return group;
}

export function buildHolderModel(
  config: HolderConfig,
  options: { arrangement?: HolderArrangement; preview?: boolean } = {},
) {
  const arrangement = options.arrangement ?? 'print';
  const preview = options.preview ?? false;
  const model = new THREE.Group();
  model.name = 'hex-sticker-holder';

  if (config.part !== 'lid') {
    const body = makeBody(config, preview);
    model.add(body);
  }

  if (config.part !== 'body') {
    const lid = makeLid(preview);
    model.add(lid);
  }

  applyHolderArrangement(model, config.depth, arrangement);
  model.updateMatrixWorld(true);
  return model;
}

export function applyHolderArrangement(model: THREE.Object3D, depth: number, arrangement: HolderArrangement) {
  const body = model.getObjectByName('holder-body');
  const lid = model.getObjectByName('holder-lid');
  if (!body || !lid) return;

  body.position.set(0, 0, 0);
  body.rotation.set(0, 0, 0);
  lid.position.set(0, 0, 0);
  lid.rotation.set(0, 0, 0);

  if (arrangement === 'print') {
    const separation = OUTER_WIDTH / 2 + 5;
    body.position.x = -separation;
    lid.position.x = separation;
    return;
  }

  // The lid is modeled plug-up for printing. In assembly, its outer face is
  // on top, its plug points down, and the flange underside rests on the rim.
  lid.rotation.x = Math.PI;
  lid.position.y = holderMetrics(depth).height + LID_FLANGE_HEIGHT;
}

export function disposeHolderModel(object: THREE.Object3D) {
  const disposedMaterials = new Set<THREE.Material>();
  object.traverse((item) => {
    if (item instanceof THREE.Mesh || item instanceof THREE.LineSegments) {
      item.geometry.dispose();
      const materials = Array.isArray(item.material) ? item.material : [item.material];
      for (const material of materials) {
        if (!disposedMaterials.has(material)) {
          material.dispose();
          disposedMaterials.add(material);
        }
      }
    }
  });
}
