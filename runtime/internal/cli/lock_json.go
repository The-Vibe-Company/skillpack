package cli

import "encoding/json"

// Preserve extensions and other clients' metadata while changing only known fields.
func mergeLockFields(extra map[string]json.RawMessage, known any) ([]byte, error) {
	b, err := json.Marshal(known)
	if err != nil {
		return nil, err
	}
	out := map[string]json.RawMessage{}
	for k, v := range extra {
		out[k] = v
	}
	fields := map[string]json.RawMessage{}
	if err = json.Unmarshal(b, &fields); err != nil {
		return nil, err
	}
	for k, v := range fields {
		out[k] = v
	}
	return json.Marshal(out)
}

func (v *installedTarget) UnmarshalJSON(b []byte) error {
	type plain installedTarget
	var p plain
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	if err := json.Unmarshal(b, &p.Extra); err != nil {
		return err
	}
	*v = installedTarget(p)
	return nil
}
func (v installedTarget) MarshalJSON() ([]byte, error) {
	type plain installedTarget
	return mergeLockFields(v.Extra, plain(v))
}

func (v *installedSkill) UnmarshalJSON(b []byte) error {
	type plain installedSkill
	var p plain
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	if err := json.Unmarshal(b, &p.Extra); err != nil {
		return err
	}
	*v = installedSkill(p)
	return nil
}
func (v installedSkill) MarshalJSON() ([]byte, error) {
	type plain installedSkill
	return mergeLockFields(v.Extra, plain(v))
}

func (v *workspaceLock) UnmarshalJSON(b []byte) error {
	type plain workspaceLock
	var p plain
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	if err := json.Unmarshal(b, &p.Extra); err != nil {
		return err
	}
	*v = workspaceLock(p)
	return nil
}
func (v workspaceLock) MarshalJSON() ([]byte, error) {
	type plain workspaceLock
	return mergeLockFields(v.Extra, plain(v))
}

func (v *installLock) UnmarshalJSON(b []byte) error {
	type plain installLock
	var p plain
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	if err := json.Unmarshal(b, &p.Extra); err != nil {
		return err
	}
	*v = installLock(p)
	return nil
}
func (v installLock) MarshalJSON() ([]byte, error) {
	type plain installLock
	return mergeLockFields(v.Extra, plain(v))
}
