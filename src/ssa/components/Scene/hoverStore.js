// Lightweight pub/sub store shared between the 3D scene (inside <Canvas>) and
// the DOM tooltip rendered next to the canvas. Keeping the tooltip outside the
// R3F tree avoids the HTML-in-canvas runtime errors we hit previously.

let state = { object: null, x: 0, y: 0 };
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener(state);
}

export function subscribeHover(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function getHoverState() {
  return state;
}

export function setHoveredObject(object, x, y) {
  if (!object) return;
  state = { object, x, y };
  emit();
}

export function moveHoverPointer(x, y) {
  if (!state.object) return;
  state = { ...state, x, y };
  emit();
}

export function clearHoveredObject(object) {
  // Ignore stale pointer-out events fired by a layer we already left.
  if (object && state.object && state.object.id !== object.id) return;
  if (!state.object) return;
  state = { object: null, x: state.x, y: state.y };
  emit();
}
