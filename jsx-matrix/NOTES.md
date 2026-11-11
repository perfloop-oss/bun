# measurements (print-type-sizes, debug profile; layout is the same in release)
main 89452d2ac -> PR
jsx::Pragma 152 -> 64
resolver::Result 288 -> 192   (JsxConfig 56 in place of a Pragma)
TSConfigJSON 312 -> 232
resolver::BundleOptions 960 -> 808
api::TransformOptions 584 -> 752  (jsx::Sources 224 in place of Option<api::Jsx> 56)
jsx::Stated 72, jsx::ImportSource 48 -> 8, MemberList 24

# allocations (counting allocator in a unit test of bun_options_types)
per Pragma clone, states defaults / importSource / factory / both: main 0 / 4 / 2 / 6 -> PR 0 / 0 / 0 / 0
PR per resolve of two layers: 0 in all four; per masked lay of a tsconfig: 0 in all four

# matrices (debug build of the PR vs canary 1.4.4-canary.1+89452d2ac), stage b
main matrix 4662 cells: 2673 equal to main; moved: 1235 by the rule, 86 rule + R1, 108 rule + R3, 80 R1, 7 R1+R3, 6 R2, 6 R2+R3, 461 R3; 0 unexplained
special matrix 405 cells: 197 equal; 169 by the rule, 9 rule + R1, 30 R3 (scanImports); 0 unexplained
fail-before on the canary: jsx-tsconfig-react-jsx.test.ts 13 of 24 fail; bundler_jsx.test.ts 1 new test fails; parallel.test.ts 2 new tests fail
suites on the PR debug build: all pass, except parallel.test.ts "each worker has a unique JEST_WORKER_ID" (timing under the debug build, also fails on main's debug build)

# release binary size (local `bun run build:release`, same toolchain and flags)
main 89452d2ac: build/release/bun 143,284,496 bytes; size text 143,094,946; .text 112,978,537; .rodata 27,239,404; .bss 1,848,360
PR 836e79bb4:   build/release/bun 143,259,920 bytes; size text 143,068,066; .text 112,951,657; .rodata 27,239,404; .bss 1,848,616
delta: file -24,576; .text -26,880; .bss +256
tools missing in the container: perf, valgrind, bloaty (no instruction counts)

# wall clock (interleaved A/B, 15 rounds each, `bun build` of 3,001 .tsx files beside tsconfig jsx=react-jsx + jsxImportSource + jsxFactory; local release builds)
main: wall median 1346 ms (1212 to 1744), cpu median 920 ms
PR:   wall median 1377 ms (1193 to 2538), cpu median 902 ms
the delta is below the noise floor; the output of both builds is byte-identical

# state at 08:10 UTC Nov 11
branch head (local + backup robobun/c55aa873/jsx-sparse-layers-wip): ba71556a76c (B) on 3da50cb763d (A) on main 89452d2ac13. NOT yet pushed to the PR branch claude/c55aa873/bunfig-jsx-overrides-tsconfig (remote still 2b315348f9).
pushback review run 9983efd65b5b launched 05:21 UTC; act on its result, then: gh api PATCH body from pr-body-final.md, retitle, force-push with lease, update status comment 5152230786, Slack update, delete scratch branches (jsx-sparse-layers-wip, jsx-matrix-scratch) when the PR branch holds the work.
verified: unit tests (options_types 8, resolver 2, bundler 3, sema config 63); matrices stage b pass; suites pass; AOT parity-3 passes; AOT net bundler-10 (autoload) passes; clippy + fmt + prettier clean; commit A alone: cargo check all crates + unit tests pass.
unrelated slow/timeouts on this debug container: parallel.test.ts "unique JEST_WORKER_ID", bundler_edgecase DeepImportDiamondDAG (20k modules, 60 s limit, takes ~90 s here; 40,000 jsx_for calls cost 6 ms in a debug test binary), aot build-options "external" tests under concurrency.

# 17:15 UTC Nov 11 (third container)
pushback review 9983efd65b5b result (truncated, no file): wanted-in-a-different-shape / rework. Known concerns: (1) rule also beat --tsconfig-override, nested and dependency tsconfig (no ask) -> narrowed to the project's tsconfig (nearest to cwd); (2) breaking without flag: docs sample + bun init tsconfig -> ReferenceError h; review's code search: 11 of 14 public repos with disagreeing files work only because tsconfig wins (not re-verified: code search throttled) -> needs maintainer decision; (3) 41-file change overlaps Jarred's #46007 (20 files), contradicted it by pinning `--jsx-side-effects` alone as no-op -> pin removed; (4) flags/Bun.build scope unasked -> open question; (5) docs sentence unqualified (Bun.build/HTML routes do not read bunfig jsx) -> docs qualified; (6) one squash cannot be reverted separately -> two commits; the rule is switched in jsx::Sources::stated.
rebased on main 447ff870b60: A 97cbfe2a80a, B + wip commits on backup branch. canary 1.4.4-canary.1+447ff870b baselines re-recorded; special twin (project tsconfig only) moves 120 of 405.
measurements from the previous head (before narrowing): see above.
TODO after build: cargo tests (4 crates), check.sh matrices stage b, main test file on PR + canary, restructure commits, push to PR branch with lease (remote head 2b315348f9), PATCH title/body, status comment 5152230786, Slack; then parity-3, bundler-10 net, suites.

# 21:30 UTC Nov 11 (third container, review round)
claude[bot] review of ff4605f20ab: F1 pointer identity of the project tsconfig (fixed: identity by path, then by real-directory path), F2 empty --jsx-* value stated the default (fixed: states nothing), F3 in-memory Bun.build entry ignores jsx (pre-existing, handed off), F4 standalone autoloadDotenv=false (not a defect of the rule: no tsconfig JSX reaches the runtime there; the missing read is handed off), F5 nested tsconfig that extends the project's brought the option back (fixed: rule by file, TSConfigJSON.jsx_of_files + sema project_config_files), F6 bunfig default dev (#48152, unchanged), F7 plugin-resolved file ignores tsconfig layer (pre-existing, handed off with F3), F8 dead JsxStated.is_development (removed).
internal incremental review (run 9b037a7f074f): sema aot package read was masked (fixed: read_config stays plain, read_to_merge masks), path identity by spelling (fixed for symlinked directories: TSConfigJSON::name_files_under via DirInfo.abs_real_path; case-insensitive respelling is not handled), tests for chains added, docs reworded, parallel test case with non-empty flag values added.
matrices at the per-file rule (before the sema/real-path fixes): main 4662: 2673 equal, 1235 rule, 86 rule+R1, 108 rule+R3, 80 R1, 7 R1+R3, 6 R2, 6 R2+R3, 461 R3, 0 unexplained; special 465 (new group E: nested extends project / base): 279 equal, 156 rule, 30 R3, 0 unexplained.
type sizes now: TSConfigJSON 256 (main 312), resolver BundleOptions 808, Result 192.
commit A alone (cbd5460a91f at that time): cargo check -p bun_runtime passes in /workspace/bun-a (worktree with build/ and vendor/ symlinked, .cargo/config.toml copied).
CI build 140262 (ff4605f20ab): only flaky (passed on retry) annotations; no red.

# 22:50 UTC Nov 11: pushed review round
PR branch claude/c55aa873/bunfig-jsx-overrides-tsconfig = a766fa4d233 (B) on 0345c8daf4a (A) on main 447ff870b60. Backup branch has the same head.
Commits are built from the final tree with split.sh (plumbing): A = old A + final Arguments.rs, bunfig.rs, JSBundler.rs, parallel.test.ts + jsx.rs/tsconfig_json.rs from make-a-files.py; messages msg-a.txt, msg-b.txt.
Validated on the final tree: unit tests (options_types 8, resolver 3, bundler 3, sema 66), matrices stage b (main 4662: 2673 equal, 0 unexplained; special 465: 279 equal, 156 rule, 30 R3, 0 unexplained), suites (all pass; parallel "unique JEST_WORKER_ID" is timing on this debug container), AOT parity-3, bun-build-api "jsx option", clippy + fmt; fail-before on canary: jsx-tsconfig-react-jsx 15 of 27, parallel 2 of 3 JSX cases; commit A alone: cargo check -p bun_runtime, fmt, unit tests (options_types 6, resolver 2).
GitHub: body updated (GraphQL updatePullRequest, PR node PR_kwDOFVKCyc75XYdR), status comment IC_kwDOFVKCyc8AAAABMxjNgg (5152230786) updated, six claude threads replied + resolved, comment 6808893918 answers the two findings outside the diff.
Handoffs: (1) Bun.build in-memory entry ignores jsx + plugin-resolved file ignores its tsconfig JSX; (2) standalone executable: autoloadTsconfig JSX ignored when autoloadDotenv is off.
REST core quota was exhausted (shared); GraphQL works for everything (body, comments, threads).
