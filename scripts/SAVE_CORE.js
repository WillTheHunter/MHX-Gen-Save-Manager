// Core MHGen/MHX save parsing + region transfer.
//
// Save layout (confirmed against mhx_data_manager/source/character.c and
// quest.c, and verified directly against real save files):
//   0x4..0x6   - 3 bytes, one per character slot: 1 = populated, 0 = empty
//   0xC        - int32, offset of the DLC quest-management section
//                (completely separate from the character slots below)
//   0x10+n*4   - int32, offset of character slot n (n = 0,1,2)
// Each character slot is a fixed SLOT_SIZE (0xEAD6E) blob, identical between
// MHX (JPN) and MHGen (EUR/USA) per mhx_data_manager's copy_character(), which
// copies this exact byte range between any of those games with no
// translation. Immediately after each slot is a per-region "footer" (shout-out
// catchphrases etc.) whose size we derive the same way SilverJolteon's tool
// does (next slot offset - this slot offset - SLOT_SIZE), never hardcoded,
// since it differs slightly between MHX and MHGen.
//
// Within a slot (offsets confirmed by inspecting real saves):
//   +0x00  - hunter name, UTF-8, 0x20 bytes, null-padded
//   +0x20  - play time in seconds, uint32
//   +0x24  - funds (zenny), uint32
//   +0x28  - hunter rank, uint16
// We intentionally do NOT parse the footer (shout-out) contents - that
// sub-format hasn't been reverse-engineered for these games, so it's kept as
// an opaque blob and always carried verbatim.

const MHGEN_SLOT_SIZE = 0xEAD6E;
const MHGEN_THRESHOLD = 3.6 * 1024 * 1024;

function coreReadU32(data, offset)
{
    return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function coreWriteU32(data, offset, value)
{
    data[offset] = value & 0xFF;
    data[offset + 1] = (value >>> 8) & 0xFF;
    data[offset + 2] = (value >>> 16) & 0xFF;
    data[offset + 3] = (value >>> 24) & 0xFF;
}

function coreReadU16(data, offset)
{
    return data[offset] | (data[offset + 1] << 8);
}

class MHGenSlotInfo
{
    constructor(data)
    {
        this.data = new Uint8Array(data);
        this.name = "";
        this.HR = 0;
        this.funds = 0;
        this.time = "";
    }
}

class MHGenSaveFile
{
    constructor(data)
    {
        this.data = data;
        this.game = 0; // 0 = MHGen (EUR/USA), 1 = MHX (JPN)
        this.slots = [0, 0, 0];
        this.slotOffsets = [];
        this.footerSize = 0;
        this.save_slots = [];
        this.footers = [];
    }

    static detectGame(fileSize)
    {
        return fileSize > MHGEN_THRESHOLD ? 0 : 1;
    }

    init()
    {
        this.game = MHGenSaveFile.detectGame(this.data.length);

        this.slots = Array.from(this.data.subarray(0x04, 0x07));

        this.slotOffsets = [
            coreReadU32(this.data, 0x10),
            coreReadU32(this.data, 0x14),
            coreReadU32(this.data, 0x18)
        ];

        this.footerSize = this.slotOffsets[1] - this.slotOffsets[0] - MHGEN_SLOT_SIZE;

        for (let slot = 0; slot < 3; slot++)
        {
            const base = this.slotOffsets[slot];
            this.save_slots[slot] = new MHGenSlotInfo(this.data.subarray(base, base + MHGEN_SLOT_SIZE));
            this.footers[slot] = new Uint8Array(this.data.subarray(base + MHGEN_SLOT_SIZE, base + MHGEN_SLOT_SIZE + this.footerSize));
        }
    }

    readSlots()
    {
        const decoder = new TextDecoder("utf-8");

        for (let slot = 0; slot < 3; slot++)
        {
            if (!this.slots[slot])
            {
                continue;
            }

            const data = this.save_slots[slot].data;

            let name = decoder.decode(data.subarray(0, 0x20));
            name = name.replace(/\0/g, '');
            this.save_slots[slot].name = name;

            this.save_slots[slot].funds = coreReadU32(data, 0x24);
            this.save_slots[slot].HR = coreReadU16(data, 0x28);

            let seconds = coreReadU32(data, 0x20);
            const hours = Math.floor(seconds / 3600);
            seconds -= hours * 3600;
            const minutes = Math.floor(seconds / 60);
            seconds -= minutes * 60;
            this.save_slots[slot].time = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    deleteSlot(slot)
    {
        this.save_slots[slot] = new MHGenSlotInfo(new Uint8Array(MHGEN_SLOT_SIZE));
        this.footers[slot] = new Uint8Array(this.footerSize);
        this.slots[slot] = 0;
    }

    exportSlot(slot)
    {
        const out = new Uint8Array(MHGEN_SLOT_SIZE + this.footerSize);
        out.set(this.save_slots[slot].data, 0);
        out.set(this.footers[slot], MHGEN_SLOT_SIZE);
        return out;
    }

    importSlot(slot, bytes)
    {
        this.save_slots[slot] = new MHGenSlotInfo(bytes.subarray(0, MHGEN_SLOT_SIZE));
        this.footers[slot] = new Uint8Array(bytes.subarray(MHGEN_SLOT_SIZE, MHGEN_SLOT_SIZE + this.footerSize));
        this.slots[slot] = 1;
        this.readSlots();
    }

    // Applies this save's current slots onto a clean template of the current
    // game type, producing an exportable buffer. Used both for a plain
    // "re-save" and as the last step of region conversion (the clean template
    // passed in just needs to be the target region's own clean save).
    buildOutput(cleanTemplate)
    {
        const out = new Uint8Array(cleanTemplate);
        const dstOffsets = [
            coreReadU32(out, 0x10),
            coreReadU32(out, 0x14),
            coreReadU32(out, 0x18)
        ];
        const dstFooterSize = dstOffsets[1] - dstOffsets[0] - MHGEN_SLOT_SIZE;

        for (let slot = 0; slot < 3; slot++)
        {
            out[0x04 + slot] = this.slots[slot];

            if (!this.slots[slot])
            {
                continue;
            }

            out.set(this.save_slots[slot].data, dstOffsets[slot]);

            // Footer sizes can differ between regions; copy what fits and
            // leave the rest as the clean template's defaults.
            const copyLen = Math.min(this.footers[slot].length, dstFooterSize);
            out.set(this.footers[slot].subarray(0, copyLen), dstOffsets[slot] + MHGEN_SLOT_SIZE);
        }

        return out;
    }
}
