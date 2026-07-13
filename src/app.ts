import "./style.css";
import {
	getDensity,
	getOffset,
	handleResize,
	initRenderer,
	setupGui,
	setupInput,
	setupVoronoi,
	startAnimationLoop,
	updateInput,
	updateVoronoi,
} from "./webgl";

initRenderer();
setupVoronoi();
setupGui();
setupInput(getDensity);

handleResize();

startAnimationLoop((elapsed) => {
	updateInput();
	updateVoronoi(elapsed, getOffset());
});
