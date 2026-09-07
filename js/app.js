// Step 1: static list, hardcoded data. No IndexedDB, no interactivity yet
// (that arrives in later build steps — see JEWELRY-PWA-SPEC.md §17).

const TYPES = ["մատանի", "բրասլետ", "կուլոն", "ցեպ", "կոպեկ", "օղեր", "այլ"];

const FAKE_ITEMS = [
  { code: "A1", name: "Yellow gold bracelet", type: TYPES[1], note: "Grandmother's, from the 1980s", status: "bank" },
  { code: "A2", name: "Wedding ring", type: TYPES[0], note: "Engraved inside band", status: "home" },
  { code: "A3", name: "Small pendant with cross", type: TYPES[2], note: "", status: "bank" },
  { code: "A4", name: "Thin chain necklace", type: TYPES[3], note: "Tangles easily, keep in pouch", status: "bank" },
  { code: "A5", name: "Old coin, framed", type: TYPES[4], note: "1915, family heirloom", status: "bank" },
  { code: "A6", name: "Gold hoop earrings", type: TYPES[5], note: "Pair, small size", status: "home" },
  { code: "A7", name: "Signet ring", type: TYPES[0], note: "Slightly bent, needs resizing", status: "bank" },
  { code: "A8", name: "Miscellaneous gold chain fragment", type: TYPES[6], note: "Not sure what this belonged to", status: "bank" },
];

function renderRow(item) {
  const row = document.createElement("div");
  row.className = "row";

  const pillClass = item.status === "bank" ? "pill-bank" : "pill-home";
  const pillIcon = item.status === "bank" ? "🏦" : "🏠";

  row.innerHTML = `
    <div class="cell cell-code">${item.code}</div>
    <div class="cell cell-photo1"><div class="thumb thumb-1">📷</div></div>
    <div class="cell cell-name">${item.name}</div>
    <div class="cell cell-status"><button class="pill ${pillClass}">${pillIcon}</button></div>
    <div class="cell cell-type">${item.type}</div>
    <div class="cell cell-photo2"><div class="thumb thumb-2">📦</div></div>
    <div class="cell cell-note">${item.note}</div>
  `;

  return row;
}

function render() {
  const rowsEl = document.getElementById("rows");
  rowsEl.innerHTML = "";
  FAKE_ITEMS.forEach((item) => rowsEl.appendChild(renderRow(item)));
}

render();
