# Tasks: 41207 Fix login timeout on renewal

Run each task with `/do-task 41207 <n>` in a NEW session.

---

## [x] Task 1: Add a failing test for the session lifetime

- Repo: `auth-lib`
- Verify: `dotnet test`

---

## [X] Task 2: Read the lifetime from config

- Repo: auth-lib
- Verify: `dotnet test`

---

## [ ] Task 3: Use the setting on the renewal page

- Repo: `web-app`
- Verify: `npm test`
