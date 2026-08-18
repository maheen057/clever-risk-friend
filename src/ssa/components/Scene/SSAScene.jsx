import { AdaptiveDpr, OrbitControls, PerspectiveCamera, Stars } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Earth } from "./Earth";
import { OrbitShells } from "./OrbitShells";
import { RadarSweep } from "./RadarSweep";
import { RiskHeatmap } from "./RiskHeatmap";
import { SatelliteField } from "./SatelliteField";
import { selectedObjectWorldPosition, hasSelectedObject } from "./positionSharing";
import { HoverTooltip } from "./HoverTooltip";

/**
 * CameraFocusController — reads the CANONICAL selected-object position
 * from positionSharing.js (written by SatelliteField every frame).
 *
 * On focusKey change:
 * 1. Waits for SatelliteField to write the canonical position (up to 1 frame).
 * 2. Captures the exact rendered position.
 * 3. Computes camera target position (dynamic distance based on orbital radius).
 * 4. Smoothly animates BOTH camera.position and controls.target in lockstep.
 * 5. Disables autoRotate during animation, restores it afterward.
 */
function CameraFocusController({ focusKey }) {
  const { camera, controls } = useThree();
  const stateRef = useRef({
    animating: false,
    autoRotateWasOn: false,
    startPos: new THREE.Vector3(),
    targetPos: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
    progress: 0,
  });

  useEffect(() => {
    if (!focusKey) return;

    let cancelled = false;

    function startAnimation() {
      if (cancelled) return;

      const pos = selectedObjectWorldPosition.clone();
      const orbitalRadius = pos.length();

      // Dynamic focus distance based on the object's actual orbital radius
      // LEO (~2.68) → ~2.5 units, GEO (~15.95) → ~6.8 units
      const focusDistance = Math.max(2.5, orbitalRadius * 0.35 + 1.0);

      // Camera sits offset from the object along the radial direction
      const offset = pos.clone().normalize().multiplyScalar(focusDistance);
      const cameraTarget = pos.clone().add(offset);

      const s = stateRef.current;
      s.startPos.copy(camera.position);
      s.targetPos.copy(cameraTarget);
      s.startTarget.copy(controls ? controls.target : new THREE.Vector3());
      s.endTarget.copy(pos);
      s.progress = 0;
      s.animating = true;

      if (controls) {
        s.autoRotateWasOn = controls.autoRotate;
        controls.autoRotate = false;
      }
    }

    // If the canonical position is already available (e.g. from a previous frame),
    // start immediately. Otherwise wait one frame for SatelliteField to write it.
    if (hasSelectedObject && selectedObjectWorldPosition.lengthSq() > 0.0001) {
      startAnimation();
    } else {
      const raf = requestAnimationFrame(() => {
        if (!cancelled && hasSelectedObject && selectedObjectWorldPosition.lengthSq() > 0.0001) {
          startAnimation();
        }
      });
    }

    return () => { cancelled = true; };
  }, [focusKey]);

  useFrame((_, delta) => {
    const s = stateRef.current;
    if (!s.animating) return;

    s.progress += delta * 0.55; // ~1.8 second animation
    const t = Math.min(1, s.progress);
    const smooth = t * t * (3 - 2 * t); // smoothstep

    camera.position.lerpVectors(s.startPos, s.targetPos, smooth);

    if (controls) {
      controls.target.lerpVectors(s.startTarget, s.endTarget, smooth);
      controls.update();
    }

    if (t >= 1) {
      s.animating = false;
      if (controls && s.autoRotateWasOn) {
        controls.autoRotate = true;
      }
    }
  });

  return null;
}

/**
 * InertialRotationController — keeps the globe coasting after a drag ends.
 *
 * OrbitControls' damping naturally provides the coast, but the constant
 * autoRotate would otherwise override it. We disable autoRotate while the
 * user is interacting and for a short grace period after release, letting
 * the damping-driven momentum carry the globe before resuming idle spin.
 */
function InertialRotationController({ baseSpeed = 0.24, resumeDelay = 1.2 }) {
  const { controls } = useThree();
  const timer = useRef(0);

  useEffect(() => {
    if (!controls) return;

    const onStart = () => {
      timer.current = 0;
      controls.autoRotate = false;
    };

    const onEnd = () => {
      timer.current = 0;
      controls.autoRotate = false;
    };

    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);

    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
    };
  }, [controls]);

  useFrame((_, delta) => {
    if (!controls || controls.autoRotate) return;

    timer.current += delta;
    if (timer.current > resumeDelay) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = baseSpeed;
    }
  });

  return null;
}


export function SSAScene({
  snapshot,
  filters,
  forecastHours,
  activeFrame,
  selectedObject,
  selectedRisk,
  onSelectObject,
  onSelectRisk,
  focusKey,
}) {
  const objects = snapshot?.objects || [];
  const riskCells = useMemo(() => {
    if (activeFrame?.cells?.length) return activeFrame.cells;
    return snapshot?.risk_cells || [];
  }, [activeFrame, snapshot]);

  return (
    <>
    <Canvas
      className="ssa-canvas"
      dpr={[1, 1.8]}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true }}
      camera={{ position: [0, 5.2, 11.5], fov: 49, near: 0.05, far: 90 }}
    >
      <color attach="background" args={["#02030a"]} />
      <fog attach="fog" args={["#05070d", 13, 48]} />
      <Suspense fallback={null}>
        <PerspectiveCamera makeDefault position={[0, 5.2, 11.5]} fov={49} near={0.05} far={90} />
        <ambientLight intensity={0.32} />
        <directionalLight position={[7, 5, 6]} intensity={2.25} color="#fff5dc" />
        <pointLight position={[-8, -2, -5]} intensity={1.4} color="#4de3ff" />
        <pointLight position={[4, 7, -8]} intensity={0.7} color="#ff6b9a" />

        <Stars radius={64} depth={46} count={4200} factor={4.3} saturation={0.2} fade speed={0.45} />
        <Earth />
        <OrbitShells objects={objects} filters={filters} />
        <RiskHeatmap
          riskCells={riskCells}
          filters={filters}
          forecastHours={forecastHours}
          selectedRisk={selectedRisk}
          onSelectRisk={onSelectRisk}
        />
        <SatelliteField
          objects={objects}
          filters={filters}
          forecastHours={forecastHours}
          selectedObject={selectedObject}
          onSelectObject={onSelectObject}
        />
        <RadarSweep forecastHours={forecastHours} />

        <EffectComposer multisampling={0}>
          <Bloom intensity={0.82} luminanceThreshold={0.15} luminanceSmoothing={0.42} mipmapBlur />
          <Vignette offset={0.22} darkness={0.58} />
        </EffectComposer>

        <CameraFocusController
          focusKey={focusKey}
        />

        <InertialRotationController />

        <OrbitControls
          enableDamping
          dampingFactor={0.045}
          autoRotate
          autoRotateSpeed={0.24}
          minDistance={4.8}
          maxDistance={32}
          rotateSpeed={0.85}
          zoomSpeed={0.82}
          enableRotate
          minAzimuthAngle={-Infinity}
          maxAzimuthAngle={Infinity}
          minPolarAngle={0}
          maxPolarAngle={Math.PI}
        />
        <AdaptiveDpr pixelated />
      </Suspense>
    </Canvas>
      <HoverTooltip />
    </>
  );
}
