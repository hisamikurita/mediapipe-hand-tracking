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

// クリックされた cell の Power cell の「半径」(最も近い Power 二等分線までの距離) を
// 求めて rect の初期サイズにする。以前の 0.5*(1+w) 経験式は「隣接 seed の weight=0 かつ
// 間隔=1」の仮定なので、centerZoom で隣接 weight も乗るケースだと過大評価になり、
// 開始 rect が実セル境界を越えて隣まで食い込むズレを起こしていた。
const computePowerCellRadius = (
	cellX: number,
	cellY: number,
	offsetX: number,
	offsetY: number,
) => {
	const p = seedPoint(cellX, cellY, currentTime, voronoiParams.animSpeed);
	const seedX = cellX + p.x;
	const seedY = cellY + p.y;
	const wSelf = seedWeight(seedX, seedY, offsetX, offsetY);
	let minRadius = Infinity;
	for (let dy = -2; dy <= 2; dy++) {
		for (let dx = -2; dx <= 2; dx++) {
			if (dx === 0 && dy === 0) continue;
			const otherCellX = cellX + dx;
			const otherCellY = cellY + dy;
			const op = seedPoint(
				otherCellX,
				otherCellY,
				currentTime,
				voronoiParams.animSpeed,
			);
			const otherSeedX = otherCellX + op.x;
			const otherSeedY = otherCellY + op.y;
			const wOther = seedWeight(otherSeedX, otherSeedY, offsetX, offsetY);
			const L = Math.hypot(otherSeedX - seedX, otherSeedY - seedY);
			if (L < 1e-3) continue;
			// self→other 方向で計った、self seed から Power 二等分線までの距離。
			// Power diagram: 二等分線は midpoint から (w_self - w_other)/(2L) だけ
			// other 側にシフトした直線 → self からの距離 = L/2 - (w_other - w_self)/(2L)。
			const radius = L / 2 + (wSelf - wOther) / (2 * L);
			if (radius < minRadius) minRadius = radius;
		}
	}
	// 過小 radius (負値含む: self が完全に飲まれているセル) は最低サイズにクランプ。
	// これ以下だと rect が点になって click 演出が消えるため。
	return Math.max(minRadius, 0.05);
};

// Pass 1 と同じ最近傍探索を JS で行う。
// シェーダは Power diagram (d = distSq - w) で判定しているので、こちらも weight を
// 差し引かないと centerZoom で weight が乗ったセル付近のクリックで別セルを掴んでしまう。
// また push は uFocusAmount=0 の間は無効 (最初のクリック時点は必ず 0) なので、
// ここでは displaceForFocus 相当は不要 (rawSeedWorld = seedWorld で OK)。
// 検索範囲は shader と同じ 5x5 (Power diagram では weight で境界が伸びるため 3x3 では足りない)。
const findNearestCell = (
	worldUvX: number,
	worldUvY: number,
	offsetX: number,
	offsetY: number,
) => {
	const gridX = Math.floor(worldUvX);
	const gridY = Math.floor(worldUvY);
	let minPower = Infinity;
	let nx = 0;
	let ny = 0;
	for (let dy = -2; dy <= 2; dy++) {
		for (let dx = -2; dx <= 2; dx++) {
			const cellX = gridX + dx;
			const cellY = gridY + dy;
			const p = seedPoint(cellX, cellY, currentTime, voronoiParams.animSpeed);
			const seedWorldX = cellX + p.x;
			const seedWorldY = cellY + p.y;
			const ox = seedWorldX - worldUvX;
			const oy = seedWorldY - worldUvY;
			const w = seedWeight(seedWorldX, seedWorldY, offsetX, offsetY);
			const d = ox * ox + oy * oy - w;
			if (d < minPower) {
				minPower = d;
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

		const cell = findNearestCell(worldUvX, worldUvY, offset.x, offset.y);
		focusCell.x = cell.x;
		focusCell.y = cell.y;
		hasFocus = true;

		// クリックされたセルの実 Power cell 半径を初期 rect サイズに使う
		focusInitialSize = computePowerCellRadius(
			cell.x,
			cell.y,
			offset.x,
			offset.y,
		);

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
