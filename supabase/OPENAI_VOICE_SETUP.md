# OpenAI Realtime 音声のSupabase設定

このフォルダーは、GitHub PagesからOpenAI Realtime APIを安全に使うためのEdge Functionです。

通常のOpenAI APIキーはブラウザーへ置かず、Supabase Secretとして保存してください。

## 1. OpenAI APIキーをSupabaseへ登録

```bash
supabase secrets set OPENAI_API_KEY=sk-proj-...
```

## 2. Edge Functionをデプロイ

```bash
supabase functions deploy openai-realtime-token
```

`supabase/config.toml` で `verify_jwt = false` にしています。
関数側でGitHub PagesのOriginを確認し、ブラウザーへは短時間有効なephemeral keyだけを返します。

## 3. 利用者画面

既存の `sync-config.js` の `supabaseUrl` を使うため、URLの追加設定は不要です。

OpenAI音声が利用できない場合、利用者アプリは端末標準の読み上げへフォールバックします。
