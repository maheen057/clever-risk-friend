import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BAND_COLORS, degToRad, orbitPhase, orbitPositionTo } from "../../utils/orbitalMath";
import { selectedObjectWorldPosition, setHasSelectedObject } from "./positionSharing";
import { clearHoveredObject, moveHoverPointer, setHoveredObject } from "./hoverStore";

const tempObject = new THREE.Object3D();
const tempColor = new THREE.Color();
const tempVector = new THREE.Vector3();
const debrisPalette = ["#22c55e", "#4ade80", "#a3e635", "#84cc16", "#65a30d"];

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function formatPct(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n * 100)}%`;
}

function riskLabelFromSeverity(severity) {
  const s = (severity ?? "").toString().toLowerCase();
  if (s.includes("very")) return "Very Low";
  if (s.includes("low")) return "Low";
  if (s.includes("moderate") || s.includes("med")) return "Moderate";
  if (s.includes("elevated")) return "Elevated";
  if (s.includes("high")) return "High";
  if (s.includes("critical")) return "Critical";
  if (s.includes("extreme")) return "Extreme";
  return (severity ?? "Unknown").toString();
}

function debrisColorFor(object, index = 0) {
  let hash = index;
  const id = object?.id ?? "";
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % debrisPalette.length;
  }
  return debrisPalette[hash];
}

function regionLabelFromBand(band) {
  const s = (band ?? "").toString().toLowerCase();
  if (s.includes("leo")) return "LEO";
  if (s.includes("meo")) return "MEO";
  if (s.includes("geo")) return "GEO";
  if (s.includes("heo")) return "HEO";
  return band ? String(band) : null;
}

function safeToFixed(n, digits) {
  const x = safeNum(n);
  if (x === undefined) return null;
  return x.toFixed(digits);
}

function applyOrbitTransform(object, elapsedSeconds, forecastHours, scale) {
  orbitPositionTo(tempVector, object.orbit, elapsedSeconds, forecastHours);
  tempObject.position.copy(tempVector);
  tempObject.rotation.set(
    degToRad(object.orbit?.inclination_deg || 0) * 0.72,
    orbitPhase(object.orbit, elapsedSeconds, forecastHours) + Math.PI / 2,
    degToRad(object.orbit?.raan_deg || 0)
  );
  tempObject.scale.setScalar(scale);
  tempObject.updateMatrix();
}

function markInstanceUpdates(...meshes) {
  for (const mesh of meshes) {
    if (!mesh) continue;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    } else {
      const count = mesh.count || 0;
      if (count > 0) {
        const colors = new Float32Array(count * 3);
        colors.fill(1);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}

/**
 * SelectedBeacon — reads the CANONICAL position from positionSharing.js
 * instead of calculating its own position independently.
 * This guarantees the ring is exactly at the same position as the rendered instance.
 */
function SelectedBeacon() {
  const groupRef = useRef();
  const rotationRef = useRef(0);

  useFrame((_, delta) => {
    rotationRef.current += delta * 1.8;
    if (!groupRef.current) return;
    // Copy the EXACT canonical position that SatelliteField writes every frame
    groupRef.current.position.copy(selectedObjectWorldPosition);
    groupRef.current.rotation.y = rotationRef.current;
  });

  return (
    <group ref={groupRef}>
      {/* Outer ring beacon */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.24, 0.008, 8, 48]} />
        <meshBasicMaterial
          color="#ff00aa"
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Inner ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.14, 0.005, 8, 32]} />
        <meshBasicMaterial
          color="#ff69b4"
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Brighter point light for better visibility */}
      <pointLight color="#ff00aa" intensity={3.0} distance={2.5} />
    </group>
  );
}

export function SatelliteField({ objects, filters, forecastHours, selectedObject, onSelectObject }) {
  const { camera, gl } = useThree();

  const activeBodyRef = useRef();
  const activePanelRef = useRef();
  const activeGlowRef = useRef();
  const debrisCoreRef = useRef();
  const debrisGlowRef = useRef();

  const clusterGlowRef = useRef();
  const clusterCoreRef = useRef();

  const elapsedRef = useRef(0);

  const [hovered, setHovered] = useState(null);
  void hovered;
  // Note: HTML tooltips inside the R3F Canvas tree can cause runtime errors.
  // This component previously relied on a DOM overlay; to preserve globe rendering,
  // we omit the in-canvas tooltip markup when R3F cannot mount HTML elements.

  const visible = useMemo(() => {
    const base = (objects || []).filter((object) => {
      const categoryVisible = object.category === "debris" ? filters.debris : filters.active;
      return categoryVisible && filters[object.band];
    });
    // If selectedObject is not in the filtered list (e.g., hidden by filters),
    // force-include it so the selected object remains visible.
    if (selectedObject && !base.some((o) => o.id === selectedObject.id)) {
      return [...base, selectedObject];
    }
    return base;
  }, [objects, filters, selectedObject]);

  const activeObjects = useMemo(() => visible.filter((object) => object.category !== "debris"), [visible]);
  const debrisObjects = useMemo(() => visible.filter((object) => object.category === "debris"), [visible]);

  // Zoom-aware clutter management (renders fewer instances when camera is far).
  const densityMode = useMemo(() => {
    const dist = camera ? camera.position.length() : 12;
    if (dist < 10) return "detailed";
    if (dist < 16) return "balanced";
    return "compact";
  }, [camera]);

  const filteredActiveObjects = useMemo(() => {
    if (densityMode === "detailed") return activeObjects;
    const max = densityMode === "balanced" ? 160 : 90;
    const sorted = [...activeObjects].sort((a, b) => (b.collision_probability ?? 0) - (a.collision_probability ?? 0));
    return sorted.slice(0, Math.min(max, sorted.length));
  }, [activeObjects, densityMode]);

  const filteredDebrisObjects = useMemo(() => {
    if (densityMode === "detailed") return debrisObjects;
    const max = densityMode === "balanced" ? 190 : 110;
    const sorted = [...debrisObjects].sort((a, b) => (b.debris_density ?? 0) - (a.debris_density ?? 0));
    return sorted.slice(0, Math.min(max, sorted.length));
  }, [debrisObjects, densityMode]);

  const clusterKeyOf = (o) => {
    const category = o.category ?? "unknown";
    const band = o.band ?? "unknown";
    const inc = safeNum(o.orbit?.inclination_deg) ?? 0;
    const raan = safeNum(o.orbit?.raan_deg) ?? 0;

    const incBin = Math.round(inc / 4) * 4;
    const raanBin = Math.round(raan / 18) * 18;

    return `${category}|${band}|i${incBin}|raan${raanBin}`;
  };

  const clusters = useMemo(() => {
    // Build coarse clusters from the *currently rendered* sets to avoid heavy work.
    // Cluster representative = highest intensity object in that cluster.
    const all = [...filteredActiveObjects, ...filteredDebrisObjects];

    const map = new Map();
    for (const o of all) {
      const key = clusterKeyOf(o);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(o);
    }

    const list = [];
    for (const [key, arr] of map.entries()) {
      if (!arr.length) continue;
      const category = arr[0].category ?? "unknown";
      const band = arr[0].band ?? "unknown";
      const isDebris = category === "debris";

      const scored = arr
        .map((o) => {
          const intensity = isDebris ? safeNum(o.debris_density) ?? 0 : safeNum(o.collision_probability) ?? 0;
          return { o, intensity };
        })
        .sort((a, b) => b.intensity - a.intensity);

      const repr = scored[0]?.o ?? arr[0];
      const count = arr.length;
      const avgRisk = isDebris
        ? (scored.slice(0, Math.min(20, scored.length)).reduce((s, x) => s + (x.intensity ?? 0), 0) / Math.min(20, scored.length))
        : (scored.slice(0, Math.min(20, scored.length)).reduce((s, x) => s + (x.intensity ?? 0), 0) / Math.min(20, scored.length));

      list.push({ key, repr, category, band, count, avgRisk });
    }

    // Keep top clusters by avgRisk so the chart stays readable.
    list.sort((a, b) => (b.avgRisk ?? 0) - (a.avgRisk ?? 0));
    return list.slice(0, densityMode === "detailed" ? 18 : 24);
  }, [filteredActiveObjects, filteredDebrisObjects, densityMode]);

  const updateClustersInstances = (glowMesh, coreMesh) => {
    if (!glowMesh || !coreMesh) return;

    const count = clusters.length;
    glowMesh.count = Math.max(1, count);
    coreMesh.count = Math.max(1, count);

    for (let i = 0; i < count; i += 1) {
      const c = clusters[i];
      const o = c.repr;

      const intensity = c.category === "debris" ? safeNum(o.debris_density) ?? 0 : safeNum(o.collision_probability) ?? 0;
      const emphasis = c.category === "debris" ? 0.9 + Math.min(1.5, intensity * 1.25) : 0.95 + Math.min(1.5, intensity * 1.35);

      // Use representative object orbit to position cluster glyph.
      applyOrbitTransform(o, elapsedRef.current, forecastHours, emphasis);

      // Cluster glyph shape: use sphere for glow and smaller core.
      const baseScale = 0.11 + Math.min(1.2, c.count * 0.014) + Math.min(0.9, intensity * 0.35);
      tempObject.scale.setScalar(baseScale);
      tempObject.updateMatrix();

      glowMesh.setMatrixAt(i, tempObject.matrix);
      coreMesh.setMatrixAt(i, tempObject.matrix);

      const isDebris = c.category === "debris";
      const baseColor = isDebris ? new THREE.Color(debrisColorFor(o, i)) : new THREE.Color(BAND_COLORS[o.band] || "#38bdf8");

      const glowCol = baseColor.clone().multiplyScalar(0.42 + Math.min(1, intensity) * 1.2);
      const coreCol = baseColor.clone().multiplyScalar(0.55 + Math.min(1, intensity) * 1.35);

      glowMesh.setColorAt(i, glowCol);
      coreMesh.setColorAt(i, coreCol);

      // Slight pulse via scale multiplier on the instance itself (no animation curves).
      tempObject.scale.setScalar(baseScale * (1 + Math.min(0.15, intensity * 0.08)));
      tempObject.updateMatrix();
      glowMesh.setMatrixAt(i, tempObject.matrix);
      coreMesh.setMatrixAt(i, tempObject.matrix);
    }

    markInstanceUpdates(glowMesh, coreMesh);
  };

  const updateSatelliteInstances = (bodyMesh, panelMesh, glowMesh, objs) => {
    if (!bodyMesh || !panelMesh || !glowMesh) return;

    for (let i = 0; i < objs.length; i += 1) {
      const object = objs[i];
      const p = safeNum(object.collision_probability) ?? 0;
      const isSelected = selectedObject?.id && object.id === selectedObject.id;

      // Selected satellite gets larger scale and much brighter glow
      const selectedScale = isSelected ? 1.4 : 1.0;
      const emphasis = (0.95 + Math.min(1, p) * 1.35) * selectedScale;
      applyOrbitTransform(object, elapsedRef.current, forecastHours, emphasis);

      bodyMesh.setMatrixAt(i, tempObject.matrix);
      panelMesh.setMatrixAt(i, tempObject.matrix);

      if (isSelected) {
        // Selected satellite → magenta
        tempColor.setHex(0xff00aa);
        bodyMesh.setColorAt(i, tempColor);
        panelMesh.setColorAt(i, tempColor);
      } else {
        // Unselected satellite → white
        tempColor.setHex(0xffffff);
        bodyMesh.setColorAt(i, tempColor);
        const panelCol = new THREE.Color("#f1f5f9");
        panelMesh.setColorAt(i, panelCol);
      }

      // Glow: selected → much bigger, stronger magenta glow
      const glowScale = (1.05 + Math.min(1, p) * 1.5) * (isSelected ? 2.5 : 1.0);
      tempObject.scale.setScalar(glowScale);
      tempObject.updateMatrix();
      glowMesh.setMatrixAt(i, tempObject.matrix);

      const glowIntensity = isSelected ? 1.5 : (0.6 + Math.min(1, p) * 0.9);
      const glowCol = new THREE.Color(isSelected ? "#ff00aa" : "#ffffff").multiplyScalar(glowIntensity);
      glowMesh.setColorAt(i, glowCol);
    }

    markInstanceUpdates(bodyMesh, panelMesh, glowMesh);
  };

  const updateDebrisInstances = (coreMesh, glowMesh, objs) => {
    if (!coreMesh || !glowMesh) return;

    for (let i = 0; i < objs.length; i += 1) {
      const object = objs[i];
      const d = safeNum(object.debris_density) ?? 0;
      const isSelected = selectedObject?.id && object.id === selectedObject.id;

      // Selected debris gets larger scale
      const selectedScale = isSelected ? 1.6 : 1.0;
      const emphasis = (0.82 + d * 1.25) * selectedScale;
      applyOrbitTransform(object, elapsedRef.current, forecastHours, emphasis);

      tempObject.rotation.x += i * 0.19;
      tempObject.rotation.z += i * 0.13;
      tempObject.updateMatrix();

      coreMesh.setMatrixAt(i, tempObject.matrix);

      if (isSelected) {
        // Selected debris → magenta
        const magenta = new THREE.Color("#ff00aa");
        coreMesh.setColorAt(i, magenta);
      } else {
        // Unselected debris → green from palette
        const col = new THREE.Color(debrisColorFor(object, i));
        const coreCol = col.clone().multiplyScalar(0.95 + d * 0.4);
        coreMesh.setColorAt(i, coreCol);
      }

      const glowScale = (1.05 + d * 1.35) * (isSelected ? 2.8 : 1.0);
      tempObject.scale.setScalar(glowScale);
      tempObject.updateMatrix();

      glowMesh.setMatrixAt(i, tempObject.matrix);

      if (isSelected) {
        const magentaGlow = new THREE.Color("#ff00aa").multiplyScalar(1.2 + d * 0.6);
        glowMesh.setColorAt(i, magentaGlow);
      } else {
        const col = new THREE.Color(debrisColorFor(object, i));
        const glowCol = col.clone().multiplyScalar(0.75 + d * 0.6);
        glowMesh.setColorAt(i, glowCol);
      }
    }

    markInstanceUpdates(coreMesh, glowMesh);
  };

  useFrame((_, delta) => {
    elapsedRef.current += delta;

    // ── Canonical selected-object position ──────────────────────────
    // Compute ONCE here using the SAME elapsedRef.current and forecastHours
    // that will be used to render the instances below.
    // This is the SINGLE source of truth for the selected object's position.
    if (selectedObject && selectedObject.orbit) {
      orbitPositionTo(selectedObjectWorldPosition, selectedObject.orbit, elapsedRef.current, forecastHours);
      setHasSelectedObject(true);
    } else {
      setHasSelectedObject(false);
    }

    // Cluster glyphs (non-interactive): provides higher-level orbital activity context.
    updateClustersInstances(clusterGlowRef.current, clusterCoreRef.current);

    updateSatelliteInstances(activeBodyRef.current, activePanelRef.current, activeGlowRef.current, filteredActiveObjects);
    updateDebrisInstances(debrisCoreRef.current, debrisGlowRef.current, filteredDebrisObjects);
  });

  const handleActiveClick = (event) => {
    event.stopPropagation();
    const item = filteredActiveObjects[event.instanceId];
    if (item) onSelectObject(item);
  };

  const handleDebrisClick = (event) => {
    event.stopPropagation();
    const item = filteredDebrisObjects[event.instanceId];
    if (item) onSelectObject(item);
  };

  const pointerXY = (event) => {
    const native = event?.nativeEvent ?? event;
    return { x: native?.clientX ?? 0, y: native?.clientY ?? 0 };
  };

  const hoverFrom = (list) => (event) => {
    const idx = event.instanceId;
    if (idx == null) return;
    const item = list[idx];
    if (!item) return;
    const { x, y } = pointerXY(event);
    setHovered(item);
    setHoveredObject(item, x, y);
    if (gl?.domElement) gl.domElement.style.cursor = "pointer";
  };

  const moveFrom = (list) => (event) => {
    const idx = event.instanceId;
    if (idx == null) return;
    const item = list[idx];
    if (!item) return;
    const { x, y } = pointerXY(event);
    setHoveredObject(item, x, y);
  };

  const clearHover = () => {
    setHovered(null);
    clearHoveredObject(null);
    if (gl?.domElement) gl.domElement.style.cursor = "auto";
  };

  const handleActiveHover = hoverFrom(filteredActiveObjects);
  const handleDebrisHover = hoverFrom(filteredDebrisObjects);
  const handleActiveMove = moveFrom(filteredActiveObjects);
  const handleDebrisMove = moveFrom(filteredDebrisObjects);

  return (
    <>
      <group>
        {/* Cluster glyph layer (non-interactive): rendered behind individuals */}
        <instancedMesh
          ref={clusterGlowRef}
          key={`cluster-glow-${clusters.length}-${densityMode}`}
          args={[undefined, undefined, Math.max(1, clusters.length)]}
          frustumCulled={false}
          raycast={false}
        >
          <sphereGeometry args={[0.028, 10, 10]} />
          <meshBasicMaterial
            transparent
            opacity={0.18}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
            vertexColors
          />
        </instancedMesh>

        <instancedMesh
          ref={clusterCoreRef}
          key={`cluster-core-${clusters.length}-${densityMode}`}
          args={[undefined, undefined, Math.max(1, clusters.length)]}
          frustumCulled={false}
          raycast={false}
        >
          <sphereGeometry args={[0.016, 8, 8]} />
          <meshBasicMaterial transparent opacity={0.72} toneMapped={false} depthWrite={false} vertexColors />
        </instancedMesh>

        <instancedMesh
          ref={activeGlowRef}
          key={`active-glow-${filteredActiveObjects.length}-${densityMode}`}
          args={[undefined, undefined, filteredActiveObjects.length]}
          frustumCulled={false}
          onClick={handleActiveClick}
          onPointerOver={(e) => {
            e.stopPropagation();
            handleActiveHover(e);
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            handleActiveMove(e);
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            clearHover();
          }}
        >
          <sphereGeometry args={[0.062, 12, 12]} />
          <meshBasicMaterial
            vertexColors
            transparent
            opacity={0.52}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </instancedMesh>

        <instancedMesh
          ref={activePanelRef}
          key={`active-panels-${filteredActiveObjects.length}-${densityMode}`}
          args={[undefined, undefined, filteredActiveObjects.length]}
          frustumCulled={false}
          onClick={handleActiveClick}
          onPointerOver={(e) => {
            e.stopPropagation();
            handleActiveHover(e);
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            handleActiveMove(e);
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            clearHover();
          }}
        >
          <boxGeometry args={[0.105, 0.012, 0.03]} />
          <meshBasicMaterial vertexColors transparent opacity={0.92} toneMapped={false} />
        </instancedMesh>

        <instancedMesh
          ref={activeBodyRef}
          key={`active-body-${filteredActiveObjects.length}-${densityMode}`}
          args={[undefined, undefined, filteredActiveObjects.length]}
          frustumCulled={false}
          onClick={handleActiveClick}
          onPointerOver={(e) => {
            e.stopPropagation();
            handleActiveHover(e);
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            handleActiveMove(e);
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            clearHover();
          }}
        >
          <boxGeometry args={[0.038, 0.038, 0.05]} />
          <meshBasicMaterial vertexColors transparent opacity={0.98} toneMapped={false} />
        </instancedMesh>

        <instancedMesh
          ref={debrisGlowRef}
          key={`debris-glow-${filteredDebrisObjects.length}-${densityMode}`}
          args={[undefined, undefined, filteredDebrisObjects.length]}
          frustumCulled={false}
          onClick={handleDebrisClick}
          onPointerOver={(e) => {
            e.stopPropagation();
            handleDebrisHover(e);
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            handleDebrisMove(e);
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            clearHover();
          }}
        >
          <sphereGeometry args={[0.055, 12, 12]} />
          <meshBasicMaterial
            vertexColors
            transparent
            opacity={0.52}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </instancedMesh>

        <instancedMesh
          ref={debrisCoreRef}
          key={`debris-core-${filteredDebrisObjects.length}-${densityMode}`}
          args={[undefined, undefined, filteredDebrisObjects.length]}
          frustumCulled={false}
          onClick={handleDebrisClick}
          onPointerOver={(e) => {
            e.stopPropagation();
            handleDebrisHover(e);
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            handleDebrisMove(e);
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            clearHover();
          }}
        >
          <sphereGeometry args={[0.032, 12, 12]} />
          <meshBasicMaterial vertexColors transparent opacity={0.96} toneMapped={false} />
        </instancedMesh>

        {selectedObject ? <SelectedBeacon /> : null}
      </group>

    </>
  );
}
