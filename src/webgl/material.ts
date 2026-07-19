import * as THREE from "three";
import { SHADING_PARAMS } from "./constants";

// トゥーンシェーディング: 3段階のグラデーションマップでセルルックにする
export const toonGradientMap = (() => {
	const data = new Uint8Array([
		SHADING_PARAMS.gradientShadow,
		SHADING_PARAMS.gradientMid,
		SHADING_PARAMS.gradientHighlight,
	]);
	const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
	tex.minFilter = THREE.NearestFilter;
	tex.magFilter = THREE.NearestFilter;
	tex.needsUpdate = true;
	return tex;
})();

const toToonMaterial = (mat: THREE.Material): THREE.Material => {
	const src = mat as THREE.MeshStandardMaterial;
	return new THREE.MeshToonMaterial({
		color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
		map: src.map ?? null,
		gradientMap: toonGradientMap,
		side: src.side,
	});
};

export const applyToonMaterial = (mesh: THREE.SkinnedMesh) => {
	const original = mesh.material;
	mesh.material = Array.isArray(original)
		? original.map(toToonMaterial)
		: toToonMaterial(original);
};

// アウトライン: メッシュを法線方向に膨らませて裏面だけ黒描画(inverted hull)
export const addOutline = (mesh: THREE.SkinnedMesh) => {
	mesh.geometry.computeBoundingSphere();
	const thickness = (mesh.geometry.boundingSphere?.radius ?? 1) * 0.012;
	const mat = new THREE.MeshBasicMaterial({
		color: 0x111111,
		side: THREE.BackSide,
	});
	// objectNormalはスキニング無効時に未定義になるのでnormal属性を直接使う
	mat.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader.replace(
			"#include <begin_vertex>",
			`#include <begin_vertex>
transformed += normalize(normal) * ${thickness.toFixed(6)};`,
		);
	};
	mat.customProgramCacheKey = () => `outline-skinned-${thickness.toFixed(6)}`;
	const outline = new THREE.SkinnedMesh(mesh.geometry, mat);
	outline.bind(mesh.skeleton, mesh.bindMatrix);
	outline.frustumCulled = false;
	mesh.add(outline);
};

export const addMeshOutline = (mesh: THREE.Mesh, thickness: number) => {
	const mat = new THREE.MeshBasicMaterial({
		color: 0x111111,
		side: THREE.BackSide,
	});
	// MeshBasicMaterialではobjectNormalが定義されないのでnormal属性を直接使う
	mat.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader.replace(
			"#include <begin_vertex>",
			`#include <begin_vertex>
transformed += normalize(normal) * ${thickness.toFixed(6)};`,
		);
	};
	mat.customProgramCacheKey = () => `outline-${thickness.toFixed(6)}`;
	mesh.add(new THREE.Mesh(mesh.geometry, mat));
};
