"use strict";

/* =========================================================
   【利用者アプリのデータフロー】

   facilities.js
      ↓ 施設一覧
   利用者が施設・条件を選択
      ↓
   Supabase設定あり：最新レイアウトを取得
   設定なし／通信失敗：parking-layouts.js を使用
      ↓
   parkingSpace と buildingEntrance を使って案内候補を選択
      ↓
   区画マップ・詳細案内へ表示

   実店舗のリアルタイム空き情報はまだ取得していない。
   管理レイアウトがない施設だけ研究用シミュレーションへフォールバックする。
   ========================================================= */

/* =========================================================
   駐車場空き区画案内：画面制御

   研究対象施設は facilities.js、駐車場レイアウトは
   parking-layouts.js から読み込む。位置情報と運転確認は
   location-safety.js が担当する。
   ========================================================= */

const DEMO_FACILITY = Object.freeze({
  id: "ous-main-gate-experiment",
  name: "実験用駐車場（岡山理科大学正門）",
  prefecture: "岡山県",
  municipality: "岡山市",
  address: "岡山県岡山市北区理大町1-1 岡山理科大学正門",
  category: "experiment",
  latitude: 34.6998,
  longitude: 133.9280,
  demoDistance: 0.8,
  layoutId: "ous-main-gate-experiment",
  targetBuildingId: null,
  isDemo: true,
});

const FACILITIES = Object.freeze([DEMO_FACILITY, ...FACILITY_CATALOG]);

const CATEGORY_LABELS = Object.freeze({
  supermarket: "スーパー・食品店",
  "home-center": "ホームセンター",
  "discount-store": "ディスカウントストア",
  experiment: "実験用駐車場",
});

const PRIORITY_LABELS = Object.freeze({
  balanced: "おまかせ",
  near: "入口に近い",
  wide: "幅にゆとりがある",
});

const SCREEN_ORDER = Object.freeze(["facility", "condition", "result", "guide"]);

const state = {
  currentScreen: "facility",
  selectedFacility: null,
  selectedPriority: "balanced",
  recommendedSpace: null,
  currentSpaces: [],
  currentLayout: null,
  guideEntrance: null,
  userLocation: null,
  searchSequence: 0,
  searchRequestId: 0,
  filters: { prefecture: "", category: "" },
  sortByDistance: false,
};

/* =========================================================
   DOM参照
   ========================================================= */

const facilityList = document.querySelector("#facility-list");
const filterForm = document.querySelector("#facility-filter-form");
const prefectureFilter = document.querySelector("#prefecture-filter");
const categoryFilter = document.querySelector("#category-filter");
const resetFiltersButton = document.querySelector("#reset-filters-button");
const sortDistanceButton = document.querySelector("#sort-distance-button");
const facilityCount = document.querySelector("#facility-count");
const facilityEmpty = document.querySelector("#facility-empty");
const textSizeButton = document.querySelector("#text-size-button");
const themeButton = document.querySelector("#theme-button");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const conditionForm = document.querySelector("#condition-form");
const selectedFacilityName = document.querySelector("#selected-facility-name");
const searchStatus = document.querySelector("#search-status");
const resultContent = document.querySelector("#result-content");
const spaceNumber = document.querySelector("#space-number");
const spaceDescription = document.querySelector("#space-description");
const priorityBadge = document.querySelector("#priority-badge");
const parkingMap = document.querySelector("#parking-map");
const parkingMapTitle = document.querySelector("#parking-map-title");
const updatedTime = document.querySelector("#updated-time");
const showGuideButton = document.querySelector("#show-guide-button");
const retryButton = document.querySelector("#retry-button");
const guideSpaceNumber = document.querySelector("#guide-space-number");
const guideFacilityName = document.querySelector("#guide-facility-name");
const finalDirectionTitle = document.querySelector("#final-direction-title");

/* =========================================================
   施設一覧・絞り込み・距離
   ========================================================= */

/** 選択肢を作り直し、指定した値を反映する。 */
function setSelectOptions(select, items, defaultLabel, selectedValue = "") {
  select.replaceChildren(new Option(defaultLabel, ""));
  items.forEach(([value, label]) => select.add(new Option(label, value)));
  select.value = selectedValue;
}

/** 空値を除き、施設データの値を日本語順で返す。 */
function getDistinctValues(facilities, key) {
  return [...new Set(facilities.map((facility) => facility[key]).filter(Boolean))].sort(
    (first, second) => first.localeCompare(second, "ja"),
  );
}

/** 研究対象施設から絞り込み項目を作る。 */
function initializeFilters() {
  setSelectOptions(
    prefectureFilter,
    getDistinctValues(FACILITIES, "prefecture").map((value) => [value, value]),
    "すべての都道府県",
    state.filters.prefecture,
  );
  setSelectOptions(
    categoryFilter,
    Object.entries(CATEGORY_LABELS),
    "すべてのカテゴリ",
    state.filters.category,
  );
}

/** 現在の絞り込み条件に一致する施設を返す。 */
function getFilteredFacilities() {
  return FACILITIES.filter((facility) =>
    Object.entries(state.filters).every(
      ([key, value]) => !value || facility[key] === value,
    ),
  );
}

/** 緯度経度から直線距離をkmで求める。 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const earthRadiusKm = 6371;
  const toRadians = (degree) => (degree * Math.PI) / 180;
  const latitudeDifference = toRadians(lat2 - lat1);
  const longitudeDifference = toRadians(lon2 - lon1);
  const startLatitude = toRadians(lat1);
  const endLatitude = toRadians(lat2);

  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDifference / 2) ** 2;

  const clampedA = Math.min(1, Math.max(0, a));
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
}

/** 現在地と施設座標がそろっている場合だけ直線距離を返す。 */
function getFacilityDistance(facility) {
  if (!state.userLocation) {
    return facility.isDemo ? facility.demoDistance : null;
  }
  if (!Number.isFinite(facility.latitude) || !Number.isFinite(facility.longitude)) {
    return null;
  }

  return calculateDistanceKm(
    state.userLocation.latitude,
    state.userLocation.longitude,
    facility.latitude,
    facility.longitude,
  );
}

/** 施設カード内の距離表示を更新する。 */
function updateFacilityDistance(button, facility) {
  const distance = getFacilityDistance(facility);
  const distanceElement = button.querySelector(".facility-distance");

  if (distance === null) {
    distanceElement.textContent = Number.isFinite(facility.latitude)
      ? "現在地を取得すると直線距離を表示"
      : "位置情報は管理データから追加予定";
  } else {
    distanceElement.textContent = facility.isDemo && !state.userLocation
      ? `参考距離 約${distance.toFixed(1)} km`
      : `現在地から直線 約${distance.toFixed(1)} km`;
  }

  button.setAttribute(
    "aria-label",
    `${facility.name}、${CATEGORY_LABELS[facility.category]}、${distanceElement.textContent}`,
  );
}

/** 施設一覧を表示する。 */
function renderFacilities() {
  const filtered = getFilteredFacilities();
  const sorted = [...filtered];

  if (state.sortByDistance) {
    sorted.sort((first, second) => {
      const firstDistance = getFacilityDistance(first);
      const secondDistance = getFacilityDistance(second);
      return (firstDistance ?? Infinity) - (secondDistance ?? Infinity);
    });
  }

  facilityList.replaceChildren();
  facilityCount.textContent = `${sorted.length}件`;
  facilityEmpty.hidden = sorted.length > 0;

  sorted.forEach((facility) => {
    const article = document.createElement("article");
    article.className = "facility-row";

    const button = document.createElement("button");
    button.className = "facility-button";
    button.type = "button";
    button.dataset.facilityId = facility.id;

    const main = document.createElement("span");
    main.className = "facility-main";

    const name = document.createElement("span");
    name.className = "facility-name";
    name.textContent = facility.name;

    const meta = document.createElement("span");
    meta.className = "facility-meta";
    meta.textContent = [facility.prefecture, facility.municipality, CATEGORY_LABELS[facility.category]]
      .filter(Boolean)
      .join(" / ");

    const distance = document.createElement("span");
    distance.className = "facility-distance";

    const action = document.createElement("span");
    action.className = "facility-action";
    action.textContent = "選択";

    main.append(name, meta, distance);
    button.append(main, action);
    article.append(button);
    facilityList.append(article);
    updateFacilityDistance(button, facility);
  });
}

/** GPS更新時は並び順を変えず、距離表示だけを更新する。 */
function updateFacilityDistances() {
  facilityList.querySelectorAll("[data-facility-id]").forEach((button) => {
    const facility = FACILITIES.find((item) => item.id === button.dataset.facilityId);
    if (facility) {
      updateFacilityDistance(button, facility);
    }
  });
}



/* =========================================================
   管理画面からのクラウドレイアウト取得
   ========================================================= */

/** Supabaseに保存された最新レイアウトを読み込み、同梱データより優先する。 */
async function loadRemoteParkingLayouts() {
  const config = window.PARKING_REMOTE_CONFIG ?? {};
  const url = String(config.supabaseUrl ?? "").replace(/\/$/, "");
  const publishableKey = String(config.publishableKey ?? "");
  if (config.enabled !== true || !/^https:\/\//.test(url) || publishableKey.length <= 10) {
    return;
  }

  try {
    const response = await fetch(`${url}/rest/v1/parking_layouts?select=facility_id,layout_data,updated_at`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      return;
    }
    const rows = await response.json();
    const layouts = { ...(window.PARKING_LAYOUTS ?? {}) };
    rows.forEach((row) => {
      if (row?.facility_id && row.layout_data && Array.isArray(row.layout_data.objects)) {
        layouts[row.facility_id] = row.layout_data;
      }
    });
    window.PARKING_LAYOUTS = layouts;
  } catch {
    /* 通信できない場合は同梱の parking-layouts.js を使う。 */
  }
}


/* =========================================================
   管理用Webアプリのレイアウトデータ連携
   ========================================================= */

/** facilityId に対応する駐車場レイアウトを返す。 */
function getFacilityLayout(facility) {
  if (!facility || !window.PARKING_LAYOUTS) {
    return null;
  }
  const layout = window.PARKING_LAYOUTS[facility.layoutId ?? facility.id];
  if (!layout || layout.facilityId !== facility.id || !Array.isArray(layout.objects)) {
    return null;
  }
  return layout;
}

/** 案内基準に使用できる建物出入口を取得する。 */
function getGuideEntrance(layout, facility) {
  if (!layout) {
    return null;
  }

  const entrances = layout.objects.filter((object) =>
    object.objectType === "buildingEntrance" &&
    object.guideTarget === true &&
    object.publicAccess !== false &&
    Number.isFinite(object.x) &&
    Number.isFinite(object.y),
  );

  if (facility.targetBuildingId) {
    return entrances.find((entrance) => entrance.buildingId === facility.targetBuildingId) ?? null;
  }

  return entrances[0] ?? null;
}

/** レイアウト上の2点間距離を計算する。 */
function calculateLayoutDistance(space, entrance, layout) {
  if (!space || !entrance) {
    return { score: Infinity, meters: null };
  }

  const centerX = space.x + (Number(space.width) || 0) / 2;
  const centerY = space.y + (Number(space.height) || 0) / 2;
  const pixels = Math.hypot(centerX - entrance.x, centerY - entrance.y);
  const scale = layout?.canvas?.scaleMetersPerPixel;

  return {
    score: pixels,
    meters: Number.isFinite(scale) && scale > 0 ? pixels * scale : null,
  };
}

/** 管理画面から登録された駐車区画を検索用データへ変換する。 */
function createLayoutParkingSpaces(layout, facility) {
  const entrance = getGuideEntrance(layout, facility);

  return layout.objects
    .filter((object) => object.objectType === "parkingSpace")
    .filter((object) => Number.isFinite(object.x) && Number.isFinite(object.y))
    .map((object, index) => {
      const distance = calculateLayoutDistance(object, entrance, layout);
      const status = object.status ?? "available";
      const width = Number(object.width) || 0;
      const height = Number(object.height) || 0;

      return {
        id: object.name || object.spaceNumber || object.uid || `区画${index + 1}`,
        uid: object.uid || `space_${index + 1}`,
        number: index + 1,
        isOccupied: status === "occupied" || status === "unavailable",
        isWide: object.spaceType === "accessible" || width > height * 0.65,
        spaceType: object.spaceType ?? "standard",
        entranceDistanceMeters: distance.meters,
        distanceScore: distance.score,
        sourceObject: object,
      };
    });
}

/** レイアウト未登録時に動作確認用の12区画を作る。 */
function createDemoParkingSpaces(searchSequence = state.searchSequence) {
  const baseOccupied = [2, 5, 8, 11];
  const shiftedOccupied = baseOccupied.map(
    (number) => ((number + searchSequence - 1) % 12) + 1,
  );

  return Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    const distanceMeters = Math.max(20, 82 - number * 5);
    return {
      id: `B-${String(number).padStart(2, "0")}`,
      uid: `demo_b_${String(number).padStart(2, "0")}`,
      number,
      isOccupied: shiftedOccupied.includes(number),
      isWide: [3, 4, 9, 10].includes(number),
      spaceType: "standard",
      entranceDistanceMeters: distanceMeters,
      distanceScore: distanceMeters,
      sourceObject: null,
    };
  });
}

/** 希望条件に合う空き区画を1件選ぶ。 */
function selectRecommendedSpace(spaces, priority) {
  const availableSpaces = spaces.filter((space) => !space.isOccupied);
  if (availableSpaces.length === 0) {
    return null;
  }

  if (priority === "near") {
    return [...availableSpaces].sort(
      (first, second) => first.distanceScore - second.distanceScore,
    )[0];
  }

  if (priority === "wide") {
    return availableSpaces.find((space) => space.isWide) ?? availableSpaces[0];
  }

  const nearSpaces = [...availableSpaces].sort(
    (first, second) => first.distanceScore - second.distanceScore,
  );
  return nearSpaces.find((space) => space.isWide) ?? nearSpaces[0];
}

/** オブジェクト座標をキャンバス比率へ変換する。 */
function toPercent(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (value / total) * 100));
}

/**
 * Web Mercatorで扱える緯度の範囲へ収める。
 * 管理画面と同じ計算式を使い、航空写真と配置オブジェクトの位置関係を一致させる。
 */
function clampMapLatitude(latitude) {
  return Math.max(-85.05112878, Math.min(85.05112878, latitude));
}

/** 緯度経度を国土地理院XYZタイルと同じ世界ピクセル座標へ変換する。 */
function toMapWorldPixel(latitude, longitude, zoom) {
  const size = 256 * (2 ** zoom);
  const lat = clampMapLatitude(latitude) * Math.PI / 180;
  return {
    x: ((longitude + 180) / 360) * size,
    y: (1 - Math.log(Math.tan(lat) + (1 / Math.cos(lat))) / Math.PI) / 2 * size,
  };
}

/**
 * 利用者マップ用の航空写真タイルを1枚生成する。
 * 高倍率タイルが取得できない場合は、管理画面と同様にズーム14まで
 * 低い倍率の親タイルを順番に試し、該当部分を拡大して空白を補う。
 */
function createUserSatelliteTile(targetX, targetY, targetZoom, leftPx, topPx, canvasWidth, canvasHeight) {
  const tile = document.createElement("div");
  tile.className = "user-satellite-tile";
  tile.style.left = `${toPercent(leftPx, canvasWidth)}%`;
  tile.style.top = `${toPercent(topPx, canvasHeight)}%`;
  tile.style.width = `${toPercent(257, canvasWidth)}%`;
  tile.style.height = `${toPercent(257, canvasHeight)}%`;

  function loadCandidate(candidateZoom) {
    if (candidateZoom < 14) {
      tile.classList.add("is-missing");
      return;
    }

    const difference = targetZoom - candidateZoom;
    const scale = 2 ** difference;
    const candidateTileCount = 2 ** candidateZoom;
    const parentX = Math.floor(targetX / scale);
    const parentY = Math.floor(targetY / scale);
    const wrappedParentX =
      ((parentX % candidateTileCount) + candidateTileCount) % candidateTileCount;
    const offsetX = targetX - parentX * scale;
    const offsetY = targetY - parentY * scale;

    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    image.decoding = "async";
    image.loading = "eager";
    image.style.width = `${scale * 100}%`;
    image.style.height = `${scale * 100}%`;
    image.style.left = `${-offsetX * 100}%`;
    image.style.top = `${-offsetY * 100}%`;

    image.addEventListener("error", () => {
      image.remove();
      loadCandidate(candidateZoom - 1);
    }, { once: true });

    image.src =
      `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${candidateZoom}/${wrappedParentX}/${parentY}.jpg`;
    tile.append(image);
  }

  loadCandidate(targetZoom);
  return tile;
}

/**
 * 管理画面で位置合わせした航空写真を、利用者マップの最背面へ描画する。
 * backgroundが未登録の施設では何も描画せず、従来どおり模式図だけを表示する。
 */
function renderRegisteredBackground(layout, canvasWidth, canvasHeight) {
  const background = layout?.background;
  if (!background || background.type !== "gsi-seamlessphoto") {
    return;
  }
  if (!Number.isFinite(background.centerLat) || !Number.isFinite(background.centerLng)) {
    return;
  }

  const zoom = Math.max(14, Math.min(18, Math.round(background.zoom ?? 18)));
  const tileCount = 2 ** zoom;
  const center = toMapWorldPixel(background.centerLat, background.centerLng, zoom);
  const topLeftX = center.x - canvasWidth / 2;
  const topLeftY = center.y - canvasHeight / 2;

  const startTileX = Math.floor(topLeftX / 256) - 1;
  const endTileX = Math.floor((topLeftX + canvasWidth) / 256) + 1;
  const startTileY = Math.floor(topLeftY / 256) - 1;
  const endTileY = Math.floor((topLeftY + canvasHeight) / 256) + 1;

  const layer = document.createElement("div");
  layer.className = "user-satellite-layer";
  layer.style.opacity = String(
    Math.max(0.15, Math.min(1, Number(background.opacity) || 0.75)),
  );
  layer.setAttribute("aria-hidden", "true");

  for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) {
      continue;
    }

    for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      const tile = createUserSatelliteTile(
        wrappedX,
        tileY,
        zoom,
        tileX * 256 - topLeftX - 0.5,
        tileY * 256 - topLeftY - 0.5,
        canvasWidth,
        canvasHeight,
      );
      layer.append(tile);
    }
  }

  parkingMap.append(layer);

  /* 国土地理院の航空写真を表示するため、利用者画面にも出典を明記する。 */
  const attribution = document.createElement("span");
  attribution.className = "map-photo-attribution";
  attribution.textContent = "出典：国土地理院 全国最新写真（シームレス）";
  parkingMap.append(attribution);
}

/** 管理画面で作成した実レイアウトを簡易表示する。 */
function renderRegisteredLayout(layout, recommendedSpace) {
  parkingMap.replaceChildren();
  parkingMap.className = "parking-map parking-map--layout";
  parkingMapTitle.textContent = "駐車場マップ";

  const canvasWidth = Number(layout.canvas?.width) || 1000;
  const canvasHeight = Number(layout.canvas?.height) || 700;
  parkingMap.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;

  /*
   * 航空写真を先に描画し、その上へ管理画面で作成したオブジェクトを重ねる。
   * x/y/width/heightは同じ論理キャンバスを基準にしているため位置関係が一致する。
   */
  renderRegisteredBackground(layout, canvasWidth, canvasHeight);

  const supportedTypes = new Set([
    "road",
    "sidewalk",
    "crosswalk",
    "building",
    "parkingSpace",
    "buildingEntrance",
    "parkingEntrance",
    "stopLine",
    "speedBump",
    "noEntry",
    "cartCorral",
    "bicycleParking",
    "motorcycleParking",
    "loadingZone",
    "evCharger",
  ]);

  layout.objects
    .filter((object) => supportedTypes.has(object.objectType))
    .forEach((object) => {
      const item = document.createElement("div");
      item.className = `map-object map-object--${object.objectType}`;
      item.style.left = `${toPercent(object.x, canvasWidth)}%`;
      item.style.top = `${toPercent(object.y, canvasHeight)}%`;

      if (["road", "sidewalk", "crosswalk", "building", "parkingSpace", "stopLine",
        "speedBump", "cartCorral", "bicycleParking", "motorcycleParking", "loadingZone"].includes(object.objectType)) {
        item.style.width = `${toPercent(Number(object.width) || 70, canvasWidth)}%`;
        item.style.height = `${toPercent(Number(object.height) || 70, canvasHeight)}%`;
        item.style.transform = `rotate(${Number(object.rotation) || 0}deg)`;
      }

      if (object.objectType === "parkingSpace") {
        /* 管理画面で登録した路面標示を利用者マップへそのまま反映する。 */
        item.dataset.markingStyle = object.markingStyle ?? "full";
        item.style.setProperty("--space-line-color", object.markingColor ?? "#ffffff");
        item.style.setProperty("--space-line-width", `${Math.max(1, Number(object.markingWidth) || 3)}px`);

        const isRecommended = object.uid === recommendedSpace?.uid;
        const isOccupied = object.status === "occupied" || object.status === "unavailable";
        item.classList.toggle("is-occupied", isOccupied);
        item.classList.toggle("is-recommended", isRecommended);
        item.textContent = object.name || object.spaceNumber || "区画";
        item.setAttribute(
          "aria-label",
          `${item.textContent}、${isRecommended ? "案内先" : isOccupied ? "使用中" : "空き"}`,
        );
      } else if (object.objectType === "buildingEntrance") {
        const marker = document.createElement("span");
        marker.className = "entrance-icon";
        marker.setAttribute("aria-hidden", "true");
        marker.textContent = "↥";
        const label = document.createElement("span");
        label.className = "entrance-label";
        label.textContent = object.name || "建物入口";
        item.append(marker, label);
        item.setAttribute("aria-label", label.textContent);
      } else if (object.objectType === "parkingEntrance") {
        const accessLabel = object.accessType === "entrance"
          ? "入口"
          : object.accessType === "exit"
            ? "出口"
            : "出入口";
        const defaultNames = new Set(["駐車場入口", "駐車場出口", "駐車場出入口"]);
        const customName = String(object.name ?? "").trim();
        item.textContent = customName && !defaultNames.has(customName)
          ? `${accessLabel}｜${customName}`
          : `駐車場${accessLabel}`;
        item.dataset.accessType = object.accessType ?? "both";
      } else if (object.objectType === "road") {
        if (object.trafficDirection === "oneWay") {
          item.textContent = object.name || "一方通行";
          item.dataset.trafficDirection = "oneWay";
        }
      } else if (object.objectType === "noEntry") {
        item.textContent = object.name || "進入禁止";
      } else if (object.objectType === "evCharger") {
        item.textContent = object.name || "EV充電";
      } else if (["stopLine", "speedBump", "cartCorral", "bicycleParking",
        "motorcycleParking", "loadingZone"].includes(object.objectType)) {
        item.textContent = object.name || "";
      } else if (object.objectType === "building") {
        item.textContent = object.name || "建物";
      }

      parkingMap.append(item);
    });
}

/** レイアウト未登録時の研究用区画図を表示する。 */
function renderDemoParkingMap(spaces, recommendedSpace) {
  parkingMap.replaceChildren();
  parkingMap.className = "parking-map parking-map--demo";
  parkingMap.removeAttribute("style");
  parkingMapTitle.textContent = "デモ区画図";

  spaces.forEach((space) => {
    const item = document.createElement("div");
    const isRecommended = space.id === recommendedSpace.id;
    let status = "空き";

    item.className = "parking-space";
    if (space.isOccupied) {
      item.classList.add("is-occupied");
      status = "使用中";
    }
    if (isRecommended) {
      item.classList.add("is-recommended");
      status = "案内先";
    }

    item.innerHTML = '<span class="parking-space-number"></span><span class="parking-space-state"></span>';
    item.querySelector(".parking-space-number").textContent = space.id;
    item.querySelector(".parking-space-state").textContent = status;
    item.setAttribute("role", "listitem");
    item.setAttribute("aria-label", `${space.id}、${status}`);
    parkingMap.append(item);
  });
}

/** 登録レイアウトがあれば実マップ、なければデモ図を表示する。 */
function renderParkingMap(spaces, recommendedSpace, layout) {
  if (layout && spaces.some((space) => space.sourceObject)) {
    renderRegisteredLayout(layout, recommendedSpace);
  } else {
    renderDemoParkingMap(spaces, recommendedSpace);
  }
}

/* =========================================================
   画面遷移・検索
   ========================================================= */

/** 指定した4画面のうち1画面だけを表示する。 */
function showScreen(screenName, options = {}) {
  const { addHistory = true, moveFocus = true } = options;
  if (!SCREEN_ORDER.includes(screenName)) {
    return;
  }

  document.querySelectorAll("[data-screen]").forEach((screen) => {
    screen.hidden = screen.dataset.screen !== screenName;
  });

  const currentIndex = SCREEN_ORDER.indexOf(screenName);
  document.querySelectorAll("[data-progress]").forEach((item) => {
    const itemIndex = SCREEN_ORDER.indexOf(item.dataset.progress);
    item.classList.toggle("is-current", itemIndex === currentIndex);
    item.classList.toggle("is-complete", itemIndex < currentIndex);
    if (itemIndex === currentIndex) {
      item.setAttribute("aria-current", "step");
    } else {
      item.removeAttribute("aria-current");
    }
  });

  state.currentScreen = screenName;
  if (screenName === "facility") {
    renderFacilities();
  }

  if (addHistory) {
    window.history.pushState({ screen: screenName }, "", `#${screenName}`);
  }

  window.scrollTo({ top: 0, behavior: "auto" });
  if (moveFocus && !document.querySelector("#driving-dialog")?.open) {
    document.querySelector(`#${screenName}-title`)?.focus();
  }
}

/** 選択施設に応じて登録済みレイアウトまたはデモ区画を準備する。 */
function prepareSpaces(facility) {
  const layout = getFacilityLayout(facility);
  if (layout) {
    const spaces = createLayoutParkingSpaces(layout, facility);
    if (spaces.length > 0) {
      return {
        layout,
        spaces,
        entrance: getGuideEntrance(layout, facility),
        isSimulation: false,
      };
    }
  }

  return {
    layout: null,
    spaces: createDemoParkingSpaces(),
    entrance: null,
    isSimulation: true,
  };
}

/** 空き区画検索を実行する。 */
async function runSpaceSearch(priorityOverride = null) {
  await loadRemoteParkingLayouts();
  if (window.parkingSafety && !window.parkingSafety.guardOperation()) {
    return { cancelled: true };
  }
  if (!state.selectedFacility) {
    showScreen("facility");
    return { cancelled: true };
  }

  const checkedPriority = conditionForm.querySelector('input[name="priority"]:checked');
  state.selectedPriority = priorityOverride ?? checkedPriority?.value ?? "balanced";

  const matchingRadio = conditionForm.querySelector(
    `input[name="priority"][value="${state.selectedPriority}"]`,
  );
  if (matchingRadio) {
    matchingRadio.checked = true;
  }

  const requestId = ++state.searchRequestId;
  const facility = state.selectedFacility;
  const priority = state.selectedPriority;
  state.recommendedSpace = null;

  if (state.currentScreen !== "result") {
    showScreen("result");
  }
  resultContent.hidden = true;
  searchStatus.textContent = "空き区画を確認しています…";

  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (requestId !== state.searchRequestId || state.selectedFacility !== facility) {
        resolve({ cancelled: true });
        return;
      }

      const prepared = prepareSpaces(facility);
      if (prepared.isSimulation) {
        prepared.spaces = createDemoParkingSpaces(state.searchSequence);
      }

      state.currentLayout = prepared.layout;
      state.currentSpaces = prepared.spaces;
      state.guideEntrance = prepared.entrance;
      state.recommendedSpace = selectRecommendedSpace(prepared.spaces, priority);

      if (!state.recommendedSpace) {
        searchStatus.textContent = "現在の条件で案内できる空き区画がありません。";
        resolve({ facility: facility.name, spaceId: null, priority });
        return;
      }

      spaceNumber.textContent = state.recommendedSpace.id;
      priorityBadge.textContent = PRIORITY_LABELS[priority];

      if (prepared.isSimulation) {
        spaceDescription.textContent = `店舗入口まで約${Math.round(state.recommendedSpace.entranceDistanceMeters)}m（シミュレーション）`;
        searchStatus.textContent = `${facility.name}の研究用シミュレーション結果です。`;
      } else if (Number.isFinite(state.recommendedSpace.entranceDistanceMeters)) {
        const entranceName = prepared.entrance?.name || "建物入口";
        spaceDescription.textContent = `${entranceName}まで約${Math.round(state.recommendedSpace.entranceDistanceMeters)}m`;
        searchStatus.textContent = `${facility.name}の登録レイアウトから案内先を選びました。`;
      } else {
        const entranceName = prepared.entrance?.name || "建物入口";
        spaceDescription.textContent = `${entranceName}とのレイアウト上の距離を比較して選択`;
        searchStatus.textContent = `${facility.name}の登録レイアウトから案内先を選びました。`;
      }

      updatedTime.textContent = new Intl.DateTimeFormat("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date());

      renderParkingMap(prepared.spaces, state.recommendedSpace, prepared.layout);
      resultContent.hidden = false;

      resolve({
        facility: facility.name,
        spaceId: state.recommendedSpace.id,
        priority,
        simulation: prepared.isSimulation,
      });
    }, 350);
  });
}

/** 案内画面へ選択結果を反映する。 */
function prepareGuideScreen() {
  if (!state.selectedFacility || !state.recommendedSpace) {
    showScreen("facility");
    return;
  }

  guideSpaceNumber.textContent = state.recommendedSpace.id;
  guideFacilityName.textContent = state.selectedFacility.name;
  finalDirectionTitle.textContent = `${state.recommendedSpace.id} に到着`;
  showScreen("guide");
}

/* =========================================================
   表示設定
   ========================================================= */

/** 文字サイズを切り替え、端末内に保存する。 */
function toggleTextSize() {
  const useLarge = document.documentElement.dataset.fontSize !== "large";
  document.documentElement.dataset.fontSize = useLarge ? "large" : "normal";
  textSizeButton.setAttribute("aria-pressed", String(useLarge));
  textSizeButton.textContent = useLarge ? "標準文字" : "文字を大きく";

  try {
    localStorage.setItem("parkingGuideFontSize", useLarge ? "large" : "normal");
  } catch {
    /* 保存できない環境でも表示変更は続ける。 */
  }
}

/** 保存済みの文字サイズを復元する。 */
function restoreTextSize() {
  let savedSize = "normal";
  try {
    savedSize = localStorage.getItem("parkingGuideFontSize") ?? "normal";
  } catch {
    savedSize = "normal";
  }

  const useLarge = savedSize === "large";
  document.documentElement.dataset.fontSize = useLarge ? "large" : "normal";
  textSizeButton.setAttribute("aria-pressed", String(useLarge));
  textSizeButton.textContent = useLarge ? "標準文字" : "文字を大きく";
}

/** テーマを反映し、ブラウザー上部の色も合わせる。 */
function applyTheme(theme) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalizedTheme;
  const dark = normalizedTheme === "dark";
  themeButton.setAttribute("aria-pressed", String(dark));
  themeButton.textContent = dark ? "ライトモード" : "ダークモード";
  themeColorMeta?.setAttribute("content", dark ? "#17191d" : "#ffffff");
}

/** ライト・ダークを切り替える。 */
function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  try {
    localStorage.setItem("parkingGuideTheme", nextTheme);
  } catch {
    /* 保存できない環境でも現在の表示は維持する。 */
  }
}

/** 保存値がない場合はOS設定を使う。 */
function restoreTheme() {
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem("parkingGuideTheme");
  } catch {
    savedTheme = null;
  }
  const preferredTheme = savedTheme === "light" || savedTheme === "dark"
    ? savedTheme
    : window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(preferredTheme);
}

/** 最初の画面へ戻り、検索結果を初期化する。 */
function resetApplication() {
  state.searchRequestId += 1;
  state.selectedFacility = null;
  state.selectedPriority = "balanced";
  state.recommendedSpace = null;
  state.currentSpaces = [];
  state.currentLayout = null;
  state.guideEntrance = null;
  state.searchSequence = 0;
  conditionForm.reset();
  showScreen("facility");
}

/* =========================================================
   操作イベント
   ========================================================= */

facilityList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-facility-id]");
  if (!button) {
    return;
  }

  const facility = FACILITIES.find((item) => item.id === button.dataset.facilityId);
  if (!facility) {
    return;
  }

  state.selectedFacility = facility;
  state.searchRequestId += 1;
  state.recommendedSpace = null;
  selectedFacilityName.textContent = facility.name;
  showScreen("condition");
});

textSizeButton.addEventListener("click", toggleTextSize);
themeButton.addEventListener("click", toggleTheme);
filterForm.addEventListener("submit", (event) => event.preventDefault());

prefectureFilter.addEventListener("change", () => {
  state.filters.prefecture = prefectureFilter.value;
  renderFacilities();
});

categoryFilter.addEventListener("change", () => {
  state.filters.category = categoryFilter.value;
  renderFacilities();
});

resetFiltersButton.addEventListener("click", () => {
  state.filters = { prefecture: "", category: "" };
  state.sortByDistance = false;
  initializeFilters();
  renderFacilities();
});

sortDistanceButton.addEventListener("click", () => {
  state.sortByDistance = true;
  renderFacilities();
});

window.addEventListener("parking:locationchange", (event) => {
  state.userLocation = event.detail.location;
  updateFacilityDistances();
});

conditionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void runSpaceSearch();
});

showGuideButton.addEventListener("click", prepareGuideScreen);

retryButton.addEventListener("click", () => {
  state.searchSequence += 1;
  void runSpaceSearch();
});

document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.back));
});

document.querySelectorAll("[data-go-home]").forEach((element) => {
  element.addEventListener("click", (event) => {
    event.preventDefault();
    resetApplication();
  });
});

window.addEventListener("popstate", (event) => {
  if (window.parkingSafety && !window.parkingSafety.guardOperation()) {
    window.history.pushState({ screen: state.currentScreen }, "", `#${state.currentScreen}`);
    return;
  }

  const requestedScreen = event.state?.screen;
  const canOpenScreen =
    requestedScreen === "facility" ||
    (requestedScreen === "condition" && state.selectedFacility) ||
    (requestedScreen === "result" && state.recommendedSpace) ||
    (requestedScreen === "guide" && state.recommendedSpace);

  showScreen(canOpenScreen ? requestedScreen : "facility", { addHistory: false });
});

/* =========================================================
   初期表示
   ========================================================= */

void loadRemoteParkingLayouts();
restoreTheme();
restoreTextSize();
initializeFilters();
window.history.replaceState({ screen: "facility" }, "", "#facility");
showScreen("facility", { addHistory: false, moveFocus: false });
