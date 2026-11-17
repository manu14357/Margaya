import { Grid3x3, Maximize, Minimize, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import {
  IconButton,
  LoadingState,
  Notice,
  Separator,
  Toolbar,
} from "../components/ui";
import { usePreview } from "../context";
import { useFullscreen } from "../hooks";
import type { RendererProps } from "../types";

type Scene = {
  setWireframe: (on: boolean) => void;
  resetView: () => void;
};

/** Every geometry, material and texture under `root`, disposed. */
function disposeTree(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && typeof value === "object" && "isTexture" in value) {
          (value as THREE.Texture).dispose();
        }
      }
      material.dispose();
    }
  });
}

/** Turns data: URIs in a .gltf into blob: URLs it can fetch, revoked later. */
function dataUriModifier(urls: string[]) {
  return (url: string) => {
    if (!url.startsWith("data:")) return url;
    const comma = url.indexOf(",");
    const meta = url.slice(5, comma);
    const payload = url.slice(comma + 1);
    const bytes = meta.endsWith(";base64")
      ? Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload));
    const blobUrl = URL.createObjectURL(
      new Blob([bytes], {
        type: meta.replace(/;base64$/, "") || "application/octet-stream",
      }),
    );
    urls.push(blobUrl);
    return blobUrl;
  };
}

/**
 * STL, OBJ, GLB and GLTF models: orbit controls, the camera
 * fitted to the model, soft lighting and a wireframe toggle. Everything
 * GPU-side is disposed when the preview closes. Files a .gltf references
 * by path are not available here; embedded and binary models work.
 */
export default function Model3dRenderer({
  source,
  file,
  bytes,
}: RendererProps) {
  const { labels, theme, rootRef } = usePreview();
  const mountRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [wireframe, setWireframe] = useState(false);
  const fullscreen = useFullscreen(rootRef);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !bytes) return;
    let cancelled = false;
    const blobUrls: string[] = [];
    const cleanup: Array<() => void> = [];

    (async () => {
      const [three, { OrbitControls }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/controls/OrbitControls.js"),
      ]);
      if (cancelled) return;
      const data = bytes.slice().buffer;
      let object: THREE.Object3D;
      const neutral = new three.MeshStandardMaterial({
        color: 0xb8c2bd,
        metalness: 0.1,
        roughness: 0.65,
      });
      if (file.extension === "stl") {
        const { STLLoader } = await import(
          "three/examples/jsm/loaders/STLLoader.js"
        );
        const geometry = new STLLoader().parse(data);
        geometry.computeVertexNormals();
        const material = geometry.hasAttribute("color")
          ? new three.MeshStandardMaterial({
              vertexColors: true,
              roughness: 0.65,
            })
          : neutral;
        object = new three.Mesh(geometry, material);
      } else if (file.extension === "obj") {
        const { OBJLoader } = await import(
          "three/examples/jsm/loaders/OBJLoader.js"
        );
        object = new OBJLoader().parse(new TextDecoder().decode(bytes));
        object.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            const old = mesh.material;
            for (const material of Array.isArray(old) ? old : [old]) {
              material.dispose();
            }
            mesh.material = neutral;
          }
        });
      } else {
        const { GLTFLoader } = await import(
          "three/examples/jsm/loaders/GLTFLoader.js"
        );
        const manager = new three.LoadingManager();
        manager.setURLModifier(dataUriModifier(blobUrls));
        const loader = new GLTFLoader(manager);
        const gltf = await loader.parseAsync(data, "");
        object = gltf.scene;
      }
      if (cancelled) {
        disposeTree(object);
        return;
      }

      const scene = new three.Scene();
      const renderer = new three.WebGLRenderer({
        antialias: true,
        alpha: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = three.SRGBColorSpace;
      const width = mount.clientWidth || 800;
      const height = mount.clientHeight || 600;
      renderer.setSize(width, height);
      renderer.domElement.className = "mfp-model-canvas";
      mount.append(renderer.domElement);

      scene.add(new three.HemisphereLight(0xffffff, 0x8899aa, 1.6));
      const key = new three.DirectionalLight(0xffffff, 2.2);
      key.position.set(3, 5, 4);
      scene.add(key);
      const fill = new three.DirectionalLight(0xffffff, 0.8);
      fill.position.set(-4, -2, -3);
      scene.add(fill);

      // Centre the model at the origin and frame it.
      const bounds = new three.Box3().setFromObject(object);
      const center = bounds.getCenter(new three.Vector3());
      const size = bounds.getSize(new three.Vector3());
      object.position.sub(center);
      scene.add(object);
      const radius = Math.max(size.length() / 2, 1e-3);
      const camera = new three.PerspectiveCamera(
        45,
        width / height,
        radius / 100,
        radius * 100,
      );
      const controls = new OrbitControls(camera, renderer.domElement);
      const frame = () => {
        const distance = radius / Math.sin((camera.fov * Math.PI) / 360);
        camera.position.set(distance * 0.6, distance * 0.45, distance * 0.75);
        camera.near = distance / 100;
        camera.far = distance * 100;
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
      };
      const draw = () => renderer.render(scene, camera);
      controls.addEventListener("change", draw);
      frame();
      draw();

      const resize = () => {
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        draw();
      };
      const observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(resize);
      observer?.observe(mount);

      sceneRef.current = {
        setWireframe: (on) => {
          object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            for (const material of Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material]) {
              (material as THREE.MeshStandardMaterial).wireframe = on;
            }
          });
          draw();
        },
        resetView: () => {
          frame();
          draw();
        },
      };
      cleanup.push(() => {
        observer?.disconnect();
        controls.removeEventListener("change", draw);
        controls.dispose();
        disposeTree(scene);
        neutral.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      });
      setStatus("ready");
    })().catch((error: unknown) => {
      if (cancelled) return;
      console.warn("file preview: the model could not be shown", error);
      setStatus("error");
    });

    return () => {
      cancelled = true;
      sceneRef.current = null;
      for (const run of cleanup) run();
      for (const url of blobUrls) URL.revokeObjectURL(url);
    };
  }, [bytes, file.extension]);

  if (status === "error") throw new Error("The model could not be shown.");

  return (
    <div className="mfp-fill">
      <Toolbar
        more={
          fullscreen.supported ? (
            <>
              <Separator />
              <IconButton
                label={
                  fullscreen.active ? labels.exitFullScreen : labels.fullScreen
                }
                pressed={fullscreen.active}
                onClick={fullscreen.toggle}
              >
                {fullscreen.active ? (
                  <Minimize aria-hidden="true" />
                ) : (
                  <Maximize aria-hidden="true" />
                )}
              </IconButton>
            </>
          ) : null
        }
      >
        <IconButton
          label={labels.wireframe}
          pressed={wireframe}
          disabled={status !== "ready"}
          onClick={() => {
            const next = !wireframe;
            setWireframe(next);
            sceneRef.current?.setWireframe(next);
          }}
        >
          <Grid3x3 aria-hidden="true" />
        </IconButton>
        <IconButton
          label={labels.resetView}
          disabled={status !== "ready"}
          onClick={() => sceneRef.current?.resetView()}
        >
          <RotateCcw aria-hidden="true" />
        </IconButton>
      </Toolbar>
      <Notice>{labels.modelHint}</Notice>
      <section
        ref={mountRef}
        className="mfp-model"
        data-theme={theme}
        aria-label={source.name}
      >
        {status === "loading" ? (
          <div className="mfp-overlay">
            <LoadingState />
          </div>
        ) : null}
      </section>
    </div>
  );
}
