const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function fetchImageFile(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load this image for editing.");

  const blob = await response.blob();
  const type = blob.type.split(";")[0].toLowerCase();
  const extension = MIME_EXTENSIONS[type];
  if (!extension) throw new Error("This image format cannot be cropped.");

  return new File([blob], `cropped-image.${extension}`, { type });
}
