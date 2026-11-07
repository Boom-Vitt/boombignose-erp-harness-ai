package localai

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/raster"
)

func imageMIME(b []byte) string {
	switch {
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case len(b) >= 3 && b[0] == 255 && b[1] == 216 && b[2] == 255:
		return "image/jpeg"
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return "image/webp"
	}
	return ""
}

type limitedOutput struct {
	bytes.Buffer
	max int
}

func (b *limitedOutput) Write(p []byte) (int, error) {
	if len(p) > b.max-b.Len() {
		return 0, errors.New("raster output limit")
	}
	return b.Buffer.Write(p)
}

// ValidateRaster fully decodes in the existing data-only helper process. Its
// protocol is an unsigned big-endian uint64 byte count followed by the exact
// original raster and EOF; there are no flags or filenames. No decoding occurs
// in the application process, and no missing-helper fallback is permitted.
func (p *Provider) ValidateRaster(ctx context.Context, b []byte, mime string) error {
	if err := ctx.Err(); err != nil {
		return contextError(err)
	}
	if len(b) == 0 || len(b) > raster.MaxBytes {
		return problem(413, "invalid_document", "Page raster must contain at most 3 MiB.")
	}
	actual := imageMIME(b)
	if actual == "" || actual != mime {
		return problem(415, "invalid_document", "Use valid JPEG, PNG or WebP bytes with their matching MIME type.")
	}
	if p.rasterExecutable == "" {
		return problem(503, "service_unavailable", "Native raster validation is unavailable. No image was sent for inference.")
	}
	select {
	case p.decoders <- struct{}{}:
		defer func() { <-p.decoders }()
	default:
		return problem(503, "service_unavailable", "Native raster validation is busy. No image was sent for inference.")
	}
	childCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var frame [8]byte
	binary.BigEndian.PutUint64(frame[:], uint64(len(b)))
	cmd := exec.CommandContext(childCtx, p.rasterExecutable)
	cmd.Env = []string{"GOMAXPROCS=1", "GOMEMLIMIT=96MiB"}
	cmd.Stdin = io.MultiReader(bytes.NewReader(frame[:]), bytes.NewReader(b))
	out := &limitedOutput{max: 512}
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	cmd.WaitDelay = time.Second
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return contextError(ctx.Err())
		}
		return problem(503, "service_unavailable", "Native raster validation is unavailable or timed out. No image was sent for inference.")
	}
	var data map[string]json.RawMessage
	if strictJSON(out.Bytes(), &data) != nil {
		return problem(503, "service_unavailable", "The native raster validator returned an invalid response.")
	}
	var result raster.Result
	if json.Unmarshal(out.Bytes(), &result) != nil {
		return problem(503, "service_unavailable", "The native raster validator returned an invalid response.")
	}
	if !result.OK {
		if len(data) == 2 && data["ok"] != nil && data["code"] != nil && contains([]string{"size", "unsupported", "corrupt", "animated", "dimensions"}, result.Code) {
			return problem(400, "invalid_document", "Corrupt, animated or over-limit image. Use a single page up to 4 million pixels and 2400 pixels per edge.")
		}
		return problem(503, "service_unavailable", "The native raster validator could not validate this image.")
	}
	if len(data) != 4 || data["ok"] == nil || data["mime"] == nil || data["width"] == nil || data["height"] == nil || result.MIME != mime || result.Width < 1 || result.Height < 1 || result.Width > raster.MaxEdge || result.Height > raster.MaxEdge || result.Width > raster.MaxPixels/result.Height {
		return problem(503, "service_unavailable", "The native raster validator returned invalid dimensions.")
	}
	return nil
}
