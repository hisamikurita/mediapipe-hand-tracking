import {
	OrthographicCamera,
	PerspectiveCamera,
	Scene,
	WebGLRenderer,
} from "three";

// フルスクリーンで平面を敷き詰めるだけの用途なので Orthographic を採用。
// Perspective 版もアプリ側から差し替えられるようにエクスポートしておく。
export const scene = new Scene();

export const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

// Perspective は使わないが型互換のため保持
export const _perspective = new PerspectiveCamera(50, 1, 0.1, 100);

let renderer: WebGLRenderer;
let resizeCallback: (() => void) | null = null;

export const initRenderer = () => {
	renderer = new WebGLRenderer({
		antialias: true,
		powerPreference: "high-performance",
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild(renderer.domElement);
};

export const getRenderer = (): WebGLRenderer => renderer;

export const handleResize = (onResize?: () => void) => {
	if (onResize) {
		resizeCallback = onResize;
	}
	const resize = () => {
		renderer.setSize(window.innerWidth, window.innerHeight);
		resizeCallback?.();
	};
	window.addEventListener("resize", resize);
	resize();
};

export const startAnimationLoop = (update: (elapsed: number) => void) => {
	const start = performance.now();
	const tick = () => {
		const elapsed = (performance.now() - start) / 1000;
		update(elapsed);
		renderer.render(scene, camera);
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
};
