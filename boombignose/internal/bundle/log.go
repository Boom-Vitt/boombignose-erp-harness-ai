package bundle

import (
	"bytes"
	"io"
	"strings"
	"sync"
)

// Service output is line-buffered so a credential split across Write calls is
// still redacted before it reaches disk. Oversized lines are discarded, not
// flushed unredacted. No raw service log is returned to the GUI or CLI.
type privateLog struct {
	sync.Mutex
	out        io.Writer
	secrets    []string
	pending    []byte
	discarding bool
}

func (log *privateLog) Write(body []byte) (int, error) {
	log.Lock()
	defer log.Unlock()
	size := len(body)
	for len(body) > 0 {
		end := bytes.IndexByte(body, '\n')
		chunk := body
		if end >= 0 {
			chunk = body[:end+1]
		}
		if !log.discarding {
			if len(log.pending)+len(chunk) > 1<<20 {
				log.pending = nil
				log.discarding = true
			} else {
				log.pending = append(log.pending, chunk...)
			}
		}
		if end < 0 {
			break
		}
		if !log.discarding {
			text := string(log.pending)
			for _, secret := range log.secrets {
				if secret != "" {
					text = strings.ReplaceAll(text, secret, "[redacted]")
				}
			}
			if _, err := io.WriteString(log.out, text); err != nil {
				return 0, err
			}
		}
		log.pending = log.pending[:0]
		log.discarding = false
		body = body[end+1:]
	}
	return size, nil
}
func redactedServiceLog(out io.Writer, env []string) io.Writer {
	secrets := []string{passwordFor(pgAddr(), "boombignose"), passwordFor(pgAddr(), "boombignose_auth"), passwordFor(pgAddr(), "boombignose_rest")}
	for _, item := range env {
		if value, ok := strings.CutPrefix(item, "GOTRUE_JWT_SECRET="); ok {
			secrets = append(secrets, value)
		}
		if value, ok := strings.CutPrefix(item, "PGRST_JWT_SECRET="); ok {
			secrets = append(secrets, value)
		}
	}
	return &privateLog{out: out, secrets: secrets}
}
