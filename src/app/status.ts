const statusEl = document.getElementById("status") as HTMLDivElement;

export const setStatus = (text: string, hidden = false) => {
	statusEl.textContent = text;
	statusEl.classList.toggle("hidden", hidden);
};
