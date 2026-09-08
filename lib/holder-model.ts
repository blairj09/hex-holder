import * as THREE from 'three';
import createManifold, { type Manifold as ManifoldSolid, type ManifoldToplevel } from 'manifold-3d';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type HolderPart = 'body' | 'lid' | 'both';
export type HolderArrangement = 'print' | 'assembled';
export const STICKER_THICKNESS = 0.25;
export const STICKER_CAPACITIES = [25, 50, 75, 100] as const;
export type StickerCapacity = (typeof STICKER_CAPACITIES)[number];
export const LID_HEIGHT = 6;
export const LID_FLANGE_HEIGHT = 1.6;
export const LID_PLUG_HEIGHT = LID_HEIGHT - LID_FLANGE_HEIGHT;
/** A small 45° relief at the faces printed against the build plate. */
export const BUILD_PLATE_CHAMFER = 0.6;
export const LOGO_LAYER_HEIGHT = 0.2;
const LID_TIP_CHAMFER = LID_PLUG_HEIGHT * 0.1;

export type HolderConfig = {
  depth: number;
  cellWidth: number;
  embossed: boolean;
  texture: boolean;
  part: HolderPart;
  logoSvg?: string | null;
  logoScale?: number;
  logoX?: number;
  logoZ?: number;
  logoRotation?: number;
  logoForegroundOnly?: boolean;
};

export const INSIDE_WIDTH = 46;
export const WALL = INSIDE_WIDTH * (1.5 / 45.3);
export const OUTER_WIDTH = INSIDE_WIDTH + 2 * WALL;
const OUTER_RADIUS = OUTER_WIDTH / Math.sqrt(3);
const OUTER_APOTHEM = OUTER_WIDTH / 2;
const EPSILON = 0.02;
const LOGO_BASE_WIDTH = 20;
const LOGO_CURVE_SEGMENTS = 24;
// Most logos are modest in size and need enough headroom for their lettering,
// outlines, and small accents to survive. A separate, tighter budget protects
// the preview from illustration-grade SVGs with thousands of paths.
const MAX_LOGO_SHAPES = 420;
const MAX_LOGO_CURVES = 24_000;
const MAX_SHAPE_CURVES = 640;
const COMPLEX_SVG_SOURCE_LENGTH = 250_000;
const COMPLEX_MAX_LOGO_SHAPES = 120;
const COMPLEX_MAX_LOGO_CURVES = 5_000;
const COMPLEX_MAX_SHAPE_CURVES = 320;
const COMPLEX_LOGO_CURVE_SEGMENTS = 6;
export const LOGO_POSITION_LIMIT = OUTER_WIDTH * 0.24;
let manifoldModule: Promise<ManifoldToplevel> | null = null;

function getManifoldModule() {
  manifoldModule ??= createManifold().then((module) => {
    module.setup();
    return module;
  });
  return manifoldModule;
}

export function isComplexSvgForPrint(svg: string) {
  return svg.length > COMPLEX_SVG_SOURCE_LENGTH;
}

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
    { y: 0, flatToFlat: OUTER_WIDTH - BUILD_PLATE_CHAMFER * 2 },
    { y: BUILD_PLATE_CHAMFER, flatToFlat: OUTER_WIDTH },
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
  // The engraved face is a separate, recessed skin. Let the unified core own
  // the first 0.6 mm above the build plate; otherwise this rectangular skin
  // reaches the bed at the full outer width and hides the body's chamfer.
  face.moveTo(-OUTER_RADIUS / 2, BUILD_PLATE_CHAMFER);
  face.lineTo(OUTER_RADIUS / 2, BUILD_PLATE_CHAMFER);
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
    new THREE.LineBasicMaterial({ color: '#d8e1de', transparent: true, opacity }),
  );
  mesh.add(edges);
}

function makeBody(config: HolderConfig, preview: boolean) {
  const group = new THREE.Group();
  group.name = 'holder-body';
  const engraved = config.texture && !config.embossed;
  const core = new THREE.Mesh(createBodyCoreGeometry(config.depth, engraved), standardMaterial('#f3f6f4'));
  core.name = 'body-core';
  core.castShadow = true;
  core.receiveShadow = true;
  if (preview) addEdges(core, 0.16);
  group.add(core);

  if (config.texture) {
    for (let side = 0; side < 6; side += 1) {
      const feature = new THREE.Mesh(
        createTextureGeometry(config.depth, config.cellWidth, config.embossed, side),
        standardMaterial(config.embossed ? '#ffffff' : '#e7eeea'),
      );
      feature.name = config.embossed ? 'raised-honeycomb' : 'engraved-honeycomb-ridges';
      feature.castShadow = true;
      group.add(feature);

      if (preview) {
        const outlines = new THREE.LineSegments(
          createTextureOutlineGeometry(config.depth, config.cellWidth, config.embossed, side),
          new THREE.LineBasicMaterial({
            color: config.embossed ? '#7e9189' : '#657d73',
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

type SvgShape = { shape: THREE.Shape; bounds: THREE.Box2; fill: string };

function shapeCurveCount(shape: THREE.Shape) {
  return shape.curves.length + shape.holes.reduce((count, hole) => count + hole.curves.length, 0);
}

function shapeBounds(shape: THREE.Shape) {
  const points = [...shape.getPoints(12), ...shape.holes.flatMap((hole) => hole.getPoints(12))];
  return new THREE.Box2().setFromPoints(points);
}

function rgbForFill(fill: string) {
  const match = fill.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return null;
  const hex = match[1].length === 3
    ? `${match[1][0].repeat(2)}${match[1][1].repeat(2)}${match[1][2].repeat(2)}`
    : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function isNeutralFill(fill: string) {
  const rgb = rgbForFill(fill);
  if (!rgb) return false;
  return Math.max(...rgb) - Math.min(...rgb) <= 0.06;
}

function isColorfulFill(fill: string) {
  const rgb = rgbForFill(fill);
  if (!rgb) return false;
  return Math.max(...rgb) - Math.min(...rgb) >= 0.16;
}

function svgClassFills(svg: string) {
  const fills = new Map<string, string>();
  for (const styleBlock of svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of styleBlock[1].matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const fill = rule[2].match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1]?.trim();
      if (!fill) continue;
      for (const selector of rule[1].matchAll(/\.([\w-]+)/g)) fills.set(selector[1], fill);
    }
  }
  return fills;
}

function simplifiedLoop(path: THREE.CurvePath<THREE.Vector2>, segments: number) {
  const points = path.getSpacedPoints(Math.max(3, segments));
  if (points.length > 1 && points[0].distanceToSquared(points.at(-1)!) < EPSILON * EPSILON) points.pop();
  return points;
}

function addPolygonToPath(path: THREE.Path, points: THREE.Vector2[]) {
  if (points.length < 3) return false;
  path.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) path.lineTo(point.x, point.y);
  path.closePath();
  return true;
}

function simplifyShapeForPrint(shape: THREE.Shape, maxCurves: number) {
  const loops = [shape, ...shape.holes];
  const totalLength = loops.reduce((length, loop) => length + loop.getLength(), 0);
  if (!Number.isFinite(totalLength) || totalLength <= EPSILON) return null;

  const pointBudget = Math.max(12, maxCurves - loops.length);
  const outerPoints = simplifiedLoop(shape, Math.max(3, Math.round(pointBudget * shape.getLength() / totalLength)));
  const simplified = new THREE.Shape();
  if (!addPolygonToPath(simplified, outerPoints)) return null;

  for (const hole of shape.holes) {
    const points = simplifiedLoop(hole, Math.max(3, Math.round(pointBudget * hole.getLength() / totalLength)));
    const simplifiedHole = new THREE.Path();
    if (addPolygonToPath(simplifiedHole, points)) simplified.holes.push(simplifiedHole);
  }
  return simplified;
}

function capPrintableShapes(shapes: SvgShape[], sourceLength: number) {
  const isComplex = sourceLength > COMPLEX_SVG_SOURCE_LENGTH;
  const maxShapes = isComplex ? COMPLEX_MAX_LOGO_SHAPES : MAX_LOGO_SHAPES;
  const maxCurves = isComplex ? COMPLEX_MAX_LOGO_CURVES : MAX_LOGO_CURVES;
  const maxShapeCurves = isComplex ? COMPLEX_MAX_SHAPE_CURVES : MAX_SHAPE_CURVES;
  const eligible = shapes.flatMap((item) => {
    if (shapeCurveCount(item.shape) <= maxShapeCurves) return [item];
    const simplified = simplifyShapeForPrint(item.shape, maxShapeCurves);
    return simplified ? [{ ...item, shape: simplified }] : [];
  });
  const totalCurves = eligible.reduce((count, { shape }) => count + shapeCurveCount(shape), 0);
  if (eligible.length <= maxShapes && totalCurves <= maxCurves) return eligible;

  const ranked = [...eligible].sort((a, b) => (
    b.bounds.getSize(new THREE.Vector2()).lengthSq() - a.bounds.getSize(new THREE.Vector2()).lengthSq()
  ));
  const capped: SvgShape[] = [];
  let curveCount = 0;
  for (const item of ranked) {
    const nextCurveCount = curveCount + shapeCurveCount(item.shape);
    if (capped.length >= maxShapes || nextCurveCount > maxCurves) continue;
    capped.push(item);
    curveCount = nextCurveCount;
  }
  return capped;
}

function svgShapes(svg: string, simplifyCatalogArtwork = false, scale = 1) {
  const shapes: SvgShape[] = [];
  const classFills = svgClassFills(svg);
  for (const path of new SVGLoader().parse(svg).paths) {
    const classNames = path.userData?.node?.getAttribute('class')?.split(/\s+/) ?? [];
    let classFill: string | undefined;
    for (const className of classNames) {
      const candidate = classFills.get(className);
      if (candidate) classFill = candidate;
    }
    const fill = classFill ?? (typeof path.userData?.style?.fill === 'string' ? path.userData.style.fill : '');
    if (fill.trim().toLowerCase() === 'none') continue;
    for (const shape of SVGLoader.createShapes(path)) {
      const bounds = shapeBounds(shape);
      if (!bounds.isEmpty()) shapes.push({ shape, bounds, fill });
    }
  }
  // Uploaded SVGs are faithful single-color conversions: retain every filled
  // contour exactly as supplied. Catalog art is curated differently below to
  // remove its badge background and bound illustration-grade SVGs.
  if (!simplifyCatalogArtwork || !shapes.length) return shapes.map(({ shape }) => shape);

  const overall = shapes.reduce((bounds, item) => bounds.union(item.bounds), new THREE.Box2());
  const overallSize = overall.getSize(new THREE.Vector2());
  const overallArea = overallSize.x * overallSize.y;
  if (!Number.isFinite(overallArea) || overallArea <= EPSILON) return shapes.map(({ shape }) => shape);

  // Catalog badges tend to begin with a large colored hexagon (and sometimes
  // a gradient gloss). Those shapes read as a solid black lid when converted
  // to one color. Keep large flat foreground art, but omit only true badges
  // and broad paint-server fills.
  const foreground = shapes.filter(({ bounds, fill }) => {
    const size = bounds.getSize(new THREE.Vector2());
    const coverage = size.x * size.y / overallArea;
    const coversBadge = (
      coverage > 0.25
      && size.x / overallSize.x > 0.78
      && size.y / overallSize.y > 0.78
    );
    const broadGradient = /url\(/i.test(fill) && coverage > 0.15;
    return !coversBadge && !broadGradient;
  });
  const candidates = foreground.length ? foreground : shapes;

  // Some catalog stickers (including dplyr and ggplot2) build their badge
  // background from many separate neutral paths. A per-shape bounds check
  // cannot identify that collective backdrop. When a sticker uses a rich color
  // palette, a repeated neutral fill is overwhelmingly likely to be its
  // backdrop rather than the art we want for a one-color lid modifier.
  const fillGroups = new Map<string, { count: number }>();
  for (const { fill } of candidates) {
    const group = fillGroups.get(fill) ?? { count: 0 };
    group.count += 1;
    fillGroups.set(fill, group);
  }
  const richPalette = [...fillGroups.keys()].filter(isColorfulFill).length >= 4;
  const backgroundFills = new Set(
    [...fillGroups].flatMap(([fill, group]) => (
      richPalette && isNeutralFill(fill) && group.count >= 5 ? [fill] : []
    )),
  );
  const artwork = candidates.filter(({ fill }) => !backgroundFills.has(fill));
  const printableCandidates = artwork.length ? artwork : candidates;

  // Keep the fine lettering, outlines, and thin accents of ordinary SVGs.
  // Only simplify dense illustrations, where their details would become a
  // muddy solid on a 20 mm one-color modifier anyway.
  const isComplex = isComplexSvgForPrint(svg);
  const filterFineDetails = isComplex || printableCandidates.length > MAX_LOGO_SHAPES;
  const printable = filterFineDetails
    ? printableCandidates.filter(({ bounds }) => {
      const size = bounds.getSize(new THREE.Vector2());
      const widthMm = size.x / overallSize.x * LOGO_BASE_WIDTH * scale;
      const heightMm = size.y / overallSize.y * LOGO_BASE_WIDTH * scale;
      const longSideMm = Math.max(widthMm, heightMm);
      const shortSideMm = Math.min(widthMm, heightMm);
      return isComplex
        ? longSideMm >= 0.25 && shortSideMm >= 0.12
        : longSideMm >= 0.18 && shortSideMm >= 0.06;
    })
    : printableCandidates;
  const selected = printable.length ? printable : printableCandidates;
  // A handful of catalog illustrations contain thousands of paths. The largest
  // printable features carry the recognizable design; capping them prevents an
  // impractically dense STL or a browser freeze.
  const bounded = capPrintableShapes(selected, svg.length);
  return bounded.map(({ shape }) => shape);
}

export function hasFilledSvgShape(svg: string) {
  // This is deliberately a fast, non-rendering preflight. Parsing a complex
  // catalog SVG here would duplicate the work done by the model builder and
  // make a click appear to hang before the preview gets a chance to update.
  return /<(?:path|polygon|polyline|rect|circle|ellipse)\b/i.test(svg);
}

function extrudeLogoShapes(shapes: THREE.Shape[], curveSegments: number) {
  const options = {
    depth: LOGO_LAYER_HEIGHT,
    bevelEnabled: false,
    curveSegments,
  };
  const extrudeSafely = (subset: THREE.Shape[]): THREE.BufferGeometry[] => {
    try {
      return [new THREE.ExtrudeGeometry(subset, options)];
    } catch {
      if (subset.length === 1) return [];
      const middle = Math.ceil(subset.length / 2);
      return [...extrudeSafely(subset.slice(0, middle)), ...extrudeSafely(subset.slice(middle))];
    }
  };

  const fragments = extrudeSafely(shapes);
  if (!fragments.length) return null;
  if (fragments.length === 1) return fragments[0];
  const merged = mergeGeometries(fragments, false);
  for (const fragment of fragments) fragment.dispose();
  return merged;
}

function makeLidLogo(config: HolderConfig) {
  if (!config.logoSvg) return null;
  let shapes: THREE.Shape[];
  try {
    shapes = svgShapes(config.logoSvg, config.logoForegroundOnly, config.logoScale ?? 1);
  } catch {
    return null;
  }
  if (!shapes.length) return null;

  let geometry: THREE.BufferGeometry | null;
  try {
    const curveSegments = isComplexSvgForPrint(config.logoSvg)
      ? COMPLEX_LOGO_CURVE_SEGMENTS
      : LOGO_CURVE_SEGMENTS;
    geometry = extrudeLogoShapes(shapes, curveSegments);
  } catch {
    return null;
  }
  if (!geometry) return null;
  // Standard artwork uses 24 segments per curve for smooth lettering. Very
  // large illustrations use a lower-detail, print-safe fallback instead.
  // SVG fills are extruded into the lid so the 0.2 mm modifier is flush with
  // the outer surface rather than forming a raised badge.
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  const initialBox = geometry.boundingBox!;
  const initialSize = initialBox.getSize(new THREE.Vector3());
  const longestSide = Math.max(initialSize.x, initialSize.z);
  if (!Number.isFinite(longestSide) || longestSide <= EPSILON) {
    geometry.dispose();
    return null;
  }
  geometry.scale(LOGO_BASE_WIDTH / longestSide, 1, LOGO_BASE_WIDTH / longestSide);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -box.min.y, -center.z);
  geometry.computeVertexNormals();

  const group = new THREE.Group();
  group.name = 'lid-svg-logo';
  group.position.set(
    THREE.MathUtils.clamp(config.logoX ?? 0, -LOGO_POSITION_LIMIT, LOGO_POSITION_LIMIT),
    0,
    THREE.MathUtils.clamp(config.logoZ ?? 0, -LOGO_POSITION_LIMIT, LOGO_POSITION_LIMIT),
  );
  group.scale.setScalar(config.logoScale ?? 1);
  group.rotation.y = config.logoRotation ?? 0;

  const logo = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: '#000000',
    metalness: 0,
    roughness: 0.42,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }));
  logo.name = 'lid-svg-modifier';
  logo.castShadow = true;
  group.add(logo);
  return group;
}

function makeLid(config: HolderConfig, preview: boolean) {
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
  const material = standardMaterial('#f7f8f7');

  const flange = new THREE.Mesh(createHexLoftGeometry([
    { y: 0, flatToFlat: OUTER_WIDTH - BUILD_PLATE_CHAMFER * 2 },
    { y: BUILD_PLATE_CHAMFER, flatToFlat: OUTER_WIDTH },
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
  const logo = makeLidLogo(config);
  if (logo) group.add(logo);
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
    const lid = makeLid(config, preview);
    model.add(lid);
  }

  applyHolderArrangement(model, config.depth, arrangement);
  model.updateMatrixWorld(true);
  return model;
}

/**
 * Fuses the render meshes for each printable item into a single solid mesh.
 * The preview keeps its separate meshes for materials and edge treatments.
 */
export async function makePrintableExportModel(model: THREE.Object3D) {
  model.updateMatrixWorld(true);
  const printableModel = new THREE.Group();
  printableModel.name = 'printable-hex-sticker-holder';
  const manifold = await getManifoldModule();

  for (const partName of ['holder-body', 'holder-lid']) {
    const part = model.getObjectByName(partName);
    if (!part) continue;

    const solids: ManifoldSolid[] = [];
    part.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      const position = geometry.getAttribute('position');
      const triVerts = geometry.index
        ? Uint32Array.from(geometry.index.array)
        : Uint32Array.from({ length: position.count }, (_, index) => index);
      const mesh = new manifold.Mesh({
        numProp: 3,
        vertProperties: new Float32Array(position.array),
        triVerts,
      });
      mesh.merge();
      const solid = manifold.Manifold.ofMesh(mesh);
      geometry.dispose();
      if (solid.status() !== 'NoError') {
        solid.delete();
        throw new Error(`Could not prepare the ${partName} geometry for export.`);
      }
      solids.push(solid);
    });

    if (!solids.length) continue;
    const fused = manifold.Manifold.union(solids);
    for (const solid of solids) solid.delete();
    if (fused.isEmpty() || fused.status() !== 'NoError') {
      fused.delete();
      throw new Error(`Could not fuse the ${partName} geometry for export.`);
    }
    const components = fused.decompose();
    const isSingleSolid = components.length === 1;
    for (const component of components) component.delete();
    if (!isSingleSolid) {
      fused.delete();
      throw new Error(`The ${partName} export contains disconnected solids.`);
    }

    const fusedMesh = fused.getMesh();
    fusedMesh.merge();
    const positions = new Float32Array(fusedMesh.numVert * 3);
    for (let index = 0; index < fusedMesh.numVert; index += 1) {
      positions[index * 3] = fusedMesh.vertProperties[index * fusedMesh.numProp];
      positions[index * 3 + 1] = fusedMesh.vertProperties[index * fusedMesh.numProp + 1];
      positions[index * 3 + 2] = fusedMesh.vertProperties[index * fusedMesh.numProp + 2];
    }
    fused.delete();

    const mergeTarget = Uint32Array.from({ length: fusedMesh.numVert }, (_, index) => index);
    const mergeFrom = fusedMesh.mergeFromVert ?? new Uint32Array();
    const mergeTo = fusedMesh.mergeToVert ?? new Uint32Array();
    for (let index = 0; index < mergeFrom.length; index += 1) mergeTarget[mergeFrom[index]] = mergeTo[index];
    const rootVertex = (index: number): number => {
      while (mergeTarget[index] !== index) {
        mergeTarget[index] = mergeTarget[mergeTarget[index]];
        index = mergeTarget[index];
      }
      return index;
    };
    const triangleIndices = Uint32Array.from(fusedMesh.triVerts, rootVertex);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.Uint32BufferAttribute(triangleIndices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.name = partName;
    printableModel.add(mesh);
  }

  return printableModel;
}

/**
 * Makes a standalone logo mesh with the exact world transform it has in the
 * printable holder layout. STL cannot retain scene hierarchy, so preserving
 * this transform is what keeps a separately imported modifier aligned.
 */
export function makeLogoModifierExportModel(model: THREE.Object3D) {
  const source = model.getObjectByName('lid-svg-modifier');
  if (!(source instanceof THREE.Mesh)) return null;

  source.updateWorldMatrix(true, false);
  const modifier = source.clone();
  modifier.matrixAutoUpdate = false;
  modifier.matrix.copy(source.matrixWorld);
  modifier.matrix.decompose(modifier.position, modifier.quaternion, modifier.scale);

  const modifierModel = new THREE.Group();
  modifierModel.add(modifier);
  return modifierModel;
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
