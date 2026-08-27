// Client-side image processing for trainer chat attachments (ADR-0001).
// Re-encoding through a <canvas> strips EXIF (GPS, camera metadata) and
// downscales to a max long edge, keeping uploads small and privacy-safe.
// GIFs pass through unchanged so animation survives.

export const MAX_ATTACHMENT_LONG_EDGE = 1600;
export const ATTACHMENT_JPEG_QUALITY = 0.8;
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;

export interface ProcessedImage {
	blob: Blob;
	width: number;
	height: number;
	mediaType: string;
}

/**
 * Downscale and re-encode an image file for upload. Always re-encodes
 * (even when no resize is needed) so EXIF metadata is stripped. Throws
 * when the browser can't decode the file.
 */
export async function processAttachmentImage(
	file: File,
): Promise<ProcessedImage> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		throw new Error("Couldn't read that image — unsupported format");
	}

	try {
		const scale = Math.min(
			1,
			MAX_ATTACHMENT_LONG_EDGE / Math.max(bitmap.width, bitmap.height),
		);
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Couldn't get a canvas context");
		ctx.drawImage(bitmap, 0, 0, width, height);

		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/jpeg", ATTACHMENT_JPEG_QUALITY),
		);
		if (!blob) throw new Error("Couldn't encode the image as JPEG");

		return { blob, width, height, mediaType: "image/jpeg" };
	} finally {
		bitmap.close();
	}
}
