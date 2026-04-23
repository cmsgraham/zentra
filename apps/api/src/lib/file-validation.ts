import { fileTypeFromBuffer } from 'file-type';
import { BadRequestError } from './errors.js';

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Validates uploaded image buffers against both the declared MIME type and
 * the actual file signature (magic bytes). Throws BadRequestError on mismatch.
 */
export async function assertAllowedImage(
  buffer: Buffer,
  declaredMime: string | undefined,
  maxBytes: number = 10 * 1024 * 1024,
): Promise<string> {
  if (buffer.length === 0) {
    throw new BadRequestError('Empty file');
  }
  if (buffer.length > maxBytes) {
    throw new BadRequestError(`File must be under ${Math.round(maxBytes / 1024 / 1024)} MB`);
  }
  if (!declaredMime || !ALLOWED_IMAGE_MIMES.has(declaredMime)) {
    throw new BadRequestError('Only JPG, PNG, and WEBP images are allowed');
  }
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_IMAGE_MIMES.has(detected.mime)) {
    throw new BadRequestError('File signature does not match an allowed image type');
  }
  // Detected magic bytes must agree with the declared MIME to prevent
  // a PNG-extension-as-JPEG trick from sneaking past downstream processors.
  if (detected.mime !== declaredMime) {
    throw new BadRequestError('File content does not match declared type');
  }
  return detected.mime;
}
