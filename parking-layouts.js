"use strict";

/* =========================================================
   駐車場レイアウト連携用データ

   管理用Webアプリから書き出すデータの受け口。
   facilityId をキーにするため、利用者画面側の施設一覧を変更しても
   同じIDを維持すればレイアウトをそのまま利用できる。

   objectType の主な値：
   parkingSpace / road / sidewalk / crosswalk / building /
   buildingEntrance / parkingEntrance
   ========================================================= */

window.PARKING_LAYOUT_SCHEMA_VERSION = 1;

window.PARKING_LAYOUTS = Object.freeze({
  /*
  "target_001": {
    schemaVersion: 1,
    facilityId: "target_001",
    canvas: {
      width: 1000,
      height: 700,
      scaleMetersPerPixel: null
    },
    objects: [
      {
        uid: "building_001",
        objectType: "building",
        name: "店舗",
        x: 650,
        y: 80,
        width: 260,
        height: 160,
        rotation: 0
      },
      {
        uid: "entrance_001",
        objectType: "buildingEntrance",
        name: "店舗正面入口",
        entranceType: "main",
        x: 650,
        y: 245,
        rotation: 0,
        publicAccess: true,
        wheelchairAccessible: true,
        guideTarget: true,
        buildingId: "building_001"
      },
      {
        uid: "space_001",
        objectType: "parkingSpace",
        name: "B-01",
        spaceType: "standard",
        x: 160,
        y: 330,
        width: 70,
        height: 130,
        rotation: 0,
        status: "available"
      }
    ]
  }
  */
});
