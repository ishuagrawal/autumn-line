import * as THREE from 'three';
import { MAIN, PHOTO, groundHeight, trackbed } from './core/layout';

// Two ways of looking: the locked "photo" camera that reproduces the
// reference framing, and a free "explore" camera (drag look, WASD walk,
// wheel zoom) that starts from the same spot.

export type Mode = 'photo' | 'explore';

export class CameraRig {
  mode: Mode = 'photo';
  yaw = PHOTO.yaw;
  pitch = PHOTO.pitch;
  fov = PHOTO.fovY;
  targetFov = PHOTO.fovY;
  readonly pos = new THREE.Vector3(0, PHOTO.eye, 0);
  private keys = new Set<string>();
  private dragging = false;
  private last = { x: 0, y: 0 };
  dirty = true;
  onModeChange: (m: Mode) => void = () => {};

  constructor(private readonly camera: THREE.PerspectiveCamera, el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.last = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      if (this.mode === 'photo') this.setMode('explore', false);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
      const k = (this.fov / 60) * 0.0042;
      this.yaw += dx * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * k, -1.3, 1.3);
      this.dirty = true;
    });
    const end = (e: PointerEvent) => {
      this.dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.mode === 'photo') this.setMode('explore', false);
      this.targetFov = THREE.MathUtils.clamp(this.targetFov * Math.exp(e.deltaY * 0.0012), 8, 75);
      this.dirty = true;
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'q', 'e'].includes(k)) {
        this.keys.add(k);
        if (this.mode === 'photo' && k !== 'shift') this.setMode('explore', false);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setMode(m: Mode, widen = true): void {
    if (m === 'photo') {
      this.pos.set(0, PHOTO.eye, 0);
      this.yaw = PHOTO.yaw;
      this.pitch = PHOTO.pitch;
      this.targetFov = PHOTO.fovY;
      this.fov = PHOTO.fovY;
    } else if (widen && this.mode === 'photo') {
      this.targetFov = 50;
    }
    const changed = m !== this.mode;
    this.mode = m;
    this.dirty = true;
    if (changed) this.onModeChange(m);
  }

  /** vertical FOV that keeps the photo's 3:4 frame fully visible */
  private photoFov(aspect: number): number {
    if (aspect >= PHOTO.aspect) return PHOTO.fovY;
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(PHOTO.fovY / 2)) * PHOTO.aspect / aspect);
    return THREE.MathUtils.radToDeg(half * 2);
  }

  update(dt: number): void {
    const cam = this.camera;
    if (this.mode === 'explore') {
      const speed = (this.keys.has('shift') ? 9 : 3) * dt;
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const mv = new THREE.Vector3();
      if (this.keys.has('w') || this.keys.has('arrowup')) mv.add(f);
      if (this.keys.has('s') || this.keys.has('arrowdown')) mv.sub(f);
      if (this.keys.has('d') || this.keys.has('arrowright')) mv.add(r);
      if (this.keys.has('a') || this.keys.has('arrowleft')) mv.sub(r);
      if (mv.lengthSq() > 0) {
        mv.normalize().multiplyScalar(speed);
        this.pos.add(mv);
        this.dirty = true;
      }
      if (Math.abs(this.fov - this.targetFov) > 0.01) {
        this.fov += (this.targetFov - this.fov) * Math.min(1, dt * 5);
        this.dirty = true;
      }
      // keep eyes 1.7 m above whatever is underfoot
      const q = MAIN.project(this.pos.x, this.pos.z);
      let gy = groundHeight(this.pos.x, this.pos.z);
      if (Math.abs(q.u) < 1.6) gy = Math.max(gy, trackbed(q.s, q.u).h + 0.05);
      const want = gy + 1.7;
      this.pos.y += (want - this.pos.y) * Math.min(1, dt * 8);
      cam.fov = this.fov;
    } else {
      cam.fov = this.photoFov(cam.aspect);
    }
    cam.position.copy(this.pos);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
}
