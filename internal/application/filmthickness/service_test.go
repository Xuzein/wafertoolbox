package filmthickness

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf16"
)

func TestProcessBytesParsesMultipleSlotBlocksAndWritesOutputs(t *testing.T) {
	csvText := "" +
		"Slot Number:,8\n" +
		"Time:,2026-04-23 09:12:00\n" +
		"Lot ID:,D000353.08\n" +
		"Wafer ID:,8\n" +
		"Wafer Recipe:,THK_RECIPE_A\n" +
		"Points Measured:,4\n" +
		"Point,X,Y,Unused,E2\n" +
		"1,-20,-20,x,100.1\n" +
		"2,20,-20,x,101.2\n" +
		"3,-20,20,x,99.8\n" +
		"4,20,20,x,102.0\n" +
		"Slot Number:,9\n" +
		"Time:,2026-04-23 10:12:00\n" +
		"Lot ID:,D000353.08\n" +
		"Wafer ID:,9\n" +
		"Wafer Recipe:,THK_RECIPE_A\n" +
		"Points Measured:,4\n" +
		"Point,X,Y,Unused,E2\n" +
		"1,-20,-20,x,101.1\n" +
		"2,20,-20,x,102.2\n" +
		"3,-20,20,x,100.8\n" +
		"4,20,20,x,103.0\n"

	result, err := ProcessBytes([]byte(csvText), "sample.csv", t.TempDir())
	if err != nil {
		t.Fatalf("ProcessBytes returned error: %v", err)
	}
	if result.WaferCount != 2 {
		t.Fatalf("expected 2 wafers, got %d", result.WaferCount)
	}
	if len(result.Dates) != 1 || result.Dates[0].Date != "2026-04-23" {
		t.Fatalf("unexpected date groups: %#v", result.Dates)
	}
	if _, err := os.Stat(result.SummaryPath); err != nil {
		t.Fatalf("summary file missing: %v", err)
	}
	if len(result.Dates[0].PageImages) != 1 {
		t.Fatalf("expected 1 overview page, got %d", len(result.Dates[0].PageImages))
	}
	for _, wafer := range result.Wafers {
		if _, err := os.Stat(wafer.ImagePath); err != nil {
			t.Fatalf("wafer image missing: %v", err)
		}
		if wafer.E2Avg == 0 || wafer.UniformityPct == 0 {
			t.Fatalf("stats were not calculated: %#v", wafer)
		}
	}
}

func TestProcessBytesAcceptsUTF16LE(t *testing.T) {
	csvText := "" +
		"Slot Number:,1\n" +
		"Time:,2026/04/24 11:12:00\n" +
		"Lot ID:,D000999.01\n" +
		"Wafer ID:,1\n" +
		"Wafer Recipe:,THK_RECIPE_B\n" +
		"Points Measured:,2\n" +
		"Point,X,Y,E2\n" +
		"1,0,0,88.1\n" +
		"2,10,10,89.2\n"
	data := encodeUTF16LE(csvText)

	outputRoot := filepath.Join(t.TempDir(), "wafer_maps")
	result, err := ProcessBytes(data, "sample_utf16.csv", outputRoot)
	if err != nil {
		t.Fatalf("ProcessBytes returned error: %v", err)
	}
	if result.WaferCount != 1 {
		t.Fatalf("expected 1 wafer, got %d", result.WaferCount)
	}
	if result.Wafers[0].Date != "2026-04-24" {
		t.Fatalf("unexpected date: %s", result.Wafers[0].Date)
	}
}

func TestProcessManyBytesCombinesMultipleFiles(t *testing.T) {
	fileA := []byte("" +
		"Slot Number:,1\n" +
		"Time:,2026-04-24 08:00:00\n" +
		"Lot ID:,D000001.01\n" +
		"Wafer ID:,1\n" +
		"Points Measured:,2\n" +
		"Point,X,Y,E2\n" +
		"1,0,0,10\n" +
		"2,10,10,11\n")
	fileB := []byte("" +
		"Slot Number:,2\n" +
		"Time:,2026-04-24 09:00:00\n" +
		"Lot ID:,D000001.02\n" +
		"Wafer ID:,2\n" +
		"Points Measured:,2\n" +
		"Point,X,Y,E2\n" +
		"1,0,0,12\n" +
		"2,10,10,13\n")

	result, err := ProcessManyBytes([]InputFile{
		{SourceName: "a.csv", Data: fileA},
		{SourceName: "b.csv", Data: fileB},
	}, t.TempDir())
	if err != nil {
		t.Fatalf("ProcessManyBytes returned error: %v", err)
	}
	if result.WaferCount != 2 {
		t.Fatalf("expected 2 wafers, got %d", result.WaferCount)
	}
	if len(result.Dates) != 1 || result.Dates[0].WaferCount != 2 {
		t.Fatalf("unexpected date result: %#v", result.Dates)
	}
}

func TestProcessManyBytesSkipsBadFilesAndKeepsGoodFiles(t *testing.T) {
	goodFile := []byte("" +
		"Slot Number:,1\n" +
		"Time:,2026-04-24 08:00:00\n" +
		"Lot ID:,D000001.01\n" +
		"Wafer ID:,1\n" +
		"Points Measured:,2\n" +
		"Point,X,Y,E2\n" +
		"1,0,0,10\n" +
		"2,10,10,11\n")
	badFile := []byte("this,is,not,a,rudolph,file\n")

	result, err := ProcessManyBytes([]InputFile{
		{SourceName: "bad.csv", Data: badFile},
		{SourceName: "good.csv", Data: goodFile},
	}, t.TempDir())
	if err != nil {
		t.Fatalf("ProcessManyBytes returned error: %v", err)
	}
	if result.WaferCount != 1 {
		t.Fatalf("expected 1 wafer, got %d", result.WaferCount)
	}
	if len(result.Warnings) == 0 {
		t.Fatalf("expected warning for skipped bad file")
	}
}

func encodeUTF16LE(text string) []byte {
	codeUnits := utf16.Encode([]rune(text))
	data := make([]byte, len(codeUnits)*2)
	for index, unit := range codeUnits {
		binary.LittleEndian.PutUint16(data[index*2:], unit)
	}
	return data
}
