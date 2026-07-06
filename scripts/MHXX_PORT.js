// Port a MHGen/MHX character slot into a MHXX (3DS/Switch) or MHGU save.
//
// IMPORTANT, tested and confirmed limitation: this only transplants the
// character's *identity* - hunter name, zenny, and a handful of confirmed
// appearance/color values - plus forces hunter rank to 8 and play time to 0,
// matching what the user confirmed the real in-game MHX->MHXX transfer always
// does. It does NOT carry over equipment, items, or quest/monster history.
//
// I tried to automate that part (a block-matching byte transplant, looking
// for long identical runs between a real "mhx start save" and its real
// "mhxx ported save" counterpart to infer a general field mapping) and
// measured it directly: on the one real sample pair available, it only
// reproduced ~5% of the bytes that were actually non-zero in the real ported
// save, even after several tuning passes (smaller anchors, gap-filling by
// constant delta, etc.) - i.e. it did not recover the character's real
// equipment/items in any reliable way. MHXX's character structure is ~209KB
// bigger than MHX's (0x11D088 vs 0xEAD6E) because of scattered new fields
// throughout the layout, not appended at the end, so there's no shortcut here
// short of a hand-built, verified field map the way a documented save editor
// would have - which isn't achievable with confidence from a single sample.
// Shipping a fake "it copied your gear" result would be worse than being
// upfront that it doesn't, so this stays scoped to what's verified safe.
//
// Confirmed field offsets (from diffing "mhx start save" against
// "mhxx ported save" and "mhxx saved a bit to check things"):
//   name    MHX/MHXX both +0x00, 0x20 bytes UTF-8, null-padded
//   funds   MHX/MHXX both +0x24, uint32, copied verbatim
//   HR      MHX +0x28 (source, ignored) -> MHXX +0x28 forced to 8
//   time    MHX +0x20 (source, ignored) -> MHXX +0x20 forced to 0
//   palette MHX +0x268..+0x28C (36 bytes, 9 RGBA-ish color entries) matches
//           MHXX +0x24C..+0x270 byte-for-byte in the sample - copied verbatim.
//           Right after this point the two layouts drift out of alignment
//           (a couple of bytes get inserted), so the copy stops here rather
//           than risk corrupting whatever comes next.

const MHXX_SLOT_SIZE = 0x11D088;

const MHXX_PORT_PALETTE = {
    srcOffset: 0x268,
    dstOffset: 0x24C,
    length: 0x24
};

function portMHGenSlotToMHXX(sourceSlotData)
{
    const target = new Uint8Array(CLEAN_MHXX_3DS_SAVE); // full clean 3DS container, slot 0 already zeroed
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
