'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import {
  applyHolderArrangement,
  buildHolderModel,
  disposeHolderModel,
  LID_PLUG_HEIGHT,
  type HolderConfig,
} from '@/lib/holder-model';

type ViewerProps = HolderConfig & {
  assembled: boolean;
  resetToken: number;
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

    if (modelRef.current) {
      scene.remove(modelRef.current);
      disposeHolderModel(modelRef.current);
    }
    const model = buildHolderModel({
      depth: props.depth,
      cellWidth: props.cellWidth,
      embossed: props.embossed,
      texture: props.texture,
      part: props.part,
    }, {
      arrangement: props.assembled && props.part === 'both' ? 'assembled' : 'print',
      preview: true,
    });
    modelRef.current = model;
    scene.add(model);

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
  }, [props.depth, props.cellWidth, props.embossed, props.texture, props.part, props.assembled, props.resetToken]);

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
