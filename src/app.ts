import "./style.css";
import {
	getDensity,
	getFocus,
	getOffset,
	getScrollVelocity,
	getShaderTime,
	handleResize,
	initRenderer,
	setupFocus,
	setupGui,
	setupInput,
	setupVoronoi,
	startAnimationLoop,
	updateFocus,
	updateInput,
	updateVoronoi,
} from "./webgl";

initRenderer();
setupVoronoi();
setupGui();
setupInput(getDensity);
setupFocus();

handleResize();

startAnimationLoop((elapsed) => {
	updateInput();
	updateFocus(elapsed);
	// フォーカス中は shaderTime が凍結 → 種点位置が動かず、click 時のセル形状が保たれる
	updateVoronoi(getShaderTime(), getOffset(), getScrollVelocity(), getFocus());
});
