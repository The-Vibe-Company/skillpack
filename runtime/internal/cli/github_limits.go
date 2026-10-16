package cli

import (
	"fmt"
	"os"
	"strconv"
)

// Zero values preserve the defaults for direct resolver callers.
type githubSkillLimits struct {
	bytes int64
	files int
}

func (l githubSkillLimits) normalized() githubSkillLimits {
	if l.bytes == 0 {
		l.bytes = maxPackageBytes
	}
	if l.files == 0 {
		l.files = maxPackageFiles
	}
	return l
}

func (o options) githubLimits() (githubSkillLimits, error) {
	l := githubSkillLimits{}.normalized()
	rawBytes := o.values["max-skill-size"]
	if rawBytes == "" {
		rawBytes = os.Getenv("SKILLPACK_MAX_SKILL_BYTES")
	}
	if rawBytes != "" {
		n, err := strconv.ParseInt(rawBytes, 10, 64)
		if err != nil || n <= 0 || n > githubMaxDecompressedBytes {
			return l, fail(2, fmt.Sprintf("--max-skill-size / SKILLPACK_MAX_SKILL_BYTES must be a positive integer in bytes, at most %d", githubMaxDecompressedBytes))
		}
		l.bytes = n
	}
	raw := o.values["max-skill-files"]
	if raw == "" {
		raw = os.Getenv("SKILLPACK_MAX_SKILL_FILES")
	}
	if raw != "" {
		n, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || n <= 0 || n > githubMaxTreeEntries {
			return l, fail(2, fmt.Sprintf("--max-skill-files / SKILLPACK_MAX_SKILL_FILES must be a positive integer, at most %d", githubMaxTreeEntries))
		}
		l.files = int(n)
	}
	return l, nil
}

func (l githubSkillLimits) check(size, total int64, count int) error {
	l = l.normalized()
	if size > l.bytes || total > l.bytes-size {
		return fail(5, fmt.Sprintf("GitHub skill exceeds the extracted size limit (%d bytes); raise --max-skill-size BYTES or SKILLPACK_MAX_SKILL_BYTES", l.bytes))
	}
	if count >= l.files {
		return fail(5, fmt.Sprintf("GitHub skill exceeds the file limit (%d files); raise --max-skill-files COUNT or SKILLPACK_MAX_SKILL_FILES", l.files))
	}
	return nil
}
