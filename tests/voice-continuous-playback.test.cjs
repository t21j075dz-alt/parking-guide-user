const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const window={};
vm.runInNewContext(fs.readFileSync(
  path.join(__dirname,"../voice-continuous-playback.js"),"utf8"),{window});
const assembler=window.ParkingContinuousVoice;

function buffer(length=800, value=.2, channels=1) {
  const data=Array.from({length:channels},()=>new Float32Array(length).fill(value));
  return {sampleRate:8000,numberOfChannels:channels,length,duration:length/8000,
    getChannelData(c){return data[c];}};
}
function audioContext() {
  return {sampleRate:8000,createBuffer(channels,length,rate){
    assert.equal(rate,8000);
    const data=Array.from({length:channels},()=>new Float32Array(length));
    return {length,numberOfChannels:channels,duration:length/rate,
      getChannelData(c){return data[c];}};
  }};
}

test("multiple spoken clips become one continuous Web Audio buffer",()=>{
  const a=buffer(800,.2),b=buffer(800,.2);
  const result=assembler.join(audioContext(),[a,b],["案内開始。","A列1番です。"]);
  assert.ok(result);
  assert.equal(result.numberOfChannels,1);
  assert.equal(result.length,800+Math.round(.2*8000)+800);
  assert.ok(result.getChannelData(0)[100]>0,"first clip audible");
  assert.equal(result.getChannelData(0)[1200],0,"pause between sentences is silent");
  assert.ok(result.getChannelData(0)[2500]>0,"second clip audible");
});

test("repeat instruction uses longer pause and mixed mono/stereo stays playable",()=>{
  const first=buffer(800,.22,1),second=buffer(800,.12,2);
  const result=assembler.join(audioContext(),[first,second],["繰り返します。","番号です。"]);
  assert.equal(result.numberOfChannels,2);
  assert.equal(result.length,1600+Math.round(.42*8000));
  assert.ok(result.getChannelData(0).some(n=>n>0));
  assert.ok(result.getChannelData(1).some(n=>n>0));
});

test("old individual-clip path remains available if browser lacks audio buffer merge",()=>{
  assert.equal(assembler.join({},[buffer()],[]),null);
  assert.equal(assembler.join(audioContext(),[],[]),null);
  assert.equal(assembler.join(audioContext(),[{duration:.2}],[]),null);
});
