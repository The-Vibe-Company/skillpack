# parseDuration

`parseDuration(input)` takes a string and returns the total number of seconds as an integer.

- Input is one or more groups of `<integer><unit>`. Units are `h` (hours), `m` (minutes) and `s` (seconds).
- Units are case-insensitive: `2H` means the same as `2h`.
- Groups may come in any order, each unit at most once. Spaces between groups, and leading or trailing spaces, are ignored.
- A number without a unit is invalid.
- Throw an `Error` for any invalid input: empty string, unknown unit, a number without a unit, a repeated unit, negative or decimal numbers.
