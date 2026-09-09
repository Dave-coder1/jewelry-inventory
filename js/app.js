// Step 4: Add and delete. The + button creates an item with the lowest free
// code (§4) and opens it straight into the detail sheet. "Delete item" soft-
// deletes (sets deletedAt, §12) after a confirm; the recycle bin icon opens
// Recently deleted, where items can be restored or purged. Anything past
// its 30-day window is purged on app start. See §17.
//
// Step 5: Photos. Tapping an empty sheet photo opens the file picker;
// picking a file runs it through Photos.processPhoto() (js/photos.js) and
// stores the resulting thumb+full blobs. Tapping a filled thumbnail (list
// or sheet) opens the full-screen viewer; long-pressing a filled sheet
// photo offers Replace/Remove. See §10.
//
// Step 6: Status and history. Tapping the status pill (list or sheet)
// flips bank/home, appends a dated history entry, and buzzes the phone
// (§8). In the sheet, tapping a history row opens a native date picker for
// it; swiping one left reveals Delete (or deletes outright on a full
// swipe); "Add entry" appends a manual record dated today (§9). Editing or
// deleting history never touches `status`, and toggling `status` never
// edits existing history — see §9's "kept separate on purpose".
//
// Step 7: Search and filters. `searchQuery` and `activeFilter` (§11) are
// applied together (AND) in render() to decide which items are visible —
// nothing else needs to know about them. Note for step 9 (reorder): §11
// says reordering must be disabled whenever either is active, which
// isn't wired up yet since long-press-drag doesn't exist yet.
//
// Step 8: Backup and restore. The overflow menu ("⋮", top right) offers
// Back up / Restore from file. Backup.js (js/backup.js) turns items into a
// plain JSON-safe object (and back) — this file just drives DB reads/writes
// and the UI around that: a progress card while photos are being encoded/
// decoded, navigator.share() with a download-link fallback, and the
// dismissible "you haven't backed up in a while" bar (§13).
//
// No raw IndexedDB calls in this file — everything goes through DB (db.js).

const TYPES = ["մատանի", "բրասլետ", "կուլոն", "ցեպ", "կոպեկ", "օղեր", "այլ"];

const SEED_ITEMS = [
  { code: "A1", name: "Yellow gold bracelet", type: TYPES[1], note: "Grandmother's, from the 1980s", status: "bank" },
  { code: "A2", name: "Wedding ring", type: TYPES[0], note: "Engraved inside band", status: "home" },
  { code: "A3", name: "Small pendant with cross", type: TYPES[2], note: "", status: "bank" },
  { code: "A4", name: "Thin chain necklace", type: TYPES[3], note: "Tangles easily, keep in pouch", status: "bank" },
  { code: "A5", name: "Old coin, framed", type: TYPES[4], note: "1915, family heirloom", status: "bank" },
  { code: "A6", name: "Gold hoop earrings", type: TYPES[5], note: "Pair, small size", status: "home" },
  { code: "A7", name: "Signet ring", type: TYPES[0], note: "Slightly bent, needs resizing", status: "bank" },
  { code: "A8", name: "Miscellaneous gold chain fragment", type: TYPES[6], note: "Not sure what this belonged to", status: "bank" },
];

// In-memory mirror of the `items` store, kept in sync with IndexedDB by
// every write below. The list and the sheet both read from this.
let items = [];

function makeItemFromSeed(seed, position) {
  const now = new Date();
  return {
    uid: crypto.randomUUID(),
    code: seed.code,
    position,
    name: seed.name,
    type: seed.type,
    note: seed.note,
    status: seed.status,
    photo1Thumb: null,
    photo1Full: null,
    photo2Thumb: null,
    photo2Full: null,
    history: [{ id: crypto.randomUUID(), to: seed.status, date: now.toISOString().slice(0, 10) }],
    createdAt: now.toISOString(),
    deletedAt: null,
  };
}

// The lowest code not currently in use — including codes held by items in
// Recently deleted, which stay reserved until they're restored or purged
// (§4). Only a fully purged item's code is actually free again.
function nextAvailableCode(currentItems) {
  const used = new Set(currentItems.map((it) => it.code));
  for (let letter = 65; letter <= 90; letter++) {
    for (let digit = 1; digit <= 9; digit++) {
      const code = String.fromCharCode(letter) + digit;
      if (!used.has(code)) return code;
    }
  }
  return null; // all 234 codes taken — not a case the spec expects (§1)
}

// End of the current sort order among active (non-deleted) items, so a new
// or restored item lands at the bottom of the list.
function nextPosition(currentItems) {
  const positions = currentItems.filter((it) => !it.deletedAt).map((it) => it.position);
  return positions.length ? Math.max(...positions) + 1 : 1;
}

// First run only: the `items` store is empty, so there is nothing to show.
// Seed it with the same 8 fake items step 1 used, now as real records.
async function seedIfEmpty() {
  const existing = await DB.getAllItems();
  if (existing.length > 0) return existing;

  const seeded = [];
  for (let i = 0; i < SEED_ITEMS.length; i++) {
    const item = makeItemFromSeed(SEED_ITEMS[i], i + 1);
    await DB.putItem(item);
    seeded.push(item);
  }
  return seeded;
}

// Object URLs created for row thumbnails, so they can all be revoked before
// the next render replaces the rows that hold them (§3: "call
// URL.revokeObjectURL() when the element is removed" — every render() call
// removes every row, so every render() call revokes every row URL first).
let rowObjectUrls = [];

function thumbContent(blob) {
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  rowObjectUrls.push(url);
  return `<img class="thumb-img" src="${url}" alt="">`;
}

function renderRow(item) {
  const row = document.createElement("div");
  row.className = "row";
  row.dataset.uid = item.uid;

  const pillClass = item.status === "bank" ? "pill-bank" : "pill-home";
  const pillIcon = item.status === "bank" ? "🏦" : "🏠";
  const photo1 = thumbContent(item.photo1Thumb) || "📷";
  const photo2 = thumbContent(item.photo2Thumb) || "📦";

  row.innerHTML = `
    <div class="cell cell-code">${item.code}</div>
    <div class="cell cell-photo1"><div class="thumb thumb-1" data-slot="photo1">${photo1}</div></div>
    <div class="cell cell-name">${item.name}</div>
    <div class="cell cell-status"><button class="pill ${pillClass}">${pillIcon}</button></div>
    <div class="cell cell-type">${item.type}</div>
    <div class="cell cell-photo2"><div class="thumb thumb-2" data-slot="photo2">${photo2}</div></div>
    <div class="cell cell-note">${item.note}</div>
  `;

  return row;
}

// ---- Search and filter (§11) ----
//
// Chip counts always reflect every active item, regardless of the current
// search text — they answer "how many total", not "how many showing".
// Only the row list itself is narrowed by search + filter, combined (AND).

const searchInputEl = document.getElementById("searchInput");
const searchClearEl = document.getElementById("searchClear");
const emptyStateEl = document.getElementById("emptyState");

let searchQuery = "";
let activeFilter = "all"; // "all" | "bank" | "home"

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

// Substring match against name, code, note and type — case-insensitive in
// a way that also works for Armenian, which toLowerCase() alone does not
// reliably handle (§11).
function itemMatchesSearch(item, query) {
  if (!query) return true;
  const q = query.toLocaleLowerCase();
  return (
    item.name.toLocaleLowerCase().includes(q) ||
    item.code.toLocaleLowerCase().includes(q) ||
    item.note.toLocaleLowerCase().includes(q) ||
    item.type.toLocaleLowerCase().includes(q)
  );
}

function render() {
  const rowsEl = document.getElementById("rows");
  rowObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  rowObjectUrls = [];

  const active = items.filter((item) => !item.deletedAt).sort((a, b) => a.position - b.position);
  allCountEl.textContent = active.length;
  bankCountEl.textContent = active.filter((item) => item.status === "bank").length;
  homeCountEl.textContent = active.filter((item) => item.status === "home").length;

  const visible = active
    .filter((item) => activeFilter === "all" || item.status === activeFilter)
    .filter((item) => itemMatchesSearch(item, searchQuery));

  rowsEl.innerHTML = "";

  if (visible.length === 0) {
    showEmptyState();
  } else {
    hideEmptyState();
    visible.forEach((item) => rowsEl.appendChild(renderRow(item)));
  }
}

function showEmptyState() {
  emptyStateEl.hidden = false;

  if (searchQuery) {
    emptyStateEl.innerHTML = `
      <div class="empty-state-text">No items match "${escapeHtml(searchQuery)}"</div>
      <button class="empty-state-clear" id="emptyClearSearch">Clear search</button>
    `;
    document.getElementById("emptyClearSearch").addEventListener("click", clearSearch);
  } else if (activeFilter === "all") {
    emptyStateEl.innerHTML = `<div class="empty-state-text">No items yet.</div>`;
  } else {
    const label = activeFilter === "bank" ? "Bank" : "Home";
    emptyStateEl.innerHTML = `<div class="empty-state-text">No items in ${label}.</div>`;
  }
}

function hideEmptyState() {
  emptyStateEl.hidden = true;
  emptyStateEl.innerHTML = "";
}

function clearSearch() {
  searchQuery = "";
  searchInputEl.value = "";
  searchClearEl.hidden = true;
  render();
}

searchInputEl.addEventListener("input", () => {
  searchQuery = searchInputEl.value;
  searchClearEl.hidden = searchQuery.length === 0;
  render();
});

searchClearEl.addEventListener("click", clearSearch);

// Single selection: whichever chip is tapped becomes the only active one.
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const filter = chip.dataset.filter;
    if (filter === activeFilter) return;
    activeFilter = filter;
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("chip-active", c === chip));
    render();
  });
});

// ---- Backup and restore (§13) ----

const overflowButtonEl = document.getElementById("overflowButton");
const overflowBackdropEl = document.getElementById("overflowBackdrop");
const overflowSheetEl = document.getElementById("overflowSheet");
const backupBtnEl = document.getElementById("backupBtn");
const restoreBtnEl = document.getElementById("restoreBtn");
const overflowCancelBtnEl = document.getElementById("overflowCancelBtn");
const restoreFileInputEl = document.getElementById("restoreFileInput");
const progressOverlayEl = document.getElementById("progressOverlay");
const progressTextEl = document.getElementById("progressText");
const backupReminderEl = document.getElementById("backupReminder");
const backupReminderTextEl = document.getElementById("backupReminderText");
const backupReminderActionEl = document.getElementById("backupReminderAction");
const backupReminderDismissEl = document.getElementById("backupReminderDismiss");

function openOverflowSheet() {
  overflowBackdropEl.classList.add("open");
  overflowSheetEl.classList.add("open");
  history.pushState({ overflowOpen: true }, "");
}

function hideOverflowSheet() {
  overflowBackdropEl.classList.remove("open");
  overflowSheetEl.classList.remove("open");
}

function closeOverflowSheet() {
  if (!overflowSheetEl.classList.contains("open")) return;
  if (history.state && history.state.overflowOpen) {
    history.back();
  } else {
    hideOverflowSheet();
  }
}

overflowButtonEl.addEventListener("click", openOverflowSheet);
overflowBackdropEl.addEventListener("click", closeOverflowSheet);
overflowCancelBtnEl.addEventListener("click", closeOverflowSheet);

// Not back-button dismissible on purpose — there's nothing sensible to
// resume into partway through encoding/decoding photos, so it just sits
// there until the operation finishes.
function showProgress(text) {
  progressTextEl.textContent = text;
  progressOverlayEl.classList.add("open");
}

function updateProgressText(text) {
  progressTextEl.textContent = text;
}

function hideProgress() {
  progressOverlayEl.classList.remove("open");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleBackup() {
  showProgress("Backing up…");
  try {
    const allItems = await DB.getAllItems(); // every item, including deleted (§13)
    const backup = await Backup.buildBackup(allItems, (done, total) => {
      updateProgressText(`Backing up… ${done} of ${total}`);
    });
    const filename = Backup.backupFilename();
    const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
    const file = new File([blob], filename, { type: "application/json" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (err) {
        // AbortError just means the user backed out of the share sheet —
        // that's a deliberate choice, not a failure, so leave it alone.
        // Anything else is unexpected, so fall back to a plain download
        // rather than leave the user with no backup at all.
        if (err.name !== "AbortError") downloadBlob(blob, filename);
      }
    } else {
      downloadBlob(blob, filename);
    }

    await DB.putMeta("lastBackupAt", new Date().toISOString());
    await updateBackupReminder();
  } catch (err) {
    console.error("Backup failed", err);
    alert("Backup failed. Please try again.");
  } finally {
    hideProgress();
  }
}

async function handleRestoreFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    alert("That file isn't a valid backup.");
    return;
  }

  if (!Backup.isValidBackup(parsed)) {
    alert("This backup file isn't compatible with this version of the app.");
    return;
  }

  const currentTotal = items.length; // everything, including Recently deleted
  const incomingTotal = parsed.items.length;
  const ok = confirm(
    `Replace all ${currentTotal} items with the ${incomingTotal} items in this backup? This cannot be undone.`
  );
  if (!ok) return;

  showProgress("Restoring…");
  try {
    // Decode every photo back into a Blob *before* touching the database —
    // if a corrupt file throws partway through, nothing has been deleted yet.
    const restoredItems = await Backup.parseBackupItems(parsed, (done, total) => {
      updateProgressText(`Restoring… ${done} of ${total}`);
    });

    await DB.clearItems();
    await DB.clearMeta();
    for (const item of restoredItems) {
      await DB.putItem(item);
    }
    await DB.putMeta("schemaVersion", Backup.SCHEMA_VERSION);
  } catch (err) {
    console.error("Restore failed", err);
    alert("Restore didn't fully complete. Reloading whatever was saved.");
  } finally {
    // Reload from the database either way, so the in-memory list always
    // matches whatever actually ended up persisted, success or not.
    items = await DB.getAllItems();
    render();
    await updateBackupReminder();
    hideProgress();
  }
}

backupBtnEl.addEventListener("click", () => {
  closeOverflowSheet();
  handleBackup();
});

restoreBtnEl.addEventListener("click", () => {
  closeOverflowSheet();
  restoreFileInputEl.value = "";
  restoreFileInputEl.click();
});

restoreFileInputEl.addEventListener("change", () => {
  const file = restoreFileInputEl.files[0];
  if (file) handleRestoreFile(file);
});

// ---- Backup reminder (custom thresholds — deliberately not §13's 30 days,
// which is only for the Recently Deleted purge) ----
//
// 2 independent conditions, both required to show the bar: the backup
// itself must be stale (180+ days, or none ever taken), AND it must be at
// least a month since the "✕" was last dismissed. Dismissal is stored in
// `meta` (not just in memory) precisely so it survives closing the app —
// "stay hidden for a month" has to outlive any single session.
//
// Checked at app start and right after a backup/restore — not on every
// render(), so a dismissal doesn't get undone by something unrelated (like
// editing a name) triggering a re-render before its month is up.

const BACKUP_REMINDER_STALE_DAYS = 180;
const BACKUP_REMINDER_SNOOZE_DAYS = 30; // "1 month", same approximation §12 already uses

function daysSince(isoString) {
  const ms = Date.now() - new Date(isoString).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

async function updateBackupReminder() {
  const lastBackupAt = await DB.getMeta("lastBackupAt");
  const days = lastBackupAt ? daysSince(lastBackupAt) : null;
  const stale = days === null || days >= BACKUP_REMINDER_STALE_DAYS;

  const dismissedAt = await DB.getMeta("backupReminderDismissedAt");
  const snoozed = dismissedAt !== null && daysSince(dismissedAt) < BACKUP_REMINDER_SNOOZE_DAYS;

  if (!stale || snoozed) {
    backupReminderEl.hidden = true;
    return;
  }

  backupReminderTextEl.textContent =
    days === null ? "You haven't backed up yet." : `Last backup was ${days} days ago.`;
  backupReminderEl.hidden = false;
}

backupReminderActionEl.addEventListener("click", handleBackup);
backupReminderDismissEl.addEventListener("click", async () => {
  await DB.putMeta("backupReminderDismissedAt", new Date().toISOString());
  backupReminderEl.hidden = true;
});

// ---- Detail sheet ----

const backdropEl = document.getElementById("backdrop");
const sheetEl = document.getElementById("sheet");
const sheetDragEl = document.getElementById("sheetDrag");
const sheetTitleEl = document.getElementById("sheetTitle");
const fieldName = document.getElementById("fieldName");
const fieldType = document.getElementById("fieldType");
const fieldNote = document.getElementById("fieldNote");
const noteCountEl = document.getElementById("noteCount");
const fieldCode = document.getElementById("fieldCode");
const codeErrorEl = document.getElementById("codeError");
const fieldStatus = document.getElementById("fieldStatus");
const historyListEl = document.getElementById("historyList");
const deleteItemEl = document.getElementById("deleteItem");
const addButtonEl = document.getElementById("addButton");
const allCountEl = document.getElementById("allCount");
const bankCountEl = document.getElementById("bankCount");
const homeCountEl = document.getElementById("homeCount");
const addEntryEl = document.getElementById("addEntry");
const historyAddBackdropEl = document.getElementById("historyAddBackdrop");
const historyAddSheetEl = document.getElementById("historyAddSheet");
const historyToBankBtnEl = document.getElementById("historyToBankBtn");
const historyToHomeBtnEl = document.getElementById("historyToHomeBtn");
const historyAddCancelBtnEl = document.getElementById("historyAddCancelBtn");
const recentlyDeletedButtonEl = document.getElementById("recentlyDeletedButton");
const deletedBackdropEl = document.getElementById("deletedBackdrop");
const deletedSheetEl = document.getElementById("deletedSheet");
const deletedListEl = document.getElementById("deletedList");
const deletedDoneEl = document.getElementById("deletedDone");
const sheetPhotoEls = {
  photo1: document.getElementById("sheetPhoto1"),
  photo2: document.getElementById("sheetPhoto2"),
};
const photoFileInputEl = document.getElementById("photoFileInput");
const photoActionBackdropEl = document.getElementById("photoActionBackdrop");
const photoActionSheetEl = document.getElementById("photoActionSheet");
const photoReplaceBtnEl = document.getElementById("photoReplaceBtn");
const photoRemoveBtnEl = document.getElementById("photoRemoveBtn");
const photoCancelBtnEl = document.getElementById("photoCancelBtn");
const photoViewerEl = document.getElementById("photoViewer");
const photoViewerImgEl = document.getElementById("photoViewerImg");

TYPES.forEach((type) => {
  const opt = document.createElement("option");
  opt.value = type;
  opt.textContent = type;
  fieldType.appendChild(opt);
});

let openUid = null;

function findItem(uid) {
  return items.find((item) => item.uid === uid) || null;
}

function formatHistoryDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function renderHistory(item) {
  historyListEl.innerHTML = "";

  if (item.history.length === 0) {
    historyListEl.innerHTML = `<div class="history-empty">No history yet.</div>`;
    return;
  }

  // Newest first by date; ties broken by insertion order (§3).
  const sorted = item.history
    .map((entry, insertionIndex) => ({ ...entry, insertionIndex }))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.insertionIndex - a.insertionIndex;
    });

  sorted.forEach((entry) => {
    const wrap = document.createElement("div");
    wrap.className = "history-row-wrap";
    wrap.dataset.entryId = entry.id;
    const label = entry.to === "bank" ? "To Bank" : "To Home";
    wrap.innerHTML = `
      <button class="history-delete-btn">Delete</button>
      <div class="history-row">
        <span class="history-to">${label}</span>
        <span class="history-date">${formatHistoryDate(entry.date)}</span>
      </div>
    `;
    historyListEl.appendChild(wrap);
  });
}

// ---- Status pill: toggle bank/home, append history, buzz (§8) ----

async function toggleStatus(item) {
  item.status = item.status === "bank" ? "home" : "bank";
  item.history.push({
    id: crypto.randomUUID(),
    to: item.status,
    date: new Date().toISOString().slice(0, 10),
  });
  await persist(item);
  if (navigator.vibrate) navigator.vibrate(10);
}

fieldStatus.addEventListener("click", async () => {
  const item = findItem(openUid);
  if (!item) return;
  await toggleStatus(item);
  // persist() already re-rendered the (hidden) list; the sheet's own pill
  // and history also show status/history, so refresh those here too.
  const isBank = item.status === "bank";
  fieldStatus.className = "sheet-status-pill " + (isBank ? "pill-bank" : "pill-home");
  fieldStatus.textContent = isBank ? "🏦 Bank" : "🏠 Home";
  renderHistory(item);
});

// ---- History entry editing (§9) ----
//
// Tapping a row swaps its date text for a real, visible <input type="date">
// in the same spot. We *try* .focus()/.showPicker() to pop the calendar
// open immediately, but the input staying visible is what actually
// guarantees this works everywhere: some Android browsers (Samsung
// Internet included) silently refuse showPicker() on an element that isn't
// genuinely on-screen, which is exactly what an earlier, invisible-and-
// off-screen version of this input did. A real visible field never has
// that problem — worst case, it just takes a second tap to open the
// picker instead of one.
function startEditHistoryDate(wrap, item, entryId) {
  const entry = item.history.find((h) => h.id === entryId);
  const dateEl = wrap.querySelector(".history-date");
  if (!entry || !dateEl || dateEl.tagName === "INPUT") return;

  const input = document.createElement("input");
  input.type = "date";
  input.className = "history-date-input";
  input.value = entry.date;
  dateEl.replaceWith(input);

  const finish = async () => {
    if (input.value && input.value !== entry.date) {
      entry.date = input.value;
      await persist(item);
    }
    renderHistory(item); // rebuilds the row either way, editing or not
  };

  input.addEventListener("change", finish);
  input.addEventListener("blur", finish, { once: true });

  input.focus();
  if (input.showPicker) {
    try {
      input.showPicker();
    } catch (err) {
      // Some browsers throw here in edge cases (e.g. called too soon after
      // the element was inserted). Harmless — the visible input is still
      // there, tappable, same as if showPicker() didn't exist at all.
    }
  }
}

// Which entry (if any) is currently swiped open, revealing its Delete
// button. Tracked so a tap elsewhere can close it, and so a tap on an
// already-open row closes it instead of opening the date picker.
let openHistoryEntryId = null;

const HISTORY_REVEAL_PX = 72; // width of the Delete button
const HISTORY_AUTO_DELETE_PX = 140; // swipe this far and it deletes on release

let historySwipe = null; // { wrap, rowEl, startX, startY, startTranslate, horizontal, translate }

historyListEl.addEventListener("pointerdown", (e) => {
  const wrap = e.target.closest(".history-row-wrap");
  if (!wrap || e.target.closest(".history-delete-btn")) return;

  historySwipe = {
    wrap,
    rowEl: wrap.querySelector(".history-row"),
    startX: e.clientX,
    startY: e.clientY,
    startTranslate: wrap.dataset.entryId === openHistoryEntryId ? -HISTORY_REVEAL_PX : 0,
    horizontal: null, // unknown until the pointer has moved a bit
    translate: 0,
  };
});

historyListEl.addEventListener("pointermove", (e) => {
  if (!historySwipe) return;
  const dx = e.clientX - historySwipe.startX;
  const dy = e.clientY - historySwipe.startY;

  if (historySwipe.horizontal === null) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // not enough to tell yet
    historySwipe.horizontal = Math.abs(dx) > Math.abs(dy);
    if (!historySwipe.horizontal) {
      historySwipe = null; // a vertical drag — leave it to the page scroll
      return;
    }
    historySwipe.rowEl.style.transition = "none";
  }

  const translate = Math.max(-220, Math.min(0, historySwipe.startTranslate + dx));
  historySwipe.translate = translate;
  historySwipe.rowEl.style.transform = `translateX(${translate}px)`;
});

async function endHistorySwipe() {
  if (!historySwipe) return;
  const { wrap, rowEl, horizontal, translate } = historySwipe;
  historySwipe = null;
  if (!horizontal) return;

  rowEl.style.transition = "";

  if (translate <= -HISTORY_AUTO_DELETE_PX) {
    // A full swipe deletes immediately, no need to land on the button.
    const item = findItem(openUid);
    if (item) {
      item.history = item.history.filter((h) => h.id !== wrap.dataset.entryId);
      if (openHistoryEntryId === wrap.dataset.entryId) openHistoryEntryId = null;
      await persist(item);
      renderHistory(item);
    }
  } else if (translate <= -HISTORY_REVEAL_PX / 2) {
    rowEl.style.transform = `translateX(-${HISTORY_REVEAL_PX}px)`;
    openHistoryEntryId = wrap.dataset.entryId;
  } else {
    rowEl.style.transform = "";
    if (openHistoryEntryId === wrap.dataset.entryId) openHistoryEntryId = null;
  }
}

historyListEl.addEventListener("pointerup", endHistorySwipe);
historyListEl.addEventListener("pointercancel", endHistorySwipe);

historyListEl.addEventListener("click", async (e) => {
  const wrap = e.target.closest(".history-row-wrap");
  if (!wrap) return;
  const entryId = wrap.dataset.entryId;
  const item = findItem(openUid);
  if (!item) return;

  if (e.target.closest(".history-delete-btn")) {
    item.history = item.history.filter((h) => h.id !== entryId);
    if (openHistoryEntryId === entryId) openHistoryEntryId = null;
    await persist(item);
    renderHistory(item);
    return;
  }

  if (openHistoryEntryId === entryId) {
    // A tap on an already-revealed row just closes it — a swipe that ends
    // in a real tap (no movement) never reaches here at all, since mobile
    // browsers suppress the synthetic click after a drag past a few px.
    wrap.querySelector(".history-row").style.transform = "";
    openHistoryEntryId = null;
    return;
  }

  startEditHistoryDate(wrap, item, entryId);
});

// ---- "Add entry": pick a direction, stamp today's date (§9) ----

function openHistoryAddSheet() {
  historyAddBackdropEl.classList.add("open");
  historyAddSheetEl.classList.add("open");
  history.pushState({ historyAddOpen: true }, "");
}

function hideHistoryAddSheet() {
  historyAddBackdropEl.classList.remove("open");
  historyAddSheetEl.classList.remove("open");
}

function closeHistoryAddSheet() {
  if (!historyAddSheetEl.classList.contains("open")) return;
  if (history.state && history.state.historyAddOpen) {
    history.back();
  } else {
    hideHistoryAddSheet();
  }
}

async function addHistoryEntry(to) {
  const item = findItem(openUid);
  if (!item) return;
  item.history.push({ id: crypto.randomUUID(), to, date: new Date().toISOString().slice(0, 10) });
  await persist(item);
  renderHistory(item);
}

addEntryEl.addEventListener("click", openHistoryAddSheet);
historyAddBackdropEl.addEventListener("click", closeHistoryAddSheet);
historyAddCancelBtnEl.addEventListener("click", closeHistoryAddSheet);
historyToBankBtnEl.addEventListener("click", () => {
  closeHistoryAddSheet();
  addHistoryEntry("bank");
});
historyToHomeBtnEl.addEventListener("click", () => {
  closeHistoryAddSheet();
  addHistoryEntry("home");
});

function updateNoteCount() {
  const len = fieldNote.value.length;
  noteCountEl.textContent = `${len} / 120`;
  noteCountEl.classList.toggle("visible", len >= 100);
}

function fillSheet(item) {
  sheetTitleEl.textContent = item.code;

  fieldName.value = item.name;
  fieldType.value = item.type;
  fieldNote.value = item.note;
  updateNoteCount();
  fieldCode.value = item.code;
  codeErrorEl.classList.remove("visible");
  codeErrorEl.textContent = "";

  const isBank = item.status === "bank";
  fieldStatus.className = "sheet-status-pill " + (isBank ? "pill-bank" : "pill-home");
  fieldStatus.textContent = isBank ? "🏦 Bank" : "🏠 Home";

  renderHistory(item);
  renderSheetPhoto(item, "photo1");
  renderSheetPhoto(item, "photo2");
}

// ---- Photos (§10) ----
//
// The sheet's 2 photo slots share this logic. Each slot shows the *Thumb
// blob (320px is plenty at the ~150px sheet size and the list's even
// smaller thumbnails); the full-screen viewer is the only place the 1400px
// *Full blob is used.

const sheetPhotoUrls = { photo1: null, photo2: null };
let pendingPhotoSlot = null; // which slot the file picker was opened for
let photoLongPressTimer = null;
let photoLongPressFired = false;
let photoPressStart = null;

function renderSheetPhoto(item, slot) {
  const el = sheetPhotoEls[slot];
  const img = el.querySelector(".sheet-photo-img");
  const icon = el.querySelector(".sheet-photo-icon");

  if (sheetPhotoUrls[slot]) {
    URL.revokeObjectURL(sheetPhotoUrls[slot]);
    sheetPhotoUrls[slot] = null;
  }

  const blob = item[slot + "Thumb"];
  if (blob) {
    sheetPhotoUrls[slot] = URL.createObjectURL(blob);
    img.src = sheetPhotoUrls[slot];
    img.hidden = false;
    icon.hidden = true;
  } else {
    img.hidden = true;
    img.removeAttribute("src");
    icon.hidden = false;
  }
}

function revokeSheetPhotoUrls() {
  Object.keys(sheetPhotoUrls).forEach((slot) => {
    if (sheetPhotoUrls[slot]) {
      URL.revokeObjectURL(sheetPhotoUrls[slot]);
      sheetPhotoUrls[slot] = null;
    }
  });
}

function showPhotoSpinner(slot, show) {
  sheetPhotoEls[slot].querySelector(".sheet-photo-spinner").hidden = !show;
}

function openPhotoPicker(slot) {
  pendingPhotoSlot = slot;
  photoFileInputEl.value = ""; // so picking the same file twice still fires "change"
  photoFileInputEl.click();
}

photoFileInputEl.addEventListener("change", async () => {
  const file = photoFileInputEl.files[0];
  const slot = pendingPhotoSlot;
  const item = findItem(openUid);
  if (!file || !slot || !item) return;

  showPhotoSpinner(slot, true);
  try {
    const { full, thumb } = await Photos.processPhoto(file);
    item[slot + "Full"] = full;
    item[slot + "Thumb"] = thumb;
    await persist(item);
    renderSheetPhoto(item, slot);
  } catch (err) {
    console.error("Photo processing failed", err);
    alert("Couldn't use that photo. Please try a different one.");
  } finally {
    showPhotoSpinner(slot, false);
  }
});

// ---- Replace / Remove action sheet ----

function openPhotoActionSheet(slot) {
  pendingPhotoSlot = slot;
  photoActionBackdropEl.classList.add("open");
  photoActionSheetEl.classList.add("open");
  history.pushState({ photoActionOpen: true }, "");
}

function hidePhotoActionSheet() {
  photoActionBackdropEl.classList.remove("open");
  photoActionSheetEl.classList.remove("open");
}

function closePhotoActionSheet() {
  if (!photoActionSheetEl.classList.contains("open")) return;
  if (history.state && history.state.photoActionOpen) {
    history.back();
  } else {
    hidePhotoActionSheet();
  }
}

photoActionBackdropEl.addEventListener("click", closePhotoActionSheet);
photoCancelBtnEl.addEventListener("click", closePhotoActionSheet);

photoReplaceBtnEl.addEventListener("click", () => {
  const slot = pendingPhotoSlot;
  closePhotoActionSheet();
  openPhotoPicker(slot);
});

photoRemoveBtnEl.addEventListener("click", async () => {
  const slot = pendingPhotoSlot;
  closePhotoActionSheet();
  const item = findItem(openUid);
  if (!item) return;
  item[slot + "Full"] = null;
  item[slot + "Thumb"] = null;
  await persist(item);
  renderSheetPhoto(item, slot);
});

// ---- Tap (open picker / viewer) and long-press (Replace/Remove) on a
// sheet photo slot. Same 200ms-timer-cancelled-by-movement pattern as the
// row long-press-to-reorder gesture in §8, just simpler since there's no
// drag to hand off into.

Object.entries(sheetPhotoEls).forEach(([slot, el]) => {
  el.addEventListener("pointerdown", (e) => {
    photoLongPressFired = false;
    photoPressStart = { x: e.clientX, y: e.clientY };
    photoLongPressTimer = setTimeout(() => {
      // Only a filled slot has anything to replace/remove — an empty slot
      // ignores the long hold entirely, so releasing it still falls through
      // to the tap handler below and opens the picker (photoLongPressFired
      // must stay false for that to happen).
      const item = findItem(openUid);
      if (item && item[slot + "Full"]) {
        photoLongPressFired = true;
        openPhotoActionSheet(slot);
      }
    }, 500);
  });

  el.addEventListener("pointermove", (e) => {
    if (!photoPressStart) return;
    const dx = Math.abs(e.clientX - photoPressStart.x);
    const dy = Math.abs(e.clientY - photoPressStart.y);
    if (dx > 8 || dy > 8) clearTimeout(photoLongPressTimer);
  });

  const endPress = () => {
    clearTimeout(photoLongPressTimer);
    photoPressStart = null;
  };
  el.addEventListener("pointerup", () => {
    const wasLongPress = photoLongPressFired;
    endPress();
    if (wasLongPress) return;

    const item = findItem(openUid);
    if (!item) return;
    const fullBlob = item[slot + "Full"];
    if (fullBlob) {
      openPhotoViewer(fullBlob);
    } else {
      openPhotoPicker(slot);
    }
  });
  el.addEventListener("pointercancel", endPress);
});

// ---- Full-screen photo viewer: pinch to zoom, double-tap to zoom, swipe
// down or tap outside to close (§10). Plain pointer events, no library —
// same reasoning as the reorder gesture in §8.

let viewerUrl = null;
let viewerScale = 1;
let viewerTranslate = { x: 0, y: 0 };
const viewerPointers = new Map();
let viewerPinchStart = null; // { distance, scale }
let viewerPanStart = null; // dragging while zoomed in
let viewerCloseDragStart = null; // swipe-down-to-close while at scale 1

function applyViewerTransform() {
  photoViewerImgEl.style.transform =
    `translate(${viewerTranslate.x}px, ${viewerTranslate.y}px) scale(${viewerScale})`;
}

function resetViewerTransform() {
  viewerScale = 1;
  viewerTranslate = { x: 0, y: 0 };
  applyViewerTransform();
}

function openPhotoViewer(blob) {
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = URL.createObjectURL(blob);
  photoViewerImgEl.src = viewerUrl;
  resetViewerTransform();
  photoViewerEl.classList.add("open");
  history.pushState({ viewerOpen: true }, "");
}

function hidePhotoViewer() {
  photoViewerEl.classList.remove("open");
  photoViewerEl.style.opacity = "";
  if (viewerUrl) {
    URL.revokeObjectURL(viewerUrl);
    viewerUrl = null;
  }
  photoViewerImgEl.removeAttribute("src");
  resetViewerTransform();
}

function closePhotoViewer() {
  if (!photoViewerEl.classList.contains("open")) return;
  if (history.state && history.state.viewerOpen) {
    history.back();
  } else {
    hidePhotoViewer();
  }
}

// Tapping the black background (not the image itself) closes the viewer.
photoViewerEl.addEventListener("click", (e) => {
  if (e.target === photoViewerEl) closePhotoViewer();
});

// Double-tap toggles between fit and a fixed zoom level.
photoViewerImgEl.addEventListener("dblclick", () => {
  if (viewerScale > 1) {
    resetViewerTransform();
  } else {
    viewerScale = 2.5;
    applyViewerTransform();
  }
});

function viewerPointerDistance() {
  const pts = [...viewerPointers.values()];
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

photoViewerEl.addEventListener("pointerdown", (e) => {
  viewerPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  // Follow the finger exactly while a gesture is live; the CSS transition
  // is only for the double-tap snap and the open/close fade.
  photoViewerImgEl.style.transition = "none";

  if (viewerPointers.size === 2) {
    viewerPinchStart = { distance: viewerPointerDistance(), scale: viewerScale };
    viewerCloseDragStart = null;
  } else if (viewerPointers.size === 1) {
    if (viewerScale > 1) {
      viewerPanStart = {
        x: e.clientX,
        y: e.clientY,
        tx: viewerTranslate.x,
        ty: viewerTranslate.y,
      };
    } else {
      viewerCloseDragStart = { x: e.clientX, y: e.clientY };
      photoViewerEl.style.transition = "none";
    }
  }
});

photoViewerEl.addEventListener("pointermove", (e) => {
  if (!viewerPointers.has(e.pointerId)) return;
  viewerPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (viewerPointers.size === 2 && viewerPinchStart) {
    const ratio = viewerPointerDistance() / viewerPinchStart.distance;
    viewerScale = Math.min(4, Math.max(1, viewerPinchStart.scale * ratio));
    applyViewerTransform();
  } else if (viewerPanStart) {
    viewerTranslate.x = viewerPanStart.tx + (e.clientX - viewerPanStart.x);
    viewerTranslate.y = viewerPanStart.ty + (e.clientY - viewerPanStart.y);
    applyViewerTransform();
  } else if (viewerCloseDragStart) {
    const dy = e.clientY - viewerCloseDragStart.y;
    if (dy > 0) {
      photoViewerImgEl.style.transform = `translateY(${dy}px)`;
      photoViewerEl.style.opacity = String(Math.max(0.3, 1 - dy / 400));
    }
  }
});

function endViewerPointer(e) {
  viewerPointers.delete(e.pointerId);

  if (viewerCloseDragStart) {
    const dy = e.clientY - viewerCloseDragStart.y;
    photoViewerEl.style.transition = "";
    if (dy > 100) {
      closePhotoViewer();
    } else {
      applyViewerTransform();
      photoViewerEl.style.opacity = "";
    }
    viewerCloseDragStart = null;
  }

  viewerPanStart = null;
  if (viewerPointers.size < 2) viewerPinchStart = null;
  if (viewerScale <= 1.01) resetViewerTransform();
  if (viewerPointers.size === 0) photoViewerImgEl.style.transition = "";
}

photoViewerEl.addEventListener("pointerup", endViewerPointer);
photoViewerEl.addEventListener("pointercancel", endViewerPointer);

// Persist a field change: write to IndexedDB, update the in-memory mirror,
// and re-render the (hidden, behind the sheet) list so it's consistent
// whenever the sheet is closed.
async function persist(item) {
  await DB.putItem(item);
  const idx = items.findIndex((it) => it.uid === item.uid);
  if (idx !== -1) items[idx] = item;
  render();
}

function openSheet(uid) {
  const item = findItem(uid);
  if (!item) return;
  openUid = uid;
  fillSheet(item);
  backdropEl.classList.add("open");
  sheetEl.classList.add("open");
  history.pushState({ sheetOpen: true }, "");
}

function hideSheet() {
  backdropEl.classList.remove("open");
  sheetEl.classList.remove("open");
  sheetEl.style.transform = "";
  openUid = null;
  revokeSheetPhotoUrls();
}

// Closing always goes through history.back() so the pushState from
// openSheet() gets popped; the popstate listener below does the actual
// hiding. That keeps "swipe down" / "tap backdrop" / "Android back" as one
// code path, per §6: back must never exit the app while the sheet is open.
function closeSheet() {
  if (!openUid) return;
  if (history.state && history.state.sheetOpen) {
    history.back();
  } else {
    hideSheet();
  }
}

// Overlays can stack (sheet, then a photo opened from it), so back must
// only close the topmost one. Checked most-recently-opened first.
window.addEventListener("popstate", () => {
  if (photoViewerEl.classList.contains("open")) { hidePhotoViewer(); return; }
  if (photoActionSheetEl.classList.contains("open")) { hidePhotoActionSheet(); return; }
  if (historyAddSheetEl.classList.contains("open")) { hideHistoryAddSheet(); return; }
  if (overflowSheetEl.classList.contains("open")) { hideOverflowSheet(); return; }
  if (openUid) hideSheet();
  if (deletedSheetEl.classList.contains("open")) hideDeletedList();
});

backdropEl.addEventListener("click", closeSheet);

// Tap on a row opens the sheet, except on the pill, which toggles status in
// place, or a thumbnail, which opens the photo viewer instead — but only if
// that slot actually has a photo (§8: "Tap either thumbnail | Open photo
// viewer").
document.getElementById("rows").addEventListener("click", async (e) => {
  const pill = e.target.closest(".pill");
  if (pill) {
    e.stopPropagation(); // §8: must not also open the sheet
    const row = pill.closest(".row");
    const item = findItem(row && row.dataset.uid);
    if (item) await toggleStatus(item);
    return;
  }

  const thumb = e.target.closest(".thumb");
  if (thumb) {
    const row = thumb.closest(".row");
    const item = findItem(row && row.dataset.uid);
    const fullBlob = item && item[thumb.dataset.slot + "Full"];
    if (fullBlob) openPhotoViewer(fullBlob);
    return;
  }

  const row = e.target.closest(".row");
  if (!row || !row.dataset.uid) return;
  openSheet(row.dataset.uid);
});

// ---- field commits ----

fieldName.addEventListener("blur", async () => {
  const item = findItem(openUid);
  if (!item) return;
  const value = fieldName.value.trim();
  if (!value) {
    fieldName.value = item.name; // required — revert rather than save empty
    return;
  }
  if (value === item.name) return;
  item.name = value;
  await persist(item);
});

fieldType.addEventListener("change", async () => {
  const item = findItem(openUid);
  if (!item) return;
  item.type = fieldType.value;
  await persist(item);
});

fieldNote.addEventListener("input", updateNoteCount);

fieldNote.addEventListener("blur", async () => {
  const item = findItem(openUid);
  if (!item) return;
  if (fieldNote.value === item.note) return;
  item.note = fieldNote.value;
  await persist(item);
});

fieldCode.addEventListener("blur", async () => {
  const item = findItem(openUid);
  if (!item) return;

  const value = fieldCode.value.trim().toUpperCase();
  if (value === item.code) {
    fieldCode.value = item.code;
    return;
  }

  // Deleted-but-not-purged items still reserve their code (§4), so they
  // count as a conflict too, same as nextAvailableCode() treats them.
  const conflict = items.find((it) => it.uid !== item.uid && it.code === value);
  if (!value || conflict) {
    codeErrorEl.textContent = conflict
      ? `Code ${value} is already used by "${conflict.name}".`
      : "Code can't be empty.";
    codeErrorEl.classList.add("visible");
    fieldCode.value = item.code;
    return;
  }

  codeErrorEl.classList.remove("visible");
  item.code = value;
  await persist(item);
  sheetTitleEl.textContent = item.code;
});

// ---- delete (§12) ----

deleteItemEl.addEventListener("click", async () => {
  const item = findItem(openUid);
  if (!item) return;

  const label = item.name || "this item";
  const ok = confirm(`Delete "${label}"? It moves to Recently deleted for 30 days.`);
  if (!ok) return;

  item.deletedAt = new Date().toISOString();
  await persist(item);
  closeSheet();
});

// ---- add (§4) ----

addButtonEl.addEventListener("click", async () => {
  const code = nextAvailableCode(items);
  if (!code) return; // all 234 codes taken — see nextAvailableCode()

  const now = new Date();
  const status = "home"; // no default is specified by the spec; a newly
                          // added item is most likely still on hand, not
                          // yet placed in the bank
  const item = {
    uid: crypto.randomUUID(),
    code,
    position: nextPosition(items),
    name: "",
    type: TYPES[6], // "այլ" — the default for a new item (§5)
    note: "",
    status,
    photo1Thumb: null,
    photo1Full: null,
    photo2Thumb: null,
    photo2Full: null,
    history: [{ id: crypto.randomUUID(), to: status, date: now.toISOString().slice(0, 10) }],
    createdAt: now.toISOString(),
    deletedAt: null,
  };

  await DB.putItem(item);
  items.push(item);
  render();
  openSheet(item.uid);
  fieldName.focus();
});

// ---- Recently deleted (§12) ----

function daysLeft(deletedAtIso) {
  const msLeft = new Date(deletedAtIso).getTime() + 30 * 24 * 60 * 60 * 1000 - Date.now();
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
}

function renderDeletedList() {
  const deleted = items
    .filter((item) => item.deletedAt)
    .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

  deletedListEl.innerHTML = "";

  if (deleted.length === 0) {
    deletedListEl.innerHTML = `<div class="deleted-empty">Nothing here.</div>`;
    return;
  }

  deleted.forEach((item) => {
    const left = daysLeft(item.deletedAt);
    const row = document.createElement("div");
    row.className = "deleted-row";
    row.innerHTML = `
      <div class="deleted-info">
        <div class="deleted-name">${item.name || "(unnamed)"} · ${item.code}</div>
        <div class="deleted-meta">${left} day${left === 1 ? "" : "s"} left</div>
      </div>
      <div class="deleted-actions">
        <button class="deleted-restore" data-action="restore" data-uid="${item.uid}">Restore</button>
        <button class="deleted-purge" data-action="purge" data-uid="${item.uid}">Delete permanently</button>
      </div>
    `;
    deletedListEl.appendChild(row);
  });
}

deletedListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const uid = btn.dataset.uid;
  const item = findItem(uid);
  if (!item) return;

  if (btn.dataset.action === "restore") {
    // Original code, unless something else has taken it in the meantime (§12)
    const codeTaken = items.some((it) => it.uid !== uid && !it.deletedAt && it.code === item.code);
    if (codeTaken) item.code = nextAvailableCode(items.filter((it) => it.uid !== uid));
    item.position = nextPosition(items);
    item.deletedAt = null;
    await persist(item);
    renderDeletedList();
  } else if (btn.dataset.action === "purge") {
    await DB.deleteItem(uid);
    items = items.filter((it) => it.uid !== uid);
    renderDeletedList();
  }
});

function openDeletedList() {
  renderDeletedList();
  deletedBackdropEl.classList.add("open");
  deletedSheetEl.classList.add("open");
  history.pushState({ deletedOpen: true }, "");
}

function hideDeletedList() {
  deletedBackdropEl.classList.remove("open");
  deletedSheetEl.classList.remove("open");
}

function closeDeletedList() {
  if (!deletedSheetEl.classList.contains("open")) return;
  if (history.state && history.state.deletedOpen) {
    history.back();
  } else {
    hideDeletedList();
  }
}

// The recycle bin icon is the only way into Recently deleted.
recentlyDeletedButtonEl.addEventListener("click", openDeletedList);

deletedDoneEl.addEventListener("click", closeDeletedList);
deletedBackdropEl.addEventListener("click", closeDeletedList);

// ---- drag the handle down to dismiss ----

let dragStartY = null;
let dragCurrentY = 0;

sheetDragEl.addEventListener("pointerdown", (e) => {
  dragStartY = e.clientY;
  sheetDragEl.setPointerCapture(e.pointerId);
  sheetEl.style.transition = "none";
});

sheetDragEl.addEventListener("pointermove", (e) => {
  if (dragStartY === null) return;
  dragCurrentY = Math.max(0, e.clientY - dragStartY);
  sheetEl.style.transform = `translateY(${dragCurrentY}px)`;
});

function endDrag() {
  if (dragStartY === null) return;
  sheetEl.style.transition = "";
  if (dragCurrentY > 120) {
    closeSheet();
  } else {
    sheetEl.style.transform = "";
  }
  dragStartY = null;
  dragCurrentY = 0;
}

sheetDragEl.addEventListener("pointerup", endDrag);
sheetDragEl.addEventListener("pointercancel", endDrag);

// ---- boot ----

// Anything that's been in Recently deleted for more than 30 days is gone
// for good, checked once on every app start (§12).
async function purgeExpired(loadedItems) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const kept = [];
  for (const item of loadedItems) {
    if (item.deletedAt && new Date(item.deletedAt).getTime() < cutoff) {
      await DB.deleteItem(item.uid);
    } else {
      kept.push(item);
    }
  }
  return kept;
}

async function init() {
  const loaded = await seedIfEmpty();
  items = await purgeExpired(loaded);
  render();

  // Stamp the data format version once, on first run only (§3's meta store).
  // Backup/restore compare a file's own schemaVersion against Backup's
  // constant directly, so this is mostly a record for future migrations.
  if ((await DB.getMeta("schemaVersion")) === null) {
    await DB.putMeta("schemaVersion", Backup.SCHEMA_VERSION);
  }

  await updateBackupReminder();
}

init();
