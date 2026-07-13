import { Color, Mesh, PlaneGeometry, ShaderMaterial, Texture, Vector2 } from "three";
import { scene } from "./core";
import { loadImageAtlas } from "./images";
import fragmentShader from "./shaders/voronoi.frag";
import vertexShader from "./shaders/voronoi.vert";

// GUI から参照/更新できるように公開する
export const params = {
	density: 6.0,
	animSpeed: 0.18,
	edgeWidth: 0.014,
	showPoints: false,
	showImages: true,
	imageScale: 0.5,
	parallax: 0.35,
	colorA: "#1e2a55",
	colorB: "#d1e6ff",
	edgeColor: "#050914",
};

let material: ShaderMaterial;

export const setupVoronoi = () => {
	const geometry = new PlaneGeometry(2, 2);
	material = new ShaderMaterial({
		vertexShader,
		fragmentShader,
		uniforms: {
			uTime: { value: 0 },
			uResolution: {
				value: new Vector2(window.innerWidth, window.innerHeight),
			},
			uDensity: { value: params.density },
			uOffset: { value: new Vector2(0, 0) },
			uAnimSpeed: { value: params.animSpeed },
			uEdgeWidth: { value: params.edgeWidth },
			uColorA: { value: new Color(params.colorA) },
			uColorB: { value: new Color(params.colorB) },
			uEdgeColor: { value: new Color(params.edgeColor) },
			uShowPoints: { value: params.showPoints ? 1 : 0 },
			// 画像アトラスは非同期でロードされるまで dummy を挿しておく
			uAtlas: { value: new Texture() },
			uAtlasCols: { value: 1 },
			uAtlasRows: { value: 1 },
			uImageCount: { value: 0 },
			uImagesReady: { value: 0 },
			uShowImages: { value: params.showImages ? 1 : 0 },
			uImageScale: { value: params.imageScale },
			uScrollVelocity: { value: new Vector2(0, 0) },
			uParallax: { value: params.parallax },
		},
	});
	const mesh = new Mesh(geometry, material);
	scene.add(mesh);

	window.addEventListener("resize", () => {
		material.uniforms.uResolution.value.set(
			window.innerWidth,
			window.innerHeight,
		);
	});

	// バックグラウンドで画像アトラスを構築。完了したら uniform を差し替える
	loadImageAtlas().then((atlas) => {
		if (!atlas) return;
		material.uniforms.uAtlas.value = atlas.texture;
		material.uniforms.uAtlasCols.value = atlas.cols;
		material.uniforms.uAtlasRows.value = atlas.rows;
		material.uniforms.uImageCount.value = atlas.count;
		material.uniforms.uImagesReady.value = 1;
	});
};

export const updateVoronoi = (
	elapsed: number,
	offset: { x: number; y: number },
	scrollVelocity: { x: number; y: number },
) => {
	material.uniforms.uTime.value = elapsed;
	material.uniforms.uDensity.value = params.density;
	material.uniforms.uAnimSpeed.value = params.animSpeed;
	material.uniforms.uEdgeWidth.value = params.edgeWidth;
	material.uniforms.uShowPoints.value = params.showPoints ? 1 : 0;
	material.uniforms.uShowImages.value = params.showImages ? 1 : 0;
	material.uniforms.uImageScale.value = params.imageScale;
	material.uniforms.uParallax.value = params.parallax;
	(material.uniforms.uColorA.value as Color).set(params.colorA);
	(material.uniforms.uColorB.value as Color).set(params.colorB);
	(material.uniforms.uEdgeColor.value as Color).set(params.edgeColor);
	(material.uniforms.uOffset.value as Vector2).set(offset.x, offset.y);
	(material.uniforms.uScrollVelocity.value as Vector2).set(
		scrollVelocity.x,
		scrollVelocity.y,
	);
};

export const getDensity = () => params.density;
