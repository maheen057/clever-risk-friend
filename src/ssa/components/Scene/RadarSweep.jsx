import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

export function RadarSweep({ forecastHours }) {
  const sweepRef = useRef();
  const pulseRef = useRef();

  useFrame((_, delta) => {
    if (sweepRef.current) sweepRef.current.rotation.y += delta * (0.44 + forecastHours * 0.0015);
    if (pulseRef.current) {
      pulseRef.current.scale.setScalar(1 + (Math.sin(performance.now() * 0.002) + 1) * 0.055);
      pulseRef.current.rotation.z -= delta * 0.18;
    }
  });

  return (
    <group>
      <mesh ref={sweepRef} rotation={[0, 0, -0.32]}>
        <coneGeometry args={[9.5, 0.03, 96, 1, true, 0, Math.PI * 0.22]} />
        <meshBasicMaterial color="#31e6ff" transparent opacity={0.1} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      <group ref={pulseRef}>
        {[3.1, 5.8, 9.2, 14.8].map((radius) => (
          <mesh key={radius} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius, 0.004, 8, 192]} />
            <meshBasicMaterial color={radius > 10 ? "#ff8a3d" : "#31e6ff"} transparent opacity={0.12} blending={THREE.AdditiveBlending} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

