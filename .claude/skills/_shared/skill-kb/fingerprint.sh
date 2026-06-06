#!/usr/bin/env bash
# fingerprint.sh — deterministic identity for a skill finding.
#
# Sourced by report-finding.sh / lookup-finding.sh. Provides:
#   skkb_normalize   (stdin -> normalized title on stdout)
#   skkb_fingerprint <skill> <type> <title>  -> 12-hex id on stdout
#
# The fingerprint is the LOGICAL identity of a finding: it survives across
# sessions/runs so dedup and "is this already resolved?" work. `skill` and
# `type` are part of the hash (the same symptom reported by two different skills
# is two different findings, each owned by its skill). `severity` and timestamps
# are NOT part of the hash (they change without changing identity).
#
# Pure functions, no network, failure-safe by construction.

# Normalize a title so the SAME problem phrased slightly differently — or with a
# different line number / path / hash — collapses to one fingerprint:
#   - Unicode NFD + strip combining marks  ("validación" == "validacion")
#   - lowercase
#   - replace volatile tokens (paths, line numbers, hex hashes, bare numbers)
#   - collapse every non-alphanumeric run to a single space; trim
# perl is always present on macOS; Unicode::Normalize is a core module.
skkb_normalize() {
  perl -CSD -MUnicode::Normalize -e '
    local $/; my $s = <STDIN>; $s //= "";
    $s = NFD($s);
    $s =~ s/\p{NonspacingMark}//g;                 # strip accents
    $s = lc $s;
    $s =~ s{[\w./-]*\.[a-z]{1,6}(?::\d+)?}{ pathtok }g; # file paths (+ optional :line)
    $s =~ s/\b[0-9a-f]{7,40}\b/ hashtok /g;        # git/sha hashes
    $s =~ s/\b\d+\b/ numtok /g;                     # bare numbers
    $s =~ s/[^a-z0-9]+/ /g;                          # everything else -> space
    $s =~ s/^\s+|\s+$//g; $s =~ s/\s+/ /g;
    print $s;
  ' 2>/dev/null
}

# fingerprint = sha1( skill \x1f type \x1f normalize(title) )[0:12]
skkb_fingerprint() {
  local skill="$1" type="$2" title="$3" norm
  norm="$(printf '%s' "$title" | skkb_normalize)"
  printf '%s\x1f%s\x1f%s' "$skill" "$type" "$norm" \
    | shasum -a 1 2>/dev/null | cut -c1-12
}
