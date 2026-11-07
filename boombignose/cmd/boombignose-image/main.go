// boombignose-image validates a single framed raster on stdin. It has no
// flags, configuration, filesystem, network, database or desktop dependencies.
package main

import (
	"os"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/raster"
)

func main() {
	if err := raster.Serve(os.Stdin, os.Stdout); err != nil {
		os.Exit(1)
	}
}
