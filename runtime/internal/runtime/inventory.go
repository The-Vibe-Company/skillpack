package runtime

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var (
	semverPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)
	uuidPattern   = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
)

func isUUID(value string) bool { return uuidPattern.MatchString(strings.TrimSpace(value)) }

func canonicalOrigin(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("origin must be an https origin: %q", raw)
	}
	if u.Path != "" && u.Path != "/" {
		return "", fmt.Errorf("origin must not include a path: %q", raw)
	}
	return "https://" + strings.ToLower(u.Host), nil
}

func canonicalSkillPath(path string) (string, error) {
	if strings.TrimSpace(path) == "" || !filepath.IsAbs(path) {
		return "", fmt.Errorf("skill path must be absolute: %q", path)
	}
	clean := filepath.Clean(path)
	resolved, err := filepath.EvalSymlinks(clean)
	if err != nil {
		return "", fmt.Errorf("resolve skill path %q: %w", path, err)
	}
	resolved, err = filepath.Abs(resolved)
	if err != nil {
		return "", err
	}
	stat, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("stat skill path %q: %w", path, err)
	}
	if !stat.IsDir() {
		return "", fmt.Errorf("skill path is not a directory: %q", path)
	}
	return filepath.Clean(resolved), nil
}

func (s *Store) RegisterInventory(inventory Inventory) (int, error) {
	if inventory.SchemaVersion != SchemaVersion {
		return 0, fmt.Errorf("unsupported inventory schema_version %d", inventory.SchemaVersion)
	}
	if len(inventory.Origins) == 0 {
		return 0, errors.New("inventory must contain at least one verified origin")
	}
	origins := make(map[string]struct{}, len(inventory.Origins))
	for _, raw := range inventory.Origins {
		origin, err := canonicalOrigin(raw)
		if err != nil {
			return 0, err
		}
		origins[origin] = struct{}{}
	}
	if len(inventory.Skills) == 0 {
		return 0, errors.New("inventory must contain at least one skill")
	}
	type prepared struct {
		skill  InventorySkill
		path   string
		canon  string
		origin string
	}
	preparedSkills := make([]prepared, 0, len(inventory.Skills))
	seenCanonical := make(map[string]InventorySkill, len(inventory.Skills))
	for _, item := range inventory.Skills {
		if !isUUID(item.SkillID) {
			return 0, fmt.Errorf("invalid skill_id %q", item.SkillID)
		}
		if !semverPattern.MatchString(item.Version) {
			return 0, fmt.Errorf("invalid skill version %q", item.Version)
		}
		origin, err := canonicalOrigin(item.Origin)
		if err != nil {
			return 0, err
		}
		if _, ok := origins[origin]; !ok {
			return 0, fmt.Errorf("skill origin %q is not a verified inventory origin", origin)
		}
		canon, err := canonicalSkillPath(item.Path)
		if err != nil {
			return 0, err
		}
		if previous, ok := seenCanonical[canon]; ok {
			previousOrigin, previousOriginErr := canonicalOrigin(previous.Origin)
			if previousOriginErr != nil || previous.SkillID != item.SkillID || previous.Version != item.Version || previousOrigin != origin {
				return 0, fmt.Errorf("inventory has conflicting metadata for canonical skill path %q", canon)
			}
			// A single inventory may list a symlink and its target. They are one
			// installation; process this row to retain the additional alias.
			preparedSkills = append(preparedSkills, prepared{skill: item, path: filepath.Clean(item.Path), canon: canon, origin: origin})
			continue
		}
		seenCanonical[canon] = item
		preparedSkills = append(preparedSkills, prepared{skill: item, path: filepath.Clean(item.Path), canon: canon, origin: origin})
	}

	tx, err := s.db.BeginTx(context.Background(), nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	now := formatTime(nowUTC())
	for origin := range origins {
		if _, err := tx.Exec(`INSERT INTO origins(origin, updated_at) VALUES (?, ?) ON CONFLICT(origin) DO UPDATE SET updated_at=excluded.updated_at`, origin, now); err != nil {
			return 0, err
		}
	}
	for _, item := range preparedSkills {
		// Inventory registration is additive across installations. The
		// canonical path is the installation identity; the same skill_id may
		// legitimately occur at several paths and versions.
		if _, err := tx.Exec(`DELETE FROM skill_paths WHERE path=?`, item.path); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(`INSERT INTO skills(skill_id, canonical_path, version, origin, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(canonical_path) DO UPDATE SET skill_id=excluded.skill_id, version=excluded.version, origin=excluded.origin, updated_at=excluded.updated_at`, item.skill.SkillID, item.canon, item.skill.Version, item.origin, now); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(`INSERT INTO skill_paths(path, canonical_path, updated_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET canonical_path=excluded.canonical_path, updated_at=excluded.updated_at`, item.path, item.canon, now); err != nil {
			return 0, err
		}
		// Keep the canonical path as an explicit alias even when the inventory
		// itself was supplied through a symlink.
		if _, err := tx.Exec(`INSERT INTO skill_paths(path, canonical_path, updated_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET canonical_path=excluded.canonical_path, updated_at=excluded.updated_at`, item.canon, item.canon, now); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(preparedSkills), nil
}

func (s *Store) ResolveSkill(ref string) (Skill, bool, error) {
	return resolveSkillWith(context.Background(), s.db, ref)
}

func resolveSkillWith(ctx context.Context, runner sqlRunner, ref string) (Skill, bool, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return Skill{}, false, nil
	}
	if isUUID(ref) {
		rows, err := runner.QueryContext(ctx, `SELECT canonical_path, canonical_path, skill_id, version, origin FROM skills WHERE skill_id=?`, ref)
		if err != nil {
			return Skill{}, false, err
		}
		defer rows.Close()
		var result Skill
		count := 0
		for rows.Next() {
			if err := rows.Scan(&result.Path, &result.CanonicalPath, &result.SkillID, &result.Version, &result.Origin); err != nil {
				return Skill{}, false, err
			}
			count++
		}
		if err := rows.Err(); err != nil {
			return Skill{}, false, err
		}
		if count != 1 {
			return Skill{}, false, nil
		}
		return result, true, nil
	}
	if filepath.IsAbs(ref) {
		clean := resolvePathWithParents(filepath.Clean(ref))
		var result Skill
		err := runner.QueryRowContext(ctx, `SELECT p.path, s.canonical_path, s.skill_id, s.version, s.origin FROM skill_paths p JOIN skills s ON s.canonical_path=p.canonical_path WHERE p.path=? OR p.path=? LIMIT 1`, filepath.Clean(ref), clean).Scan(&result.Path, &result.CanonicalPath, &result.SkillID, &result.Version, &result.Origin)
		if err == nil {
			return result, true, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return Skill{}, false, err
		}
		// Read hooks often identify a file inside SKILL.md's directory. Resolve
		// that file against an inventoried canonical path or alias, but require
		// one unique owner before recording the signal.
		rows, queryErr := runner.QueryContext(ctx, `SELECT p.path, s.canonical_path, s.skill_id, s.version, s.origin FROM skill_paths p JOIN skills s ON s.canonical_path=p.canonical_path`)
		if queryErr != nil {
			return Skill{}, false, queryErr
		}
		defer rows.Close()
		var matches []Skill
		for rows.Next() {
			var candidate Skill
			if scanErr := rows.Scan(&candidate.Path, &candidate.CanonicalPath, &candidate.SkillID, &candidate.Version, &candidate.Origin); scanErr != nil {
				return Skill{}, false, scanErr
			}
			root := filepath.Clean(candidate.Path)
			canonicalRoot := filepath.Clean(candidate.CanonicalPath)
			if clean != root && clean != canonicalRoot && !pathWithin(clean, root) && !pathWithin(clean, canonicalRoot) {
				continue
			}
			seen := false
			for _, prior := range matches {
				if prior.CanonicalPath == candidate.CanonicalPath {
					seen = true
					break
				}
			}
			if !seen {
				matches = append(matches, candidate)
			}
		}
		if len(matches) == 1 {
			return matches[0], true, rows.Err()
		}
		return Skill{}, false, rows.Err()
	}
	// A qualified/native skill name is usable only when it identifies one
	// inventoried skill. Ambiguity is intentionally treated as unknown.
	rows, err := runner.QueryContext(ctx, `SELECT p.path, s.canonical_path, s.skill_id, s.version, s.origin FROM skill_paths p JOIN skills s ON s.canonical_path=p.canonical_path`)
	if err != nil {
		return Skill{}, false, err
	}
	defer rows.Close()
	var matches []Skill
	for rows.Next() {
		var result Skill
		if err := rows.Scan(&result.Path, &result.CanonicalPath, &result.SkillID, &result.Version, &result.Origin); err != nil {
			return Skill{}, false, err
		}
		if !strings.EqualFold(ref, filepath.Base(result.Path)) && !strings.EqualFold(ref, filepath.Base(result.CanonicalPath)) {
			continue
		}
		found := false
		for _, previous := range matches {
			if previous.CanonicalPath == result.CanonicalPath {
				found = true
				break
			}
		}
		if !found {
			matches = append(matches, result)
		}
	}
	if err := rows.Err(); err != nil {
		return Skill{}, false, err
	}
	if len(matches) != 1 {
		return Skill{}, false, nil
	}
	return matches[0], true, nil
}

func resolvePathWithParents(path string) string {
	path = filepath.Clean(path)
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return filepath.Clean(resolved)
	}
	var suffix []string
	current := path
	for {
		parent, base := filepath.Dir(current), filepath.Base(current)
		if parent == current {
			return path
		}
		suffix = append(suffix, base)
		current = parent
		resolved, err := filepath.EvalSymlinks(current)
		if err != nil {
			continue
		}
		for i := len(suffix) - 1; i >= 0; i-- {
			resolved = filepath.Join(resolved, suffix[i])
		}
		return filepath.Clean(resolved)
	}
}

func pathWithin(path, root string) bool {
	if path == root {
		return true
	}
	separator := string(filepath.Separator)
	return strings.HasPrefix(path, strings.TrimRight(root, separator)+separator)
}

func (s *Store) inventoryStats(ctx context.Context) (skills, origins int, err error) {
	err = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM skills`).Scan(&skills)
	if err != nil {
		return
	}
	err = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM origins`).Scan(&origins)
	return
}

func (s *Store) skillVersionForID(ctx context.Context, skillID string) (string, error) {
	var version string
	err := s.db.QueryRowContext(ctx, `SELECT version FROM skills WHERE skill_id=?`, skillID).Scan(&version)
	return version, err
}

func (s *Store) cleanupOldAliases(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM skill_paths WHERE canonical_path NOT IN (SELECT canonical_path FROM skills)`)
	return err
}

var _ = time.RFC3339Nano
