/**
 * positionSharing.js
 *
 * A SINGLE mutable Vector3 that is written by SatelliteField every frame
 * (with the exact canonical rendered position of the selected object)
 * and read by SelectedBeacon and CameraFocusController.
 *
 * This guarantees that the selection ring, camera focus, and rendered mesh
 * all use the EXACT same 3D position.
 *
 * There is no React state involved — this is a raw Three.js Vector3 that
 * avoids triggering re-renders on every frame.
 */
import * as THREE from "three";

/** The one and only canonical selected-object world position. */
export const selectedObjectWorldPosition = new THREE.Vector3();

/**
 * Whether a selected object is currently active.
 * Set by SatelliteField when a selected object exists.
 */
export let hasSelectedObject = false;

export function setHasSelectedObject(value) {
  hasSelectedObject = value;
}

