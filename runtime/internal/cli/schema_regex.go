package cli

import (
	"github.com/dlclark/regexp2"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"time"
)

type schemaRegexp struct{ re *regexp2.Regexp }

func (r schemaRegexp) String() string { return r.re.String() }
func (r schemaRegexp) MatchString(value string) bool {
	matched, err := r.re.MatchString(value)
	return err == nil && matched
}
func compileSchemaRegexp(pattern string) (jsonschema.Regexp, error) {
	re, err := regexp2.Compile(pattern, regexp2.ECMAScript)
	if err != nil {
		return nil, err
	}
	re.MatchTimeout = 100 * time.Millisecond
	return schemaRegexp{re}, nil
}
