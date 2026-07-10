// Detect, remove, and re-import region-exclusive item/equipment/Palico-gear
// content from a character slot's pouch/item box/equipment box/Palico
// equipment box. See EXCLUSIVE_CONTENT.js for the id tables and how they
// were derived, and SAVE_CORE.js for the underlying slot read/write helpers.
//
// Equipment entries are NEVER cleared to empty (unlike items) and NEVER need
// any "is this the currently-equipped one" distinction - see the note above
// removeExclusiveContent for how this was confirmed (a real, before/after
// reference fix that landed on the exact same 2-byte id change for every
// exclusive equipment entry, worn or not).
function scanSlotExclusiveContent(slotData, game)
{
    const itemNames = exclusiveItemNamesFor(game);
    const equipList = exclusiveEquipmentFor(game);
    const palicoEquipList = exclusivePalicoEquipmentFor(game);
    const found = [];

    for (let i = 0; i < POUCH_COUNT; i++){
        const { id, qty } = coreReadItemSlot(slotData, POUCH_OFFSET, i);
        if (id !== 0 && itemNames[id]) found.push({ category: "pouch", index: i, id, qty, name: itemNames[id] });
    }
    for (let i = 0; i < ITEM_BOX_COUNT; i++){
        const { id, qty } = coreReadItemSlot(slotData, ITEM_BOX_OFFSET, i);
        if (id !== 0 && itemNames[id]) found.push({ category: "itemBox", index: i, id, qty, name: itemNames[id] });
    }
    for (let i = 0; i < EQUIPMENT_BOX_COUNT; i++){
        const eq = coreReadEquipmentSlot(slotData, EQUIPMENT_BOX_OFFSET, i);
        if (eq.type === 0) continue;
        const match = findExclusiveEquipment(equipList, eq.type, eq.id);
        if (match) found.push({ category: "equipmentBox", index: i, type: eq.type, id: eq.id, level: eq.level, bytes: eq.bytes, name: match.name });
    }
    for (let i = 0; i < PALICO_EQUIPMENT_COUNT; i++){
        const eq = coreReadEquipmentSlot(slotData, PALICO_EQUIPMENT_OFFSET, i);
        if (eq.type === 0) continue;
        const match = findExclusiveEquipment(palicoEquipList, eq.type, eq.id);
        if (match) found.push({ category: "palicoEquipmentBox", index: i, type: eq.type, id: eq.id, level: eq.level, bytes: eq.bytes, name: match.name });
    }

    return found;
}

// Scans every POPULATED character slot in the currently loaded save for
// content exclusive to the save's OWN region - i.e. exactly what would show
// broken/missing after transferring this save to the other region.
function scanExclusiveContent(save)
{
    const results = [];
    for (let slot = 0; slot < 3; slot++){
        if (!save.slots[slot]) continue;
        const entries = scanSlotExclusiveContent(save.save_slots[slot].data, save.game);
        if (entries.length) results.push({ slot, name: save.save_slots[slot].name, entries });
    }
    return results;
}

// Lightweight, deterministic, reversible obfuscation for the exported
// removed-content JSON's actual item/equipment list - NOT real cryptographic
// security (this is a client-side tool; the cipher is sitting right here in
// plain sight for anyone who looks), just enough friction that the file
// can't be casually hand-edited (e.g. bumping a quantity, or re-adding an
// entry that was supposed to be gone) before re-importing it. The key is
// the character slot's own hunter name, embedded in cleartext right next to
// its block (it has to be, since importRemovedContent needs to know which
// key decrypts which block) - so this is obscurity against casual editing,
// not protection against a determined user reading this file.
function slotBlockKeystream(key, length)
{
    const keyBytes = new TextEncoder().encode(key || "");
    const out = new Uint8Array(length);
    let h = 0x811c9dc5; // FNV-1a offset basis
    for (let i = 0; i < length; i++){
        const kb = keyBytes.length ? keyBytes[i % keyBytes.length] : 0;
        h ^= (kb + i);
        h = Math.imul(h, 0x01000193) >>> 0; // FNV prime mix
        out[i] = h & 0xFF;
    }
    return out;
}

function encryptSlotBlock(key, entries)
{
    const bytes = new TextEncoder().encode(JSON.stringify(entries));
    const keystream = slotBlockKeystream(key, bytes.length);
    const cipher = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) cipher[i] = bytes[i] ^ keystream[i];
    let binary = "";
    cipher.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
}

function decryptSlotBlock(key, base64Data)
{
    const binary = atob(base64Data);
    const cipher = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) cipher[i] = binary.charCodeAt(i);
    const keystream = slotBlockKeystream(key, cipher.length);
    const bytes = new Uint8Array(cipher.length);
    for (let i = 0; i < cipher.length; i++) bytes[i] = cipher[i] ^ keystream[i];
    return JSON.parse(new TextDecoder().decode(bytes));
}

// Clears/fixes every detected entry from the save (in place) and returns a
// JSON-able record of exactly what was removed, so it can be restored later
// (see importRemovedContent) - each equipment entry keeps its full 36 raw
// bytes so decorations etc. survive a round trip losslessly. The removed
// list itself is grouped by slot and encrypted per-slot (see
// encryptSlotBlock above) - one block per slot name, keyed by that slot's
// own name.
//
// Items (pouch/item box) are simply zeroed out - confirmed correct against
// a real inventoried save (exclusive item ids cleanly disappear, id=0/qty=0,
// nothing else in the item box affected).
//
// Equipment is different: a hunter/Palico can't have literally nothing in an
// equipment-box slot the way an item slot can be empty. The fix is just a
// 2-byte id rewrite to 1 (every equipment type has a valid id=1 "basic"
// version in the base game, so this always produces valid, ownable gear of
// the same class) - type/level/decorations are left exactly as they were.
// This is confirmed to apply UNIFORMLY, with no "is this currently equipped"
// special case at all: the user's "Export testing" reference saves include
// an exclusive weapon AND an exclusive armor piece that (per a separate,
// now-disproven earlier theory) looked like they might be the hunter's
// actually-worn gear, matching byte-for-byte against the separate
// EQUIPPED_WEAPON/HEAD/etc struct documented in SAVE_CORE.js - but the
// reference's own "how the tool should do" file proves the correct fix
// leaves that struct completely untouched and applies the exact same
// 2-byte id-only rewrite there too (verified zero byte difference against
// the reference). An earlier version of this feature wrongly assumed
// equipped gear needed a full reset to fixed default values plus a struct
// sync - that turned out to be unnecessary complexity, not the source of
// truth.
function removeExclusiveContent(save)
{
    const scanResults = scanExclusiveContent(save);
    const removedBySlot = new Map();
    let totalRemoved = 0;

    scanResults.forEach(({ slot, name: slotName, entries }) => {
        const slotData = save.save_slots[slot].data;
        const removed = [];
        entries.forEach(e => {
            if (e.category === "pouch") coreWriteItemSlot(slotData, POUCH_OFFSET, e.index, 0, 0);
            else if (e.category === "itemBox") coreWriteItemSlot(slotData, ITEM_BOX_OFFSET, e.index, 0, 0);
            else if (e.category === "equipmentBox") coreSetEquipmentId(slotData, EQUIPMENT_BOX_OFFSET, e.index, 1);
            else if (e.category === "palicoEquipmentBox") coreSetEquipmentId(slotData, PALICO_EQUIPMENT_OFFSET, e.index, 1);
            removed.push(e);
        });
        if (removed.length){
            // Two populated slots sharing a hunter name merge into one block
            // - they'd share the same decryption key anyway, and re-import
            // always targets a user-chosen slot regardless of origin, so
            // nothing is lost by combining them.
            const existing = removedBySlot.get(slotName) || [];
            removedBySlot.set(slotName, existing.concat(removed));
            totalRemoved += removed.length;
        }
    });

    const blocks = [...removedBySlot.entries()].map(([slotName, entries]) => ({
        slotName,
        count: entries.length,
        data: encryptSlotBlock(slotName, entries)
    }));

    return {
        _comment: "blocks encrypted to avoid cheating",
        sourceRegion: save.game === 0 ? "GEN" : "MHX",
        exportedAt: new Date().toISOString(),
        totalRemoved,
        blocks
    };
}

// Restores previously-removed entries from a JSON record (see
// removeExclusiveContent) into destSlot of the CURRENTLY loaded save - always
// into the next empty slot of the appropriate box, never the original slot
// (which may not even exist in this save). Pouch- and item-box-origin
// entries both land in the item box; equipment/Palico-equipment entries land
// in their own respective box. Throws if the file's region doesn't match the
// currently loaded save's region (importing GEN-exclusive content into an
// MHX save, or vice versa, is never valid - those ids don't exist there).
function importRemovedContent(save, destSlot, jsonData)
{
    const expectedRegion = save.game === 0 ? "GEN" : "MHX";
    if (!jsonData || !Array.isArray(jsonData.blocks)){
        throw new Error("This doesn't look like a valid removed-items file.");
    }
    if (jsonData.sourceRegion !== expectedRegion){
        throw new Error(`This file contains ${jsonData.sourceRegion}-exclusive content, but the currently loaded save is ${expectedRegion === "GEN" ? "MHGen" : "MHX"} - ${jsonData.sourceRegion}-exclusive items/equipment can't exist in a ${expectedRegion === "GEN" ? "MHGen" : "MHX"} save, so importing them here isn't possible.`);
    }

    let removed;
    try {
        removed = jsonData.blocks.flatMap(block => decryptSlotBlock(block.slotName, block.data));
    } catch (err){
        throw new Error("Couldn't read this file's contents - it looks corrupted or was hand-edited.");
    }

    const slotData = save.save_slots[destSlot].data;

    function nextEmptyItemSlot(){
        for (let i = 0; i < ITEM_BOX_COUNT; i++) if (coreReadItemSlot(slotData, ITEM_BOX_OFFSET, i).id === 0) return i;
        return -1;
    }
    function nextEmptyEquipmentSlot(offset, count){
        for (let i = 0; i < count; i++) if (coreReadEquipmentSlot(slotData, offset, i).type === 0) return i;
        return -1;
    }

    const summary = { imported: [], skippedFull: [] };

    removed.forEach(entry => {
        if (entry.category === "pouch" || entry.category === "itemBox"){
            const idx = nextEmptyItemSlot();
            if (idx === -1){ summary.skippedFull.push(entry); return; }
            coreWriteItemSlot(slotData, ITEM_BOX_OFFSET, idx, entry.id, entry.qty);
            summary.imported.push(Object.assign({ destCategory: "itemBox", destIndex: idx }, entry));
        } else if (entry.category === "equipmentBox"){
            const idx = nextEmptyEquipmentSlot(EQUIPMENT_BOX_OFFSET, EQUIPMENT_BOX_COUNT);
            if (idx === -1){ summary.skippedFull.push(entry); return; }
            coreWriteEquipmentSlotBytes(slotData, EQUIPMENT_BOX_OFFSET, idx, entry.bytes);
            summary.imported.push(Object.assign({ destCategory: "equipmentBox", destIndex: idx }, entry));
        } else if (entry.category === "palicoEquipmentBox"){
            const idx = nextEmptyEquipmentSlot(PALICO_EQUIPMENT_OFFSET, PALICO_EQUIPMENT_COUNT);
            if (idx === -1){ summary.skippedFull.push(entry); return; }
            coreWriteEquipmentSlotBytes(slotData, PALICO_EQUIPMENT_OFFSET, idx, entry.bytes);
            summary.imported.push(Object.assign({ destCategory: "palicoEquipmentBox", destIndex: idx }, entry));
        }
    });

    return summary;
}
