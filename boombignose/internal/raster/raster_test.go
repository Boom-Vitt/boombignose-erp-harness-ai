package raster

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"image"
	"image/jpeg"
	"image/png"
	"testing"
)

func pngImage(t *testing.T, w, h int) []byte {
	t.Helper()
	var out bytes.Buffer
	if err := png.Encode(&out, image.NewGray(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestDecodeStillImagesAndLimits(t *testing.T) {
	for _, size := range [][2]int{{1, 1}, {2400, 1}, {2000, 2000}} {
		got := Validate(pngImage(t, size[0], size[1]))
		if !got.OK || got.Width != size[0] || got.Height != size[1] || got.MIME != "image/png" {
			t.Fatalf("PNG %v: %+v", size, got)
		}
	}
	var jpegBytes bytes.Buffer
	if err := jpeg.Encode(&jpegBytes, image.NewGray(image.Rect(0, 0, 32, 24)), nil); err != nil {
		t.Fatal(err)
	}
	if got := Validate(jpegBytes.Bytes()); !got.OK || got.MIME != "image/jpeg" || got.Width != 32 || got.Height != 24 {
		t.Fatalf("JPEG: %+v", got)
	}
	for _, size := range [][2]int{{2401, 1}, {2000, 2001}} {
		if got := Validate(pngImage(t, size[0], size[1])); got.Code != "dimensions" {
			t.Fatalf("size %v: %+v", size, got)
		}
	}
}

func pngChunk(kind string, payload []byte) []byte {
	chunk := make([]byte, 12+len(payload))
	binary.BigEndian.PutUint32(chunk, uint32(len(payload)))
	copy(chunk[4:], kind)
	copy(chunk[8:], payload)
	binary.BigEndian.PutUint32(chunk[len(chunk)-4:], crc32.ChecksumIEEE(chunk[4:len(chunk)-4]))
	return chunk
}

func TestPNGCorruptionAndAnimation(t *testing.T) {
	valid := pngImage(t, 3, 2)
	corrupt := bytes.Clone(valid)
	corrupt[len(corrupt)-5] ^= 1
	animation := append(bytes.Clone(valid[:33]), pngChunk("acTL", make([]byte, 8))...)
	animation = append(animation, valid[33:]...)
	overflow := append(bytes.Clone(valid[:33]), []byte{255, 255, 255, 255, 'I', 'D', 'A', 'T', 0, 0, 0, 0}...)
	for _, item := range []struct {
		data []byte
		code string
	}{
		{valid[:len(valid)-1], "corrupt"}, {corrupt, "corrupt"}, {animation, "animated"}, {overflow, "corrupt"}, {append(bytes.Clone(valid), 0), "corrupt"},
	} {
		if got := Validate(item.data); got.Code != item.code {
			t.Fatalf("want %s: %+v", item.code, got)
		}
	}
	// Preserve every chunk CRC and valid dimensions while destroying the zlib
	// stream, so a header-only implementation would incorrectly accept it.
	badPixels := bytes.Clone(valid)
	for at := 8; at+12 <= len(badPixels); {
		n := int(binary.BigEndian.Uint32(badPixels[at : at+4]))
		end := at + 8 + n
		if string(badPixels[at+4:at+8]) == "IDAT" && n > 0 {
			badPixels[at+8] = 0
			binary.BigEndian.PutUint32(badPixels[end:end+4], crc32.ChecksumIEEE(badPixels[at+4:end]))
			break
		}
		at = end + 4
	}
	if got := Validate(badPixels); got.Code != "corrupt" {
		t.Fatalf("invalid pixels with valid headers: %+v", got)
	}
}

func webpChunk(kind string, payload []byte) []byte {
	chunk := make([]byte, 8+len(payload)+(len(payload)&1))
	copy(chunk, kind)
	binary.LittleEndian.PutUint32(chunk[4:], uint32(len(payload)))
	copy(chunk[8:], payload)
	return chunk
}

func webpFile(chunks ...[]byte) []byte {
	data := []byte("RIFF\x00\x00\x00\x00WEBP")
	for _, chunk := range chunks {
		data = append(data, chunk...)
	}
	binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
	return data
}

func TestWebPAnimationChunkBoundsAndHiddenDimensions(t *testing.T) {
	canvas := webpChunk("VP8X", make([]byte, 10)) // advertises 1x1
	largeLossless := make([]byte, 5)
	largeLossless[0] = 0x2f
	binary.LittleEndian.PutUint32(largeLossless[1:], uint32(2400)) // actual width 2401
	largeLossy := []byte{0x10, 0, 0, 0x9d, 1, 0x2a, 0x61, 9, 1, 0} // actual width 2401
	animatedCanvas := bytes.Clone(canvas)
	animatedCanvas[8] = 2
	badLength := webpFile(webpChunk("VP8L", largeLossless))
	binary.LittleEndian.PutUint32(badLength[16:], ^uint32(0))
	for _, item := range []struct {
		data []byte
		code string
	}{
		{webpFile(animatedCanvas), "animated"},
		{webpFile(canvas, webpChunk("ANIM", make([]byte, 6))), "animated"},
		{webpFile(canvas, webpChunk("ANMF", nil)), "animated"},
		{webpFile(canvas, webpChunk("VP8L", largeLossless)), "dimensions"},
		{webpFile(canvas, webpChunk("VP8 ", largeLossy)), "dimensions"},
		{badLength, "corrupt"},
	} {
		if got := Validate(item.data); got.Code != item.code {
			t.Fatalf("want %s: %+v", item.code, got)
		}
	}
}

func TestStrictInputFraming(t *testing.T) {
	valid := pngImage(t, 2, 2)
	frame := func(n uint64, body []byte) []byte {
		header := make([]byte, 8)
		binary.BigEndian.PutUint64(header, n)
		return append(header, body...)
	}
	for _, item := range []struct {
		input []byte
		code  string
	}{
		{nil, "framing"}, {make([]byte, 7), "framing"}, {frame(0, nil), "size"},
		{frame(^uint64(0), nil), "size"}, {frame(MaxBytes+1, nil), "size"},
		{frame(uint64(len(valid)+1), valid), "framing"},
		{frame(uint64(len(valid)), append(bytes.Clone(valid), 1)), "framing"},
		{frame(uint64(len(valid)), valid), ""},
	} {
		var output bytes.Buffer
		if err := Serve(bytes.NewReader(item.input), &output); err != nil {
			t.Fatal(err)
		}
		if output.Len() > 128 {
			t.Fatal("unbounded response")
		}
		var result Result
		if err := json.Unmarshal(output.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Code != item.code || result.OK != (item.code == "") {
			t.Fatalf("want %q: %+v", item.code, result)
		}
	}
}
