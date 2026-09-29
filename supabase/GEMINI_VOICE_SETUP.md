# Gemini Live 無料音声のSupabase設定

この構成は、Gemini 3.8 Live の無料枠を利用するためのものです。

通常のGemini APIキーはGitHub Pagesへ置かず、Supabase Secretとして保存します。
ブラウザーには短時間だけ有効なephemeral tokenだけを渡します。

## 1. Google AI Studioで無料のGemini APIキーを作成

Google AI StudioのAPI key画面でFree TierのAPIキーを作成します。
無料運用を続ける場合は、課金を有効化しないFree Tierプロジェクトを使用してください。

## 2. Supabase Secretへ登録

```bash
supabase secrets set GEMINI_API_KEY=AIza...
```

## 3. Edge Functionをデプロイ

```bash
supabase functions deploy gemini-live-token --no-verify-jwt
```

利用者画面は既存の `sync-config.js` にある `supabaseUrl` を使います。

## 無料枠の注意

Gemini 3.8 Liveには無料枠がありますが、レート上限があります。
Free Tierで送信したコンテンツはGoogleのサービス改善に利用される場合があります。
研究で個人情報・機密情報を入力しない運用にしてください。

## 音声データ

- 通常の「音声で案内」：案内文をGemini APIへ送信
- 「AIアシスタント」：起動中だけマイクを使用し、会話音声をGemini APIへ送信
- AIアシスタントを使わない場合はマイクを取得しません
