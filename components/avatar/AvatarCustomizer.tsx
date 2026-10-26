"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";

const avatars = [
  { name: "Student", file: "student.glb" },
];

type AvatarOption = (typeof avatars)[number];

function AvatarPreview({ file }: { file: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let active = true;
    let model: THREE.Object3D | null = null;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 1.4, 4);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.8));

    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(3, 5, 4);
    scene.add(light);

    const fillLight = new THREE.DirectionalLight(0xffffff, 1);
    fillLight.position.set(-3, 2, -2);
    scene.add(fillLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minPolarAngle = Math.PI / 3;
    controls.maxPolarAngle = Math.PI / 1.8;
    controls.target.set(0, 1, 0);
    controls.update();

    const loader = new GLTFLoader();

    loader.load(
      `/avatar/${file}`,
      (gltf) => {
        if (!active) {
          gltf.scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.geometry.dispose();
            }
          });
          return;
        }

        model = gltf.scene;

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());

        model.position.x -= center.x;
        model.position.z -= center.z;
        model.position.y -= box.min.y;

        scene.add(model);

        const height = box.max.y - box.min.y;
        camera.position.set(0, height * 0.7, Math.max(height * 2.5, 2));
        controls.target.set(0, height * 0.5, 0);
        controls.update();
      },
      undefined,
      (error) => {
        console.error(`Failed to load avatar: ${file}`, error);
      },
    );

    let frame = 0;

    const render = () => {
      if (!active) return;
      frame = requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };

    render();

    const resizeObserver = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return;

      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });

    resizeObserver.observe(container);

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();

      if (model) {
        scene.remove(model);
      }

      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();

          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];

          materials.forEach((material) => material.dispose());
        }
      });

      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [file]);

  return <div ref={containerRef} className="h-full w-full" />;
}

export default function AvatarCustomizer({
  onSelect,
}: {
  onSelect?: (avatar: AvatarOption) => void;
}) {
  const [selected, setSelected] = useState(0);

  function select(index: number) {
    setSelected(index);
    onSelect?.(avatars[index]);
  }

  function move(direction: number) {
    select((selected + direction + avatars.length) % avatars.length);
  }

  return (
    <section className="w-full  overflow-hidden rounded-tl-sm rounded-tr-2xl rounded-br-2xl rounded-bl-2xl border border-white/15 bg-white/10 text-white backdrop-blur-[14px] [clip-path:polygon(20%_0%,80%_0%,100%_0,100%_80%,100%_100%,0_100%,0%_80%,0_34%)] ">
      <div className="relative lg:h-[350px] md:h-[175px] sm:h-[87px]">
        <AvatarPreview file={avatars[selected].file} />

        <span className="pointer-events-none font-orbitron absolute inset-x-0 bottom-3 text-center text-xs text-white/80">
          {avatars[selected].name}
        </span>
      </div>

      <div className="flex h-[57px] items-center gap-1 border-t border-white/10 bg-white/[0.025] px-2">
        <button
          type="button"
          onClick={() => move(-1)}
          aria-label="Previous avatar"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <ChevronLeft size={17} />
        </button>

        <div className="flex flex-1 items-center justify-center gap-2 overflow-x-auto py-2">
          {avatars.map((avatar, index) => (
            <button
              key={avatar.file}
              type="button"
              onClick={() => select(index)}
              aria-label={`Select ${avatar.name}`}
              aria-pressed={selected === index}
              className={`relative font-orbitron grid size-9 shrink-0 place-items-center rounded-xl border text-xs transition ${
                selected === index
                  ? "border-white bg-white/15 text-white"
                  : "border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/10"
              }`}
            >
              {index + 1}

              {selected === index && (
                <Check
                  size={11}
                  className="absolute -right-1 -top-1 rounded-full bg-white p-0.5 text-white"
                />
              )}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => move(1)}
          aria-label="Next avatar"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </section>
  );
}