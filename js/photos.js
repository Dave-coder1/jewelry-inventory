// Step 5: image pipeline. Turns a picked file into the 2 JPEG blobs the
// data model wants — a 1400px "full" version and a 320px thumbnail — with
// EXIF rotation already baked in. No DOM code here; app.js wires the result
// into the photo slots and IndexedDB. See JEWELRY-PWA-SPEC.md §10.

const PHOTO_FULL_EDGE = 1400;
const PHOTO_THUMB_EDGE = 320;
const PHOTO_QUALITY = 0.82;

// Draws `bitmap` onto a canvas scaled so its longest edge is `maxEdge` (never
// upscaled), then exports it as a JPEG blob.
function drawResized(bitmap, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      PHOTO_QUALITY
    );
  });
}

// file -> { full: Blob, thumb: Blob }.
//
// `imageOrientation: "from-image"` is the whole trick for §10's "photo taken
// sideways displays upright" check: createImageBitmap reads the file's EXIF
// orientation tag and rotates the pixels to match before we ever touch a
// canvas, so nothing downstream needs to know EXIF exists.
async function processPhoto(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const [full, thumb] = await Promise.all([
      drawResized(bitmap, PHOTO_FULL_EDGE),
      drawResized(bitmap, PHOTO_THUMB_EDGE),
    ]);
    return { full, thumb };
  } finally {
    bitmap.close(); // frees the decoded pixels immediately, not on next GC
  }
}

const Photos = { processPhoto };
