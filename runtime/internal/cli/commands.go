package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

type commandHandler func(*app) (any, error)

func executeCommand(args []string, in io.Reader, out, diagnostic io.Writer) (any, options, error) {
	o := options{values: map[string]string{}, flags: map[string]bool{}}
	var result any
	root := &cobra.Command{
		Use: "skillpack", Short: "Manage skills, credentials and agent setup",
		Long:         "Skillpack installs and publishes portable agent skills and manages their workspace capabilities.",
		Example:      "  skillpack auth login\n  skillpack skills list\n  skillpack install plan-pr --scope project\n  skillpack doctor",
		SilenceUsage: true, SilenceErrors: true,
	}
	root.SetOut(out)
	root.SetErr(diagnostic)
	root.SetArgs(args)
	root.CompletionOptions.DisableDefaultCmd = true
	root.AddCommand(&cobra.Command{Use: "usage", Short: "Inspect local skill-usage collection", Long: "Usage hooks, telemetry and synchronization are managed independently of API credentials."})
	root.AddCommand(&cobra.Command{Use: "version", Short: "Print the native CLI version"})
	root.PersistentFlags().Bool("json", false, "Print machine-readable JSON")
	root.PersistentFlags().String("api-url", "", "Skillpack API origin (default https://skillpack.app/v1)")
	root.PersistentFlags().String("profile", "", "Saved connection profile")
	root.PersistentFlags().String("project", "", "Project directory")
	root.PersistentFlags().String("input", "", "Read JSON input from file or - for stdin")

	add := func(parent *cobra.Command, use, short, example string, handler commandHandler, bools, values []string) *cobra.Command {
		cmd := &cobra.Command{Use: use, Short: short, Example: example}
		for _, name := range bools {
			cmd.Flags().Bool(name, false, boolFlagHelp(name))
		}
		for _, name := range values {
			cmd.Flags().String(name, "", valueFlagHelp(name))
		}
		if handler != nil {
			cmd.RunE = func(cmd *cobra.Command, positional []string) error {
				o.args = append(strings.Fields(cmd.CommandPath())[1:], positional...)
				collectFlags(cmd, &o)
				home, err := clientHome()
				if err != nil {
					return fail(1, "cannot resolve private configuration directory")
				}
				result, err = handler(&app{o, in, out, diagnostic, home})
				return err
			}
		}
		parent.AddCommand(cmd)
		return cmd
	}

	auth := add(root, "auth", "Manage CLI authentication", "  skillpack auth login\n  skillpack auth status", nil, nil, nil)
	add(auth, "login", "Approve access in your browser", "  skillpack auth login\n  skillpack auth login --token-stdin", (*app).auth, []string{"token-stdin", "no-browser", "manual"}, nil)
	for _, name := range []string{"status", "refresh", "logout"} {
		add(auth, name, strings.Title(name)+" the CLI connection", "  skillpack auth "+name, (*app).auth, nil, nil)
	}
	add(root, "setup", "Configure agent integrations and usage hooks", "  skillpack setup --tools codex,claude-code,opencode", (*app).setup, []string{"dry-run"}, []string{"tools"})
	add(root, "install [slug]", "Install a skill and its dependencies", "  skillpack install plan-pr --scope project\n  skillpack install --public TOKEN --version 1.2.3", (*app).install, []string{"public", "force", "pin", "dry-run", "confirm-secrets"}, []string{"scope", "tools", "version"})
	add(root, "update [slug]", "Update installed skills", "  skillpack update --all --dry-run\n  skillpack update plan-pr", (*app).update, []string{"all", "dry-run", "force", "confirm-secrets"}, []string{"scope", "tools", "version"})
	add(root, "sync", "Verify and restore pinned project skills", "  skillpack sync --frozen", func(a *app) (any, error) {
		if !a.options.flags["frozen"] {
			return nil, fail(2, "use sync --frozen to verify locked packages")
		}
		return a.frozenSync()
	}, []string{"frozen", "dry-run"}, nil)
	add(root, "import-lock PATH", "Import a legacy lockfile", "  skillpack import-lock companion.lock", (*app).importLock, []string{"dry-run"}, []string{"tools"})
	skills := add(root, "skills", "Browse, validate and publish packages", "  skillpack skills list", nil, nil, nil)
	for _, spec := range []struct{ use, short string }{{"list", "List available skills"}, {"info SLUG", "Show skill details"}, {"versions SLUG", "List published versions"}} {
		add(skills, spec.use, spec.short, "  skillpack skills "+spec.use, (*app).skills, nil, nil)
	}
	for _, name := range []string{"validate", "publish", "push"} {
		add(skills, name+" FOLDER", strings.Title(name)+" a package", "  skillpack skills "+name+" ./my-skill", (*app).skills, nil, []string{"scope", "version", "manifest"})
	}
	secrets := add(root, "secrets", "Manage skill secrets and bindings", "  skillpack secrets list", nil, nil, nil)
	for _, name := range []string{"list", "info", "configuration", "create", "update", "rotate", "delete", "bind", "unbind", "sync"} {
		add(secrets, name, strings.Title(name)+" secrets", "  skillpack secrets "+name+" --help", (*app).secrets, []string{"dry-run", "confirm-secrets"}, nil)
	}
	db := add(root, "db", "Query declared Skill Databases", "  skillpack db info my-skill", nil, nil, nil)
	for _, name := range []string{"info", "query", "execute", "shares"} {
		add(db, name+" SKILL", strings.Title(name)+" a Skill Database", "  skillpack db "+name+" my-skill", (*app).database, nil, []string{"realm", "sql", "params"})
	}
	add(root, "api METHOD PATH", "Call a supported REST endpoint", "  skillpack api GET /v1/skills", (*app).api, nil, nil)
	self := add(root, "self", "Manage the Skillpack binary", "  skillpack self update", nil, nil, nil)
	add(self, "update", "Download a verified CLI release", "  skillpack self update --dry-run", (*app).selfUpdate, []string{"dry-run"}, []string{"version"})
	add(root, "doctor", "Diagnose setup and connectivity", "  skillpack doctor", (*app).doctor, nil, nil)
	root.AddCommand(&cobra.Command{Use: "completion [bash|zsh|fish|powershell]", Short: "Generate shell completion", ValidArgs: []string{"bash", "zsh", "fish", "powershell"}, Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		switch args[0] {
		case "bash":
			return root.GenBashCompletion(out)
		case "zsh":
			return root.GenZshCompletion(out)
		case "fish":
			return root.GenFishCompletion(out, true)
		case "powershell":
			return root.GenPowerShellCompletion(out)
		default:
			return fail(2, "choose bash, zsh, fish or powershell")
		}
	}})
	if err := root.Execute(); err != nil {
		var ce *commandError
		if !errors.As(err, &ce) {
			err = fail(2, err.Error())
		}
		return result, o, err
	}
	return result, o, nil
}

func collectFlags(cmd *cobra.Command, o *options) {
	visit := func(flag *pflag.Flag) {
		if flag.Value.Type() == "bool" {
			o.flags[flag.Name] = flag.Value.String() == "true"
		} else {
			o.values[flag.Name] = flag.Value.String()
		}
	}
	cmd.Flags().Visit(visit)
	cmd.InheritedFlags().Visit(visit)
}

func boolFlagHelp(name string) string {
	return map[string]string{"token-stdin": "Read API key from stdin", "manual": "Enter an API key in the terminal", "no-browser": "Show approval URL without opening browser", "dry-run": "Preview without changing files", "all": "Update all installed skills", "force": "Replace modified managed files", "public": "Install from a public share token", "pin": "Pin the installed version", "confirm-secrets": "Allow private secret projection", "frozen": "Require exact locked versions"}[name]
}
func valueFlagHelp(name string) string {
	return map[string]string{"scope": "Installation or publication scope", "tools": "Comma-separated agent tools", "version": "Exact version", "manifest": "Package manifest path", "realm": "Database realm", "sql": "SQL statement", "params": "JSON SQL parameters"}[name]
}

func printHuman(out io.Writer, args []string, result any) error {
	if len(args) >= 2 && args[0] == "skills" && args[1] == "list" {
		if rows, ok := result.([]any); ok {
			if len(rows) == 0 {
				_, err := fmt.Fprintln(out, "No skills found.")
				return err
			}
			table := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
			fmt.Fprintln(table, "SLUG\tVERSION\tSCOPE\tSTATUS")
			for _, item := range rows {
				row, ok := item.(map[string]any)
				if !ok {
					continue
				}
				value := func(key string) string {
					if text, ok := row[key].(string); ok && text != "" {
						return text
					}
					return "-"
				}
				fmt.Fprintf(table, "%s\t%s\t%s\t%s\n", value("slug"), value("current_version"), value("scope"), value("install_status"))
			}
			return table.Flush()
		}
	}
	if len(args) >= 2 && args[0] == "auth" {
		switch args[1] {
		case "logout":
			_, err := fmt.Fprintln(out, "Signed out locally.")
			return err
		case "login", "status":
			if status, ok := result.(keyStatus); ok {
				workspace, user := status.Workspace.Name, status.User.Email
				if workspace == "" {
					workspace = status.Workspace.ID
				}
				if user == "" {
					user = status.User.ID
				}
				_, err := fmt.Fprintf(out, "Connected to %s as %s\nAPI key: %s (expires %s)\n", workspace, user, status.Token.Prefix, status.Token.ExpiresAt)
				return err
			}
		}
	}
	b, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	if len(b) == 0 {
		return nil
	}
	if len(b) > 0 && b[0] == '{' {
		var fields map[string]json.RawMessage
		if json.Unmarshal(b, &fields) == nil {
			keys := make([]string, 0, len(fields))
			for key := range fields {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				_, err = fmt.Fprintf(out, "%s: %s\n", key, strings.TrimSpace(string(fields[key])))
				if err != nil {
					return err
				}
			}
			return nil
		}
	}
	_, err = fmt.Fprintln(out, string(b))
	return err
}
