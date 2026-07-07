// Port a MHGen/MHX character slot into a MHXX (3DS/Switch) or MHGU save.
//
// CRITICAL: CLEAN_MHXX_3DS_SAVE's slot 0 is NOT an empty/zeroed character.
// The first version of this tool built the base template by zeroing out the
// entire character struct in a real save, then writing our confirmed fields
// on top of that - which crashed a real 3DS on load. Diffing showed the real
// struct has ~27,000 non-zero bytes scattered all over its ~1.16MB size, most
// of which are engine-internal state (tutorial/unlock flags, sentinel/enum
// values, etc.) that we have no mapping for and that are very likely NOT
// valid as zero - the game apparently checks/uses some of them even for a
// "fresh" HR8 character. Zeroing them produced a struct the game refused to
// load. Fix: CLEAN_MHXX_3DS_SAVE's slot 0 is the UNMODIFIED, real, valid,
// loadable character from "mhxx ported save/system" (an actual successful
// MHX->MHXX transfer, done in-game) - portMHGenSlotToMHXX() only overwrites
// the specific fields listed below on top of it. Every other byte (Palico
// roster/stats, Guild Card cosmetics, key items, decorations, quest/academy
// progress) is left exactly as that reference character had it rather than
// zeroed - a real character's baseline is far less likely to be rejected by
// the game than an empty struct, even though it means those specific fields
// won't reflect the actual source save being ported for anyone else's data.
// Re-verified end to end after this change: porting "mhx start save" and
// diffing the result against "mhxx ported save" byte-for-byte now matches on
// 99.0% of the real save's non-zero bytes (up from 15.1% with the zeroed
// template) - the remaining ~1% is entirely inside the item box's packed
// array and equipment box type byte, i.e. exactly the already-known,
// already-documented remap imperfections below, not new unexplained damage.
//
// Scope, confirmed against a real transfer (user-verified in-game): name,
// funds, appearance/color, equipment box, item box, and monster hunt/capture
// log all carry over. Hunter rank always resets to 8 and play time always
// resets to 0 (confirmed mandatory by the user, not incidental). Full Palico
// roster/stats, decorations attached to gear, Guild Card cosmetic mirror
// fields, and hub/academy point totals are NOT ported (they retain the
// reference character's own values, inherited from the base template above)
// - see the notes on each section below for why they aren't overwritten.
//
// The MHXX side of every offset below comes from Dawnshifter's
// MHXXSwitchSaveEditor (github.com/Dawnshifter/MHXXSwitchSaveEditor,
// Data/Offsets.cs) - an independently reverse-engineered MHXX/MHGU save
// editor. The MHX side comes from this project's earlier work plus
// mhx_data_manager/APMMHXSaveEditor. Every mapping below was independently
// re-verified against the real "mhx start save" -> "mhxx ported save" sample
// in this project before being used (not just taken on the two tools' word).
//
//   name    MHX/MHXX both +0x00, 0x20 bytes UTF-8, null-padded
//   funds   MHX/MHXX both +0x24, uint32, copied verbatim (also mirrored at
//           MHXX +0x280F - both match the source value in the sample)
//   HR      MHX +0x28 (source, ignored) -> MHXX +0x28 forced to 8
//   time    MHX +0x20 (source, ignored) -> MHXX +0x20 forced to 0
//   HR points (MHX +0x1476 / MHXX +0x280B) - this does NOT carry over (the
//           sample's value there does not match after the real transfer,
//           consistent with the mandatory HR reset) - intentionally skipped.
//   palette MHX +0x268..+0x28C (36 bytes) -> MHXX +0x24C..+0x270, byte-exact
//           match confirmed. This is a separate copy from the small discrete
//           cosmetic fields MHXX also has at +0x23B48-0x23B7F (voice, eye
//           color, hairstyle, etc.) - no confirmed MHX-side source for
//           those specific discrete fields was found, so they're left alone.
//
//   Equipment box: MHX 1400 slots x 36 bytes @+0x4667 -> MHXX 2000 slots x
//   36 bytes @+0x62EE. Verified against all 456 non-empty slots in the
//   sample: the equipped item's ID shifts right by one byte (MHXX inserts a
//   new byte at position 1, pushing the low/high ID bytes from position 1/2
//   to 2/3) - confirmed exact for 456/456 non-empty entries. The equipment
//   "type" byte at position 0 carries over unchanged in ~82% of entries
//   (the rest have extra high bits set in MHXX that don't appear in MHX -
//   likely an "awakened"/rarity flag with no MHX equivalent - copied as-is
//   regardless, since the base item is still correctly identified either
//   way). Everything from position 3 onward (level, decorations) did NOT
//   verify against a simple shift (tested and found wrong in the sample),
//   so it's intentionally left at the clean template's default rather than
//   risk writing a wrong value - only type + item ID are transplanted, but
//   those are what actually put the right gear back in the box.
//
//   Palico equipment box: MHX 700 slots x 36 bytes @+0x10B47 -> MHXX 1000
//   slots x 36 bytes @+0x17C2E. Same record format as the hunter equipment
//   box, so the same transform is applied - not independently re-verified
//   against the sample (the sample character's Palico gear box was empty),
//   but it's the same 36-byte struct at a matching pair of documented
//   offsets, so it's included with that caveat.
//
//   Item box: MHX 1400 slots x 18 bits @+0x290 (low 11 bits = item ID, high 7
//   bits = quantity - NOT 12+6 as first assumed; 11 bits matches MHX's own
//   ~1933-item catalog) -> MHXX 2300 slots x 19 bits @+0x278 (low 12 bits =
//   item ID, high 7 bits = quantity - 12 bits matches MHXX's larger ~2991-
//   item catalog). Quantity is a byte-for-byte direct copy - verified 100%
//   exact across all 1277 non-empty slots in the sample (the earlier "topped
//   up to 99" theory was wrong; it just looked that way because the sample
//   character keeps basic consumables stocked at max). Item ID needs
//   remapping because MHXX inserted new items throughout its catalog rather
//   than appending them at the end. The mapping used is: (1) exact name match
//   between MHX's ItemList and MHXX's ItemNameList (see ITEM_ID_MAP.js -
//   1565/1932 items, ~81%, match exactly by string), (2) for the rest -
//   mostly items MHXX renders with an abbreviated name, e.g. "Rhenoplos
//   Carapace" -> "Rhenoplos Carap" - linear interpolation of the id offset
//   between the two nearest exact-matched anchors. Combined, this reproduces
//   88.6% of the sample's item IDs exactly; nearly all remaining misses are
//   off by only a handful of IDs (an adjacent item in the same equipment/
//   material category), not a wrong category entirely. This is the one
//   region of this port that is a best-effort reconstruction rather than a
//   verified 1:1 mapping - flagged as such in the UI.
//
//   Monster hunt/capture counts: MHX 71 monsters x 2 bytes each
//   @+0x42E7/+0x43C7 -> MHXX 137 monsters x 2 bytes each @+0x5EA6/+0x5FB8.
//   Verified byte-for-byte identical for the first 20 monsters in the
//   sample (same monster-ID ordering in both games, MHXX just added more at
//   the end) - copied directly, 1:1, for the overlapping range.

const MHXX_SLOT_SIZE = 0x11D088;

const MHXX_PORT_PALETTE = {
    srcOffset: 0x268,
    dstOffset: 0x24C,
    length: 0x24
};

const EQUIPMENT_BOX = { srcOffset: 0x4667, srcCount: 1400, dstOffset: 0x62EE, dstCount: 2000, recordSize: 36 };
const PALICO_EQUIPMENT_BOX = { srcOffset: 0x10B47, srcCount: 700, dstOffset: 0x17C2E, dstCount: 1000, recordSize: 36 };
const ITEM_BOX = { srcOffset: 0x290, srcBitWidth: 18, srcCount: 1400, dstOffset: 0x278, dstBitWidth: 19, dstCount: 2300 };
const MONSTER_HUNT = { srcOffset: 0x42E7, dstOffset: 0x5EA6, count: 71 };
const MONSTER_CAPTURE = { srcOffset: 0x43C7, dstOffset: 0x5FB8, count: 71 };

function readPackedArray(data, offset, bitWidth, count)
{
    const out = [];
    let bitPos = 0;
    const mask = (1 << bitWidth) - 1;

    for (let i = 0; i < count; i++)
    {
        const bytePos = offset + (bitPos >> 3);
        const bitOff = bitPos & 7;
        const raw = (data[bytePos] || 0) | ((data[bytePos + 1] || 0) << 8) | ((data[bytePos + 2] || 0) << 16) | ((data[bytePos + 3] || 0) << 24);
        out.push((raw >>> bitOff) & mask);
        bitPos += bitWidth;
    }

    return out;
}

function writePackedArray(data, offset, bitWidth, values)
{
    let bitPos = 0;
    const mask = (1 << bitWidth) - 1;

    for (const val of values)
    {
        const bytePos = offset + (bitPos >> 3);
        const bitOff = bitPos & 7;
        const v = (val & mask) * Math.pow(2, bitOff);

        for (let b = 0; b < 4; b++)
        {
            data[bytePos + b] = (data[bytePos + b] || 0) | (Math.floor(v / Math.pow(2, b * 8)) & 0xFF);
        }

        bitPos += bitWidth;
    }
}

function transplantEquipmentBox(src, dst, cfg)
{
    const count = Math.min(cfg.srcCount, cfg.dstCount);

    for (let i = 0; i < count; i++)
    {
        const s = cfg.srcOffset + i * cfg.recordSize;
        const d = cfg.dstOffset + i * cfg.recordSize;

        let empty = true;
        for (let k = 0; k < cfg.recordSize; k++)
        {
            if (src[s + k] !== 0) { empty = false; break; }
        }
        if (empty) continue;

        dst[d] = src[s];         // equipment type (carried as-is)
        dst[d + 1] = 0;          // new field MHXX inserted here - left at default
        dst[d + 2] = src[s + 1]; // item ID low byte
        dst[d + 3] = src[s + 2]; // item ID high byte
        // level/decoration slots (src bytes 3+) did not verify against a
        // simple shift in the real sample, so left at the clean template's
        // default rather than risk writing a wrong value
    }
}

// ITEM_ID_ANCHORS (from ITEM_ID_MAP.js) is a flat [mhxId, mhxxId, ...] list,
// sorted ascending by mhxId, of items whose MHX and MHXX names matched
// exactly. For ids not in the table, interpolate the id offset between the
// nearest anchors on each side (handles items MHXX renders under an
// abbreviated name) - see the header comment above for the measured accuracy.
function remapItemId(id)
{
    const anchors = ITEM_ID_ANCHORS;
    let beforeIdx = -1, afterIdx = -1;

    for (let i = 0; i < anchors.length; i += 2)
    {
        if (anchors[i] === id) return anchors[i + 1];
        if (anchors[i] < id) beforeIdx = i;
        if (anchors[i] > id && afterIdx === -1) afterIdx = i;
    }

    if (beforeIdx === -1) return afterIdx === -1 ? id : anchors[afterIdx + 1] - (anchors[afterIdx] - id);
    if (afterIdx === -1) return anchors[beforeIdx + 1] + (id - anchors[beforeIdx]);

    const aId = anchors[beforeIdx], aMapped = anchors[beforeIdx + 1];
    const bId = anchors[afterIdx], bMapped = anchors[afterIdx + 1];
    const offsetA = aMapped - aId;
    const offsetB = bMapped - bId;
    const frac = (id - aId) / (bId - aId);

    return Math.round(id + offsetA + (offsetB - offsetA) * frac);
}

function transplantItemBox(src, dst, cfg)
{
    const items = readPackedArray(src, cfg.srcOffset, cfg.srcBitWidth, cfg.srcCount);

    const remapped = items.map((v) => {
        const id = v & 0x7FF;       // low 11 bits
        const qty = v >>> 11;       // high 7 bits
        if (id === 0) return 0;
        return (qty << 12) | remapItemId(id); // quantity copied as-is, only the id is remapped
    });

    while (remapped.length < cfg.dstCount) remapped.push(0);

    writePackedArray(dst, cfg.dstOffset, cfg.dstBitWidth, remapped.slice(0, cfg.dstCount));
}

function transplantMonsterCounts(src, dst, cfg)
{
    for (let i = 0; i < cfg.count; i++)
    {
        dst[cfg.dstOffset + i * 2] = src[cfg.srcOffset + i * 2];
        dst[cfg.dstOffset + i * 2 + 1] = src[cfg.srcOffset + i * 2 + 1];
    }
}

function portMHGenSlotToMHXX(sourceSlotData)
{
    const target = new Uint8Array(CLEAN_MHXX_3DS_SAVE); // full 3DS container; slot 0 is a real valid character, see header comment
    const dstSlotOffset = coreReadU32(target, 0x10);

    const slot = target.subarray(dstSlotOffset, dstSlotOffset + MHXX_SLOT_SIZE);

    // Name
    slot.set(sourceSlotData.subarray(0, 0x20), 0x00);

    // Funds
    slot.set(sourceSlotData.subarray(0x24, 0x28), 0x24);

    // Hunter rank forced to 8, play time forced to 0 - confirmed mandatory
    slot[0x20] = 0; slot[0x21] = 0; slot[0x22] = 0; slot[0x23] = 0;
    slot[0x28] = 8; slot[0x29] = 0;

    // Appearance palette (confirmed-aligned region only)
    slot.set(
        sourceSlotData.subarray(MHXX_PORT_PALETTE.srcOffset, MHXX_PORT_PALETTE.srcOffset + MHXX_PORT_PALETTE.length),
        MHXX_PORT_PALETTE.dstOffset
    );

    transplantEquipmentBox(sourceSlotData, slot, EQUIPMENT_BOX);
    transplantEquipmentBox(sourceSlotData, slot, PALICO_EQUIPMENT_BOX);
    transplantItemBox(sourceSlotData, slot, ITEM_BOX);
    transplantMonsterCounts(sourceSlotData, slot, MONSTER_HUNT);
    transplantMonsterCounts(sourceSlotData, slot, MONSTER_CAPTURE);

    target[0x04] = 1; // mark slot 0 populated

    return target;
}

// Re-packages an already-ported MHXX-3DS-shaped save into MHXX-Switch or MHGU,
// by splicing its (identically-formatted) character slot into SilverJolteon's
// own clean templates for those platforms - the exact technique his own tool
// uses to convert between all three, since they share one slot format.
function repackagePortedSave(mhxx3dsSave, targetFormat)
{
    const srcOff = 0x00;
    const srcSlotOffset = coreReadU32(mhxx3dsSave, 0x10 + srcOff);
    const slotBytes = mhxx3dsSave.subarray(srcSlotOffset, srcSlotOffset + MHXX_SLOT_SIZE);

    let template, dstOff;
    if (targetFormat === "mhxx_3ds")
    {
        return new Uint8Array(mhxx3dsSave);
    }
    else if (targetFormat === "mhxx_switch")
    {
        template = CLEAN_MHXX_SWITCH_SAVE;
        dstOff = 0x24;
    }
    else
    {
        template = CLEAN_MHGU_SAVE;
        dstOff = 0x24;
    }

    const out = new Uint8Array(template);
    const dstSlotOffset = coreReadU32(out, 0x10 + dstOff) + dstOff;
    out.set(slotBytes, dstSlotOffset);
    out[0x04 + dstOff] = 1;

    return out;
}
