// 無限スクロール入力: マウスホイール + ポインタドラッグ。
// offset の単位は「セル」(voronoi.frag と同じスケール)。
// 密度に依らず「1px ドラッグ = 1px 移動」に感じさせるため、density/screenHeight で正規化する。
//
// wheel と drag で慣性を分けるため内部で 2 系統の offset に分ける:
//   - wheelOffset: 減衰する velocity を毎フレーム積む古典 model (ホイールは変更なし)
//   - dragOffset : ドラッグ中は dragTarget へ lerp 追従、release で GSAP tween へ引き継ぐ
// 外に見せる getOffset() は両者の合算。両者独立に動くので干渉しない。

import { gsap } from "gsap";

// ドラッグの意図位置 (pointermove が加算 / release 時に GSAP tween は不要)
const dragTarget = { x: 0, y: 0 };
// 実際に描画に使う位置。dragTarget に lerp して追いつく (ドラッグ中の重み感)
const dragOffset = { x: 0, y: 0 };
const wheelOffset = { x: 0, y: 0 };
const wheelVelocity = { x: 0, y: 0 };
const combined = { x: 0, y: 0 };
// 画像内パララックス用のスクロール速度 (combined の毎フレーム差分を EMA で平滑化)
const scrollVelocity = { x: 0, y: 0 };
let prevCombinedX = 0;
let prevCombinedY = 0;
const lastPointer = { x: 0, y: 0 };
let isDragging = false;
let dragTween: gsap.core.Tween | null = null;
// 最近 ~100ms のポインタ位置サンプル (release 時の velocity 計算用)
const samples: { t: number; x: number; y: number }[] = [];

// wheel 慣性減衰
const DAMPING = 0.88;
// wheel の生 delta を velocity に足す係数
const WHEEL_STRENGTH = 0.08;
// ドラッグ中の追従の重み。0=動かない / 1=1:1 追従。0.15 で 1 秒弱の柔らかい追従
const DRAG_LERP = 0.1;
// drag release の慣性 tween 時間 (秒)
const DRAG_INERTIA_DURATION = 1.0;
// power2.out で release 時の初速を指の速度に一致させる係数 (数学的には ease'(0)=2 なので 1/2)
const DRAG_INERTIA_FACTOR = 0.25;
// velocity 計算用サンプルウィンドウ (ms)
const SAMPLE_WINDOW_MS = 100;
// scrollVelocity の EMA 平滑化係数 (パララックス用、ジャダー抑制)
const SCROLL_VELOCITY_EMA = 0.2;

const pixelToCellScale = (density: number) => density / window.innerHeight;

export const setupInput = (getDensity: () => number) => {
	const canvas = document.querySelector("canvas");
	if (!canvas) return;

	canvas.style.touchAction = "none";
	canvas.style.cursor = "grab";

	canvas.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			const scale = pixelToCellScale(getDensity());
			wheelVelocity.x += e.deltaX * scale * WHEEL_STRENGTH;
			// ホイール下 = 下方向を見に行く。vUv.y は上が + なので符号反転
			wheelVelocity.y -= e.deltaY * scale * WHEEL_STRENGTH;
		},
		{ passive: false },
	);

	canvas.addEventListener("pointerdown", (e) => {
		// 走行中の drag 慣性 tween は現在位置で止める
		dragTween?.kill();
		dragTween = null;

		// dragTarget を現在の dragOffset に合わせて「catch-up ゼロ」で開始
		dragTarget.x = dragOffset.x;
		dragTarget.y = dragOffset.y;

		isDragging = true;
		lastPointer.x = e.clientX;
		lastPointer.y = e.clientY;
		samples.length = 0;
		samples.push({ t: performance.now(), x: e.clientX, y: e.clientY });
		canvas.style.cursor = "grabbing";
		canvas.setPointerCapture(e.pointerId);
	});

	canvas.addEventListener("pointermove", (e) => {
		if (!isDragging) return;
		const dx = e.clientX - lastPointer.x;
		const dy = e.clientY - lastPointer.y;
		lastPointer.x = e.clientX;
		lastPointer.y = e.clientY;

		const scale = pixelToCellScale(getDensity());
		// ドラッグは「意図位置」に直接足す。実際の描画は lerp (updateInput) で追従
		dragTarget.x -= dx * scale;
		dragTarget.y += dy * scale;

		// 最近ウィンドウ内のサンプルだけ残す。release 時にここから velocity を計算
		const now = performance.now();
		samples.push({ t: now, x: e.clientX, y: e.clientY });
		while (samples.length > 1 && samples[0].t < now - SAMPLE_WINDOW_MS) {
			samples.shift();
		}
	});

	const endDrag = (e: PointerEvent) => {
		if (!isDragging) return;
		isDragging = false;
		canvas.style.cursor = "grab";
		canvas.releasePointerCapture(e.pointerId);

		if (samples.length < 2) return;
		const oldest = samples[0];
		const newest = samples[samples.length - 1];
		const dtMs = newest.t - oldest.t;
		// フリックとしては短すぎる = 停止 release とみなして慣性なし
		if (dtMs < 5) return;

		// ウィンドウ内の平均速度 (px/ms)。減速してから離しても、最近の平均が残る
		const vxPxPerMs = (newest.x - oldest.x) / dtMs;
		const vyPxPerMs = (newest.y - oldest.y) / dtMs;
		const scale = pixelToCellScale(getDensity());
		// 目標到達距離 (cell) = velocity(cell/sec) * duration * factor
		//   velocity(cell/sec) = velocity(px/ms) * 1000ms/sec * scale(cell/px)
		const dxCells =
			-vxPxPerMs * 1000 * scale * DRAG_INERTIA_DURATION * DRAG_INERTIA_FACTOR;
		const dyCells =
			vyPxPerMs * 1000 * scale * DRAG_INERTIA_DURATION * DRAG_INERTIA_FACTOR;

		// dragOffset を dragTarget (指の最終位置) + 慣性距離 まで直接 tween。
		// 現在 dragOffset は dragTarget に対して lag しているので、catch-up + 慣性 が
		// 一連の power2.out で連続的に処理される。
		const targetX = dragTarget.x + dxCells;
		const targetY = dragTarget.y + dyCells;
		// tween 完走後の dragTarget も終点に揃えておく (次のドラッグの起点として)
		dragTarget.x = targetX;
		dragTarget.y = targetY;

		dragTween = gsap.to(dragOffset, {
			x: targetX,
			y: targetY,
			duration: DRAG_INERTIA_DURATION,
			ease: "power2.out",
			onComplete: () => {
				dragTween = null;
			},
		});
	};
	canvas.addEventListener("pointerup", endDrag);
	canvas.addEventListener("pointercancel", endDrag);
};

export const updateInput = () => {
	// ドラッグ中は毎フレーム dragOffset を dragTarget に lerp (重み感)。
	// 非ドラッグ時は GSAP tween が dragOffset を直接動かすのでここでは触らない。
	if (isDragging) {
		dragOffset.x += (dragTarget.x - dragOffset.x) * DRAG_LERP;
		dragOffset.y += (dragTarget.y - dragOffset.y) * DRAG_LERP;
	}

	// wheel は独立に damped-velocity 方式で積分 (ドラッグ中でも生きたまま)
	wheelOffset.x += wheelVelocity.x;
	wheelOffset.y += wheelVelocity.y;
	wheelVelocity.x *= DAMPING;
	wheelVelocity.y *= DAMPING;
	if (Math.abs(wheelVelocity.x) < 1e-5) wheelVelocity.x = 0;
	if (Math.abs(wheelVelocity.y) < 1e-5) wheelVelocity.y = 0;

	combined.x = dragOffset.x + wheelOffset.x;
	combined.y = dragOffset.y + wheelOffset.y;

	// パララックス用に「フレーム間の生スクロール差分」を EMA で平滑化して保持。
	// wheel の減衰・gsap tween・ドラッグ中の lerp が全部 combined に反映されているので、
	// 差分を取ればどの入力起点でも「今どれくらい流れているか」が拾える。
	const rawVx = combined.x - prevCombinedX;
	const rawVy = combined.y - prevCombinedY;
	scrollVelocity.x =
		scrollVelocity.x * (1 - SCROLL_VELOCITY_EMA) + rawVx * SCROLL_VELOCITY_EMA;
	scrollVelocity.y =
		scrollVelocity.y * (1 - SCROLL_VELOCITY_EMA) + rawVy * SCROLL_VELOCITY_EMA;
	prevCombinedX = combined.x;
	prevCombinedY = combined.y;
};

export const getOffset = () => combined;
export const getScrollVelocity = () => scrollVelocity;
