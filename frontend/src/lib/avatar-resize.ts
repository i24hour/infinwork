import sharp from 'sharp';

/** Avatars are shown at most ~80px wide; 256px stays sharp on 3x screens. */
export const AVATAR_SIZE = 256;
const AVATAR_QUALITY = 82;

/**
 * Re-encode an image data URL as a small square WebP data URL.
 * Throws if the bytes are not a decodable image.
 */
export async function shrinkAvatarDataUrl(dataUrl: string): Promise<string> {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1).replace(/\s/g, '');
    const input = Buffer.from(base64, 'base64');
    const output = await sharp(input, { limitInputPixels: 50_000_000 })
        .rotate() // respect EXIF orientation before the metadata is dropped
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
        .webp({ quality: AVATAR_QUALITY })
        .toBuffer();
    return `data:image/webp;base64,${output.toString('base64')}`;
}
