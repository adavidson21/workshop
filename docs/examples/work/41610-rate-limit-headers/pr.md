# PR text: 41610

One section per repo. Copy each section into ADO when you open the PR.

---

## gateway

Branch: `dev/bug/41610-rate-limit-headers` -> `main`

**Title:** Send rate limit headers on every response

**Description:**

Adds the standard rate limit headers.

- Header values come from the limiter

Testing: dotnet test, all pass.

Work item: #41610
