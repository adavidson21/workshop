# Review: 41610 Send rate limit headers

Verdict: READY

## Pass 2: Code quality

| # | Severity | Category | Location | Problem | Suggested fix |
|---|---|---|---|---|---|
| 1 | Should fix | consistency | `gateway/src/RateLimit/HeaderWriter.cs:18` | The limit is read inline instead of from options | Read it from `RateLimitOptions` |
| 2 | Nit | tests | `gateway/tests/RateLimitTests.cs:40` | Test name does not say the expected result | Rename it |
