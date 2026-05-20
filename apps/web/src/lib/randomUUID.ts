export function randomUUID(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
		const v = Number(c);
		const r =
			typeof crypto !== "undefined" &&
			typeof crypto.getRandomValues === "function"
				? crypto.getRandomValues(new Uint8Array(1))[0]
				: Math.floor(Math.random() * 256);
		return (v ^ (r & (15 >> (v / 4)))).toString(16);
	});
}
