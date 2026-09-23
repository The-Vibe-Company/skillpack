package runtime

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegisterInventoryMergesCanonicalPath(t *testing.T) {
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "official", "example")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(skillDir, alias); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	store, err := OpenStore(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	inventory := Inventory{
		SchemaVersion: 1,
		Origins:       []string{"https://skillpack.app"},
		Skills: []InventorySkill{{
			Path:    alias,
			SkillID: "11111111-1111-4111-8111-111111111111",
			Version: "1.2.3",
			Origin:  "https://skillpack.app",
		}},
	}
	if _, err := store.RegisterInventory(inventory); err != nil {
		t.Fatal(err)
	}

	got, ok, err := store.ResolveSkill(skillDir)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || got.SkillID != inventory.Skills[0].SkillID {
		t.Fatalf("resolved skill = %#v, ok=%v", got, ok)
	}
	fileSkill, ok, err := store.ResolveSkill(filepath.Join(skillDir, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !ok || fileSkill.SkillID != inventory.Skills[0].SkillID {
		t.Fatalf("resolved file skill = %#v, ok=%v", fileSkill, ok)
	}

	data, err := json.Marshal(inventory)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 {
		t.Fatal("inventory unexpectedly empty")
	}
}

func TestRegisterInventoryKeepsSameSkillIDAcrossInstallationsAndPartialRefreshes(t *testing.T) {
	stateDir := t.TempDir()
	root := t.TempDir()
	projectSkill := filepath.Join(root, "project", "shared-skill")
	globalSkill := filepath.Join(root, "global", "shared-skill")
	for _, path := range []string{projectSkill, globalSkill} {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	alias := filepath.Join(root, "alias")
	if err := os.Symlink(projectSkill, alias); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	store, err := OpenStore(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	const skillID = "11111111-1111-4111-8111-111111111111"
	const origin = "https://skillpack.app"
	if count, err := store.RegisterInventory(Inventory{
		SchemaVersion: SchemaVersion,
		Origins:       []string{origin},
		Skills: []InventorySkill{
			{Path: projectSkill, SkillID: skillID, Version: "1.0.0", Origin: origin},
			{Path: globalSkill, SkillID: skillID, Version: "2.0.0", Origin: origin},
		},
	}); err != nil || count != 2 {
		t.Fatalf("initial registration count=%d err=%v", count, err)
	}
	project, ok, err := store.ResolveSkill(projectSkill)
	if err != nil || !ok || project.Version != "1.0.0" {
		t.Fatalf("project resolution=%#v ok=%v err=%v", project, ok, err)
	}
	global, ok, err := store.ResolveSkill(globalSkill)
	if err != nil || !ok || global.Version != "2.0.0" {
		t.Fatalf("global resolution=%#v ok=%v err=%v", global, ok, err)
	}
	if _, ok, err := store.ResolveSkill(skillID); err != nil || ok {
		t.Fatalf("ambiguous UUID resolution ok=%v err=%v", ok, err)
	}
	if count, err := store.RegisterInventory(Inventory{
		SchemaVersion: SchemaVersion,
		Origins:       []string{origin},
		Skills:        []InventorySkill{{Path: alias, SkillID: skillID, Version: "1.0.0", Origin: origin}},
	}); err != nil || count != 1 {
		t.Fatalf("alias registration count=%d err=%v", count, err)
	}
	resolvedAlias, ok, err := store.ResolveSkill(alias)
	canonicalProject, canonicalErr := canonicalSkillPath(projectSkill)
	if err != nil || canonicalErr != nil || !ok || resolvedAlias.CanonicalPath != canonicalProject {
		t.Fatalf("alias resolution=%#v ok=%v err=%v", resolvedAlias, ok, err)
	}
	if count, err := store.RegisterInventory(Inventory{
		SchemaVersion: SchemaVersion,
		Origins:       []string{origin},
		Skills:        []InventorySkill{{Path: projectSkill, SkillID: skillID, Version: "1.1.0", Origin: origin}},
	}); err != nil || count != 1 {
		t.Fatalf("partial refresh count=%d err=%v", count, err)
	}
	project, ok, err = store.ResolveSkill(projectSkill)
	if err != nil || !ok || project.Version != "1.1.0" {
		t.Fatalf("refreshed project resolution=%#v ok=%v err=%v", project, ok, err)
	}
	global, ok, err = store.ResolveSkill(globalSkill)
	if err != nil || !ok || global.Version != "2.0.0" {
		t.Fatalf("preserved global resolution=%#v ok=%v err=%v", global, ok, err)
	}
	var skillCount int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM skills`).Scan(&skillCount); err != nil {
		t.Fatal(err)
	}
	if skillCount != 2 {
		t.Fatalf("skill rows=%d, want two installation identities", skillCount)
	}
}

func TestCaptureEventUsesOnlyWireContractAndDeduplicatesCorrelation(t *testing.T) {
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "skill")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, err = store.RegisterInventory(Inventory{
		SchemaVersion: 1,
		Origins:       []string{"https://skillpack.app"},
		Skills:        []InventorySkill{{Path: skillDir, SkillID: "11111111-1111-4111-8111-111111111111", Version: "1.2.3", Origin: "https://skillpack.app"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	input := CaptureInput{
		SkillRef:    skillDir,
		Kind:        "invocation",
		Adapter:     "codex-hook",
		Agent:       "codex",
		Environment: "local",
		SessionID:   "session-1",
		TurnID:      "turn-1",
		CallID:      "call-1",
		Source:      "hook",
	}
	first, err := store.CaptureEvent(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.CaptureEvent(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if !first.Captured || second.Captured || first.EventID != second.EventID {
		t.Fatalf("capture results = %#v, %#v", first, second)
	}

	var payload string
	if err := store.db.QueryRow(`SELECT payload FROM events WHERE event_id=?`, first.EventID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"session-1", "call-1", "origin", "path", "prompt"} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("wire payload leaked %q: %s", forbidden, payload)
		}
	}
	if len(payload) > MaxEventBytes {
		t.Fatalf("payload size = %d, want <= %d", len(payload), MaxEventBytes)
	}
}
