# 利用者アプリのコード案内

## 最初に読むファイル

| ファイル | 役割 |
| --- | --- |
| `index.html` | 画面の要素とスクリプトの読み込み順 |
| `app.js` | 施設選択、条件指定、区画検索、画面遷移、音声案内の制御 |
| `facilities.js` / `parking-layouts.js` | 施設一覧と配置図データ |
| `live-status.js` | クラウドの区画状態と情報の鮮度の確認 |
| `location-safety.js` | 現在地と運転中の操作制限 |
| `map-display.js` / `map-display.css` | 駐車場マップの表示 |
| `facility-operations.js` | 営業時間・休業日の判定 |
| `camera-view.js` | 施設のカメラ写真の取得・表示 |
| `user-experience.js` / `user-experience.css` | 案内の優先表示、設定・補足の整理 |
| `styles.css` / `experience.css` | 基本スタイルと画面の調整 |

## 音声とオフライン動作

| ファイル | 役割 |
| --- | --- |
| `voice-guide-scripts.js` | 案内文の組み立て |
| `voice-guide-playback.js` / `voice-continuous-playback.js` | 分割音声・連続音声の再生補助 |
| `voice-audio-cache.js` | 音声ファイルの準備と保存 |
| `speech-readings.js` | 店舗名などの読み方 |
| `voice-test-scenarios.js` | 音声テストのシナリオ |
| `recorded-demo.html` / `recorded-demo.js` | 保存した録画データを使う独立した実演画面 |
| `pwa.js` / `service-worker.js` / `manifest.webmanifest` | インストール、更新、オフラインキャッシュ |
| `sync-config.js` | 公開クライアントの接続設定 |

スクリプトはES Modulesではなく、HTMLから順に読み込む構成です。`state`や公開された関数を別ファイルから参照するため、ファイル内に呼び出しがないだけでは削除できません。`map-display.js`などは管理者アプリにも存在しますが、両アプリが単独で公開できるよう保持しています。

## 変更後の確認

```sh
node scripts/check-source.cjs
node --test tests/*.test.cjs
node tests/ui-refinement-browser.cjs
```

最後のコマンドはPlaywrightとChromiumが必要です。GitHub Actionsでは準備から実行します。`check-source.cjs`はGit管理下の全JavaScript・JSON・Web Manifestを検査します。新しいファイルも検査する場合は先に`git add`してください。

公開ファイルを変更したら、`index.html`のURLと`service-worker.js`の`SHELL_FILES`を揃え、`VERSION`も更新してください。施設データや保存データのキーは、名前の整理だけを理由に変更しないでください。

## 2026-11-12の整理

- 読み込み元のない`recorded-demo-link.js`とCSS、およびその専用表示処理を削除。独立した録画実演ページは維持。
- 廃止した進行番号のDOM更新処理とCSSを削除。画面名の検証に使う`SCREEN_ORDER`は維持。
- 「音声を試す」の重複翻訳キーを削除し、従来実際に使われていた`Test voice`を維持。
- 未使用の定数・テスト変数を削除。カメラ表示と案内文処理を整形。

確認は静的解析と自動テストです。全コードに問題がないことや、実端末のGPS・Bluetoothでの動作を保証するものではありません。
