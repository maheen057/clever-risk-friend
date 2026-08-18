import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const atmosphereVertex = `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const atmosphereFragment = `
varying vec3 vNormal;
void main() {
  float intensity = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.1);
  gl_FragColor = vec4(0.18, 0.78, 1.0, 1.0) * intensity;
}
`;

export function Earth() {
  const earthRef = useRef();
  const cloudRef = useRef();
  const glowRef = useRef();
  const earthTexture = useMemo(createEarthTexture, []);
  const cloudTexture = useMemo(createCloudTexture, []);

  useFrame((_, delta) => {
    if (earthRef.current) earthRef.current.rotation.y += delta * 0.035;
    if (cloudRef.current) cloudRef.current.rotation.y += delta * 0.052;
    if (glowRef.current) glowRef.current.rotation.y -= delta * 0.018;
  });

  return (
    <group>
      <mesh ref={earthRef}>
        <sphereGeometry args={[2, 96, 96]} />
        <meshStandardMaterial
          map={earthTexture}
          roughness={0.86}
          metalness={0.02}
          emissive="#061a20"
          emissiveIntensity={0.18}
        />
      </mesh>

      <mesh ref={cloudRef}>
        <sphereGeometry args={[2.045, 96, 96]} />
        <meshStandardMaterial
          map={cloudTexture}
          transparent
          opacity={0.28}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          color="#e4fbff"
          roughness={0.58}
        />
      </mesh>

      <mesh ref={glowRef} scale={[1.18, 1.18, 1.18]}>
        <sphereGeometry args={[2.02, 96, 96]} />
        <shaderMaterial
          vertexShader={atmosphereVertex}
          fragmentShader={atmosphereFragment}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
          transparent
          depthWrite={false}
        />
      </mesh>

      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.17, 2.23, 192]} />
        <meshBasicMaterial color="#31e6ff" transparent opacity={0.16} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function createEarthTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const ocean = ctx.createLinearGradient(0, 0, 0, canvas.height);
  ocean.addColorStop(0, "#092d46");
  ocean.addColorStop(0.5, "#0c4354");
  ocean.addColorStop(1, "#041826");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 2400; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const shade = 15 + Math.random() * 45;
    ctx.fillStyle = `rgba(${shade}, ${100 + shade}, ${120 + shade}, ${0.025 + Math.random() * 0.035})`;
    ctx.fillRect(x, y, 1.4, 1.4);
  }

  const landColor = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  landColor.addColorStop(0, "#4f7f55");
  landColor.addColorStop(0.48, "#b49f67");
  landColor.addColorStop(1, "#2f695e");
  ctx.fillStyle = landColor;

  drawContinent(ctx, [
    [130, 128],
    [196, 82],
    [270, 110],
    [305, 186],
    [270, 242],
    [192, 228],
    [132, 190],
  ]);
  drawContinent(ctx, [
    [300, 250],
    [362, 282],
    [390, 366],
    [344, 452],
    [292, 394],
    [270, 306],
  ]);
  drawContinent(ctx, [
    [492, 116],
    [624, 88],
    [748, 126],
    [800, 204],
    [720, 248],
    [588, 230],
    [476, 184],
  ]);
  drawContinent(ctx, [
    [638, 252],
    [710, 278],
    [746, 364],
    [696, 430],
    [618, 382],
    [596, 300],
  ]);
  drawContinent(ctx, [
    [796, 212],
    [902, 224],
    [944, 292],
    [900, 334],
    [806, 316],
    [760, 264],
  ]);

  ctx.strokeStyle = "rgba(216, 245, 255, 0.18)";
  ctx.lineWidth = 1.2;
  for (let y = 58; y < canvas.height; y += 62) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(240, y - 24, 512, y + 22, canvas.width, y - 10);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createCloudTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 260; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const width = 40 + Math.random() * 140;
    const height = 8 + Math.random() * 32;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, width);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.36)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x, y, width, height, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function drawContinent(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    const [x, y] = points[i];
    const [previousX, previousY] = points[i - 1];
    ctx.quadraticCurveTo(previousX + (x - previousX) * 0.45, previousY - 26, x, y);
  }
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 236, 176, 0.18)";
  ctx.lineWidth = 3;
  ctx.stroke();
}

