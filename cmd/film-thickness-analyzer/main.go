package main

import (
	"flag"
	"fmt"
	"os"

	"waferbox/internal/application/filmthickness"
)

func main() {
	inputPath := flag.String("input", "", "Rudolph film thickness CSV path")
	outputRoot := flag.String("output", "", "output root directory, default is ~/Downloads/wafer_maps")
	flag.Parse()

	if *inputPath == "" && flag.NArg() > 0 {
		*inputPath = flag.Arg(0)
	}
	if *inputPath == "" {
		fmt.Fprintln(os.Stderr, "usage: film-thickness-analyzer -input input.csv -output tmp/wafer_maps")
		os.Exit(2)
	}

	result, err := filmthickness.ProcessFile(*inputPath, *outputRoot)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}

	fmt.Println("Film Thickness")
	fmt.Println("Output root:", result.OutputRoot)
	fmt.Println("Summary:", result.SummaryPath)
	fmt.Println("Wafers:", result.WaferCount)
	for _, date := range result.Dates {
		fmt.Printf("- %s: %d wafers, %d overview pages\n", date.Date, date.WaferCount, len(date.PageImages))
	}
	if len(result.Warnings) > 0 {
		fmt.Println("Warnings:")
		for _, warning := range result.Warnings {
			fmt.Println("-", warning)
		}
	}
}
