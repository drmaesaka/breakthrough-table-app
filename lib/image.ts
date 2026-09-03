/**
 * Shrinks a photo in the browser before upload. Phone cameras produce 3–8 MB
 * images; an avatar shown at 80px does not need them, and every chat bubble
 * would otherwise download the full file. Returns a JPEG no larger than
 * `maxSide` on its longest edge. Falls back to the original file if the
 * browser cannot decode it (HEIC on some Androids).
 */
export async function shrinkImage(file: File, maxSide = 512, quality = 0.85): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob || file
  } catch {
    return file
  }
}
