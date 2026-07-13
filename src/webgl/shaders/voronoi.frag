precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform vec2 uResolution;
uniform float uDensity;      // セル分割数 (何マスに区切るか)
uniform vec2 uOffset;        // ワールドオフセット (セル単位) 無限スクロール用
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

void main() {
	// 画面のアスペクト比を吸収して正方セルにする。uOffset で無限スクロール
	vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
	vec2 uv = (vUv - 0.5) * aspect * uDensity + uOffset;

	vec2 cell = floor(uv);
	vec2 frac = fract(uv);

	// ---- Pass 1: 最近傍種点を確定 ----
	float minDistSq = 8.0;
	vec2 nearestOffset = vec2(0.0);
	vec2 nearestNeighbor = vec2(0.0);
	vec2 nearestCellId = vec2(0.0);

	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++) {
			vec2 neighbor = vec2(float(x), float(y));
			vec2 point = seedPoint(cell + neighbor);
			vec2 diff = neighbor + point - frac;
			float d = dot(diff, diff);
			if (d < minDistSq) {
				minDistSq = d;
				nearestOffset = diff;
				nearestNeighbor = neighbor;
				nearestCellId = cell + neighbor;
			}
		}
	}

	// ---- Pass 2: 最近傍と各隣接種点の「垂直二等分線」までの距離を取り、最小を境界距離とする ----
	// 二等分線 = セルの実際の辺。この距離を使うことで、辺の向きや頂点近傍でも太さが均一になる。
	// 最近傍セルを中心に 5x5 (24 セル) をスキャン。Voronoi 隣接する種点は最近傍から最大 2 セル
	// 離れる可能性があり、3x3 では取りこぼしが起きるため。
	float edgeDist = 8.0;
	for (int y = -2; y <= 2; y++) {
		for (int x = -2; x <= 2; x++) {
			vec2 neighbor = nearestNeighbor + vec2(float(x), float(y));
			vec2 point = seedPoint(cell + neighbor);
			vec2 diff = neighbor + point - frac;
			vec2 delta = diff - nearestOffset;
			if (dot(delta, delta) < 1e-5) continue; // 最近傍自身はスキップ
			// フラグメント (原点) から二等分線までの垂直距離
			vec2 mid = 0.5 * (nearestOffset + diff);
			edgeDist = min(edgeDist, dot(mid, normalize(delta)));
		}
	}

	// セル ID からハッシュ (画像選択と色フォールバックで共用)
	float cellRand = fract(sin(dot(nearestCellId, vec2(41.3, 289.1))) * 43758.5);
	vec3 cellColor = mix(uColorA, uColorB, cellRand);

	if (uImagesReady > 0.5 && uShowImages > 0.5) {
		// 種点中心で cover-fit 済み画像をサンプル。Voronoi セル形状で自然にクロップ
		vec2 imgUv = 0.5 - nearestOffset * uImageScale;
		// パララックス: スクロール速度に応じて画像 UV をシフト。画像がセルより
		// 「遅れて動く」ように見える。過度なシフトを避けるため範囲を制限。
		imgUv += clamp(uScrollVelocity * uParallax, vec2(-0.20), vec2(0.20));
		// アトラス隣接タイルへの染み出しを防ぐ
		imgUv = clamp(imgUv, 0.001, 0.999);
		float idx = floor(cellRand * uImageCount);
		float col = mod(idx, uAtlasCols);
		float row = floor(idx / uAtlasCols);
		vec2 atlasUv = (vec2(col, row) + imgUv) / vec2(uAtlasCols, uAtlasRows);
		cellColor = texture2D(uAtlas, atlasUv).rgb;
	}

	// fwidth で 1 ピクセル分の AA をかけて、密度が変わってもエッジは常にシャープに
	float aa = fwidth(edgeDist);
	float edge = smoothstep(uEdgeWidth - aa, uEdgeWidth + aa, edgeDist);
	vec3 col = mix(uEdgeColor, cellColor, edge);

	// 種点マーカー (デバッグ / 演出用)
	float pointMask = 1.0 - smoothstep(0.0, 0.04, sqrt(minDistSq));
	col = mix(col, vec3(1.0), pointMask * uShowPoints);

	gl_FragColor = vec4(col, 1.0);
}
