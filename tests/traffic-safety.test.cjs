"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(require("node:path").join(__dirname, "../traffic-safety.js"), "utf8");
function setup() {
  const window = {
    PARKING_LAYOUTS: { a:{facilityId:"a", safetyAdvisories:[
      {id:"a1", type:"right_turn_prohibited", message:"右折入場禁止です。", enabled:true, verified:true, stage:"approach"},
      {id:"a2", message:"未確認", enabled:true, verified:false},
      {id:"a3", message:"店舗別", enabled:true, verified:true, destinationId:"shop1", stage:"onsite"},
    ]} },
    ParkingTrafficSafetyContext: () => ({ facility:{id:"a"}, destinationId:"", voiceEnabled:true, screen:"waiting" }),
    setInterval: () => 0,
  };
  const document = { readyState:"loading", addEventListener(){}, getElementById(){ return null; } };
  const sandbox = {window,document,Date,Set,Number,String,Array,Object};
  vm.runInNewContext(source,sandbox);
  return window;
}
test("only manually verified matching safety messages are exposed",()=>{
 const w=setup();
 assert.deepEqual(w.ParkingTrafficSafety.currentAdvisories().map(a=>a.message),["右折入場禁止です。"]);
});
test("voice warnings are announced once per stage",()=>{
 const w=setup();
 assert.deepEqual(Array.from(w.ParkingTrafficSafety.takeStaticWarnings("approach")),["右折入場禁止です。"]);
 assert.equal(w.ParkingTrafficSafety.takeStaticWarnings("approach").length,0);
});
test("live alerts must be fresh and explicit",()=>{
 const w=setup();
 const now=Date.parse("2026-11-12T10:00:00Z");
 const row=(seconds,p,b)=>({checked_at:new Date(now-seconds*1000).toISOString(),
    pedestrian_warning:p,bicycle_warning:b});
 assert.equal(w.ParkingTrafficSafety.toHazards([row(5,true,false)],now).pedestrian,true);
 assert.equal(w.ParkingTrafficSafety.toHazards([row(30,true,true)],now).known,false);
 assert.equal(w.ParkingTrafficSafety.toHazards([row(5,false,false)],now).bicycle,false);
});
