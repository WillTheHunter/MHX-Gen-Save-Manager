// Region-exclusive item/equipment IDs for MHGen (EUR/USA) and MHX (JPN).
//
// Confirmed empirically against 2 real save files the user built specifically
// for this ("Exclusive DLC/mhgen save", "Exclusive DLC/mhx save" + their own
// "Save details.txt" describing exactly what was placed where), read directly
// at the known offsets (character-slot-relative):
//   POUCH_OFFSET = 0x142E, 32 slots, 18-bit packed (11-bit id | 7-bit qty)
//   ITEM_BOX_OFFSET = 0x290, 1400 slots, same 18-bit packing
//   EQUIPMENT_BOX_OFFSET = 0x4667, 1400 slots, 36 bytes each
//     (byte0 = type, bytes1-2 = item id LE, byte3 = level-1, bytes6-11 = 3
//     decoration slots, 2 bytes each)
//   PALICO_EQUIPMENT_OFFSET = 0x10B47, 700 slots, same 36-byte record layout
// (all from APMMHXSaveEditor's Offsets.cs/Constants.cs, cross-checked against
// this project's own MHXX_PORT.js item-box bit-packing, which already used
// the identical 11-bit-id/7-bit-qty scheme).
//
// Equipment "type" byte matches APMMHXSaveEditor's EquipmentTypes array:
//   0 None, 1 Head, 2 Chest, 3 Arms, 4 Waist, 5 Legs, 6 Talisman,
//   7 Great Sword, 8 Sword and Shield, 9 Hammer, 10 Lance, 11 Heavy Bowgun,
//   12 Medium Bowgun?, 13 Light Bowgun, 14 Longsword, 15 Switch Axe,
//   16 Gunlance, 17 Bow, 18 Dual Blades, 19 Hunting Horn, 20 Insect Glaive,
//   21 Charge Blade, 22 Palico Weapon, 23 Palico Helmet, 24 Palico Armor
//
// Item IDs cross-checked two ways: (1) directly read from the reference
// saves at the exact page/slot positions in Save details.txt, matching the
// item names given there; (2) independently, every one of these ids shows as
// "Unknown [id]" in APMMHXSaveEditor's own (English-only) 1933-entry
// GameConstants.ItemList - i.e. the *only* placeholder-named ids in the
// entire 1883-1932 "DLC/collab currency" range, everything else in that
// range (Uniqlo Coin, Ushio Coin, Wind Waker, etc.) has a real English name
// there because GEN also received that particular collab. Equipment ids are
// confirmed only by direct save readout (no equivalent name table exists),
// and cross-checked in count (not per-id name) against the pre-existing
// REGION_INCOMPATIBLE_ITEMS list in main.js, which was hand-curated earlier
// from item/weapon/armor NAMES with no ids - every category's item count
// matches exactly (e.g. MHX's 16 "Fake Tama" armor names = 4 ids x 4 body
// slots found here).

const GEN_EXCLUSIVE_ITEM_NAMES = {
    1929: "Sealing Shield",
    1930: "Option",
    1931: "Celestial Scroll",
    1932: "Arthur's Armor"
};

const MHX_EXCLUSIVE_ITEM_NAMES = {
    1889: "Gude-gude Egg",
    1890: "Soul Stone",
    1907: "Salmon Fillet",
    1908: "Macross Delta Coin"
};

// Individual (type,id) -> exact name mapping isn't fully recoverable from the
// reference saves alone (multiple ids share one collective set name in the
// hand-curated list above) - named collectively by set/collab instead.
const GEN_EXCLUSIVE_EQUIPMENT = [
    { type: 8, id: 102, name: "Falchion (Sword and Shield)" },
    { type: 18, id: 101, name: "Light Sword Cypher (Dual Blades)" },
    ...[1, 2, 3, 4, 5].flatMap(type => [718, 719, 720, 721].map(id => (
        { type, id, name: "Hiryu Sky / Hiryu Land / Lodestar armor" }
    )))
];

const MHX_EXCLUSIVE_EQUIPMENT = [
    { type: 19, id: 88, name: "Gudetama Frying Pan (Hunting Horn)" },
    ...[1, 2, 3, 5].flatMap(type => [678, 679, 680, 681].map(id => (
        { type, id, name: "Fake Tama Tights/Suit (normal and S) armor" }
    )))
];

const GEN_EXCLUSIVE_PALICO_EQUIPMENT = [
    ...[283, 284].map(id => ({ type: 22, id, name: "F Tsumugari / F Arthur's Lance" })),
    ...[284, 285].map(id => ({ type: 23, id, name: "F Okami Hood / F Arthur's Helm" })),
    ...[284, 285].map(id => ({ type: 24, id, name: "F Divine Retribution / F Arthur's Armor" }))
];

const MHX_EXCLUSIVE_PALICO_EQUIPMENT = [
    ...[252, 280, 267, 268].map(id => ({ type: 22, id, name: "Spirits Neko Sword / Fillet Stick / Nyalkyrie Weapon" })),
    ...[248, 281, 266].map(id => ({ type: 23, id, name: "Spirits Neko Helm / Nyalkyrie Head" })),
    ...[248, 281, 266, 265].map(id => ({ type: 24, id, name: "Spirits Neko Armor / Dressed-up Kirimi-chan / Nyalkyrie Suit" }))
];

function exclusiveItemNamesFor(game) {
    return game === 0 ? GEN_EXCLUSIVE_ITEM_NAMES : MHX_EXCLUSIVE_ITEM_NAMES;
}

function exclusiveEquipmentFor(game) {
    return game === 0 ? GEN_EXCLUSIVE_EQUIPMENT : MHX_EXCLUSIVE_EQUIPMENT;
}

function exclusivePalicoEquipmentFor(game) {
    return game === 0 ? GEN_EXCLUSIVE_PALICO_EQUIPMENT : MHX_EXCLUSIVE_PALICO_EQUIPMENT;
}

function findExclusiveEquipment(list, type, id) {
    return list.find(e => e.type === type && e.id === id) || null;
}

// IMPORTANT (supersedes two earlier, WRONG assumptions): there is no
// "currently equipped" special case for exclusive equipment at all, and no
// fixed reserved box index either. Two things proved this:
//   (1) a fixed equipment-box index does NOT reliably indicate "currently
//       equipped" gear - the user's "Export testing" reference saves (a
//       real, heavily-populated character) show exclusive equipped gear
//       sitting at box index 489/490, nowhere near any reserved low index.
//   (2) matching box entries against the hunter's separate EQUIPPED_WEAPON/
//       HEAD/etc struct (APMMHXSaveEditor's Offsets.cs - that tool defines
//       these offsets but never reads/writes them) looked promising (byte-
//       exact type/id matches were found there for the exclusive weapon and
//       armor), but the reference's own "how the tool should do" file proves
//       the correct fix leaves that struct COMPLETELY UNTOUCHED and applies
//       the exact same 2-byte id-only rewrite to the box regardless (0 byte
//       difference confirmed against the reference in both cases). An
//       earlier version of this feature wrongly assumed equipped gear needed
//       a full 36-byte reset to fixed default values (Great Sword/Leather
//       armor) plus a struct sync - that was unnecessary complexity chasing
//       a coincidental byte match, not the source of truth.
// The one, uniform, verified-correct rule: every exclusive equipment or
// Palico-equipment box entry - worn or not, wherever it sits - just gets its
// 2-byte id field rewritten to 1 (see coreSetEquipmentId in SAVE_CORE.js).
// Every equipment type has a valid id=1 "basic" version in the base game, so
// this always produces valid, ownable gear of the same class.
