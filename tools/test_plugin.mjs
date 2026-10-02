// Runs the plugin against a fake Model O and checks what it writes.
//   node tools/test_plugin.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

// Fake mouse: command report on collection 3, configuration on collection 1 (any pair works).
const CMD_COL = 3, DATA_COL = 1;
let collection = null, requested = false, color = [0, 0, 255];
const writes = [];
const config = new Array(131).fill(0);
config[0] = 0x04; config[1] = 0x11; config[0x35] = 0x02; config[0x38] = 0x40;
config[0x39] = 0x80; config[0x3A] = 0x80; config[0x3B] = 0x00;

globalThis.device = {
  setName() {}, log() {}, pause() {},
  color: () => color,
  set_endpoint: (iface, usage, page, col) => { collection = col; },
  send_report(data, len) {
    if (collection === CMD_COL && data[0] === 0x05 && data[1] === 0x11) { requested = true; return; }
    if (collection === DATA_COL && data[0] === 0x04 && len === 520) {
      writes.push(data.slice());
      for (let i = 0; i < config.length; i++) config[i] = data[i];
      config[0x03] = 0x00;
    }
  },
  get_report(data, len) {
    if (collection === DATA_COL && requested && data[0] === 0x04) { requested = false; return config.slice(); }
    return [];
  },
};
Object.assign(globalThis, { mouseMode: "Follow SignalRGB", minSecondsBetweenWrites: 10, LightingMode: "Canvas", forcedColor: "#009bde" });

const src = readFileSync(new URL("../Glorious_Model_O_Wired.js", import.meta.url), "utf8");
const plugin = await import("data:text/javascript," + encodeURIComponent(src));

const realNow = Date.now;
let now = 1_000_000;
Date.now = () => now;

plugin.Initialize();
plugin.Render();
assert.equal(writes.length, 1, "first frame writes the effect color");
let w = writes[0];
assert.equal(w.length, 520);
assert.equal(w[0x03], 0x7B); assert.equal(w[0x06], 0x00); assert.equal(w[0x35], 0x02);
assert.deepEqual(w.slice(0x39, 0x3C), [0, 255, 0], "blue as R, B, G");
assert.equal(w[0x38], 0x40, "brightness kept");

plugin.Render();
assert.equal(writes.length, 1, "same color: no write");

color = [255, 0, 0];
now += 3000; plugin.Render();
assert.equal(writes.length, 1, "new color within 10 s: wait");
now += 8000; plugin.Render();
assert.equal(writes.length, 2, "after 10 s: write the new color");
assert.deepEqual(writes[1].slice(0x39, 0x3C), [255, 0, 0]);

color = [255, 4, 6];
now += 20000; plugin.Render();
assert.equal(writes.length, 2, "tiny change isn't worth a write");

globalThis.mouseMode = "Rainbow";
now += 20000; plugin.Render();
assert.equal(writes.length, 3); assert.equal(writes[2][0x35], 0x01);
now += 20000; plugin.Render();
assert.equal(writes.length, 3, "built-in mode is written once");

assert.ok(plugin.Validate({ interface: 1, usage: 1, usage_page: 0xff00 }));
Date.now = realNow;
console.log("all plugin checks passed");
