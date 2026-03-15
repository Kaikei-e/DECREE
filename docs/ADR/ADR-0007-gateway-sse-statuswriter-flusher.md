# ADR-0007: Gateway SSE 500 エラー修正 — statusWriter に http.Flusher を委譲

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

DECREE Eye のプロジェクト詳細ページ (`/projects/[projectId]`) にアクセスするとページが応答しなくなる障害が発生した。調査の結果、以下の因果関係が判明した:

1. **Gateway の SSE エンドポイント `GET /api/events` が 500 を返す** — レスポンスボディは `"streaming unsupported"`
2. **Eye が SSE 接続失敗後に再接続ループに入る** — `EventSource` の自動再接続がブラウザのメインスレッドをブロックし、ページ全体が無応答になる

根本原因は `loggingMiddleware` の `statusWriter` ラッパーにある。Go の `net/http` では `http.ResponseWriter` を別の struct でラップすると、元の ResponseWriter が実装していたオプショナルインターフェース（`http.Flusher`, `http.Hijacker` 等）が隠蔽される。SSE ハンドラー内の `w.(http.Flusher)` 型アサーションが失敗し、500 エラーとなっていた。

これは Go の ResponseWriter ラッパーにおける既知のパターンで、多くの HTTP ミドルウェアライブラリで同様の問題と修正が報告されている。

## 決定事項

`statusWriter` に `Flush()` メソッドを追加し、内部の `ResponseWriter` が `http.Flusher` を実装していれば委譲する。これにより `statusWriter` 自体が `http.Flusher` インターフェースを満たし、SSE ハンドラーの型アサーションが成功する。

## 実装の概要

### 変更ファイル

**`services/gateway/internal/api/middleware.go`**

`statusWriter` に `Flush()` メソッドを追加:

```go
func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
```

既存の `Unwrap()` メソッドと合わせて、`statusWriter` は以下のインターフェースを満たす:

- `http.ResponseWriter`（埋め込みによる暗黙の実装）
- `http.Flusher`（`Flush()` メソッドの追加）
- `Unwrap() http.ResponseWriter`（`http.NewResponseController` による自動アンラップ対応）

**`services/gateway/internal/api/router_test.go`**

`TestSSEThroughMiddleware` テストを追加。ミドルウェアチェーン（recovery → logging → CORS）を経由して SSE エンドポイントにアクセスし、500 ではなく 200 + `text/event-stream` が返ることを検証する。

### データフロー（修正後）

```
Eye (EventSource) → Gateway middleware chain → statusWriter (now implements Flusher)
                                                    ↓
                                              SSE Handler
                                              w.(http.Flusher) ✓ 成功
                                                    ↓
                                              200 + text/event-stream
                                              heartbeat / event streaming
```

### 影響範囲

- **データモデル:** 変更なし
- **Atlas migration:** 変更なし
- **API エンドポイント:** `GET /api/events` の動作修正（仕様変更なし）
- **Redis Streams:** 変更なし
- **リアルタイムモニタリング:** SSE 接続が正常に確立されるようになり、Eye がリアルタイムイベントを受信可能になる

## 代替案

### 代替案 1: ミドルウェアチェーンから SSE パスを除外する

SSE エンドポイントを `loggingMiddleware` の前に直接マウントし、ラッパーを経由しないようにする方法。却下理由: SSE リクエストのログが残らなくなり、運用時のデバッグが困難になる。また、今後別のオプショナルインターフェースが必要になった場合に同じ問題が再発する。

### 代替案 2: `http.NewResponseController` に統一する

Go 1.20 で導入された `http.NewResponseController` は `Unwrap()` を辿って元の ResponseWriter の機能にアクセスできる。SSE ハンドラー側で `rc.Flush()` を使う方法。却下理由: SSE ハンドラーの実装は標準的なパターン（`w.(http.Flusher)` の型アサーション）に従っており、ミドルウェア側で対応するのが Go コミュニティの慣習に合致する。また、将来他の箇所でも Flusher が必要になった場合に毎回 SSE ハンドラー側を修正する必要がなくなる。

### 代替案 3: 汎用的な ResponseWriter ラッパーライブラリを導入する

`httpsnoop` 等のライブラリを使い、全オプショナルインターフェースを自動的に委譲する方法。却下理由: 現時点で必要なのは `http.Flusher` のみであり、外部依存の追加は過剰。必要になった時点で検討する。

## 影響・トレードオフ

### メリット

- SSE 接続が正常に確立され、Eye のプロジェクト詳細ページが応答するようになる
- ログミドルウェアが SSE リクエストも含めて全リクエストを記録し続ける
- テストにより、ミドルウェアチェーン経由の SSE 動作が回帰テストで保護される

### デメリット・リスク

- `statusWriter` に今後 `http.Hijacker` 等の他のオプショナルインターフェースが必要になった場合、同様のメソッド追加が必要になる。ただし現時点では WebSocket を使用していないため不要

### パフォーマンスへの影響

なし。`Flush()` メソッドは元の ResponseWriter への単純な委譲であり、オーバーヘッドは無視できる。

## 今後の課題

- Eye 側の SSE 再接続ロジックにバックオフ戦略を導入する（現在は即時再接続のためサーバー障害時にリクエストが集中する可能性がある）
- Gateway で WebSocket 対応が必要になった場合、`statusWriter` に `http.Hijacker` の委譲を追加する

## 関連するADR

- ADR-0006: Eye HUD/CIC デザインシステム — Eye のプロジェクト詳細ページを含む UI 実装
