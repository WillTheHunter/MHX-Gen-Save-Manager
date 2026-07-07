var VERSION = "v1.0.0";

var save = null;

var saveByteArray = (function (){
	var a = document.createElement("a");
	document.body.appendChild(a);
	a.style = "display: none";
	return function (data, name){
	   var blob = new Blob(data, {type: "application/octet-stream"}),
		  url = window.URL.createObjectURL(blob);
	   a.href = url;
	   a.download = name;
	   a.click();
	   window.URL.revokeObjectURL(url);
	};
}());

function gameName(game){
	return game === 1 ? "MHX (JPN)" : "MHGen (EUR/USA)";
}

function cleanTemplateFor(game){
	return game === 1 ? CLEAN_MHX_SAVE : CLEAN_MHGEN_SAVE;
}

var PORT_FORMAT_NAMES = {mhxx_3ds: "MHXX 3DS (JP)", mhxx_switch: "MHXX Switch (JP)", mhgu: "MHGU Switch (EN)"};

function displayInfo(save){
	var DL = document.getElementById("DL");
	var text = `<select class="dropdown" id="dropdown">`;
	text += `<option value=0 ${save.game === 0 ? "selected" : ""}>MHGen (EUR/USA)</option>`;
	text += `<option value=1 ${save.game === 1 ? "selected" : ""}>MHX (JPN)</option>`;
	text += `</select><span class="menu"><button onclick="exportSave()">Export save</button></span>`;

	// Port-to-MHXX/MHGU UI disabled for now - the port can still produce a save
	// that crashes real hardware in cases we haven't verified, and we don't
	// want people breaking their saves with it. portSlot()/portMHGenSlotToMHXX()/
	// repackagePortedSave() are untouched - uncomment this block + the
	// "Port to XX/GU" button in the slot-actions row below to turn it back on.
	// text += `<span class="menu" style="margin-left: 40px;">`;
	// text += `<select class="dropdown" id="port_format_dropdown">`;
	// for (var fmt in PORT_FORMAT_NAMES) text += `<option value="${fmt}">${PORT_FORMAT_NAMES[fmt]}</option>`;
	// text += `</select></span>`;

	text += `<span class="menu" style="margin-left: 40px;"><button onclick="openCompatWindow()">Check region-transfer compatibility</button></span>`;
	DL.innerHTML = text;

	var table = document.getElementById("saveTable");
	text = "";

	save.save_slots.forEach((slot, index) => {
		text += `<div class="save-table ${slot.name ? 'save-slot' : 'empty-slot'} list__item is-idle js-item">`;
		if (slot.name){
			text += `<table><tr>
				<td class="slot-name">${slot.name}</td>
				<td class="slot-hr" colspan=2><span class="slot-title">HR</span><span class="slot-text">${slot.HR}</span></td>
			</tr><tr>
				<td class="slot-funds"><span class="slot-title">Funds</span><span class="slot-text">${slot.funds}z</span></td>
				<td colspan=2 class="slot-time"><span class="slot-title">Play Time</span><span class="slot-text">${slot.time}</span></td>
			</tr></table>
			<div class="slot-actions">
			<button onclick="deleteSlot(${index})">Delete</button>
			<button onclick="exportSlot(${index})">Export</button>
			<button onclick="importSlot(${index})">Import</button>
			<!-- Port to XX/GU disabled for now - see comment above port_format_dropdown -->
			<!-- <button onclick="portSlot(${index})" style="margin-left: 20px;">Port to XX/GU</button> -->
			<button onclick="openReclaimWindow(${index})">Reclaim item packs</button>
			</div>`;
		}
		else{
			text += `(No Data)<div class="import"><button onclick="importSlot(${index})">Import</button></div>`;
		}
		text += `<div class="overlay"></div></div>`;
	});

	table.innerHTML = text;
	drag_setup();
}

function newSave(){
	save = new MHGenSaveFile(new Uint8Array(CLEAN_MHGEN_SAVE));
	save.init();
	save.readSlots();
	displayInfo(save);
}

function readSave(event){
	save = null;
	document.getElementById("DL").innerHTML = "";
	document.getElementById("saveTable").innerHTML = "";

	var file = event.target.files[0];
	var reader = new FileReader();

	reader.onload = function(e){
		var data = new Uint8Array(e.target.result);
		if (data.length !== CLEAN_MHGEN_SAVE.length && data.length !== CLEAN_MHX_SAVE.length){
			alert(`Unrecognized save file size (${data.length} bytes). Expected a MHGen or MHX "system" save file.`);
			newSave();
			return;
		}
		save = new MHGenSaveFile(data);
		save.init();
		save.readSlots();
		displayInfo(save);
	};

	reader.readAsArrayBuffer(file);
}

function loadSave(){
	document.getElementById("loadSave").click();
}

function deleteSlot(slot){
	save.deleteSlot(slot);
	displayInfo(save);
}

function exportSlot(slot){
	var bytes = save.exportSlot(slot);
	saveByteArray([bytes], `${save.save_slots[slot].name}.saveslot`);
}

function importSlot(slot){
	var input = document.createElement('input');
	input.type = 'file';
	input.accept = ".saveslot";
	input.onchange = event => {
		var file = event.target.files[0];
		if (!file) return;

		var reader = new FileReader();
		reader.onload = e => {
			var bytes = new Uint8Array(e.target.result);
			var expectedLen = MHGEN_SLOT_SIZE + save.footerSize;
			if (bytes.length !== expectedLen){
				alert(`Invalid save slot file (got ${bytes.length} bytes, expected ${expectedLen}).`);
				return;
			}
			save.importSlot(slot, bytes);
			displayInfo(save);
		};
		reader.readAsArrayBuffer(file);
	};
	input.click();
}

// A real 3DS keeps "system" and "system_backup" byte-identical and crashes on
// load if they mismatch (emulators like Citra don't enforce this, which is why
// this only shows up on real hardware) - always write both, identical.
function exportSave(){
	var targetGame = parseInt(document.getElementById("dropdown").value);
	var out = save.buildOutput(cleanTemplateFor(targetGame));
	saveByteArray([out], "system");
	saveByteArray([out], "system_backup");
}

// Persistent per-game DLC selection state, so switching saves/regions doesn't
// forget what the user picked. Defaults to "everything selected, native
// version" (the old all-or-nothing behavior), since that's the least
// surprising starting point.
var dlcSelection = {};

function questsForGame(game){
	return game === 0 ? GEN_DLC_QUESTS : MHX_DLC_QUESTS;
}

function palicoesForGame(game){
	return game === 0 ? GEN_DLC_PALICOES : MHX_DLC_PALICOES;
}

function itemPacksForGame(game){
	return game === 0 ? GEN_DLC_ITEM_PACKS : MHX_DLC_ITEM_PACKS;
}

function otherGameLabel(game){
	return game === 0 ? "MHX" : "GEN";
}

function getDLCSelection(game){
	if (!dlcSelection[game]){
		dlcSelection[game] = {
			quests: new Set(questsForGame(game).map(q => q.id)),
			questVersion: new Set(), // ids using the OTHER game's version
			itemPacks: new Set(itemPacksForGame(game).map((p, i) => i)),
			itemPackVersion: new Set(), // indices using the OTHER game's pack in this slot
			palicoes: new Set(palicoesForGame(game).map((p, i) => i)),
			palicoVersion: new Set() // indices using the OTHER game's version
		};
	}
	return dlcSelection[game];
}

// Renders a list of {key, checked, label, pairLabel, useOther} into a fixed-
// column HTML table (SilverJolteon's manageCats() layout) so the popup
// scrolls straight down inside the fixed-width popup window instead of
// spilling sideways. Each entry gets an on/off "install this" checkbox above,
// and - only where a confirmed GEN/MHX pairing exists - a colored toggle
// button below it (blue = GEN, green = MHX) showing which version's bytes
// will be written; clicking it flips both the color and the version used.
function escapeHtml(s){
	var div = document.createElement("div");
	div.textContent = s;
	return div.innerHTML;
}

function renderGridTable(items, cols, checkboxClass, versionClass, game){
	var rows = Math.ceil(items.length / cols);
	var html = "<table>";
	for (var r = 0; r < rows; r++){
		html += "<tr>";
		for (var c = 0; c < cols; c++){
			var idx = r * cols + c;
			html += `<td style="border: 1px solid grey; text-align: left; padding: 3px 6px;">`;
			if (idx < items.length){
				var item = items[idx];
				html += `<input type="checkbox" class="${checkboxClass}" data-key="${item.key}" ${item.checked ? "checked" : ""}>
					<label><span class="item-name-label">${escapeHtml(item.label)}</span></label>`;
				if (item.pairLabel){
					html += `</br>` + versionToggleHtml(versionClass, item.key, game, item.useOther, item.label, item.pairLabel);
				}
			}
			html += `</td>`;
		}
		html += "</tr>";
	}
	html += "</table>";
	return html;
}

function versionToggleHtml(versionClass, key, game, useOther, nativeLabel, otherLabel){
	var shownGame = useOther ? (game === 0 ? 1 : 0) : game;
	var colorClass = shownGame === 0 ? "toggle-color-gen" : "toggle-color-mhx";
	var buttonText = shownGame === 0 ? "GEN" : "MHX";
	return `<button class="${versionClass} version-toggle ${colorClass}" data-key="${key}"
		data-state="${useOther ? 1 : 0}" data-native-label="${escapeHtml(nativeLabel)}" data-other-label="${escapeHtml(otherLabel)}"
		>${buttonText}</button>`;
}

// Flips both the toggle button's color/text AND the entry's visible name (so
// e.g. clicking Caligold's toggle shows its Japanese name, and Advanced
// Pack 2's toggle shows whichever pack sits in that slot on the other side).
function flipVersionButton(btn, game){
	var useOther = btn.dataset.state === "1" ? false : true;
	btn.dataset.state = useOther ? "1" : "0";
	var shownGame = useOther ? (game === 0 ? 1 : 0) : game;
	btn.classList.remove("toggle-color-gen", "toggle-color-mhx");
	btn.classList.add(shownGame === 0 ? "toggle-color-gen" : "toggle-color-mhx");
	btn.textContent = shownGame === 0 ? "GEN" : "MHX";

	var nameLabel = btn.closest("td").querySelector(".item-name-label");
	if (nameLabel){
		nameLabel.textContent = useOther ? btn.dataset.otherLabel : btn.dataset.nativeLabel;
	}
}

function sectionControlsHtml(prefix){
	return `<span style="margin-left: 10px;">
		<button id="${prefix}_toggle" style="height:22px;">Toggle GEN/X</button>
		<button id="${prefix}_none" style="height:22px;">Uncheck All</button>
		<button id="${prefix}_default" style="height:22px;">Set to Default</button>
	</span>`;
}

// Wires the 3 standard per-section buttons: bulk-flip every version toggle in
// the section, uncheck every "install" checkbox, or reset both back to
// defaults (everything installed, native version).
function wireSectionControls(popup, prefix, checkboxClass, versionClass, game, defaultKeys){
	document.getElementById(`${prefix}_toggle`).addEventListener("click", () => {
		popup.querySelectorAll(`.${versionClass}`).forEach(btn => flipVersionButton(btn, game));
	});
	document.getElementById(`${prefix}_none`).addEventListener("click", () => {
		popup.querySelectorAll(`.${checkboxClass}`).forEach(cb => cb.checked = false);
	});
	document.getElementById(`${prefix}_default`).addEventListener("click", () => {
		popup.querySelectorAll(`.${checkboxClass}`).forEach(cb => cb.checked = true);
		popup.querySelectorAll(`.${versionClass}`).forEach(btn => {
			if (btn.dataset.state !== "0") flipVersionButton(btn, game);
		});
	});
}

function openDLCWindow(){
	if (!save){
		alert("Load or create a save first.");
		return;
	}

	var game = save.game;
	var sel = getDLCSelection(game);
	var quests = questsForGame(game);
	var palicoes = palicoesForGame(game);
	var itemPacks = itemPacksForGame(game);
	var other = otherGameLabel(game);

	var challengeQuests = quests.filter(q => q.listIndex < 20);
	var eventQuests = quests.filter(q => q.listIndex >= 20);

	var itemPackItems = itemPacks.map((p, i) => ({
		key: i, checked: sel.itemPacks.has(i), label: p.displayName,
		pairLabel: p.pairDisplayName, useOther: sel.itemPackVersion.has(i)
	}));

	var palicoItems = palicoes.map((p, i) => ({
		key: i, checked: sel.palicoes.has(i), label: p.displayName,
		pairLabel: p.pairDisplayName, useOther: sel.palicoVersion.has(i)
	}));

	function questItem(q){
		return {
			key: q.id, checked: sel.quests.has(q.id), label: q.displayName,
			pairLabel: q.pairDisplayName, useOther: sel.questVersion.has(q.id)
		};
	}

	var popup = document.getElementById("popup");
	popup.innerHTML = `<div class="cat-window">
		<b>Inject DLC</b></br>
		<span style="font-size: 11px; color: grey;">Tick the box above each entry to install it; anything already installed is left alone either way. Where a colored GEN/MHX button is shown, it's a confirmed match (same quest ID, or same collab Palico by brand, or the pack in the same slot) - click it to switch which game's bytes get written; blue = GEN, green = MHX.</span></br></br>

		<b>Item Packs (${itemPacks.length})</b>
		${sectionControlsHtml("pack")}</br>
		<span style="font-size: 11px; color: grey;">
			GEN and MHX have entirely separate item pack campaigns (different real-world promotions) - the version toggle here just swaps in whichever pack sits in this same slot in the other game, not the "same" pack.
		</span></br>
		${renderGridTable(itemPackItems, 2, "dlc-pack", "dlc-pack-ver", game)}</br>

		<b>Palicoes (${palicoes.length})</b>
		${sectionControlsHtml("palico")}</br>
		<span style="font-size: 11px; color: grey;">Palicoes with no GEN release at all (Sanrio, Macross Delta, and other JP-only collabs) are included at the end of the list, injectable into a GEN save too - they'll only ever be in Japanese, since no English text for them exists.</span></br>
		${renderGridTable(palicoItems, 4, "dlc-palico", "dlc-palico-ver", game)}</br>

		<b>Challenge/Arena Quests (${challengeQuests.length})</b>
		${sectionControlsHtml("cquest")}</br>
		${renderGridTable(challengeQuests.map(questItem), 3, "dlc-cquest", "dlc-cquest-ver", game)}</br>

		<b>Event Quests (${eventQuests.length})</b>
		${sectionControlsHtml("equest")}</br>
		${renderGridTable(eventQuests.map(questItem), 3, "dlc-equest", "dlc-equest-ver", game)}</br>

		<button id="run_dlc">Inject Selected</button>
	</div>`;

	// Assignment (not addEventListener) - #popup persists across re-renders of
	// its innerHTML, so addEventListener would keep piling up a new delegated
	// handler every time this window is reopened, causing clicks to fire N
	// times and silently cancel themselves out (even numbers of flips = no
	// visible change). Assigning onclick always replaces the previous one.
	popup.onclick = (e) => {
		if (e.target.classList.contains("version-toggle")) flipVersionButton(e.target, game);
	};

	wireSectionControls(popup, "pack", "dlc-pack", "dlc-pack-ver", game);
	wireSectionControls(popup, "palico", "dlc-palico", "dlc-palico-ver", game);
	wireSectionControls(popup, "cquest", "dlc-cquest", "dlc-cquest-ver", game);
	wireSectionControls(popup, "equest", "dlc-equest", "dlc-equest-ver", game);

	document.getElementById("run_dlc").addEventListener("click", runDLCInject);

	document.getElementById("popup-window-overlay").style.display = "block";
	document.getElementById("popup-window").style.display = "block";
}

function runDLCInject(){
	var game = save.game;
	var sel = getDLCSelection(game);
	var popup = document.getElementById("popup");

	var quests = questsForGame(game);
	var otherQuests = questsForGame(game === 0 ? 1 : 0);
	var palicoes = palicoesForGame(game);
	var itemPacks = itemPacksForGame(game);

	function checkedKeys(selector){
		var set = new Set();
		popup.querySelectorAll(selector).forEach(cb => set.add(parseInt(cb.dataset.key)));
		return set;
	}
	function versionKeys(selector){
		var set = new Set();
		popup.querySelectorAll(selector).forEach(btn => { if (btn.dataset.state === "1") set.add(parseInt(btn.dataset.key)); });
		return set;
	}

	sel.itemPacks = checkedKeys(".dlc-pack");
	sel.itemPackVersion = versionKeys(".dlc-pack-ver");

	sel.palicoes = checkedKeys(".dlc-palico");
	sel.palicoVersion = versionKeys(".dlc-palico-ver");

	sel.quests = new Set([...checkedKeys(".dlc-cquest"), ...checkedKeys(".dlc-equest")]);
	sel.questVersion = new Set([...versionKeys(".dlc-cquest-ver"), ...versionKeys(".dlc-equest-ver")]);

	var large = game === 0;

	var otherQuestById = new Map(otherQuests.map(q => [q.id, q]));
	var questsToInject = quests
		.filter(q => sel.quests.has(q.id))
		.map(q => {
			if (sel.questVersion.has(q.id) && otherQuestById.has(q.id)){
				var other = otherQuestById.get(q.id);
				return [q.listIndex, q.id, other.size, other.data];
			}
			return [q.listIndex, q.id, q.size, q.data];
		});
	var questResult = injectQuests(save.data, questsToInject, large);

	var secondaryLog = game === 0 ? GEN_DLC_SECONDARY_LOG : MHX_DLC_SECONDARY_LOG;
	var flag = game === 0 ? GEN_DLC_FLAG : MHX_DLC_FLAG;

	var bonusPatches = [];
	var anyPalico = false;
	palicoes.forEach((p, i) => {
		if (sel.palicoes.has(i)){
			var patches = (sel.palicoVersion.has(i) && p.pairPatches) ? p.pairPatches : p.patches;
			bonusPatches.push(...patches);
			anyPalico = true;
		}
	});
	if (anyPalico) bonusPatches.push(...secondaryLog);

	var anyPack = false;
	itemPacks.forEach((p, i) => {
		if (sel.itemPacks.has(i)){
			var patches = (sel.itemPackVersion.has(i) && p.pairPatches) ? p.pairPatches : p.patches;
			bonusPatches.push(...patches);
			anyPack = true;
		}
	});
	if (anyPack) bonusPatches.push(flag);

	var bonusApplied = applyBonusPatches(save.data, bonusPatches);

	save.init();
	save.readSlots();
	displayInfo(save);
	closeWindow();

	alert(`DLC injected.\n\nQuests installed: ${questResult.installed}\nQuests already owned: ${questResult.alreadyOwned}\nBonus content bytes applied: ${bonusApplied}`);
}

// Carries over: name, funds, appearance/color, equipment box, palico
// equipment box, item box (best-effort item ID remap, see MHXX_PORT.js), and
// monster hunt/capture log. Hunter rank always resets to 8 and play time
// always resets to 0 (confirmed mandatory, matching a real transfer). Uses
// whichever format is picked in the top-bar "port_format_dropdown", same
// pattern as the region dropdown + Export save - no separate popup/dialog
// needed.
function portSlot(slot){
	var targetFormat = document.getElementById("port_format_dropdown").value;

	var mhxx3ds = portMHGenSlotToMHXX(save.save_slots[slot].data);
	var out = repackagePortedSave(mhxx3ds, targetFormat);

	saveByteArray([out], "system");
	// MHXX-3DS is real 3DS hardware, which keeps "system"/"system_backup"
	// byte-identical and crashes on load if they mismatch (see exportSave) -
	// MHXX-Switch/MHGU don't use this file pairing, so only write it here.
	if (targetFormat === "mhxx_3ds") saveByteArray([out], "system_backup");

	alert(`Ported "${save.save_slots[slot].name}" to ${PORT_FORMAT_NAMES[targetFormat]}.\n\n` +
		`Carried over: name, funds, appearance/color, equipment box, palico equipment box, item box, and monster hunt/capture log.\n` +
		`Hunter rank is reset to 8 and play time is reset to 0 (this always happens on a real transfer too).\n` +
		`Item box IDs use a best-effort remap (~89% exact match against a real sample) since MHXX reorganized its item catalog - double check your item box after porting.\n` +
		`Decorations, key items, full Palico roster/stats, and quest progress are NOT ported.\n` +
		`No DLC is included either, same as a real transfer - inject DLC for the new game separately afterward.`);
}

// Equipment/items that break the OTHER game if carried across in a region
// transfer (MHGen<->MHX) unless deleted from the character first. This is a
// static reference list, not something detectable automatically - we don't
// have the item/equipment ID tables decoded, so this is a manual checklist
// for the user to go through in-game before transferring. Japanese-only
// (MHX-exclusive) names are translated for English speakers.
var REGION_INCOMPATIBLE_ITEMS = {
	"MHGen Exclusive": {
		"Items": ["Sealing Shield", "Option", "Celestial Scroll", "Arthur's Armor"],
		"Hunter Weapons": ["Falchion (SnS)", "Light Sword Cypher (DB)"],
		"Hunter Armor": ["Hiryu Sky", "Hiryu Land", "Lodestar"],
		"Palico/Prowler Weapons": ["F Tsumugari", "F Arthur's Lance"],
		"Palico/Prowler Armor": ["F Okami Hood", "F Divine Retribution", "F Arthur's Helm", "F Arthur's Armor"]
	},
	"MHX Exclusive": {
		"Items": [
			"ぐでぐでとした卵 (Lazy/Gude-gude Egg)",
			"魂石 (Soul Stone)",
			"しゃけのきりみ (Salmon Fillet)",
			"マクロスΔコイン (Macross Delta Coin)"
		],
		"Weapons": ["ぐでたまフライパン (Gudetama Frying Pan, Hunting Horn)"],
		"Hunter Armor": [
			"ニセたま頭タイツ (Fake Tama Head Tights)",
			"ニセたま胴タイツ (Fake Tama Body Tights)",
			"ニセたま腕タイツ (Fake Tama Arm Tights)",
			"ニセたま脚タイツ (Fake Tama Leg Tights)",
			"ニセたま頭スーツ (Fake Tama Head Suit)",
			"ニセたま胴スーツ (Fake Tama Body Suit)",
			"ニセたま腕スーツ (Fake Tama Arm Suit)",
			"ニセたま脚スーツ (Fake Tama Leg Suit)",
			"ニセたまS頭タイツ (Fake Tama S Head Tights)",
			"ニセたまS胴タイツ (Fake Tama S Body Tights)",
			"ニセたまS腕タイツ (Fake Tama S Arm Tights)",
			"ニセたまS脚タイツ (Fake Tama S Leg Tights)",
			"ニセたまS頭スーツ (Fake Tama S Head Suit)",
			"ニセたまS胴スーツ (Fake Tama S Body Suit)",
			"ニセたまS腕スーツ (Fake Tama S Arm Suit)",
			"ニセたまS脚スーツ (Fake Tama S Leg Suit)"
		],
		"Palico/Prowler Weapons": [
			"スピリッツネコ剣 (Spirits Neko Sword)",
			"スピリッツSネコ剣 (Spirits S Neko Sword)",
			"きりみステッキ (Fillet Stick)",
			"ニャルキリーウェポン (Nyalkyrie Weapon)"
		],
		"Palico/Prowler Armor": [
			"スピリッツネコ兜 (Spirits Neko Helm)",
			"スピリッツネコ鎧 (Spirits Neko Armor)",
			"スピリッツSネコ兜 (Spirits S Neko Helm)",
			"スピリッツSネコ鎧 (Spirits S Neko Armor)",
			"おめかしきりみちゃん (Dressed-up Kirimi-chan)",
			"ニャルキリーヘッド (Nyalkyrie Head)",
			"ニャルキリースーツ (Nyalkyrie Suit)"
		]
	}
};

// Directly reads/writes the real per-slot claimed-item-pack bitmask (see
// ITEM_PACK_CLAIM_OFFSET in SAVE_CORE.js) - checked = currently claimed.
// Unlike the old standalone MH-Gen-X-Item-packs-reclaim tool (which zeroed
// an opaque 2-byte field and tracked "already used" separately via a byte
// appended past the end of the file), this reads the actual live state
// straight from the save, so no extra tracking byte is needed at all - the
// checkbox state IS the current truth, and unchecking + Apply writes exactly
// that back. Mainly useful after a region transfer (MHGen<->MHX carries this
// flag over unchanged, blocking the new game's own item packs from being
// re-claimed) but works on any loaded slot.
function openReclaimWindow(slot){
	var game = save.game;
	var itemPacks = itemPacksForGame(game);
	var mask = coreReadClaimedPackMask(save.save_slots[slot].data);

	var items = itemPacks.map((p, i) => ({
		key: i, checked: (mask & (1 << i)) !== 0, label: p.displayName
	}));

	var popup = document.getElementById("popup");
	popup.innerHTML = `<div class="cat-window">
		<b>Reclaim item packs - ${save.save_slots[slot].name}</b></br>
		<span style="font-size: 11px; color: grey;">
			Checked = already claimed on this character. Uncheck a pack and hit Apply to
			mark it unclaimed again, so it can be redeemed in-game. Mainly useful right
			after a region transfer (MHGen &harr; MHX), since the new game's item packs are
			a completely different campaign but this flag carries over as-is.
		</span></br></br>
		<span style="margin-left: 10px;">
			<button id="reclaim_none" style="height:22px;">Uncheck All</button>
			<button id="reclaim_all" style="height:22px;">Check All</button>
		</span></br>
		${renderGridTable(items, 2, "reclaim-pack", null, game)}</br>
		<button id="run_reclaim">Apply</button>
		<button onclick="closeWindow()">Cancel</button>
	</div>`;

	document.getElementById("reclaim_none").addEventListener("click", () => {
		popup.querySelectorAll(".reclaim-pack").forEach(cb => cb.checked = false);
	});
	document.getElementById("reclaim_all").addEventListener("click", () => {
		popup.querySelectorAll(".reclaim-pack").forEach(cb => cb.checked = true);
	});
	document.getElementById("run_reclaim").addEventListener("click", () => applyReclaim(slot));

	document.getElementById("popup-window-overlay").style.display = "block";
	document.getElementById("popup-window").style.display = "block";
}

function applyReclaim(slot){
	var popup = document.getElementById("popup");
	var newMask = 0;
	popup.querySelectorAll(".reclaim-pack").forEach(cb => {
		if (cb.checked) newMask |= (1 << parseInt(cb.dataset.key));
	});

	coreWriteClaimedPackMask(save.save_slots[slot].data, newMask);
	closeWindow();
	alert(`Updated claimed item packs for "${save.save_slots[slot].name}". Export the save to keep this change.`);
}

function openCompatWindow(){
	var popup = document.getElementById("popup");

	var html = `<div class="cat-window">
		<b>Region-transfer compatibility check</b></br></br>
		<span>
			These items/weapons/armor only exist in one region. If a character carries
			any of these when transferred to the other region (MHGen &harr; MHX), the save
			can break. Unequip and remove them from your item box, storage box, and
			Palico/Prowler loadouts <b>before</b> exporting to the other region -
			this isn't something that can be checked automatically since the item/
			equipment ID tables haven't been decoded, so go through this list manually in-game.
		</span></br></br>`;

	for (var region in REGION_INCOMPATIBLE_ITEMS){
		html += `<u>${region}</u></br>`;
		var categories = REGION_INCOMPATIBLE_ITEMS[region];
		for (var category in categories){
			html += `<b>${category}</b></br><span style="font-size: 12px;">${categories[category].join(", ")}</span></br>`;
		}
		html += `</br>`;
	}

	html += `<button onclick="closeWindow()">Close</button></div>`;
	popup.innerHTML = html;

	document.getElementById("popup-window-overlay").style.display = "block";
	document.getElementById("popup-window").style.display = "block";
}

function closeWindow(){
	document.getElementById("popup-window-overlay").style.display = "none";
	document.getElementById("popup-window").style.display = "none";
}

newSave();

window.addEventListener("load", () => {
	var footer = document.getElementById("footer");
	var now = new Date();
	var year = now.getFullYear();
	footer.innerHTML = `<a href="https://github.com/SilverJolteon/">Style based on SilverJolteon's MHXX-MHGU Save Manager</a> &nbsp;·&nbsp; MHGen/MHX Save Manager ${VERSION} &copy;${year}`;
});
