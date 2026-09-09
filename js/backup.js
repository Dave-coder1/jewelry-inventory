// Step 8: Backup and restore. Turns items (with their Blob photos) into one
// plain JSON-safe object, and back again. No DOM code and no IndexedDB
// calls here — app.js reads from/writes to DB (db.js) and drives the UI;
// this file only knows how to convert data. See JEWELRY-PWA-SPEC.md §13.

// Bumped only if the shape of a backup file ever needs to change. Both
// export and import compare against this — an old or foreign file with a
// different number is rejected rather than guessed at.
const SCHEMA_VERSION = 1;

const PHOTO_FIELDS = ["photo1Thumb", "photo1Full", "photo2Thumb", "photo2Full"];

// Blob -> "data:image/jpeg;base64,...." — a data URL *is* a base64 string
// with a small header on front, so this satisfies §13's "convert each blob
// to a base64 string" while also recording the blob's MIME type for free.
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// The reverse: fetch() understands data: URLs directly, so this is the
// simplest correct way back to a Blob — no manual base64 decoding needed.
async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function itemToBackupJson(item) {
  const out = { ...item };
  for (const field of PHOTO_FIELDS) {
    out[field] = item[field] ? await blobToDataUrl(item[field]) : null;
  }
  return out;
}

async function itemFromBackupJson(raw) {
  const item = { ...raw };
  for (const field of PHOTO_FIELDS) {
    item[field] = raw[field] ? await dataUrlToBlob(raw[field]) : null;
  }
  return item;
}

// items (from DB.getAllItems(), including deleted ones per §13) -> the
// full backup object ready for JSON.stringify(). onProgress(done, total),
// if given, is called after each item — encoding 80 photos isn't instant.
async function buildBackup(items, onProgress) {
  const exportedItems = [];
  for (let i = 0; i < items.length; i++) {
    exportedItems.push(await itemToBackupJson(items[i]));
    if (onProgress) onProgress(i + 1, items.length);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items: exportedItems,
  };
}

function backupFilename() {
  const date = new Date().toISOString().slice(0, 10);
  return `jewelry-backup-${date}.json`;
}

// The reverse of buildBackup(): the parsed JSON's `items` -> real items
// with real Blob photos, ready for DB.putItem(). Does not touch IndexedDB
// itself — app.js decides when it's safe to clear and rebuild the store.
async function parseBackupItems(backupJson, onProgress) {
  const items = [];
  for (let i = 0; i < backupJson.items.length; i++) {
    items.push(await itemFromBackupJson(backupJson.items[i]));
    if (onProgress) onProgress(i + 1, backupJson.items.length);
  }
  return items;
}

function isValidBackup(parsed) {
  return !!parsed && parsed.schemaVersion === SCHEMA_VERSION && Array.isArray(parsed.items);
}

const Backup = { SCHEMA_VERSION, buildBackup, backupFilename, parseBackupItems, isValidBackup };
