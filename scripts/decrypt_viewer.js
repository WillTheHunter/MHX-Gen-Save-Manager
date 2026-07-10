// Standalone decryptor for "removed_<region>_exclusive_content.json" files
// exported by the MHGen/MHX Save Manager's "Auto-resolve transfer" feature.
// This is a verbatim copy of the cipher in EXCLUSIVE_SCAN.js
// (slotBlockKeystream/decryptSlotBlock) - kept as its own separate file so
// this little viewer has no dependency on the rest of the app and can be
// opened on its own.
//
// Reminder of what the cipher actually is (see EXCLUSIVE_SCAN.js for the
// full writeup): each block's "data" field is NOT plain base64 of the JSON
// text - it's base64 of that JSON's UTF-8 bytes XORed with a keystream
// derived from the block's own "slotName" via a small FNV-1a-based
// generator. Base64-decoding it on its own (e.g. with a generic online
// tool) only reverses the outer base64 layer and leaves the XORed bytes,
// which is why that looked like garbage - you also need this exact
// keystream step, which no generic tool knows about.
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

// Decrypts every block in a parsed removed-content JSON file. Each block's
// own "slotName" field (stored in cleartext right next to it) IS its
// decryption key - that's by design, since re-importing needs to know
// which key decrypts which block - so nothing needs to be typed in here.
function decryptFile(jsonData)
{
    if (!jsonData || !Array.isArray(jsonData.blocks)){
        throw new Error('This doesn\'t look like a valid removed-items file - no "blocks" array found.');
    }
    return jsonData.blocks.map(block => ({
        slotName: block.slotName,
        count: block.count,
        entries: decryptSlotBlock(block.slotName, block.data)
    }));
}
