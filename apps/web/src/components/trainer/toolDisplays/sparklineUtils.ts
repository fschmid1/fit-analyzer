export function sparklinePath(
	values: number[],
	width: number,
	height: number,
): string {
	if (values.length < 2) return "";
	const min = Math.min(...values);
	const max = Math.max(...values);
	const range = max - min || 1;
	const stepX = width / (values.length - 1);
	const points = values.map((v, i) => ({
		x: i * stepX,
		y: height - ((v - min) / range) * height,
	}));
	return points
		.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
		.join(" ");
}
