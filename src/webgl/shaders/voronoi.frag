precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform vec2 uResolution;
uniform float uDensity;      // セル分割数 (何マスに区切るか)
uniform vec2 uOffset;        // ワールドオフセット (セル単位) 無限スクロール用
uniform float uCenterZoom;   // 中心付近の種点に加算するウェイト。大きいほど中央のセルが物理的に大きくなる
uniform float uAnimSpeed;    // 種点の動く速さ
uniform float uEdgeWidth;    // 境界線の太さ (セル単位、向きに依らず均一)
uniform vec3  uColorA;       // フォールバックグラデ低い側
uniform vec3  uColorB;       // フォールバックグラデ高い側
uniform vec3  uEdgeColor;    // 境界線色
uniform float uShowPoints;   // 種点マーカーの ON/OFF (0 or 1)

// 画像アトラス関連
uniform sampler2D uAtlas;    // cols×rows 画像アトラス
uniform float uAtlasCols;    // アトラスの列数
uniform float uAtlasRows;    // アトラスの行数
uniform float uImageCount;   // 有効な画像数
uniform float uImagesReady;  // 0=未ロード / 1=ロード済み
uniform float uShowImages;   // 画像描画 ON/OFF
uniform float uImageScale;   // セル内画像の拡大率 (小さくすると画像が寄る、大きくすると引き)
uniform vec2  uScrollVelocity; // 毎フレームのスクロール速度 (cell/frame)
uniform float uParallax;       // パララックス強度 (0=OFF、正なら drag/wheel と同方向にシフト)

// フォーカス (クリックで拡大) 関連
uniform vec2  uFocusCell;         // フォーカス中のセル ID (world cell coords)
uniform float uFocusAmount;       // 0=通常、1=画面 90% 正方形に拡大 (GSAP で 0↔1)
uniform float uFocusInitialSize;  // クリック時のセル半径。rect の開始サイズ (シームレス化)

// 2D ハッシュ: セル座標 -> 疑似ランダム 2D 点
vec2 hash2(vec2 p) {
	p = vec2(dot(p, vec2(127.1, 311.7)),
	         dot(p, vec2(269.5, 183.3)));
	return fract(sin(p) * 43758.5453);
}

// あるセルの中で、時間とともにゆっくり回遊する種点位置 ([0,1] 内)
vec2 seedPoint(vec2 cellId) {
	vec2 seed = hash2(cellId);
	return 0.5 + 0.5 * sin(uTime * uAnimSpeed + 6.2831 * seed);
}

// 中心 (uOffset) からの距離に応じて種点にウェイトを与える。
// 加算重み付き Voronoi: 距離を (dist - w) として比較すると、w が大きい種点ほど
// 遠くのフラグメントも勝ち取れる = セルが物理的に大きくなる。
// 中心近くの種点だけがブーストされ、周辺は 0 (通常 Voronoi)。
float seedWeight(vec2 seedWorld) {
	float radial = length(seedWorld - uOffset);
	return uCenterZoom * (1.0 - smoothstep(0.0, uDensity * 0.5, radial));
}

// 最終 rect (focusAmount=1 での uOffset 中心・0.45*density 半径) を基準に seed を押し出す。
// 「最終形」基準にすることで animation 中も pushDir が変わらず、seed が滑らかに移動する。
// 方向は基本 L∞ normal (±x か ±y) だが、対角 (|x|=|y|) 付近では smoothstep で滑らかに blend →
// 45° の seed は 45° 方向に押されて、角の周辺の連続性が保たれる。
vec2 displaceForFocus(vec2 seedWorld, float density, float amount) {
	if (amount < 0.001) return seedWorld;

	// 最終 rect (uOffset 中心) からの相対位置で判断
	vec2 finalOffset = seedWorld - uOffset;
	vec2 finalAbsOffset = abs(finalOffset);
	float finalCheb = max(finalAbsOffset.x, finalAbsOffset.y);
	if (finalCheb < 0.001) return seedWorld;

	float finalRectHalf = 0.45 * density;
	// pushZoneWidth を広めに (0.7 * density) 取り、maxPushCap を控えめに (1.0) することで
	// 圧縮率 = maxCap / pushZoneWidth ≈ 24%。近接 seed が push で衝突するのを防ぎ、
	// 「post-push でセルが uEdgeWidth 以下まで潰れて白線一色になる」現象を回避。
	float pushZoneWidth = 0.7 * density;
	float pushZoneEnd = finalRectHalf + pushZoneWidth;
	if (finalCheb > pushZoneEnd) return seedWorld;

	float maxPushCap = 1.0;
	float pushAmount;
	if (finalCheb < finalRectHalf) {
		pushAmount = maxPushCap;
	} else {
		float t = 1.0 - (finalCheb - finalRectHalf) / pushZoneWidth;
		pushAmount = maxPushCap * t;
	}
	pushAmount *= amount;

	// 対角付近を滑らかに blend した L∞ normal 方向
	// ratio=1 (|y|=0) → +x のみ / ratio=0 (|x|=0) → +y のみ / ratio=0.5 (対角) → 45° 方向
	float ratio = finalAbsOffset.x / max(finalAbsOffset.x + finalAbsOffset.y, 0.001);
	float wx = smoothstep(0.3, 0.7, ratio);
	vec2 pushDir = vec2(sign(finalOffset.x) * wx, sign(finalOffset.y) * (1.0 - wx));
	pushDir = pushDir / max(length(pushDir), 0.001);

	return seedWorld + pushDir * pushAmount;
}

void main() {
	// 画面のアスペクト比を吸収して正方セルにする。uOffset で無限スクロール
	vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
	vec2 uv = (vUv - 0.5) * aspect * uDensity + uOffset;

	vec2 cell = floor(uv);
	vec2 frac = fract(uv);

	// ---- フォーカスセルの距離 (SDF): focus=0 で Euclidean、focus=1 で画面中央の Chebyshev SDF ----
	// これを他セルの Voronoi 距離と比較して勝てば「フォーカスセル領域」= 拡大した状態。
	// 中央 SDF の halfSize = 0.45 * density は「短辺の 90% を占める正方形」を意味する
	// (uv 空間で 0.9*density のサイズ、短辺 = 画面高さ = density)。
	//
	// 素の chebyshev SDF は rect 外でも傾きが 1 しかなく、周辺 Voronoi 距離 (~0.5) より
	// 小さい範囲まで focus が勝ってしまう ⇒ 正方形にならず外側にはみ出す。
	// そこで rect の外側だけを focusAmount に応じて急峻化して、boundary を「クリフ」にする。
	// 他セルは即座に距離勝負に勝つようになり、正方形境界がきっちり出る。
	vec2 focusSeedWorld = uFocusCell + seedPoint(uFocusCell);
	vec2 rectCenterWorld = mix(focusSeedWorld, uOffset, uFocusAmount);
	float rectHalfWorld = mix(uFocusInitialSize, 0.45 * uDensity, uFocusAmount);
	vec2 chebOffset = abs(uv - rectCenterWorld);
	float rawChebFocus = max(chebOffset.x, chebOffset.y) - rectHalfWorld;
	bool focusActive = uFocusAmount > 0.001;

	// ---- Pass 1: 最近傍種点を確定 (focus 中は uFocusCell を除外 & 5x5 で displaced seed を捕捉) ----
	// Power diagram (Laguerre): d = |F - S|² - w で比較。境界は直線 (加算重み付きは双曲線)。
	// nearestEuclidean は SDF morph 用: 「フォーカスセルの Voronoi 境界」までの距離計算に使う。
	float minPower = 1e6;
	float nearestWeight = 0.0;
	float nearestEuclidean = 1e3;
	vec2 nearestOffset = vec2(0.0);
	vec2 nearestNeighbor = vec2(0.0);
	vec2 nearestCellId = vec2(0.0);

	for (int y = -2; y <= 2; y++) {
		for (int x = -2; x <= 2; x++) {
			vec2 neighbor = vec2(float(x), float(y));
			vec2 cellId = cell + neighbor;
			if (focusActive && all(equal(cellId, uFocusCell))) continue;
			vec2 point = seedPoint(cellId);
			vec2 rawSeedWorld = cell + neighbor + point;
			vec2 pushedSeed = displaceForFocus(rawSeedWorld, uDensity, uFocusAmount);
			vec2 diff = pushedSeed - uv;
			float distSq = dot(diff, diff);
			float w = seedWeight(pushedSeed);
			float d = distSq - w;
			if (d < minPower) {
				minPower = d;
				nearestOffset = diff;
				nearestNeighbor = neighbor;
				nearestCellId = cellId;
				nearestWeight = w;
				nearestEuclidean = sqrt(distSq);
			}
		}
	}

	// フォーカスセル領域を SDF morph で決定:
	//   voronoiSDF = Power diagram 境界までの符号付き距離 (Euclidean 換算)
	//     = (focusPower - minPower) / (2 * L) where L = |focusSeed - nearestSeed|
	//     → click 前後で focus セルの形状 (Power cell) と完全一致 → シームレス
	//   rectSDF    = rawChebFocus  (< 0 で rect 内)
	//   focusAmount で mix → 「Power cell 形状」から「90% 正方形」へ滑らかに morph
	// combinedSDF はエッジ描画にも使うのでスコープを広く取る
	vec2 focusToFrag = focusSeedWorld - uv;
	float w_focus = seedWeight(focusSeedWorld);
	float focusPower = dot(focusToFrag, focusToFrag) - w_focus;
	float seedSepL = length(focusToFrag - nearestOffset); // focusSeed - nearestSeed
	float voronoiSDF = (focusPower - minPower) / max(2.0 * seedSepL, 0.01);
	float combinedSDF = mix(voronoiSDF, rawChebFocus, uFocusAmount);
	bool focusWins = focusActive && combinedSDF < 0.0;
	if (focusWins) {
		nearestCellId = uFocusCell;
	}

	// ---- Pass 2: 最近傍と各隣接種点の「垂直二等分線」までの距離を取り、最小を境界距離とする ----
	// 二等分線 = セルの実際の辺。この距離を使うことで、辺の向きや頂点近傍でも太さが均一になる。
	// 最近傍セルを中心に 5x5 (24 セル) をスキャン。Voronoi 隣接する種点は最近傍から最大 2 セル
	// 離れる可能性があり、3x3 では取りこぼしが起きるため。
	float edgeDist = 8.0;
	if (focusWins) {
		// focus 内側: combined SDF (morph 済み境界) までの距離。rect ではなく実際の形状を追従
		edgeDist = -combinedSDF;
	} else {
		for (int y = -2; y <= 2; y++) {
			for (int x = -2; x <= 2; x++) {
				vec2 neighbor = nearestNeighbor + vec2(float(x), float(y));
				vec2 cellId = cell + neighbor;
				if (focusActive && all(equal(cellId, uFocusCell))) continue;
				vec2 point = seedPoint(cellId);
				vec2 rawSeedWorld = cell + neighbor + point;
				vec2 pushedSeed = displaceForFocus(rawSeedWorld, uDensity, uFocusAmount);
				vec2 diff = pushedSeed - uv;
				vec2 delta = diff - nearestOffset;
				float lenDelta = length(delta);
				if (lenDelta < 1e-3) continue; // 最近傍自身はスキップ
				// フラグメント (原点) から Power diagram 境界までの垂直距離。
				// 境界は midpoint から (w1 - w2) / (2L) だけ delta 方向にシフトした直線。
				float w_other = seedWeight(pushedSeed);
				vec2 mid = 0.5 * (nearestOffset + diff);
				float edge = dot(mid, delta / lenDelta) + (nearestWeight - w_other) / (2.0 * lenDelta);
				edgeDist = min(edgeDist, edge);
			}
		}
		// focus 中は「combined SDF の境界」(morph 済み) までの距離を外側から距離場に含める
		if (focusActive) {
			edgeDist = min(edgeDist, combinedSDF);
		}
	}

	// セル ID からハッシュ (画像選択と色フォールバックで共用)
	float cellRand = fract(sin(dot(nearestCellId, vec2(41.3, 289.1))) * 43758.5);
	vec3 cellColor = mix(uColorA, uColorB, cellRand);

	if (uImagesReady > 0.5 && uShowImages > 0.5) {
		vec2 imgUv;
		if (focusWins) {
			// focusAmount=1: rect を [0,1] UV に写す (全体表示)
			vec2 rectImgUv = (uv - rectCenterWorld) / (2.0 * max(rectHalfWorld, 0.001)) + 0.5;
			// focusAmount=0: Voronoi 側と同じ effectiveScale で計算 → close 完了時に snap しない
			float focusScale = min(uImageScale, 1.0 / (1.0 + w_focus));
			vec2 voronoiImgUv = 0.5 - (focusSeedWorld - uv) * focusScale;
			imgUv = mix(voronoiImgUv, rectImgUv, uFocusAmount);
		} else {
			// 通常セルは uImageScale の元の見え方を維持。拡大されたセルだけ clamp しない
			// 上限まで自動で scale を絞る。1 / (1 + w) は「cover-fit する scale」で、
			// uImageScale がそれより小さければそのまま (clamp 起きない)、大きければ強制。
			float effectiveScale = min(uImageScale, 1.0 / (1.0 + nearestWeight));
			imgUv = 0.5 - nearestOffset * effectiveScale;
			// パララックス (フォーカス中はフェード)
			imgUv += clamp(uScrollVelocity * uParallax, vec2(-0.20), vec2(0.20))
				* (1.0 - uFocusAmount);
		}
		// アトラス隣接タイルへの染み出しを防ぐ
		imgUv = clamp(imgUv, 0.001, 0.999);
		// 隣接セルが同じスロットを引かないよう、Latin square 風の決定的割り当て。
		// 8 近傍の diff (dx + 7*dy) = {±1, ±6, ±7, ±8} は 25 で割り切れない → base 段階で全部違う。
		// さらに 13 (25 と coprime) で permute して見た目のパターン性を弱める。
		float base = mod(nearestCellId.x + nearestCellId.y * 7.0, uImageCount);
		float idx = mod(base * 13.0 + 7.0, uImageCount);
		float col = mod(idx, uAtlasCols);
		float row = floor(idx / uAtlasCols);
		vec2 atlasUv = (vec2(col, row) + imgUv) / vec2(uAtlasCols, uAtlasRows);
		cellColor = texture2D(uAtlas, atlasUv).rgb;
	}

	// fwidth で 1 ピクセル分の AA をかけて、密度が変わってもエッジは常にシャープに
	float aa = fwidth(edgeDist);
	float edge = smoothstep(uEdgeWidth - aa, uEdgeWidth + aa, edgeDist);
	vec3 col = mix(uEdgeColor, cellColor, edge);

	// 種点マーカー (デバッグ / 演出用) — フォーカス中はフェード
	float pointMask = 1.0 - smoothstep(0.0, 0.04, length(nearestOffset));
	col = mix(col, vec3(1.0), pointMask * uShowPoints * (1.0 - uFocusAmount));

	gl_FragColor = vec4(col, 1.0);
}
