"use strict";
/**
 * 音声テスト用施設だけで使用する、通常の案内画面によるデモ。
 * 3実験共通のマップを読み、実際のカメラ/GPS/Supabase/駐車記録には書き込まない。
 * 読み上げ全文は一切DOMへ挿入しない。
 */
window.ParkingVoiceScreenDemo = (() => {
  const $ = selector => document.querySelector(selector);
  const panel = $("#voice-test-demo-controls");
  const waitingCases = new Set(["voice_test_notice","start_single","start_complex","approaching",
    "retry_started","camera_recovered","recorded_demo"]);
  const conditionCases = new Set(["conditions_changed","destination_changed"]);
  const parkedCases = new Set(["parking_completed","parked_location","timer_started","timer_elapsed","exit_detected"]);
  const unavailableCases = new Set(["space_none","full","retry_none","conditions_unavailable",
    "recognition_unknown","rest","closed","closed_unknown","camera_disconnected",
    "location_unknown","status_stale","space_unavailable"]);
  const unknownCases = new Set(["recognition_unknown","camera_disconnected","location_unknown","status_stale"]);
  const alternativeCases = new Set(["space_alternative","retry_found","space_changed"]);
  const text = (ja, en) => ui(ja, en);
  let lastRenderedScene = "";

  function active() {
    return Boolean(state.voiceTestRun && state.selectedFacility?.id === VOICE_TEST_FACILITY_ID);
  }
  function setStatus(ja, en) {
    const node = $("#voice-test-status");
    if (node) node.textContent = text(ja, en);
  }
  function setControls(completed) {
    ["#voice-test-prev","#voice-test-next","#voice-test-pause","#voice-test-retry"].forEach(selector => {
      const node = $(selector);
      if (node) node.hidden = completed;
    });
    ["#voice-test-repeat","#voice-test-finish"].forEach(selector => {
      const node = $(selector);
      if (node) node.hidden = !completed;
    });
    const count = $("#voice-test-complete-count");
    if (count) count.hidden = !completed;
  }
  function demoData(item) {
    const prepared = prepareSpaces(state.selectedFacility);
    // 元の区画オブジェクトは変更せず、表示用のコピーだけを使う。
    const registered = prepared.spaces.filter(space => space.occupancyStatus !== "unavailable");
    const base = registered.length ? registered : Array.from({length:6},(_,index)=>({
      id:String(index+1), uid:"voice-demo-"+(index+1), number:index+1, spaceType:"standard",
      entranceDistanceMeters:null, distanceScore:index+1,
    }));
    const unavailable=unavailableCases.has(item.id);
    const unknown=unknownCases.has(item.id);
    const index=alternativeCases.has(item.id) && base.length>1 ? 1 : 0;
    const spaces=base.map((space,i)=>{
      const occupied=unavailable || (alternativeCases.has(item.id) && i===0)
        || (item.id==="space_maybe_taken" && i===index);
      return {...space,isOccupied:occupied||unknown,
        occupancyStatus:unknown?"unknown":occupied?"occupied":"available"};
    });
    return {prepared,spaces,choice:spaces[index]||spaces[0]};
  }
  function sceneScreen(id) {
    if(id==="guidance_ended") return "facility";
    if(conditionCases.has(id)) return "condition";
    if(waitingCases.has(id)) return "waiting";
    if(parkedCases.has(id)) return "parked";
    return "result";
  }
  function renderScene(item) {
    if(!active()) return;
    const {prepared,spaces,choice}=demoData(item);
    const screen=sceneScreen(item.id), unavailable=unavailableCases.has(item.id);
    state.currentLayout=prepared.layout;
    state.guideEntrance=prepared.entrance;
    state.currentSpaces=spaces;
    state.resultSimulation=true;
    state.resultLive=false;
    state.arrivalCheck=null;
    state.searchOutcome=unavailable?"not-found":(["facility","condition","waiting"].includes(screen)?null:"found");
    state.recommendedSpace=(unavailable||["facility","condition","waiting"].includes(screen))?null:choice;
    state.parkedSpace=screen==="parked"?{...choice,isOccupied:true,occupancyStatus:"occupied"}:null;
    if(state.parkedSpace) state.currentSpaces=spaces.map(s=>s.uid===choice.uid?state.parkedSpace:s);
    // 通常画面間で同じマップDOMを移動させる（記録や配信はしない）。
    if(resultMapSlot&&parkingMapSection) resultMapSlot.append(parkingMapSection);
    showScreen(screen,{addHistory:false,moveFocus:false});
    lastRenderedScene=screen;
    if(screen==="waiting") {
      updateWaitingScreen();
      if(waitingProximityStatus) waitingProximityStatus.textContent=text(
        "位置情報は使用していません（デモ）。","Location tracking is off (demo).");
      if(waitingGoogleMapsLink) waitingGoogleMapsLink.hidden=true;
      if(waitingGoogleMapsNote) waitingGoogleMapsNote.hidden=true;
    }else if(screen==="result") {
      if(congestionNotice) congestionNotice.hidden=true;
      const detected=["arrival_detected","arrival_video_confirm"].includes(item.id);
      if(parkingArrivalPanel) parkingArrivalPanel.hidden=!detected;
      if(parkingArrivalStatus && detected) parkingArrivalStatus.textContent=text(
        "案内先の車両を確認（模擬）。実際の検知結果ではありません。",
        "Vehicle detected at assigned space (simulated).");
      if(parkingArrivalActions) parkingArrivalActions.hidden=true;
      if(searchStatus) searchStatus.textContent=text(
        "模擬データの画面デモです。実際の空き状況ではありません。",
        "Screen demo with simulated data, not live availability.");
      if(resultContent) resultContent.hidden=unavailable;
      if(noSpaceContent) noSpaceContent.hidden=!unavailable;
      if(unavailable){
        if(noSpaceTitle) noSpaceTitle.textContent=isEnglish()?item.en:item.ja;
        if(noSpaceDescription) noSpaceDescription.textContent=text(
          "この状況を模擬しています。実際の駐車場の情報ではありません。",
          "This condition is simulated, not actual parking data.");
      }else{
        if(spaceNumber) spaceNumber.textContent=choice.id;
        if(spaceDescription) spaceDescription.textContent=text(
          "共有マップを使った案内例（模擬）","Sample guidance using the shared parking map");
        if(priorityBadge) priorityBadge.textContent=getPriorityLabel(state.selectedPriority);
        if(updatedTime) updatedTime.textContent=text("デモ","Demo");
        renderParkingMap(state.currentSpaces,choice,state.currentLayout);
      }
    }else if(screen==="parked"){
      if(parkedSpaceNumber) parkedSpaceNumber.textContent=choice.id;
      if(parkedFacilityName) parkedFacilityName.textContent=getFacilityDisplayName(state.selectedFacility);
      updateParkedScreenCopy();
      const title=$("#parked-title");
      if(title) title.textContent=item.id==="exit_detected"
        ?text("出庫を検知（デモ）","Departure detected (demo)")
        :text("駐車位置のご案内（デモ）","Parking location (demo)");
      const label=$("#parked-screen .parked-location-card .result-label");
      if(label) label.textContent=text("駐車した区画（模擬）","Parked space (simulated)");
      const note=$("#parked-screen .parked-location-card .muted");
      if(note) note.textContent=item.id==="timer_elapsed"
        ?text("駐車時間の例：12分（模擬）","Example elapsed time: 12 minutes (simulated)")
        :text("実際の駐車位置は保存していません。","No real parking session has been saved.");
      const notice=$("#parked-screen .parked-notice");
      if(notice) notice.textContent=text("次の場面へは画面下のデモ操作から進めます。",
        "Use the demo controls below to continue.");
      if(parkedMapSlot&&parkingMapSection) parkedMapSlot.append(parkingMapSection);
      renderParkingMap(state.currentSpaces,choice,state.currentLayout);
    }
  }
  function renderStep(){
    const run=state.voiceTestRun;
    if(!active()||run.completed||!run.scenarios[run.index])return;
    const item=run.scenarios[run.index];
    renderScene(item);
    panel.hidden=false;
    document.body.classList.add("voice-demo-active");
    const group=window.ParkingVoiceTestScenarios.groups.find(group=>group.id===item.group);
    const name=$("#voice-test-title"), progress=$("#voice-test-progress"), label=$("#voice-test-group");
    if(name) name.textContent=isEnglish()?item.en:item.ja;
    if(progress) progress.textContent=text(
      "画面デモ "+(run.index+1)+" / "+run.scenarios.length,
      "Screen demo "+(run.index+1)+" / "+run.scenarios.length);
    if(label) label.textContent=group?(isEnglish()?group.en:group.ja):"";
    const previous=$("#voice-test-prev");
    if(previous) previous.disabled=run.index===0;
    setStatus("音声を準備しています。","Preparing audio.");
    window.scrollTo?.({top:0,behavior:"auto"});
  }
  function playbackError(run,index,token){
    if(!active()||run!==state.voiceTestRun||run.index!==index||run.token!==token)return;
    run.paused=true;
    setStatus("音声を再生できませんでした。再開または次の場面を押してください。",
      "Playback failed. Tap Resume or Next scene.");
    const pause=$("#voice-test-pause");
    if(pause) pause.textContent=text("再開","Resume");
  }
  function complete(run){
    run.completed=true;run.paused=true;run.token++;
    setControls(true);
    setStatus("すべての場面を再生しました。","All scenes finished.");
    const count=$("#voice-test-complete-count");
    if(count) count.textContent=text(run.scenarios.length+"種類のデモを終了しました。",
      "Completed "+run.scenarios.length+" screen demos.");
  }
  function playbackComplete(run,index,token){
    if(!active()||run!==state.voiceTestRun||run.index!==index||run.token!==token||run.paused||run.completed)return;
    run.index++;
    if(run.index>=run.scenarios.length){complete(run);return;}
    renderStep();
    if(document.hidden){
      run.paused=true;
      setStatus("次の画面に進みました。開いて再開を押してください。",
        "Next screen is ready. Return and tap Resume.");
      const pause=$("#voice-test-pause");
      if(pause) pause.textContent=text("再開","Resume");
    }else play();
  }
  function play(){
    const run=state.voiceTestRun;
    if(!active()||run.completed||!run.scenarios[run.index])return false;
    if(!state.voiceEnabled||!voiceEnabledInput?.checked){
      run.paused=true;
      setStatus("音声案内がOFFです。設定をONにしてください。","Voice guidance is off.");
      return false;
    }
    run.paused=false;run.token++;
    const token=run.token,index=run.index;
    const pause=$("#voice-test-pause");
    if(pause)pause.textContent=text("一時停止","Pause");
    setStatus("音声再生中。終了すると次の案内画面に進みます。",
      "Speaking. The next guidance screen opens after playback.");
    let script;
    try{script=voiceTestScript(run.scenarios[index]);}
    catch{playbackError(run,index,token);return false;}
    const spoken=speakText(script.text,{
      userGesture:true,parts:script.parts,roles:script.roles,
      onComplete:()=>playbackComplete(run,index,token),
      onError:()=>playbackError(run,index,token),
    });
    if(!spoken)playbackError(run,index,token);
    return Boolean(spoken);
  }
  function stop(){
    if(state.voiceTestRun)state.voiceTestRun.token++;
    cancelSpeech();
    state.voiceTestRun=null;
    state.parkedSpace=null;state.recommendedSpace=null;
    state.arrivalCheck=null;state.searchOutcome=null;
    state.resultLive=false;state.resultSimulation=false;
    state.currentSpaces=[];state.currentLayout=null;
    if(resultMapSlot&&parkingMapSection)resultMapSlot.append(parkingMapSection);
    panel.hidden=true;
    document.body.classList.remove("voice-demo-active");
    if(state.selectedFacility?.id===VOICE_TEST_FACILITY_ID){
      showScreen("condition",{addHistory:false});
      updateVoiceTestEntry();
    }
  }
  function start(){
    if(state.selectedFacility?.id!==VOICE_TEST_FACILITY_ID)return false;
    if(window.parkingSafety&&!window.parkingSafety.guardOperation())return false;
    if(!voiceEnabledInput?.checked){
      if(voiceTestCount)voiceTestCount.textContent=text(
        "音声案内がOFFです。設定からONにしてください。","Enable voice guidance in settings.");
      return false;
    }
    const scenarios=window.ParkingVoiceTestScenarios?.scenarios(
      getGuidanceSpeechLocale(),voiceTestCategory?.value||"all")||[];
    if(!scenarios.length){
      if(voiceTestCount)voiceTestCount.textContent=text(
        "この言語に対応する場面がありません。","No scenarios in this language.");
      return false;
    }
    if(state.voiceTestRun)stop();
    state.voiceTestRun={scenarios,index:0,token:0,paused:false,completed:false};
    state.voiceEnabled=true;
    setControls(false);
    renderStep();
    return play();
  }
  function change(delta){
    const run=state.voiceTestRun;
    if(!active()||run.completed)return;
    cancelSpeech();run.token++;
    run.index=Math.max(0,Math.min(run.scenarios.length,run.index+delta));
    if(run.index>=run.scenarios.length){complete(run);return;}
    run.paused=false;renderStep();play();
  }
  // 旧テスト画面のイベントは通常画面上では発火させない。
  const bind=(selector,handler)=>{
    $(selector)?.addEventListener("click",event=>{
      event.preventDefault();
      event.stopImmediatePropagation();
      handler();
    },true);
  };
  bind("#voice-test-prev",()=>change(-1));
  bind("#voice-test-next",()=>change(1));
  bind("#voice-test-retry",()=>{if(!active()||state.voiceTestRun.completed)return;cancelSpeech();play();});
  bind("#voice-test-pause",()=>{
    const run=state.voiceTestRun;
    if(!active()||run.completed)return;
    if(run.paused){play();return;}
    run.paused=true;run.token++;cancelSpeech();
    const button=$("#voice-test-pause");
    if(button)button.textContent=text("再開","Resume");
    setStatus("一時停止中。再開すると現在の案内を最初から再生します。",
      "Paused. Resume restarts the current announcement.");
  });
  bind("#voice-test-back",stop);
  bind("#voice-test-finish",stop);
  bind("#voice-test-repeat",()=>{stop();start();});
  // デモ中、画面側の検索・駐車確定・出庫などを押しても本番処理を動かさない。
  document.addEventListener("click",event=>{
    if(!active())return;
    const button=event.target.closest?.("button,a,[data-go-home]");
    if(!button||button.closest?.("#voice-test-demo-controls"))return;
    if(button.closest?.("#map-view-controls"))return;
    event.preventDefault();event.stopImmediatePropagation();
  },true);
  document.addEventListener("submit",event=>{
    if(!active())return;
    event.preventDefault();event.stopImmediatePropagation();
  },true);
  window.addEventListener("popstate",event=>{
    if(!active())return;
    event.stopImmediatePropagation();
    stop();
  },true);
  return Object.freeze({start,stop,play,change,isActive:active,sceneScreen});
})();
