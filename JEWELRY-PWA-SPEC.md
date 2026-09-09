# Jewelry Inventory — Build Spec

A private Progressive Web App for tracking family gold jewelry across 2 locations:
a bank safe deposit box and home. Single user, single phone, no accounts, no server,
no analytics. All data lives on the device.

**Read this whole file before writing any code.** Build in the order given in
§17, and stop after each step so it can be checked on a real phone.

---

## 1. Target and constraints

| | |
|---|---|
| Device | Samsung Galaxy S24 Ultra, Samsung Browser, portrait only |
| Design viewport | 390 px CSS wide (design for this, allow 360–430) |
| Items | 20–40, will not exceed ~100 |
| Network | Must work fully offline (the bank vault has no signal) |
| Auth | None. The phone's own lock screen is the only protection |
| Hosting | GitHub Pages, installed to home screen |

Assume a fast device. Do not add virtualization, pagination, or lazy-render
tricks for a list of 40 rows.

---

## 2. Stack

Vanilla HTML, CSS and JavaScript. **No framework, no build step, no npm, no
bundler.** Files are deployed exactly as written. This is deliberate: the owner
is learning to code and needs to be able to edit a file, push, and see the change.

No external CDN links of any kind — everything must work offline on first load
after install.

### File structure

```
index.html
css/app.css
js/db.js          IndexedDB layer — all storage functions live here
js/photos.js      image resize + compression
js/app.js         UI, rendering, events
js/backup.js      export / import
sw.js             service worker (must sit at repo root for scope)
manifest.webmanifest
icons/icon-192.png
icons/icon-512.png
icons/icon-maskable-512.png
```

Keep `db.js` free of DOM code and `app.js` free of raw IndexedDB calls.

---

## 3. Data model

IndexedDB database `jewelry`, version 1.

### Store: `items` (keyPath `uid`)

| Field | Type | Notes |
|---|---|---|
| `uid` | string | `crypto.randomUUID()`. Permanent, internal, never shown, never changes |
| `code` | string | Visible ID, e.g. `A8`. See §4 |
| `position` | number | Sort order. Float, see §4 |
| `name` | string | Required, max 60 chars |
| `type` | string | 1 of the values in §5 |
| `note` | string | Max 120 chars, single line |
| `status` | `"bank"` \| `"home"` | Authoritative current location |
| `photo1Thumb` | Blob | Item photo, 320 px |
| `photo1Full` | Blob | Item photo, 1400 px |
| `photo2Thumb` | Blob \| null | Box photo, 320 px |
| `photo2Full` | Blob \| null | Box photo, 1400 px |
| `history` | array | See below |
| `createdAt` | string | ISO timestamp |
| `deletedAt` | string \| null | Set on delete, see §12 |

History entry:

```js
{ id: "uuid", to: "bank" | "home", date: "2026-09-06" }
```

`date` is a plain date string, no time, no timezone. Sort descending by `date`
for display; ties broken by insertion order.

### Store: `meta` (keyPath `key`)

Single-value records: `lastBackupAt`, `schemaVersion`.

### Photos are Blobs, not base64 strings

Store `Blob` objects directly in IndexedDB. Render with
`URL.createObjectURL(blob)` and **call `URL.revokeObjectURL()` when the element
is removed** or the app will leak memory as the list is scrolled and re-rendered.

---

## 4. IDs, codes and ordering

3 separate concepts. Do not merge them.

**`uid`** — internal identity. A UUID. Never displayed. Everything (history,
photos) is keyed to this.

**`code`** — the visible label, 1 capital A–Z followed by 1 digit 1–9: `A1`…`A9`,
`B1`…`B9`, and so on. 234 possible codes.

- Auto-assigned on create: the lowest code not currently in use, including codes
  held by items in Recently deleted.
- **Never reassigned by dragging.** Once an item is `A8` it stays `A8`.
- Editable by hand in the detail sheet. Reject a duplicate with the inline
  message: `Code A8 is already used by "Grandmother's ring".`

**`position`** — sort order only, never displayed. Store as a float. To drop an
item between neighbours at 3.0 and 4.0, set it to 3.5. Renormalize to whole
numbers 1, 2, 3… only when 2 positions come within 0.0001 of each other.

---

## 5. Type values

A fixed list, in this order, stored as a constant in `app.js` so it is easy to edit:

```js
const TYPES = ["մատանի", "բրասլետ", "կուլոն", "ցեպ", "կոպեկ", "օղեր", "այլ"];
```

Rendered as a native `<select>` in the detail sheet. Default for a new item: `այլ`.
All other interface text is in English. Search must match Armenian text correctly
(see §11).

---

## 6. Screens

There are exactly 3 surfaces.

1. **List** — the whole app. Search bar, filter chips, table, add button.
2. **Detail sheet** — slides up from the bottom. Opened by tapping a row.
3. **Photo viewer** — full-screen. Opened by tapping a thumbnail.

No routing, no separate pages, no navigation stack. The sheet and viewer are
overlays over the list, dismissed by the Android back button, by a downward
swipe, or by tapping outside.

Wire the Android back button with `history.pushState` when an overlay opens and
`popstate` to close it. Back must never exit the app while an overlay is open.

---

## 7. List layout

The 7 columns, left to right. Columns 1–4 must be readable **without any
horizontal scrolling**; 5–7 are reached by scrolling right.

| # | Column | Width | Notes |
|---|---|---|---|
| 1 | Code | 34 px | Sticky to the left edge while scrolling horizontally |
| 2 | Photo 1 | 80 px | Square, 10 px corner radius. Must be big enough to recognise the piece without tapping |
| 3 | Name | 132 px | 2 lines max, then ellipsis |
| 4 | Status | 62 px | Pill, see §8 |
| 5 | Type | 88 px | Single line |
| 6 | Photo 2 | 56 px | Square, 8 px radius |
| 7 | Note | 170 px | 2 lines max, then ellipsis |

Total content width ~622 px + padding, inside a ~390 px viewport, so roughly
250 px of horizontal travel.

### Structure

One horizontally scrollable container holding the header row and all body rows,
so they scroll together and stay aligned. The page scrolls vertically as normal.
The header row is sticky to the top; the code column is sticky to the left.

```
┌──────────────────────────────────────┐
│  Search                              │  sticky
│  [ All 40 ] [ 🏦 34 ] [ 🏠 6 ]       │  sticky
├────┬────────┬──────────┬──────┬──────┤
│ ID │ Photo  │ Name     │ Where│ Type │→ scrolls right
├────┼────────┼──────────┼──────┼──────┤
│ A1 │ ┌────┐ │ Yellow   │ 🏦   │ բրաս│
│    │ │ img│ │ bracelet │      │      │
│    │ └────┘ │          │      │      │
├────┼────────┼──────────┼──────┼──────┤
│ A2 │ ┌────┐ │ ...      │ 🏠   │      │
└────┴────────┴──────────┴──────┴──────┘
                                  [ + ]  floating
```

Row height 96 px. Hairline separators (0.5 px) between rows, inset to start at
the photo. Roughly 7 rows visible at a time.

Use a CSS grid or fixed-width table — not a flex row per item — so columns line
up exactly between the header and every row.

---

## 8. Gestures

There are 3 candidate gestures on a row and they must not fight each other.
The resolution below is deliberate; do not "improve" it.

| Gesture | Result |
|---|---|
| Tap on the row (anywhere except the pill or a thumbnail) | Open detail sheet |
| Tap the status pill | Toggle bank ↔ home instantly, in place |
| Tap either thumbnail | Open photo viewer |
| Horizontal drag | Scroll the table sideways |
| Long-press 200 ms, then vertical drag | Reorder |

**There is no swipe-to-delete.** Horizontal swipe is already the sideways scroll,
and the 2 cannot coexist on the same surface. Delete lives at the bottom of the
detail sheet instead (§12).

### Status pill

2 states only.

- Bank: `🏦` on a light blue-grey fill.
- Home: `🏠` on a light green fill.

Tapping it toggles the value, writes to IndexedDB, appends a history entry dated
today, updates the filter chip counts, and fires a short haptic buzz via
`navigator.vibrate(10)`. No confirmation dialog, no toast. Animate the fill colour
over 150 ms so the change is visible.

Stop propagation so the tap does not also open the sheet.

### Long-press reorder

Use Pointer Events, not the HTML5 drag-and-drop API — it is unreliable on Android.

1. `pointerdown` starts a 200 ms timer. Cancel it if the pointer moves more than
   8 px first, so scrolling still works.
2. On fire: `setPointerCapture`, set `touch-action: none` on the row, scale it to
   0.97, add a shadow, `navigator.vibrate(15)`.
3. Track `pointermove` on the Y axis, translate the lifted row, and shift the
   other rows to open a gap at the target index.
4. Auto-scroll the page when the pointer is within 60 px of the top or bottom edge.
5. On `pointerup`: animate into place, recompute `position`, persist, and
   **leave every `code` untouched.**

This is the hardest part of the build. Do it last. If it fights you for more than
a couple of attempts, fall back to a vendored copy of SortableJS with
`delay: 200, delayOnTouchOnly: true` — but copy the file into `js/` rather than
linking a CDN, because it has to work offline.

---

## 9. Detail sheet

Slides up from the bottom over a dimmed backdrop, 92% of viewport height, rounded
top corners, a small grab handle. Everything is editable in place — no separate
edit mode, no Save button. Each field commits on blur.

Order of contents:

1. Both photos side by side, large (~150 px). Tap to enlarge, long-press for
   `Replace photo` / `Remove photo`.
2. Name — a text input styled to look like plain text until focused.
3. Type — native `<select>`.
4. Note — textarea, 120 char limit, live counter appearing at 100.
5. Code — small text input with the uniqueness check from §4.
6. Status — the same pill, full width, tappable.
7. **Move history** — scrollable, newest first:

   ```
   To Home — 06 Sep 2026
   To Bank — 04 Sep 2026
   To Home — 25 Sep 2025
   To Bank — 04 Sep 2024
   ```

   Tap a row to edit its date with a native `<input type="date">`. Swipe left on
   an entry to delete it (safe here — the sheet does not scroll horizontally).
   An `Add entry` button at the bottom appends a manual record.

8. `Delete item` — red text, full width, at the very bottom.

### Status and history are kept separate on purpose

`status` is the single source of truth for where an item is now. `history` is a
correctable log. Editing or deleting a history entry does **not** change `status`,
and toggling `status` always appends a new entry. They can legitimately disagree
after a manual correction, and that is fine — do not add code to reconcile them.

---

## 10. Photos

Tapping an empty photo slot calls a plain `<input type="file" accept="image/*">`,
which lets Android offer both the gallery and the camera. Do not use `capture`,
which would force the camera.

Pipeline on selection:

1. Read the file, honour EXIF orientation (`createImageBitmap` with
   `{ imageOrientation: "from-image" }`).
2. Draw to a canvas twice: longest edge 1400 px, and longest edge 320 px.
3. Export both as JPEG at quality 0.82 via `canvas.toBlob()`.
4. Store all 4 blobs, replacing any previous ones.

Expect ~200 KB full and ~30 KB thumb per photo — around 20 MB for 40 items with
2 photos each. The user's originals in the gallery are never touched or deleted.

Show a spinner over the slot while processing. A 12 MP photo from an S24 Ultra
takes a moment.

### Photo viewer

Full-screen black, the 1400 px version, pinch to zoom and double-tap to zoom.
Swipe down or tap outside to close. Nothing else — no captions, no chrome, no
share button.

---

## 11. Search and filter

Sticky at the top of the list.

- **Search box** — matches `name`, `code`, `note` and `type`, case-insensitive,
  substring. Filters as you type, no debounce needed at this size. Clear button
  on the right when it has content.
- **3 filter chips** — `All`, `🏦 Bank`, `🏠 Home`, each showing a live count.
  Single selection, `All` is the default.

Search and chips combine (AND).

For case-insensitive matching that works with Armenian, use
`a.toLocaleLowerCase().includes(b.toLocaleLowerCase())` — not `toLowerCase()`.

Empty result state: `No items match "xyz"` with a `Clear search` button.

Reordering is disabled whenever a search or filter is active — the visible order
is not the real order, so a drop would be meaningless. Grey out nothing; just do
not lift on long-press, and show a small toast: `Clear the filter to reorder.`

---

## 12. Delete and Recently deleted

`Delete item` in the sheet asks for confirmation:
`Delete "Yellow bracelet"? It moves to Recently deleted for 30 days.`

On confirm, set `deletedAt` and hide it from the list. Its `code` stays reserved.

Reach Recently deleted by tapping the item count in the `All` chip. It lists
deleted items with `Restore` and `Delete permanently` buttons, and shows days
remaining. On app start, permanently remove anything past 30 days.

Restoring puts the item back at the end of the list with its original code, or a
newly assigned one if that code was taken in the meantime.

---

## 13. Backup and restore

The most important feature in the app. IndexedDB is not permanent storage —
clearing Chrome's browsing data erases everything.

### Export

A `Back up` button in a small overflow menu at the top right.

1. Read every item, including deleted ones.
2. Convert each blob to a base64 string.
3. Build 1 JSON file: `{ schemaVersion, exportedAt, items: [...] }`.
4. Name it `jewelry-backup-2026-09-07.json`.
5. Offer it with `navigator.share({ files: [file] })` so Google Drive appears in
   the Android share sheet. If `navigator.canShare` rejects files, fall back to a
   normal download link.
6. Write `lastBackupAt` to `meta`.

Base64 inflates the file by about a third, so expect ~27 MB. That is fine for Drive.
Show a progress indicator; encoding 80 photos is not instant.

### Reminder

If `lastBackupAt` is more than 30 days old, show a dismissible bar above the list:
`Last backup was 34 days ago. Back up now.` Never a modal, never blocking.

### Restore

`Restore from file` in the same menu. File picker, parse, validate
`schemaVersion`, then confirm with:
`Replace all 40 items with the 38 items in this backup? This cannot be undone.`
On confirm, clear both stores and rebuild from the file.

---

## 14. Storage permanence

On first run, call `navigator.storage.persist()`. This asks Android not to evict
the data when reclaiming disk space. It is a request that can be refused, which is
exactly why §13 exists.

Show current usage in the overflow menu via `navigator.storage.estimate()`:
`Using 19 MB. Last backup 3 days ago.`

---

## 15. PWA setup

### manifest.webmanifest

```json
{
  "name": "Jewelry",
  "short_name": "Jewelry",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#FFFFFF",
  "theme_color": "#FFFFFF",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512",
      "type": "image/png", "purpose": "maskable" }
  ]
}
```

### sw.js

Cache-first for the app shell — the HTML, CSS, JS, manifest and icons. Nothing
else is ever fetched, so there is no network strategy to design.

```js
const CACHE_VERSION = "v1";   // BUMP THIS ON EVERY DEPLOY
```

**This constant is the single biggest trap in the project.** If it is not bumped,
the phone keeps serving the old cached code after a push and it looks as though
the change did nothing. Put a comment saying so directly above it.

On `activate`, delete every cache whose name does not match the current version.

The service worker must never cache or touch IndexedDB. The 2 are unrelated:
the service worker holds the app, IndexedDB holds the data.

---

## 16. Visual design

The brief is "very clean, Apple-like". Follow iOS conventions closely rather than
inventing a look.

### Tokens

```css
--bg:            #FFFFFF;
--bg-grouped:    #F2F2F7;   /* sheet backdrop, search field fill */
--text:          #000000;
--text-secondary:#3C3C4399;  /* note, type, history dates */
--separator:     #3C3C434A;  /* 0.5px hairlines */
--tint:          #007AFF;    /* the only accent — links, focus, active chip */
--destructive:   #FF3B30;
--bank-fill:     #E8EDF5;
--bank-text:     #3A5A8C;
--home-fill:     #E6F4EA;
--home-text:     #2E7D4F;
```

Support dark mode with `prefers-color-scheme` using the standard iOS dark values
(`#000000` background, `#1C1C1E` grouped).

### Type

System stack only — no web fonts, since they would need caching and add weight:

```css
font-family: -apple-system, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif;
```

| Role | Size | Weight |
|---|---|---|
| Name | 16 px | 500 |
| Code | 14 px | 600, tabular numerals |
| Type, note, history | 13 px | 400, `--text-secondary` |
| Section labels in the sheet | 13 px | 400, sentence case |
| Sheet title | 20 px | 600 |

Sentence case everywhere. No all-caps labels.

### Motion

Only in response to a tap: the sheet sliding up (300 ms, `cubic-bezier(.32,.72,0,1)`),
the pill's colour change (150 ms), the row lift and drop. Nothing animates on load.
Respect `prefers-reduced-motion` by cutting durations to 0.

### Touch targets

Minimum 44 × 44 px for the pill, chips, and every control in the sheet.

### Safe areas

Use `env(safe-area-inset-bottom)` so the floating add button and the sheet clear
the Android gesture bar.

---

## 17. Build order

Stop after each step. Each has a check that must pass on the real phone before
moving on.

1. **Static list, hardcoded data.** 8 fake items, all 7 columns, horizontal
   scroll, sticky header and code column.
   *Check: columns 1–4 readable with no scrolling; scrolling right reveals 5–7 with columns still aligned.*

2. **IndexedDB.** `db.js` with get / put / delete / getAll. Replace the fake data.
   *Check: add a row via the console, reload, it is still there.*

3. **Detail sheet.** Open on row tap, all fields editable, commit on blur,
   Android back closes it.
   *Check: edit a name, close, reopen — the change persisted.*

4. **Add and delete.** Floating `+` button, auto-assigned code, delete with
   Recently deleted.
   *Check: add 3 items, get A1 A2 A3; delete A2; add another — it becomes A4, not A2.*

5. **Photos.** Picker, EXIF-correct resize, both sizes, thumbnails in the list,
   full-screen viewer with pinch zoom.
   *Check: a photo taken sideways displays upright; the list still scrolls smoothly with 20 photos loaded.*

6. **Status and history.** Pill toggle, history append, history editing in the sheet.
   *Check: toggle twice, see 2 new dated entries; edit a date, confirm the pill did not change.*

7. **Search and filters.** Search box, 3 chips with live counts, Armenian matching.
   *Check: typing "բրաս" finds the bracelets.*

8. **Backup and restore.** Export to share sheet, import with confirmation, the
   30-day reminder bar.
   *Check: export to Drive, clear the site data in Chrome, reinstall, restore — every photo and every history entry comes back.*

9. **Reorder.** Long-press lift, drag, drop, persist.
   *Check: normal vertical scrolling still works; codes do not change after a drop.*

10. **PWA.** Manifest, icons, service worker, `navigator.storage.persist()`.
    *Check: install to home screen, turn on airplane mode, force-close, reopen — the app loads and all data is present.*

Commit to git after each step, using the step name as the message.

---

## 18. Out of scope

Do not build any of these, even if they seem helpful:

- Accounts, login, PIN, biometrics, encryption
- Cloud sync, server, database, API
- Valuations, weights, prices, currency, insurance fields
- Multi-user, sharing, permissions
- Analytics, crash reporting, telemetry
- Categories or tags beyond the fixed `type` list
- A separate "boxes" entity — photo 2 stays per item
- Landscape or tablet layouts
- Printing or PDF export
- Dark mode toggle — follow the system setting only
