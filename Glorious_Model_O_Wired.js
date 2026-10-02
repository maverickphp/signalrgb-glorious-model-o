export function Name() { return "Glorious Model O (Wired)"; }
export function VendorId() { return 0x258A; }
export function ProductId() { return 0x0036; }
export function Publisher() { return "Community"; }
export function Size() { return [1, 1]; }
export function DefaultPosition() { return [240, 120]; }
export function DefaultScale() { return 8.0; }
export function Type() { return "Hid"; }
export function DeviceType() { return "mouse"; }
/* global
mouseMode:readonly
minSecondsBetweenWrites:readonly
LightingMode:readonly
forcedColor:readonly
*/
export function ControllableParameters() {
	return [
		{property:"mouseMode", group:"lighting", label:"Mouse Lighting", description:"Follow SignalRGB sets the mouse to your effect's color. The others are the mouse's own built-in animations.", type:"combobox", values:["Follow SignalRGB", "Rainbow", "Wave", "Spectrum Cycle", "Off"], default:"Follow SignalRGB"},
		{property:"minSecondsBetweenWrites", group:"lighting", label:"Seconds Between Color Updates", description:"The Model O saves every color change to its memory, so changes are spaced out to avoid wearing it out. Lower is more responsive.", step:"1", type:"number", min:"3", max:"60", default:"10"},
		{property:"LightingMode", group:"lighting", label:"Lighting Mode", description:"Canvas follows the active effect, Forced uses one color", type:"combobox", values:["Canvas", "Forced"], default:"Canvas"},
		{property:"forcedColor", group:"lighting", label:"Forced Color", description:"Color used in Forced mode", min:"0", max:"360", type:"color", default:"#009bde"},
	];
}

// Protocol (from OpenRGB's SinowealthController, which supports this mouse):
// - Command report 0x05 (6 bytes): [05 11 00 00 00 00] asks the mouse for its configuration.
// - Configuration report 0x04 (520 bytes, feature): read it, change the lighting bytes, set
//   [0x03] = 0x7B and [0x06] = 0x00, and send it back. The mouse saves it, so there is no live
//   color mode: every change is a write to its memory, which this plugin rate-limits.
// Lighting bytes: [0x35] mode; static brightness [0x38] (high nibble), color [0x39..0x3B] as R, B, G.
const CMD_REPORT_SIZE = 6;
const CONFIG_REPORT_SIZE = 520;
const CONFIG_MIN_SIZE = 131;
const MODES = { "Off": 0x00, "Rainbow": 0x01, "Static": 0x02, "Spectrum Cycle": 0x05, "Wave": 0x09 };
const ANIMATION_BYTES = { 0x01: 0x36, 0x05: 0x54, 0x09: 0x7C };  // brightness/speed byte per mode
const COLOR_CHANGE_THRESHOLD = 24;  // sum of |dR|+|dG|+|dB| below this isn't worth a write

let cmdCollection = null;
let dataCollection = null;
let lastWritten = null;   // {mode, color}
let lastWriteAt = 0;

export function LedNames() { return ["Mouse"]; }
export function LedPositions() { return [[0, 0]]; }

export function Validate(endpoint) {
	return endpoint.interface === 1 && endpoint.usage_page === 0xFF00;
}

export function ImageUrl() {
	return "https://raw.githubusercontent.com/maverickphp/signalrgb-glorious-model-o/main/assets/signalrgb-glorious-model-o.png";
}

function useCollection(collection) {
	device.set_endpoint(1, 0x0001, 0xFF00, collection);
}

function requestConfig() {
	useCollection(cmdCollection);
	device.send_report([0x05, 0x11, 0x00, 0x00, 0x00, 0x00], CMD_REPORT_SIZE);
	device.pause(30);
	useCollection(dataCollection);
	const cfg = device.get_report([0x04], CONFIG_REPORT_SIZE);
	return cfg && cfg.length >= CONFIG_MIN_SIZE && cfg[0] === 0x04 ? cfg : null;
}

// The two vendor collections can't be told apart by usage, so try each pair until one returns
// the configuration.
function findCollections() {
	for (let c = 0; c <= 6; c++) {
		for (let d = 0; d <= 6; d++) {
			if (c === d) { continue; }
			cmdCollection = c;
			dataCollection = d;
			try {
				if (requestConfig()) {
					device.log(`Model O: command collection ${c}, configuration collection ${d}`);
					return true;
				}
			} catch (e) {
				// not this pair
			}
		}
	}
	cmdCollection = dataCollection = null;
	device.log("Model O: couldn't find the configuration report");
	return false;
}

function writeLighting(mode, color) {
	const cfg = requestConfig();
	if (!cfg) {
		device.log("Model O: configuration read failed; skipping write");
		return false;
	}
	const buf = new Array(CONFIG_REPORT_SIZE).fill(0);
	for (let i = 0; i < cfg.length && i < CONFIG_REPORT_SIZE; i++) { buf[i] = cfg[i]; }
	buf[0x03] = 0x7B;  // write to device
	buf[0x06] = 0x00;
	buf[0x35] = mode;
	if (mode === MODES.Static) {
		if ((buf[0x38] & 0xF0) === 0) { buf[0x38] = 0x40; }  // keep its brightness, never 0
		buf[0x39] = color[0];
		buf[0x3A] = color[2];
		buf[0x3B] = color[1];
	} else if (ANIMATION_BYTES[mode] && (buf[ANIMATION_BYTES[mode]] & 0xF0) === 0) {
		buf[ANIMATION_BYTES[mode]] = 0x43;  // full brightness, medium speed
	}
	useCollection(dataCollection);
	device.send_report(buf, CONFIG_REPORT_SIZE);
	lastWritten = { mode, color };
	lastWriteAt = Date.now();
	return true;
}

function colorDistance(a, b) {
	return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

export function Initialize() {
	device.setName("Glorious Model O");
	device.setImageFromUrl(ImageUrl());
	findCollections();
}

export function Render() {
	if (dataCollection === null) {
		return;
	}
	const now = Date.now();
	const minGap = Math.max(3, Number(minSecondsBetweenWrites) || 10) * 1000;
	if (lastWritten && now - lastWriteAt < minGap) {
		return;
	}

	if (mouseMode !== "Follow SignalRGB") {
		const mode = MODES[mouseMode] ?? MODES.Rainbow;
		if (!lastWritten || lastWritten.mode !== mode) {
			writeLighting(mode, null);
		}
		return;
	}

	const color = LightingMode === "Forced" ? hexToRgb(forcedColor) : device.color(0, 0);
	if (!lastWritten || lastWritten.mode !== MODES.Static || colorDistance(color, lastWritten.color) >= COLOR_CHANGE_THRESHOLD) {
		writeLighting(MODES.Static, color);
	}
}

// The mouse keeps its last color when SignalRGB closes; no extra write.
export function Shutdown() {}

function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
}
