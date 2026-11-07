// Package raster validates still OCR rasters without changing their pixels.
package raster

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"

	"golang.org/x/image/vp8"
	"golang.org/x/image/vp8l"
	_ "golang.org/x/image/webp"
)

const (
	MaxBytes  = 3 * 1024 * 1024
	MaxPixels = 4_000_000
	MaxEdge   = 2400
)

// Result is the complete, deliberately data-free wire response.
type Result struct {
	OK     bool   `json:"ok"`
	Code   string `json:"code,omitempty"`
	MIME   string `json:"mime,omitempty"`
	Width  int    `json:"width,omitempty"`
	Height int    `json:"height,omitempty"`
}

func failure(code string) Result { return Result{Code: code} }

func allowedSize(w, h int) bool {
	return w > 0 && h > 0 && w <= MaxEdge && h <= MaxEdge && w <= MaxPixels/h
}

// Serve accepts exactly one unsigned big-endian length-prefixed image. The
// input allocation is exact and occurs only after checking the unsigned limit.
// Its caller supplies stdin/stdout; no file paths or operating environment enter
// the decoding package.
func Serve(in io.Reader, out io.Writer) error {
	return json.NewEncoder(out).Encode(readFrame(in))
}

func readFrame(in io.Reader) Result {
	var header [8]byte
	if _, err := io.ReadFull(in, header[:]); err != nil {
		return failure("framing")
	}
	n := binary.BigEndian.Uint64(header[:])
	if n == 0 || n > MaxBytes {
		return failure("size")
	}
	data := make([]byte, int(n))
	if _, err := io.ReadFull(in, data); err != nil {
		return failure("framing")
	}
	var extra [1]byte
	if n, err := io.ReadFull(in, extra[:]); n != 0 || err != io.EOF {
		return failure("framing")
	}
	return Validate(data)
}

// Validate checks encoded structure and dimensions before allocating a decoded
// bitmap, then fully decodes and checks the actual bounds. Decoder failures are
// intentionally not exposed across the process boundary.
func Validate(data []byte) Result {
	if len(data) == 0 || len(data) > MaxBytes {
		return failure("size")
	}
	var mime, code string
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		mime, code = "image/png", checkPNG(data)
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		mime = "image/jpeg"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		mime, code = "image/webp", checkWebP(data)
	default:
		return failure("unsupported")
	}
	if code != "" {
		return failure(code)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || "image/"+format != mime {
		return failure("corrupt")
	}
	if !allowedSize(config.Width, config.Height) {
		return failure("dimensions")
	}
	decoded, actualFormat, err := image.Decode(bytes.NewReader(data))
	if err != nil || actualFormat != format {
		return failure("corrupt")
	}
	bounds := decoded.Bounds()
	if !allowedSize(bounds.Dx(), bounds.Dy()) {
		return failure("dimensions")
	}
	if bounds.Dx() != config.Width || bounds.Dy() != config.Height {
		return failure("corrupt")
	}
	return Result{OK: true, MIME: mime, Width: bounds.Dx(), Height: bounds.Dy()}
}

func checkPNG(data []byte) string {
	for at := 8; ; {
		if len(data)-at < 12 {
			return "corrupt"
		}
		n := uint64(binary.BigEndian.Uint32(data[at : at+4]))
		if n > uint64(len(data)-at-12) {
			return "corrupt"
		}
		end := at + 8 + int(n)
		kind := string(data[at+4 : at+8])
		if kind == "acTL" || kind == "fcTL" || kind == "fdAT" {
			return "animated"
		}
		if crc32.ChecksumIEEE(data[at+4:end]) != binary.BigEndian.Uint32(data[end:end+4]) {
			return "corrupt"
		}
		if kind == "IEND" {
			if n != 0 || end+4 != len(data) {
				return "corrupt"
			}
			return ""
		}
		at = end + 4
	}
}

func checkWebP(data []byte) string {
	if uint64(binary.LittleEndian.Uint32(data[4:8]))+8 != uint64(len(data)) {
		return "corrupt"
	}
	canvasW, canvasH, imageW, imageH := 0, 0, 0, 0
	seenCanvas, seenImage, seenAlpha := false, false, false
	for at := 12; at < len(data); {
		if len(data)-at < 8 {
			return "corrupt"
		}
		n := uint64(binary.LittleEndian.Uint32(data[at+4 : at+8]))
		padded := n + (n & 1)
		if padded > uint64(len(data)-at-8) {
			return "corrupt"
		}
		chunk := data[at+8 : at+8+int(n)]
		switch string(data[at : at+4]) {
		case "ANIM", "ANMF":
			return "animated"
		case "VP8X":
			if at != 12 || seenCanvas || len(chunk) != 10 {
				return "corrupt"
			}
			if chunk[0]&2 != 0 {
				return "animated"
			}
			if chunk[0]&0xc1 != 0 || chunk[1] != 0 || chunk[2] != 0 || chunk[3] != 0 {
				return "corrupt"
			}
			canvasW = 1 + int(chunk[4]) + int(chunk[5])<<8 + int(chunk[6])<<16
			canvasH = 1 + int(chunk[7]) + int(chunk[8])<<8 + int(chunk[9])<<16
			if !allowedSize(canvasW, canvasH) {
				return "dimensions"
			}
			seenCanvas = true
		case "ALPH":
			if !seenCanvas || seenImage || seenAlpha || len(chunk) < 1 || chunk[0]&0xc0 != 0 || chunk[0]&3 > 1 {
				return "corrupt"
			}
			seenAlpha = true
		case "VP8 ":
			if seenImage {
				return "corrupt"
			}
			d := vp8.NewDecoder()
			d.Init(bytes.NewReader(chunk), len(chunk))
			fh, err := d.DecodeFrameHeader()
			if err != nil || !fh.KeyFrame {
				return "corrupt"
			}
			imageW, imageH, seenImage = fh.Width, fh.Height, true
		case "VP8L":
			if seenImage || seenAlpha {
				return "corrupt"
			}
			config, err := vp8l.DecodeConfig(bytes.NewReader(chunk))
			if err != nil {
				return "corrupt"
			}
			imageW, imageH, seenImage = config.Width, config.Height, true
		}
		// WebP DecodeConfig can return just the VP8X canvas. Independently
		// inspect the real VP8/VP8L header before any full/alpha decoding.
		if seenImage && !allowedSize(imageW, imageH) {
			return "dimensions"
		}
		at += 8 + int(padded)
	}
	if !seenImage || (seenCanvas && (canvasW != imageW || canvasH != imageH)) {
		return "corrupt"
	}
	return ""
}
