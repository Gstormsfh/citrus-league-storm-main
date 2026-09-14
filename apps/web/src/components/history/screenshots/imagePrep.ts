/**
 * Screenshots straight from a camera roll are 3 to 12 MB each; the reader
 * downsizes anything past 1568 px on its long edge anyway. So the browser
 * scales each image to 1600 px before upload: a dozen phone screenshots
 * become a few MB, the upload is quick on a phone, and the text stays
 * legible. A small PNG is sent as it is, because re-encoding crisp text as
 * JPEG only makes it worse.
 */
export const MAX_EDGE = 1600;
const PASS_THROUGH_BYTES = 1_400_000;

export interface PreparedImage {
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  name: string;
  previewUrl: string;
  width: number;
  height: number;
}

function base64Of(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function decode(file: File): Promise<{ draw: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { draw: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      // Fall through to the Image path: an older WebView, or a type the bitmap decoder refuses.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });
    return { draw: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`${file.name} could not be read as an image. Use a screenshot saved as PNG or JPEG.`);
  }
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const decoded = await decode(file);
  try {
    const { width, height } = decoded;
    const passType = file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp' ? (file.type as PreparedImage['mediaType']) : null;
    if (passType && Math.max(width, height) <= MAX_EDGE && file.size <= PASS_THROUGH_BYTES) {
      const data = base64Of(await file.arrayBuffer());
      return { data, mediaType: passType, name: file.name, previewUrl: `data:${passType};base64,${data}`, width, height };
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot resize images. Try a smaller screenshot.');
    ctx.drawImage(decoded.draw, 0, 0, w, h);
    const url = canvas.toDataURL('image/jpeg', 0.9);
    const data = url.slice(url.indexOf(',') + 1);
    return { data, mediaType: 'image/jpeg', name: file.name, previewUrl: url, width: w, height: h };
  } finally {
    decoded.release();
  }
}

export async function prepareImages(files: File[]): Promise<PreparedImage[]> {
  const out: PreparedImage[] = [];
  for (const f of files) out.push(await prepareImage(f));
  return out;
}
