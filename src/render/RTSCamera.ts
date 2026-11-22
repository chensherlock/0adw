import * as THREE from 'three';
import { TerrainMap } from '../sim/map/TerrainMap';

export class RTSCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();

  // Smooth damped goals for buttery 0 A.D.-style camera feel (yaw = 0 aligns North/-Z Up & East/+X Right 1:1 with Minimap!)
  private readonly desiredTarget = new THREE.Vector3();
  yaw = 0;
  private desiredYaw = 0;
  distance = 44;
  private desiredDistance = 44;
  minDistance = 15;
  maxDistance = 96;

  edgeScrollEnabled = true;

  private readonly keys = new Set<string>();
  private readonly worldSize: number;
  private readonly terrain: TerrainMap;

  // Mouse drag pan / rotate state (supports both Middle-Drag and Right-Drag)
  private activeDragButton: number | null = null; // 1 = middle, 2 = right
  private dragStartX = 0;
  private dragStartY = 0;
  private lastDragX = 0;
  private lastDragY = 0;
  private isDraggingPan = false;
  private isDraggingRotate = false;
  private readonly dragAnchorWorld = new THREE.Vector3();
  private readonly dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycaster = new THREE.Raycaster();

  // Edge scroll pointer state
  private mouseClientX = -1;
  private mouseClientY = -1;
  private pointerInsideWindow = false;
  private pointerOverHud = false;
  private isLeftBoxDragging = false;
  private domElement: HTMLElement | null = null;

  constructor(aspect: number, terrain: TerrainMap) {
    this.terrain = terrain;
    this.worldSize = terrain.worldSize;
    this.camera = new THREE.PerspectiveCamera(46, aspect, 0.5, 460);

    const spawn = terrain.spawns[0];
    const pos = terrain.tileToWorldCenter(spawn.tileX, spawn.tileZ);
    const y = Math.max(0.2, terrain.getHeightAt(pos.x, pos.z));
    this.target.set(pos.x, y, pos.z);
    this.desiredTarget.copy(this.target);
    this.syncCameraTransform();
  }

  /** True if the user is actively dragging the map with right/middle mouse */
  isMapDragging(): boolean {
    return this.isDraggingPan || this.isDraggingRotate;
  }

  private raycastHorizontalPlane(clientX: number, clientY: number, planeY: number, out: THREE.Vector3): boolean {
    if (!this.domElement) return false;
    const rect = this.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    this.dragPlane.constant = -planeY;
    return this.raycaster.ray.intersectPlane(this.dragPlane, out) !== null;
  }

  attachListeners(domElement: HTMLElement): () => void {
    this.domElement = domElement;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      this.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };

    // Smooth Zoom-toward-Cursor (0 A.D. style!)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Support Mac trackpad 2-finger pan when Ctrl is not pressed? Wait: wheel zoom is universal,
      // and zooming toward the cursor lets you navigate effortlessly with just the wheel!
      const beforeHit = new THREE.Vector3();
      const hasHit = this.raycastHorizontalPlane(e.clientX, e.clientY, this.desiredTarget.y, beforeHit);

      // Normalize delta across mouse wheels & trackpads
      const clampedDelta = Math.max(-120, Math.min(120, e.deltaY));
      const zoomFactor = 1 + (clampedDelta / 100) * 0.14;
      const oldDist = this.desiredDistance;
      const newDist = Math.max(this.minDistance, Math.min(this.maxDistance, oldDist * zoomFactor));
      this.desiredDistance = newDist;

      // Shift target subtly toward cursor when zooming in (feels super intuitive!)
      if (hasHit && newDist < oldDist) {
        const pull = (1 - newDist / oldDist) * 0.45;
        this.desiredTarget.x += (beforeHit.x - this.desiredTarget.x) * pull;
        this.desiredTarget.z += (beforeHit.z - this.desiredTarget.z) * pull;
        this.clampDesiredTarget();
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        this.isLeftBoxDragging = true;
      } else if (e.button === 1 || e.button === 2) {
        if (e.button === 1) e.preventDefault();
        this.activeDragButton = e.button;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.lastDragX = e.clientX;
        this.lastDragY = e.clientY;
        this.isDraggingPan = false;
        this.isDraggingRotate = false;
        this.raycastHorizontalPlane(e.clientX, e.clientY, this.target.y, this.dragAnchorWorld);
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      this.mouseClientX = e.clientX;
      this.mouseClientY = e.clientY;
      this.pointerInsideWindow = true;

      // Check if cursor is hovering over interactive HUD buttons or modals
      const targetEl = e.target as HTMLElement | null;
      this.pointerOverHud = Boolean(
        targetEl &&
          (targetEl.closest('#top-bar') ||
            targetEl.closest('#bottom-dock') ||
            targetEl.closest('.modal-backdrop:not(.hidden)'))
      );

      if (this.activeDragButton !== null) {
        const totalMove = Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY);
        const dx = e.clientX - this.lastDragX;
        const dy = e.clientY - this.lastDragY;
        this.lastDragX = e.clientX;
        this.lastDragY = e.clientY;

        if (!this.isDraggingPan && !this.isDraggingRotate && totalMove > 6) {
          if (e.ctrlKey || (this.activeDragButton === 1 && (e.shiftKey || e.altKey))) {
            this.isDraggingRotate = true;
          } else {
            this.isDraggingPan = true;
            this.raycastHorizontalPlane(e.clientX, e.clientY, this.target.y, this.dragAnchorWorld);
          }
          domElement.style.cursor = this.isDraggingRotate ? 'ew-resize' : 'grabbing';
        }

        if (this.isDraggingRotate) {
          this.desiredYaw -= dx * 0.0065;
        } else if (this.isDraggingPan) {
          // 1:1 world-grounded grab pan (feels identical to grabbing the battlefield directly!)
          const curHit = new THREE.Vector3();
          if (this.raycastHorizontalPlane(e.clientX, e.clientY, this.dragAnchorWorld.y, curHit)) {
            const shiftX = this.dragAnchorWorld.x - curHit.x;
            const shiftZ = this.dragAnchorWorld.z - curHit.z;
            // Clamp huge ray shifts at shallow horizon angles
            const shiftLen = Math.hypot(shiftX, shiftZ);
            const maxShift = this.distance * 0.45;
            const scale = shiftLen > maxShift ? maxShift / shiftLen : 1;
            this.desiredTarget.x += shiftX * scale;
            this.desiredTarget.z += shiftZ * scale;
            this.clampDesiredTarget();
            // Apply immediately for zero-lag ground grab feel
            this.target.x = this.desiredTarget.x;
            this.target.z = this.desiredTarget.z;
            this.target.y = this.desiredTarget.y;
            this.syncCameraTransform();
            this.raycastHorizontalPlane(e.clientX, e.clientY, this.dragAnchorWorld.y, this.dragAnchorWorld);
          } else {
            const panScale = this.distance * 0.0028;
            this.panRelative(-dx * panScale, dy * panScale);
          }
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        this.isLeftBoxDragging = false;
      }
      if (e.button === this.activeDragButton) {
        this.activeDragButton = null;
        this.isDraggingPan = false;
        this.isDraggingRotate = false;
        domElement.style.cursor = '';
      }
    };

    const onMouseLeaveDoc = () => {
      this.pointerInsideWindow = false;
    };

    const onBlur = () => {
      this.keys.clear();
      this.activeDragButton = null;
      this.isDraggingPan = false;
      this.isDraggingRotate = false;
      this.isLeftBoxDragging = false;
      this.pointerInsideWindow = false;
      domElement.style.cursor = '';
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('mouseleave', onMouseLeaveDoc);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mouseleave', onMouseLeaveDoc);
      domElement.removeEventListener('wheel', onWheel);
      domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      domElement.style.cursor = '';
    };
  }

  private panRelative(rightDelta: number, forwardDelta: number): void {
    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    this.desiredTarget.x += rightX * rightDelta + fwdX * forwardDelta;
    this.desiredTarget.z += rightZ * rightDelta + fwdZ * forwardDelta;
    this.clampDesiredTarget();
  }

  private clampDesiredTarget(): void {
    const pad = 8;
    this.desiredTarget.x = Math.max(pad, Math.min(this.worldSize - pad, this.desiredTarget.x));
    this.desiredTarget.z = Math.max(pad, Math.min(this.worldSize - pad, this.desiredTarget.z));
    this.desiredTarget.y = Math.max(0.2, this.terrain.getHeightAt(this.desiredTarget.x, this.desiredTarget.z));
  }

  jumpTo(x: number, z: number): void {
    this.desiredTarget.x = x;
    this.desiredTarget.z = z;
    this.clampDesiredTarget();
    this.target.copy(this.desiredTarget);
    this.syncCameraTransform();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    const panSpeed = (28 + this.distance * 0.85) * dt;
    let right = 0;
    let forward = 0;

    // 1. Keyboard pan
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right -= 1;

    // 2. Smooth 0 A.D.-style Screen-Edge Scrolling
    if (
      this.edgeScrollEnabled &&
      this.pointerInsideWindow &&
      !this.isDraggingPan &&
      !this.isDraggingRotate &&
      !this.isLeftBoxDragging
    ) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const edgePx = 28;
      // Only scroll over HUD if pushed to the outermost 8px screen bezel
      const effectiveEdge = this.pointerOverHud ? 8 : edgePx;

      let edgeRight = 0;
      let edgeForward = 0;
      if (this.mouseClientX >= 0 && this.mouseClientX < effectiveEdge) {
        edgeRight -= (effectiveEdge - this.mouseClientX) / effectiveEdge;
      } else if (this.mouseClientX > w - effectiveEdge) {
        edgeRight += (this.mouseClientX - (w - effectiveEdge)) / effectiveEdge;
      }
      if (this.mouseClientY >= 0 && this.mouseClientY < effectiveEdge) {
        edgeForward += (effectiveEdge - this.mouseClientY) / effectiveEdge;
      } else if (this.mouseClientY > h - effectiveEdge) {
        edgeForward -= (this.mouseClientY - (h - effectiveEdge)) / effectiveEdge;
      }

      // Smooth ramp curve (0.45 base + 0.55 ramp) so edge scrolling feels snappy yet controllable
      if (edgeRight !== 0) right += Math.sign(edgeRight) * (0.45 + 0.55 * Math.abs(edgeRight));
      if (edgeForward !== 0) forward += Math.sign(edgeForward) * (0.45 + 0.55 * Math.abs(edgeForward));
    }

    if (right !== 0 || forward !== 0) {
      const len = Math.hypot(right, forward);
      const mag = Math.min(1.15, len);
      this.panRelative((right / len) * panSpeed * mag, (forward / len) * panSpeed * mag);
    }

    if (this.keys.has('KeyQ')) this.desiredYaw += 1.65 * dt;
    if (this.keys.has('KeyE')) this.desiredYaw -= 1.65 * dt;

    // 3. Smooth exponential damping for silky camera motion
    const smooth = 1 - Math.exp(-14 * dt);
    this.target.lerp(this.desiredTarget, smooth);
    this.distance += (this.desiredDistance - this.distance) * smooth;
    this.yaw += (this.desiredYaw - this.yaw) * smooth;

    this.syncCameraTransform();
  }

  private syncCameraTransform(): void {
    const t = (this.distance - this.minDistance) / (this.maxDistance - this.minDistance);
    const pitch = THREE.MathUtils.lerp(0.72, 1.1, t);

    const horiz = Math.cos(pitch) * this.distance;
    const vert = Math.sin(pitch) * this.distance;

    const camX = this.target.x + Math.sin(this.yaw) * horiz;
    const camZ = this.target.z + Math.cos(this.yaw) * horiz;
    const camY = this.target.y + vert;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  getMinimapViewportPolygon(): Array<{ x: number; z: number }> {
    const corners = [
      new THREE.Vector2(-1, -1),
      new THREE.Vector2(1, -1),
      new THREE.Vector2(1, 1),
      new THREE.Vector2(-1, 1),
    ];
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.5);
    const hit = new THREE.Vector3();
    const result: Array<{ x: number; z: number }> = [];

    for (const c of corners) {
      this.raycaster.setFromCamera(c, this.camera);
      if (this.raycaster.ray.intersectPlane(plane, hit)) {
        result.push({ x: hit.x, z: hit.z });
      }
    }
    return result;
  }
}
