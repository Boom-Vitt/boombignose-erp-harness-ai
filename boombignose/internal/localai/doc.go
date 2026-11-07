// Package localai owns local inference and request-local source-grounded chat.
//
// Integration: construct exactly one shared Provider with NewProvider(Config),
// then NewService(provider, authorizedReadOnlyToolRunner). Chat accepts the
// frozen erpwire.ChatRequest/ChatReply contract. DecodeChatRequest supplies strict
// bounded JSON decoding for HTTP routers. GenerateText also ports the internal
// one-shot draft client; callers own authentication/domain parsing/human review.
// It is not an evidence-certified ERP answer or a public read/write endpoint and
// uses the same shared provider. Guidance scope never
// calls ToolRunner.Specs or ToolRunner.Call. ERP scope requires fresh successful
// business evidence each turn; catalog metadata cannot satisfy that transition.
// Every ERP call is made with the caller's immutable Actor, never model-supplied
// identity. The injected reader must perform live membership/MFA/RLS checks on
// each call. The router owns live authentication, CSRF/origin checks and headers.
//
// Config.Redact accepts trusted static native secret policy; WithRedactor adds
// per-request bearer/refresh protection to the same provider via context. These
// concurrency-safe deterministic/idempotent callbacks are never serialized or
// logged. Preserve originals in caller/request ownership: only model-facing
// views are redacted. Tool JSON is parsed structurally; changed actual ranges
// retain original_slice_sha256 separately from visible text_sha256, and source/
// coverage partial state plus application warnings track the projection. Only
// visible read bytes enter the quote map. Protected final model output is
// rejected, never repaired into accepted source evidence. No literal text
// callback claims to redact raster pixels; opaque image bytes are unchanged.
//
// One cancellation-aware inference gate belongs to the shared Provider and is
// released before calling any ERP/document tool. The same provider must be
// supplied to the native stored-image adapter to avoid a second model service.
// Chat verifies local GGUF completion/vision metadata and sends runner=llamacpp,
// num_ctx=32768, truncate=false and shift=false. Bounded single-raster OCR keeps
// the installed GGUF or safetensors vision checkpoint and requested num_ctx=16384;
// it does not claim MLX enforces a hard context bound. Metadata verification is
// not inference/quality proof: runtime acceptance must exercise actual backends.
// There is no automatic pull, cloud proxy, retry, history eviction, downgrade or
// Node runtime.
//
// OCRHTTP accepts the existing /api/ocr/page raw raster body and Content-Type,
// x-ocr-page, x-ocr-pages, x-ocr-source-sha256 headers, returning OCRPage JSON.
// Browser PDF.js retains the sequential original-PDF-to-page workflow: source
// file/aggregate pixel limits remain browser-owned; each page enforces 3 MiB,
// 4 million pixels, 2400px/edge, at most twelve page references, a 15s upload,
// five-second/two-concurrent native decoder and 240s OCR deadline. HTTP OCR
// admits one page at a time (429 busy) while both model paths share one gate.
// RecognizePage is the equivalent byte-oriented API. ExtractImageText is the
// authorized native stored-image adapter: the caller must supply authorized
// immutable original bytes and their expected SHA-256, which is checked before
// decoding. It does not fetch paths/URLs or pretend to read stored PDFs. The
// data-only boombignose-image helper path is explicit and absolute. Missing
// helper makes raster operations unavailable, not otherwise configured chat.
// All transcription is unverified and review-only; unknown field pointers are
// serialized as JSON null and exact integer satang never travels through float.
// OCRPage textSha256 identifies visible transcription bytes. If redacted,
// originalTranscriptionSha256 identifies the unverified pre-redaction model
// transcription, not verified original-file text. sourceSha256/rasterSha256
// always retain their actual file/raster identity; partial/redacted/warnings
// explicitly identify the visible transcription view.
//
// Local documents live only for the duration of Chat. Full originals, Unicode
// UTF-16-safe ranges, hashes, coverage and original/range identities are kept
// separate from metadata/search previews. Only materialized contiguous ranges
// enter the quote map. Historical generated assistant prose never enters it.
// Accepted user inline text beyond a single bounded range is registered without
// replacing its original history content. Request input limits stay unchanged.
// ERP source/fact/coverage IDs are remapped together; current-turn membership,
// exact quotes, server-owned review codes and numeric prose are independently
// checked even if the backend ignores its JSON schema. Monetary values and
// mandatory receivables coverage are rendered by application code. Thai word
// boundaries use a pinned, licensed ICU dictionary and bounded pure-Go dynamic
// segmentation, not substrings or exceptions; see THIRD-PARTY-NOTICES.txt.
//
// ErrorResponse maps safe package Error values to {error,code} and HTTP status.
// Codes: invalid_request/invalid_document (400,413,415 as appropriate), busy
// (429), upload_timeout (408), missing_model/model_not_allowed/
// local_model_unavailable/source_changed (409), context_overflow/unreadable_page
// or incomplete inference (422), cancelled (499), timeout (504), unavailable
// native/model/read catalog (503), and independently rejected model/source
// results (502). Authentication and live store errors remain parent-owned.
// For the existing browser's installation banner, a router may project model
// configuration errors into {notConfigured:true,message:err.Error()}; OCR keeps
// its ordinary {error,code} shape. Never return raw backend/source error text.
package localai
