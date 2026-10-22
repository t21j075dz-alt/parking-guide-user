"use strict";
// 自宅の満空情報は既存の管理者アカウントだけで読む。動画・カメラURLは取得しない。
window.PARKING_HOME_LIVE = (() => {
  const keyName = "parkingHomeLiveAccessToken", facilityId = "home-test-001", ttl = 15000;
  let token = "", rows = new Map(), effective = new Map(), running = false;
  const config = () => window.PARKING_REMOTE_CONFIG ?? {};
  const getToken = () => { try { return sessionStorage.getItem(keyName) || token; } catch { return token; } };
  const saveToken = value => { token = value; try { value ? sessionStorage.setItem(keyName,value) : sessionStorage.removeItem(keyName); } catch {} };
  const active = () => !!getToken();
  const getStatus = uid => {
    if (!active()) return null;
    const r = rows.get(uid), time = Date.parse(r?.checked_at ?? "");
    if (!r || !Number.isFinite(time) || Date.now() - time > ttl || Date.now() - time < -30000) return "unknown";
    return ["occupied","available","unknown"].includes(r.status) ? r.status : "unknown";
  };
  const message = text => { const el = document.querySelector("#home-live-user-status"); if (el) el.textContent=text; };
  function notify() {
    const next = new Map(Array.from(rows.keys()).map(uid => [uid, getStatus(uid)]));
    const keys = new Set([...effective.keys(), ...next.keys()]);
    const changed = [...keys].some(uid => effective.get(uid) !== next.get(uid));
    effective = next;
    if (changed) window.dispatchEvent(new Event("parking-home-live-update"));
  }
  async function refresh() {
    if (!active() || running || document.hidden) return;
    running = true;
    try {
      const c = config();
      const response = await fetch(c.supabaseUrl.replace(/\/$/,"")+
        "/rest/v1/parking_live_status?facility_id=eq.home-test-001&select=space_uid,status,checked_at", {
        headers:{apikey:c.publishableKey,Authorization:"Bearer "+getToken()},
        cache:"no-store",signal:AbortSignal.timeout(10000),
      });
      if ([401,403].includes(response.status)) {
        saveToken(""); rows=new Map(); effective=new Map();
        message("認証の有効期限が切れました。再ログインしてください。");
        document.querySelector("#home-live-user-login").hidden=false;
        document.querySelector("#home-live-user-logout").hidden=true;
        window.dispatchEvent(new Event("parking-home-live-update")); return;
      }
      if (!response.ok) throw new Error("HTTP "+response.status);
      const data=await response.json();
      rows=new Map((Array.isArray(data)?data:[]).map(r=>[r.space_uid,r]));
      notify();
      const free=[...rows.keys()].filter(id=>getStatus(id)==="available").length;
      message("YOLO実測・確認済み空き "+free+"区画 / "+new Date().toLocaleTimeString("ja-JP")+"更新");
    } catch {
      message("判定データを取得できません。通信・ログイン状態を確認してください。");
      notify(); // 停止時に期限切れとなった区画を「未確認」へ戻す
    } finally { running=false; }
  }
  function init() {
    const form=document.querySelector("#home-live-user-login");
    const logout=document.querySelector("#home-live-user-logout");
    if(!form||!logout) return;
    form.hidden=active(); logout.hidden=!active();
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      const email=form.querySelector("[name=email]")?.value?.trim() ?? "";
      const passwordEl=form.querySelector("[name=password]");
      message("管理者アカウントを確認しています…");
      try {
        const c=config(),response=await fetch(c.supabaseUrl.replace(/\/$/,"")+"/auth/v1/token?grant_type=password",{
          method:"POST",headers:{apikey:c.publishableKey,"Content-Type":"application/json"},
          body:JSON.stringify({email,password:passwordEl.value}),signal:AbortSignal.timeout(10000),
        });
        const body=await response.json();
        if(!response.ok||!body.access_token) throw new Error("login failed");
        saveToken(body.access_token); form.hidden=true; logout.hidden=false;
        rows=new Map(); effective=new Map();
        await refresh();
        window.dispatchEvent(new Event("parking-home-live-update"));
      } catch {message("ログインできませんでした。認証情報を確認してください。");}
      finally {if(passwordEl)passwordEl.value="";}
    });
    logout.addEventListener("click",()=>{
      saveToken(""); rows=new Map(); effective=new Map();
      form.hidden=false;logout.hidden=true;
      message("ログアウトしました。保存済みの区画状態を表示します。");
      window.dispatchEvent(new Event("parking-home-live-update"));
    });
    if(active())void refresh();
    setInterval(()=>{if(active())void refresh();},3000);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true}); else init();
  return { facilityId, active, getStatus, refresh };
})();