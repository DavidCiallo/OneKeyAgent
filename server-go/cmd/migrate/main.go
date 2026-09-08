// migrate — one-shot tool importing legacy data/*.jsonl collections into the
// SQLite database (data/onekey.db). Rows keep their ids and timestamps.
//
// Usage: go run ./cmd/migrate [-data ../data] [-db data/onekey.db]
package main

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"onekey/server/internal/store"
)

func main() {
	dataDir := flag.String("data", "../data", "directory containing *.jsonl collections")
	dbPath := flag.String("db", "data/onekey.db", "target SQLite database")
	flag.Parse()

	if err := os.MkdirAll(filepath.Dir(*dbPath), 0o755); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	db, err := store.Open(*dbPath)
	if err != nil {
		fmt.Println("open db:", err)
		os.Exit(1)
	}

	// collection file name → table (Repository lowercases collection names,
	// so the JSONL files on disk are lowercase too).
	collections := []struct {
		file  string
		table string
	}{
		{"account.jsonl", "account"},
		{"model.jsonl", "model"},
		{"provider.jsonl", "provider"},
		{"role.jsonl", "role"},
		{"account_role.jsonl", "account_role"},
		{"settings.jsonl", "settings"},
		{"usage_bucket.jsonl", "usage_bucket"},
		{"gift_card.jsonl", "gift_card"},
		{"transaction.jsonl", "transaction"},
		{"task.jsonl", "task"},
		{"session_reasoning.jsonl", "session_reasoning"},
	}

	for _, c := range collections {
		path := filepath.Join(*dataDir, c.file)
		if _, err := os.Stat(path); err != nil {
			fmt.Printf("skip %-24s (not found)\n", c.file)
			continue
		}
		n, err := importFile(db, c.table, path)
		if err != nil {
			fmt.Printf("FAIL %-24s %v\n", c.file, err)
			os.Exit(1)
		}
		fmt.Printf("ok   %-24s %d rows\n", c.file, n)
	}
	fmt.Println("migration complete")
}

func importFile(db *sql.DB, table, path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	var rows []map[string]any
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 64*1024*1024)
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var row map[string]any
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			fmt.Printf("  warn: %s:%d bad json skipped (%v)\n", filepath.Base(path), lineNo, err)
			continue
		}
		rows = append(rows, row)
	}
	if err := scanner.Err(); err != nil {
		return 0, err
	}
	return store.BatchInsertRows(db, table, rows)
}
