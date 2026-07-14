// クリックでセルをフォーカス拡大する状態管理。
// シェーダの hash2 / seedPoint と一致するロジックを JS 側で再現して、
// クリック座標 → world uv → 最近傍セル ID を特定する。
// focusAmount は GSAP で 0↔1 をトゥイーンし、シェーダ側の距離関数を
// Euclidean → 中心 SDF に補間することで「押しのけ拡大」を実現。

import { gsap } from "gsap";
import { DURATION, EASING } from "./constants";
import { getOffset, setClickHandler } from "./input";
import { params as voronoiParams } from "./voronoi";

const focusCell = { x: 0, y: 0 };
const state = { amount: 0 };
let hasFocus = false;
let focusTween: gsap.core.Tween | null = null;
let currentTime = 0;
// クリックされたセルの Power diagram 半径 (≈ (1 + weight) / 2)。
// shader の rectHalf をこの値からスタートさせることで、開始時点で rect が
// クリックしたセルの上にちょうど重なる (「クリックしたセルがそのまま拡大」に見える)。
let focusInitialSize = 0.5;
// シェーダに渡す「セル動作用の時間」。フォーカス動作中 (open/close 含む) は進まない。
// これにより click 時のセル形状が凍結され、rect への morph が「動く形からじゃなく静止形から」始まる。
let shaderTime = 0;
let prevElapsed = 0;

const fract = (x: number) => x - Math.floor(x);

// GLSL smoothstep と一致 (0..1 のスムーズなランプ)
const smoothstep = (edge0: number, edge1: number, x: number) => {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
};

// voronoi.frag の seedWeight と一致
const seedWeight = (
	seedX: number,
	seedY: number,
	offsetX: number,
	offsetY: number,
) => {
	const radial = Math.hypot(seedX - offsetX, seedY - offsetY);
	return (
		voronoiParams.centerZoom *
		(1 - smoothstep(0, voronoiParams.density * 0.5, radial))
	);
};

// voronoi.frag の hash2 と一致
const hash2 = (px: number, py: number) => ({
	x: fract(Math.sin(px * 127.1 + py * 311.7) * 43758.5453),
	y: fract(Math.sin(px * 269.5 + py * 183.3) * 43758.5453),
});

// voronoi.frag の seedPoint と一致
const seedPoint = (cellX: number, cellY: number, time: number, speed: number) => {
	const s = hash2(cellX, cellY);
	return {
		x: 0.5 + 0.5 * Math.sin(time * speed + 6.2831 * s.x),
		y: 0.5 + 0.5 * Math.sin(time * speed + 6.2831 * s.y),
	};
};

// Pass 1 と同じ最近傍探索を JS で行う
const findNearestCell = (worldUvX: number, worldUvY: number) => {
	const gridX = Math.floor(worldUvX);
	const gridY = Math.floor(worldUvY);
	const fx = worldUvX - gridX;
	const fy = worldUvY - gridY;
	let minDist = Infinity;
	let nx = 0;
	let ny = 0;
	for (let dy = -1; dy <= 1; dy++) {
		for (let dx = -1; dx <= 1; dx++) {
			const cellX = gridX + dx;
			const cellY = gridY + dy;
			const p = seedPoint(cellX, cellY, currentTime, voronoiParams.animSpeed);
			const ox = dx + p.x - fx;
			const oy = dy + p.y - fy;
			const d = ox * ox + oy * oy;
			if (d < minDist) {
				minDist = d;
				nx = cellX;
				ny = cellY;
			}
		}
	}
	return { x: nx, y: ny };
};

export const setupFocus = () => {
	setClickHandler((screenX, screenY) => {
		// 開いている状態でのクリックは閉じる (どこをクリックしても閉じる = 「戻る」感覚)
		if (hasFocus) {
			focusTween?.kill();
			focusTween = gsap.to(state, {
				amount: 0,
				duration: 0.55,
				ease: "power2.inOut",
				onComplete: () => {
					hasFocus = false;
					focusTween = null;
				},
			});
			return;
		}

		// screen → vUv (Y は shader と合わせて反転)
		const vUvX = screenX / window.innerWidth;
		const vUvY = 1 - screenY / window.innerHeight;
		const aspect = window.innerWidth / window.innerHeight;
		const offset = getOffset();
		const density = voronoiParams.density;
		// shader の uv 計算と同じ
		const worldUvX = (vUvX - 0.5) * aspect * density + offset.x;
		const worldUvY = (vUvY - 0.5) * density + offset.y;

		const cell = findNearestCell(worldUvX, worldUvY);
		focusCell.x = cell.x;
		focusCell.y = cell.y;
		hasFocus = true;

		// クリックされたセルの seed world 位置から weight を計算し、
		// Power diagram のセル半径 ≈ (1 + w) / 2 を初期 rect サイズに
		const p = seedPoint(cell.x, cell.y, currentTime, voronoiParams.animSpeed);
		const seedWorldX = cell.x + p.x;
		const seedWorldY = cell.y + p.y;
		const w = seedWeight(seedWorldX, seedWorldY, offset.x, offset.y);
		focusInitialSize = 0.5 * (1 + w);

		focusTween?.kill();
		focusTween = gsap.to(state, {
			amount: 1,
			duration: DURATION.BASE,
			ease: EASING.TRANSFORM,
			onComplete: () => {
				focusTween = null;
			},
		});
	});
};

export const updateFocus = (elapsed: number) => {
	// フォーカス中は shaderTime を凍結、それ以外は elapsed に合わせて進める。
	// close 完了 (hasFocus=false) で再開すると click 時点から連続的にセル動作再開。
	const dt = elapsed - prevElapsed;
	prevElapsed = elapsed;
	if (!hasFocus) shaderTime += dt;
	// クリック時の findNearestCell は「今画面に映っているセル」= shaderTime で計算
	currentTime = shaderTime;
};

export const getShaderTime = () => shaderTime;

export const getFocus = () => ({
	cell: focusCell,
	amount: state.amount,
	initialSize: focusInitialSize,
	shaderTime,
});
