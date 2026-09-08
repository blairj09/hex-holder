'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import {
  applyHolderArrangement,
  buildHolderModel,
  disposeHolderModel,
  LID_PLUG_HEIGHT,
  LOGO_POSITION_LIMIT,
  type HolderConfig,
} from '@/lib/holder-model';

type ViewerProps = HolderConfig & {
  assembled: boolean;
  resetToken: number;
  onLogoTransformChange: (transform: { x: number; z: number; scale: number; rotation: number }) => void;
  onLogoRemove: () => void;
};

type ObjectPose = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

function capturePose(object: THREE.Object3D): ObjectPose {
  return {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
  };
}

function segmentProgress(value: number, start: number, end: number) {
  const progress = THREE.MathUtils.clamp((value - start) / (end - start), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function applyAssemblyProgress(
  body: THREE.Object3D,
  lid: THREE.Object3D,
  printBody: ObjectPose,
  assembledBody: ObjectPose,
  printLid: ObjectPose,
  assembledLid: ObjectPose,
  rotationY: number,
  hoverY: number,
  progress: number,
) {
  // Lift clear, rotate at the side, align, lower to a visible hover, then insert.
  const bodyProgress = segmentProgress(progress, 0.18, 0.62);
  const liftProgress = segmentProgress(progress, 0, 0.18);
  const rotationProgress = segmentProgress(progress, 0.18, 0.42);
  const alignmentProgress = segmentProgress(progress, 0.42, 0.6);
  const approachProgress = segmentProgress(progress, 0.6, 0.72);
  const insertionProgress = segmentProgress(progress, 0.78, 1);

  body.position.lerpVectors(printBody.position, assembledBody.position, bodyProgress);
  body.quaternion.copy(printBody.quaternion).slerp(assembledBody.quaternion, bodyProgress);

  lid.position.x = THREE.MathUtils.lerp(printLid.position.x, assembledLid.position.x, alignmentProgress);
  lid.position.z = THREE.MathUtils.lerp(printLid.position.z, assembledLid.position.z, alignmentProgress);
  lid.position.y = progress < 0.6
    ? THREE.MathUtils.lerp(printLid.position.y, rotationY, liftProgress)
    : progress < 0.78
      ? THREE.MathUtils.lerp(rotationY, hoverY, approachProgress)
      : THREE.MathUtils.lerp(hoverY, assembledLid.position.y, insertionProgress);
  lid.quaternion.copy(printLid.quaternion).slerp(assembledLid.quaternion, rotationProgress);
}

function fitCamera(
  container: HTMLDivElement,
  model: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  keepDirection: boolean,
) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const viewport = container.getBoundingClientRect();
  const aspect = viewport.width && viewport.height ? viewport.width / viewport.height : 1;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const verticalFit = size.y / (2 * Math.tan(halfVerticalFov));
  const horizontalFit = Math.max(size.x, size.z) / (2 * Math.tan(halfVerticalFov) * aspect);
  const distance = Math.max(78, Math.max(verticalFit, horizontalFit) * 1.22 + Math.min(size.x, size.z) * 0.3);
  const direction = keepDirection
    ? camera.position.clone().sub(controls.target).normalize()
    : new THREE.Vector3(1, 0.62, 1).normalize();

  controls.target.copy(center);
  camera.position.copy(center).add(direction.multiplyScalar(distance));
  controls.update();
}

function normalizeAngle(angle: number) {
  return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
}

function makeLine(points: number[], color: string) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
}

const ROTATION_HANDLE_OFFSET = 3.7;

function addLogoTransformControls(model: THREE.Group) {
  const lid = model.getObjectByName('holder-lid');
  const logo = model.getObjectByName('lid-svg-logo');
  const modifier = model.getObjectByName('lid-svg-modifier');
  if (!lid || !logo || !(modifier instanceof THREE.Mesh)) return;

  modifier.geometry.computeBoundingBox();
  const box = modifier.geometry.boundingBox;
  if (!box) return;

  const controls = new THREE.Group();
  controls.name = 'logo-transform-controls';
  controls.userData = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
  const frameY = -0.22;
  const frameColor = '#e7ffb1';
  const outline = makeLine([
    box.min.x, frameY, box.min.z, box.max.x, frameY, box.min.z,
    box.max.x, frameY, box.min.z, box.max.x, frameY, box.max.z,
    box.max.x, frameY, box.max.z, box.min.x, frameY, box.max.z,
    box.min.x, frameY, box.max.z, box.min.x, frameY, box.min.z,
  ], frameColor);
  outline.name = 'logo-transform-outline';
  outline.renderOrder = 4;
  controls.add(outline);
  const moveSurface = new THREE.Mesh(
    new THREE.PlaneGeometry(box.max.x - box.min.x, box.max.z - box.min.z).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  moveSurface.name = 'logo-move-handle';
  moveSurface.position.y = frameY + 0.02;
  controls.add(moveSurface);

  for (const [x, z] of [[box.min.x, box.min.z], [box.min.x, box.max.z], [box.max.x, box.min.z], [box.max.x, box.max.z]]) {
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.25, 1.2),
      new THREE.MeshBasicMaterial({ color: frameColor, depthTest: false }),
    );
    handle.name = 'logo-scale-handle';
    handle.userData = { baseX: x, baseZ: z };
    handle.position.y = frameY;
    handle.renderOrder = 5;
    controls.add(handle);
  }

  const rotationStem = makeLine([0, frameY, 0, 0, frameY, 0], frameColor);
  rotationStem.name = 'logo-rotation-stem';
  rotationStem.renderOrder = 4;
  controls.add(rotationStem);
  const rotationHandle = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.2, 8, 28).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: frameColor, depthTest: false }),
  );
  rotationHandle.name = 'logo-rotate-handle';
  rotationHandle.position.y = frameY;
  rotationHandle.renderOrder = 5;
  controls.add(rotationHandle);
  const rotationHitArea = new THREE.Mesh(
    new THREE.CircleGeometry(1.55, 28).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
  );
  rotationHitArea.name = 'logo-rotate-hit-area';
  rotationHitArea.position.y = frameY + 0.03;
  controls.add(rotationHitArea);
  lid.add(controls);
  syncLogoTransformControls(lid, logo);
}

function removeLogoTransformControls(lid: THREE.Object3D) {
  const controls = lid.getObjectByName('logo-transform-controls');
  if (!controls) return;
  controls.removeFromParent();
  controls.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

function syncLogoTransformControls(lid: THREE.Object3D, logo: THREE.Object3D) {
  const controls = lid.getObjectByName('logo-transform-controls');
  if (!controls) return;
  const { maxZ } = controls.userData as { maxZ: number };
  const scale = logo.scale.x;
  controls.position.x = logo.position.x;
  controls.position.z = logo.position.z;
  controls.rotation.y = logo.rotation.y;

  const outline = controls.getObjectByName('logo-transform-outline');
  if (outline) outline.scale.set(scale, 1, scale);
  controls.traverse((object) => {
    if (object.name === 'logo-scale-handle') {
      object.position.x = object.userData.baseX * scale;
      object.position.z = object.userData.baseZ * scale;
    }
  });

  const topZ = maxZ * scale;
  const rotationStem = controls.getObjectByName('logo-rotation-stem') as THREE.LineSegments | undefined;
  const stemPosition = rotationStem?.geometry.getAttribute('position');
  if (stemPosition) {
    stemPosition.setXYZ(0, 0, -0.22, topZ);
    stemPosition.setXYZ(1, 0, -0.22, topZ + ROTATION_HANDLE_OFFSET);
    stemPosition.needsUpdate = true;
  }
  controls.traverse((object) => {
    if (object.name === 'logo-rotate-handle' || object.name === 'logo-rotate-hit-area') {
      object.position.z = topZ + ROTATION_HANDLE_OFFSET;
    }
  });
}

function interactionFor(object: THREE.Object3D, lid: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current && current !== lid) {
    if (current.name === 'logo-scale-handle') return 'scale' as const;
    if (current.name === 'logo-rotate-handle' || current.name === 'logo-rotate-hit-area') return 'rotate' as const;
    if (current.name === 'logo-move-handle') return 'move' as const;
    current = current.parent;
  }
  return null;
}

function isLogoModifier(object: THREE.Object3D, lid: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current && current !== lid) {
    if (current.name === 'lid-svg-modifier') return true;
    current = current.parent;
  }
  return false;
}

function isTextEditingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export function LiveModelViewer(props: ViewerProps) {
  const mount = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const hasFramedRef = useRef(false);
  const previousLayoutRef = useRef('');
  const previousResetTokenRef = useRef(props.resetToken);
  const previousAssembledRef = useRef(props.assembled);
  const previousLogoSvgRef = useRef(props.logoSvg);
  const selectedLogoRef = useRef(false);
  const logoEditingEnabledRef = useRef(props.assembled && props.part !== 'body');
  const logoTransformChangeRef = useRef(props.onLogoTransformChange);
  const logoRemoveRef = useRef(props.onLogoRemove);

  useEffect(() => {
    logoTransformChangeRef.current = props.onLogoTransformChange;
  }, [props.onLogoTransformChange]);

  useEffect(() => {
    logoRemoveRef.current = props.onLogoRemove;
  }, [props.onLogoRemove]);

  useEffect(() => {
    logoEditingEnabledRef.current = props.assembled && props.part !== 'body';
    if (!logoEditingEnabledRef.current) {
      selectedLogoRef.current = false;
      const lid = modelRef.current?.getObjectByName('holder-lid');
      if (lid) removeLogoTransformControls(lid);
    }
  }, [props.assembled, props.part]);

  useEffect(() => {
    const container = mount.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#063d4a');
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 2000);
    camera.position.set(115, 82, 135);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 38;
    controls.maxDistance = 650;
    controls.target.set(0, 18, 0);
    controls.update();

    scene.add(new THREE.HemisphereLight('#e4fff6', '#012c36', 2.15));
    scene.add(new THREE.AmbientLight('#dff5f0', 0.55));
    const key = new THREE.DirectionalLight('#ffffff', 2.8);
    key.position.set(45, 85, 70);
    key.castShadow = true;
    scene.add(key);
    const fill = new THREE.DirectionalLight('#7bd7cd', 1.1);
    fill.position.set(-60, 25, -45);
    scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.ShadowMaterial({ color: '#001f27', opacity: 0.2 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;

    let resizeFrame = 0;
    let renderedWidth = 0;
    let renderedHeight = 0;
    const resize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        const { width, height } = container.getBoundingClientRect();
        if (!width || !height) return;
        if (Math.abs(width - renderedWidth) < 0.5 && Math.abs(height - renderedHeight) < 0.5) return;
        renderedWidth = width;
        renderedHeight = height;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dragPoint = new THREE.Vector3();
    const lidSurface = new THREE.Plane();
    const lidNormal = new THREE.Vector3();
    let dragMode: 'move' | 'scale' | 'rotate' | null = null;
    let draggedLogo: THREE.Object3D | null = null;
    const dragOffset = new THREE.Vector3();
    const dragVector = new THREE.Vector2();
    let startScale = 1;
    let startRotation = 0;
    let startAngle = 0;

    const setLogoSelected = (selected: boolean) => {
      selectedLogoRef.current = selected;
      const model = modelRef.current;
      const lid = model?.getObjectByName('holder-lid');
      if (!lid) return;
      if (selected && logoEditingEnabledRef.current) addLogoTransformControls(model!);
      else removeLogoTransformControls(lid);
    };

    const setPointerRay = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
    };
    const onPointerDown = (event: PointerEvent) => {
      const lid = modelRef.current?.getObjectByName('holder-lid');
      const logo = modelRef.current?.getObjectByName('lid-svg-logo');
      if (event.button !== 0 || !lid || !logo || !logoEditingEnabledRef.current) return;
      setPointerRay(event);
      const intersections = raycaster.intersectObject(lid, true);
      const interaction = intersections
        .map((hit) => interactionFor(hit.object, lid))
        .find((kind): kind is 'move' | 'scale' | 'rotate' => kind !== null);
      if (!interaction) {
        setLogoSelected(intersections.some((hit) => isLogoModifier(hit.object, lid)));
        return;
      }
      const surfacePoint = lid.localToWorld(new THREE.Vector3(0, 0, 0));
      lidNormal.set(0, -1, 0).applyQuaternion(lid.getWorldQuaternion(new THREE.Quaternion())).normalize();
      lidSurface.setFromNormalAndCoplanarPoint(lidNormal, surfacePoint);
      if (!raycaster.ray.intersectPlane(lidSurface, dragPoint)) return;
      const localPoint = lid.worldToLocal(dragPoint.clone());
      dragMode = interaction;
      draggedLogo = logo;
      dragOffset.set(logo.position.x - localPoint.x, 0, logo.position.z - localPoint.z);
      dragVector.set(localPoint.x - logo.position.x, localPoint.z - logo.position.z);
      startScale = logo.scale.x;
      startRotation = logo.rotation.y;
      startAngle = Math.atan2(dragVector.y, dragVector.x);
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
      event.preventDefault();
      event.stopPropagation();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragMode || !draggedLogo) return;
      const lid = modelRef.current?.getObjectByName('holder-lid');
      if (!lid) return;
      setPointerRay(event);
      const surfacePoint = lid.localToWorld(new THREE.Vector3(0, 0, 0));
      lidNormal.set(0, -1, 0).applyQuaternion(lid.getWorldQuaternion(new THREE.Quaternion())).normalize();
      lidSurface.setFromNormalAndCoplanarPoint(lidNormal, surfacePoint);
      if (!raycaster.ray.intersectPlane(lidSurface, dragPoint)) return;
      const localPoint = lid.worldToLocal(dragPoint.clone());
      if (dragMode === 'move') {
        draggedLogo.position.x = THREE.MathUtils.clamp(localPoint.x + dragOffset.x, -LOGO_POSITION_LIMIT, LOGO_POSITION_LIMIT);
        draggedLogo.position.z = THREE.MathUtils.clamp(localPoint.z + dragOffset.z, -LOGO_POSITION_LIMIT, LOGO_POSITION_LIMIT);
      } else {
        const vector = new THREE.Vector2(localPoint.x - draggedLogo.position.x, localPoint.z - draggedLogo.position.z);
        if (dragMode === 'scale') {
          const startDistance = Math.max(0.5, dragVector.length());
          const nextScale = startScale * vector.length() / startDistance;
          // Deliberately unbounded: the artwork can extend beyond the lid.
          if (Number.isFinite(nextScale) && nextScale > 0.01) draggedLogo.scale.setScalar(nextScale);
        } else {
          draggedLogo.rotation.y = normalizeAngle(startRotation - (Math.atan2(vector.y, vector.x) - startAngle));
        }
      }
      syncLogoTransformControls(lid, draggedLogo);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!dragMode || !draggedLogo) return;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      logoTransformChangeRef.current({
        x: draggedLogo.position.x,
        z: draggedLogo.position.z,
        scale: draggedLogo.scale.x,
        rotation: draggedLogo.rotation.y,
      });
      dragMode = null;
      draggedLogo = null;
      controls.enabled = true;
      renderer.domElement.style.cursor = 'grab';
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedLogoRef.current || isTextEditingTarget(event.target) || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
      event.preventDefault();
      setLogoSelected(false);
      logoRemoveRef.current();
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);

    let frame = 0;
    const renderFrame = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(renderFrame);
    };
    renderFrame();

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown, true);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      controls.dispose();
      if (modelRef.current) disposeHolderModel(modelRef.current);
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const container = mount.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!container || !scene || !camera || !controls) return;

    const arrangementChanged = Boolean(modelRef.current)
      && props.part === 'both'
      && previousAssembledRef.current !== props.assembled;
    const previousArrangement = previousAssembledRef.current ? 'assembled' : 'print';
    const cameraStart = camera.position.clone();
    const controlsTargetStart = controls.target.clone();

    if (previousLogoSvgRef.current !== props.logoSvg) {
      selectedLogoRef.current = false;
      previousLogoSvgRef.current = props.logoSvg;
    }

    if (modelRef.current) {
      scene.remove(modelRef.current);
      disposeHolderModel(modelRef.current);
    }
    const model = buildHolderModel({
      depth: props.depth,
      cellWidth: props.cellWidth,
      embossed: props.embossed,
      texture: props.texture,
      fingerNotch: props.fingerNotch,
      part: props.part,
      logoSvg: props.logoSvg,
      logoScale: props.logoScale,
      logoX: props.logoX,
      logoZ: props.logoZ,
      logoRotation: props.logoRotation,
      logoForegroundOnly: props.logoForegroundOnly,
    }, {
      arrangement: props.assembled && props.part === 'both' ? 'assembled' : 'print',
      preview: true,
    });
    modelRef.current = model;
    scene.add(model);
    if (props.assembled && props.part !== 'body' && selectedLogoRef.current) addLogoTransformControls(model);

    let animationFrame = 0;
    const layoutKey = `${props.part}|${props.depth}|${props.resetToken}`;
    if (arrangementChanged) {
      const body = model.getObjectByName('holder-body')!;
      const lid = model.getObjectByName('holder-lid')!;

      applyHolderArrangement(model, props.depth, 'print');
      model.updateMatrixWorld(true);
      const printBody = capturePose(body);
      const printLid = capturePose(lid);
      const bodyBox = new THREE.Box3().setFromObject(body);
      const lidBox = new THREE.Box3().setFromObject(lid);
      const lidRadialClearance = Math.hypot(
        Math.max(
          Math.abs(lidBox.min.y - printLid.position.y),
          Math.abs(lidBox.max.y - printLid.position.y),
        ),
        Math.max(
          Math.abs(lidBox.min.z - printLid.position.z),
          Math.abs(lidBox.max.z - printLid.position.z),
        ),
      );
      const rotationY = bodyBox.max.y + lidRadialClearance + 3;

      applyHolderArrangement(model, props.depth, 'assembled');
      model.updateMatrixWorld(true);
      const assembledBody = capturePose(body);
      const assembledLid = capturePose(lid);
      const hoverY = assembledLid.position.y + LID_PLUG_HEIGHT + 4;

      const endProgress = props.assembled ? 1 : 0;
      applyAssemblyProgress(body, lid, printBody, assembledBody, printLid, assembledLid, rotationY, hoverY, endProgress);
      model.updateMatrixWorld(true);
      fitCamera(container, model, camera, controls, true);
      const cameraEnd = camera.position.clone();
      const controlsTargetEnd = controls.target.clone();

      // The rotation stage has the widest/tallest silhouette, so use it for
      // the roomy intermediate camera framing.
      applyAssemblyProgress(body, lid, printBody, assembledBody, printLid, assembledLid, rotationY, hoverY, 0.32);
      model.updateMatrixWorld(true);
      fitCamera(container, model, camera, controls, true);
      const cameraStage = camera.position.clone();
      const controlsTargetStage = controls.target.clone();

      const startProgress = previousArrangement === 'assembled' ? 1 : 0;
      applyAssemblyProgress(body, lid, printBody, assembledBody, printLid, assembledLid, rotationY, hoverY, startProgress);
      model.updateMatrixWorld(true);
      camera.position.copy(cameraStart);
      controls.target.copy(controlsTargetStart);
      controls.update();

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        applyAssemblyProgress(body, lid, printBody, assembledBody, printLid, assembledLid, rotationY, hoverY, endProgress);
        camera.position.copy(cameraEnd);
        controls.target.copy(controlsTargetEnd);
        controls.update();
        hasFramedRef.current = true;
        previousLayoutRef.current = layoutKey;
        previousResetTokenRef.current = props.resetToken;
        previousAssembledRef.current = props.assembled;
        return;
      }

      const startedAt = performance.now();
      const duration = 1900;
      controls.enabled = false;
      const animateAssembly = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const assemblyProgress = props.assembled ? progress : 1 - progress;
        applyAssemblyProgress(body, lid, printBody, assembledBody, printLid, assembledLid, rotationY, hoverY, assemblyProgress);

        const cameraToStage = segmentProgress(progress, 0, props.assembled ? 0.22 : 0.28);
        const cameraToEnd = segmentProgress(progress, props.assembled ? 0.78 : 0.82, 1);
        if (cameraToEnd === 0) {
          camera.position.lerpVectors(cameraStart, cameraStage, cameraToStage);
          controls.target.lerpVectors(controlsTargetStart, controlsTargetStage, cameraToStage);
        } else {
          camera.position.lerpVectors(cameraStage, cameraEnd, cameraToEnd);
          controls.target.lerpVectors(controlsTargetStage, controlsTargetEnd, cameraToEnd);
        }
        controls.update();
        if (progress < 1) {
          animationFrame = requestAnimationFrame(animateAssembly);
        } else {
          controls.enabled = true;
        }
      };
      animationFrame = requestAnimationFrame(animateAssembly);
      hasFramedRef.current = true;
    } else if (previousLayoutRef.current !== layoutKey) {
      const resetRequested = previousResetTokenRef.current !== props.resetToken;
      fitCamera(container, model, camera, controls, hasFramedRef.current && !resetRequested);
      hasFramedRef.current = true;
      previousLayoutRef.current = layoutKey;
      previousResetTokenRef.current = props.resetToken;
    }
    previousLayoutRef.current = layoutKey;
    previousResetTokenRef.current = props.resetToken;
    previousAssembledRef.current = props.assembled;

    return () => {
      cancelAnimationFrame(animationFrame);
      controls.enabled = true;
    };
  }, [props.depth, props.cellWidth, props.embossed, props.texture, props.fingerNotch, props.part, props.logoSvg, props.logoScale, props.logoX, props.logoZ, props.logoRotation, props.logoForegroundOnly, props.assembled, props.resetToken]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div
        ref={mount}
        className="absolute inset-0 cursor-grab touch-none overflow-hidden [&>canvas]:block active:cursor-grabbing"
        aria-label="Rotatable 3D model of the hex sticker holder"
      />
      <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-white/15 bg-[#063d4a]/80 px-3 py-2 font-mono text-[11px] text-[#dff5f0] backdrop-blur">
        Drag to rotate · Scroll to zoom
      </div>
    </div>
  );
}
