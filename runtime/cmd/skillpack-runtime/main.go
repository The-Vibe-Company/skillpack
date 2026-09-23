package main

import (
	"os"

	runtime "github.com/The-Vibe-Company/skillpack/runtime/internal/runtime"
)

func main() {
	os.Exit(runtime.Run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}
