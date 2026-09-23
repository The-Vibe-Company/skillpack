package cli

import (
	"encoding/json"
	"github.com/google/uuid"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

func (a *app) database() (any, error) {
	args := a.options.args
	if len(args) < 3 || !validSegment(args[2]) {
		return nil, fail(2, "usage: skillpack db info|query|execute|shares SKILL --input -")
	}
	path := "/skills/" + args[2] + "/database"
	method := "GET"
	var body []byte
	var err error
	switch args[1] {
	case "info":
	case "shares":
		path += "/shares"
		if a.options.values["input"] != "" {
			method = "PUT"
			body, err = a.inputJSON()
		}
	case "query", "execute":
		path += "/" + args[1]
		method = "POST"
		if sql := a.options.values["sql"]; sql != "" {
			value := map[string]any{"sql": sql, "params": []any{}}
			if raw := a.options.values["params"]; raw != "" {
				var params []any
				if json.Unmarshal([]byte(raw), &params) != nil {
					return nil, fail(2, "params must be a JSON array")
				}
				value["params"] = params
			}
			if realm := a.options.values["realm"]; realm != "" {
				value["audience"] = "personal"
				value["realm_id"] = realm
			}
			body, _ = json.Marshal(value)
		} else {
			body, err = a.inputJSON()
		}
	default:
		return nil, fail(2, "unknown database command")
	}
	if err != nil {
		return nil, err
	}
	c, err := a.client()
	if err != nil {
		return nil, err
	}
	return c.json(method, path, body)
}

func (a *app) secrets() (any, error) {
	args := a.options.args
	if len(args) < 2 {
		return nil, fail(2, "secrets requires list, info, create, update, rotate, delete, bind, unbind, configuration or sync")
	}
	c, err := a.client()
	if err != nil {
		return nil, err
	}
	if args[1] == "sync" {
		if len(args) < 3 {
			return nil, fail(2, "secrets sync requires at least one skill")
		}
		status, err := c.status()
		if err != nil {
			return nil, err
		}
		var skills []map[string]string
		for _, slug := range args[2:] {
			if !validSegment(slug) {
				return nil, fail(2, "invalid skill slug")
			}
			skills = append(skills, map[string]string{"slug": slug})
		}
		p, err := c.preflightSecrets(skills)
		if err != nil {
			return nil, err
		}
		if a.options.flags["dry-run"] {
			return p, nil
		}
		return a.projectSecrets(c, status.Workspace.ID, p)
	}
	method, path := "GET", "/secrets"
	var body []byte
	for _, arg := range args[2:] {
		if !validSegment(arg) {
			return nil, fail(2, "invalid resource identifier")
		}
	}
	switch args[1] {
	case "list":
		if len(args) != 2 {
			return nil, fail(2, "secrets list takes no identifier")
		}
	case "info", "update", "rotate", "delete":
		if len(args) != 3 {
			return nil, fail(2, "provide one secret ID")
		}
		path += "/" + args[2]
		if args[1] == "update" {
			method = "PATCH"
		}
		if args[1] == "rotate" {
			method = "POST"
			path += "/rotate"
		}
		if args[1] == "delete" {
			method = "DELETE"
		}
	case "create":
		method = "POST"
	case "configuration":
		if len(args) != 3 {
			return nil, fail(2, "provide one skill")
		}
		path = "/skills/" + args[2] + "/secret-configuration"
	case "bind", "unbind":
		if len(args) != 4 {
			return nil, fail(2, "provide skill and slot ID")
		}
		path = "/skills/" + args[2] + "/secret-bindings/" + args[3]
		method = "PUT"
		if args[1] == "unbind" {
			method = "DELETE"
		}
	default:
		return nil, fail(2, "unknown secrets command; less common metadata operations are available through api")
	}
	if method != "GET" && method != "DELETE" {
		body, err = a.inputJSON()
		if err != nil {
			return nil, err
		}
	}
	return c.json(method, path, body)
}

type secretItem struct {
	Projection string `json:"projection_id"`
	Skill      string `json:"skill"`
	Key        string `json:"env_key"`
	Value      string `json:"value,omitempty"`
	Slot       string `json:"slot_id"`
	Version    int    `json:"secret_version"`
	Status     string `json:"status"`
	Required   bool   `json:"required"`
}
type secretPlan struct {
	ID         string       `json:"plan_id"`
	Operation  string       `json:"operation_id"`
	Blockers   int          `json:"blockers"`
	Items      []secretItem `json:"items"`
	Tombstones []secretItem `json:"tombstones"`
}
type secretValues struct {
	Operation  string       `json:"operation_id"`
	Items      []secretItem `json:"items"`
	Tombstones []secretItem `json:"tombstones"`
}

func (c *client) preflightSecrets(skills []map[string]string) (secretPlan, error) {
	var plan secretPlan
	body, _ := json.Marshal(map[string]any{"operation_id": uuid.NewString(), "skills": skills})
	b, err := c.request("POST", "/secret-retrievals/preflight", body, "application/json", 8<<20)
	if err != nil {
		return plan, err
	}
	if json.Unmarshal(b, &plan) != nil || !validSegment(plan.ID) {
		return plan, fail(8, "invalid secrets preflight response")
	}
	if plan.Blockers > 0 {
		return plan, fail(7, "required secret bindings are missing or inaccessible; use secrets configuration")
	}
	return plan, nil
}
func (c *client) redeemSecrets(plan secretPlan) (secretValues, error) {
	var values secretValues
	b, err := c.request("POST", "/secret-retrievals/"+plan.ID+"/grant", []byte(`{}`), "application/json", 1<<20)
	if err != nil {
		return values, err
	}
	var grant struct {
		Grant string `json:"grant"`
	}
	if json.Unmarshal(b, &grant) != nil || !strings.HasPrefix(grant.Grant, "cmp_grant_") {
		return values, fail(8, "invalid retrieval grant")
	}
	body, _ := json.Marshal(grant)
	b, err = c.request("POST", "/secret-grants/redeem", body, "application/json", 8<<20)
	if err != nil {
		return values, err
	}
	if json.Unmarshal(b, &values) != nil || values.Operation != plan.Operation {
		return values, fail(8, "invalid secret redemption response; start a fresh preflight")
	}

	expected := map[string]secretItem{}
	for _, item := range plan.Items {
		if item.Status == "personal" || item.Status == "shared" {
			expected[item.Projection] = item
		}
	}
	for _, item := range values.Items {
		prior, ok := expected[item.Projection]
		if !ok || prior.Skill != item.Skill || prior.Key != item.Key || prior.Slot != item.Slot || prior.Version != item.Version {
			return values, fail(5, "secret redemption differs from preflight")
		}
		delete(expected, item.Projection)
	}
	if len(expected) > 0 {
		return values, fail(5, "secret redemption is incomplete")
	}
	tombstones := map[string]string{}
	for _, item := range plan.Tombstones {
		tombstones[item.Projection] = item.Skill
	}
	for _, item := range values.Tombstones {
		if tombstones[item.Projection] != item.Skill {
			return values, fail(5, "unexpected secret tombstone")
		}
		delete(tombstones, item.Projection)
	}
	if len(tombstones) > 0 {
		return values, fail(5, "secret tombstone response incomplete")
	}
	return values, nil
}
func legacyHome() (string, error) {
	if p := os.Getenv("SKILLPACK_LEGACY_HOME"); p != "" {
		return filepath.Abs(p)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".companion"), nil
}
func secureSubdir(base string, parts ...string) (string, error) {
	current := base
	for i := 0; i <= len(parts); i++ {
		if i > 0 {
			if !validSegment(parts[i-1]) && parts[i-1] != "_manual" {
				return "", fail(5, "invalid private path component")
			}
			current = filepath.Join(current, parts[i-1])
		}
		if info, err := os.Lstat(current); err == nil {
			if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return "", fail(5, "private path is redirected")
			}
		} else if !os.IsNotExist(err) {
			return "", err
		}
		if err := os.MkdirAll(current, 0700); err != nil {
			return "", err
		}
		if err := protectPath(current, true); err != nil {
			return "", err
		}
	}
	return current, nil
}

var envKey = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func renderSecrets(items []secretItem) ([]byte, error) {
	sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })
	var b strings.Builder
	prior := ""
	for _, item := range items {
		if !envKey.MatchString(item.Key) || item.Key == prior {
			return nil, fail(5, "invalid or duplicate secret environment key")
		}
		prior = item.Key
		value := strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "\r", "\\r", "\n", "\\n").Replace(item.Value)
		b.WriteString(item.Key + "=\"" + value + "\"\n")
	}
	return []byte(b.String()), nil
}

func (a *app) projectSecrets(c *client, workspace string, p secretPlan) (any, error) {
	if _, err := secureSubdir(a.home); err != nil {
		return nil, err
	}
	unlock, err := acquireLock(filepath.Join(a.home, ".mutation.lock"))
	if err != nil {
		return nil, err
	}
	defer unlock()
	if err = a.recoverTransaction(); err != nil {
		return nil, err
	}
	values, err := c.redeemSecrets(p)
	if err != nil {
		return nil, err
	}
	rows, paths, err := a.stageProjections(workspace, values, nil)
	if err != nil {
		return nil, err
	}
	defer a.discardUncommitted(&rows)
	if err = a.commitTransaction(rows); err != nil {
		return nil, err
	}
	return map[string]any{"status": "projected", "paths": paths, "count": len(values.Items)}, nil
}
func (a *app) stageProjections(workspace string, values secretValues, selected []string) ([]replacement, map[string]string, error) {
	home, err := legacyHome()
	if err != nil {
		return nil, nil, err
	}
	root, err := secureSubdir(home, "secrets", workspace)
	if err != nil {
		return nil, nil, err
	}
	groups := map[string][]secretItem{}
	for _, slug := range selected {
		groups[slug] = nil
	}
	for _, item := range values.Items {
		if !validSegment(item.Skill) {
			return nil, nil, fail(5, "invalid projection skill")
		}
		groups[item.Skill] = append(groups[item.Skill], item)
	}
	for _, item := range values.Tombstones {
		if !validSegment(item.Skill) {
			return nil, nil, fail(5, "invalid projection skill")
		}
		if _, ok := groups[item.Skill]; !ok {
			groups[item.Skill] = nil
		}
	}
	var rows []replacement
	success := false
	defer func() {
		if !success {
			a.discardUncommitted(&rows)
		}
	}()
	paths := map[string]string{}
	for slug, items := range groups {
		dir, err := secureSubdir(root, slug)
		if err != nil {
			return nil, nil, err
		}
		body, err := renderSecrets(items)
		if err != nil {
			return nil, nil, err
		}
		path := filepath.Join(dir, ".env")
		r, err := stageFile(path, body, true)
		if err != nil {
			return nil, nil, err
		}
		r.Root = home
		rows = append(rows, r)
		paths[slug] = path
	}
	path := filepath.Join(home, "secrets", "state.json")
	type workspaceState struct {
		Projections map[string]map[string]any `json:"projections"`
	}
	state := struct {
		Version    int                       `json:"schemaVersion"`
		Workspaces map[string]workspaceState `json:"workspaces"`
	}{1, map[string]workspaceState{}}
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return nil, nil, fail(6, "secret state redirected")
	}
	if b, err := os.ReadFile(path); err == nil {
		if json.Unmarshal(b, &state) != nil || state.Version != 1 || state.Workspaces == nil {
			return nil, nil, fail(6, "secret state invalid")
		}
	} else if !os.IsNotExist(err) {
		return nil, nil, err
	}
	ws := state.Workspaces[workspace]
	if ws.Projections == nil {
		ws.Projections = map[string]map[string]any{}
	}
	for _, item := range values.Tombstones {
		delete(ws.Projections, item.Projection)
	}
	for _, item := range values.Items {
		ws.Projections[item.Projection] = map[string]any{"skill": item.Skill, "slotId": item.Slot, "secretVersion": item.Version, "envKey": item.Key, "projectionId": item.Projection, "path": paths[item.Skill]}
	}
	state.Workspaces[workspace] = ws
	b, _ := json.MarshalIndent(state, "", "  ")
	r, err := stageFile(path, b, true)
	if err != nil {
		return nil, nil, err
	}
	r.Root = home
	rows = append(rows, r)
	success = true
	return rows, paths, nil
}
