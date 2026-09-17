# Development Workflow

Documents the lifecycle every change must follow, from requirement to approval.

---

## Lifecycle

```text
Requirement
    ↓
Architecture
    ↓
Task Breakdown
    ↓
Implementation
    ↓
Unit Tests
    ↓
Integration Tests
    ↓
Specialist Review
    ↓
Security Review
    ↓
Documentation
    ↓
Architect Approval
```

Not every step is heavyweight for every change — match the process to the risk
(see "Specialist Review" below and `AGENTS.md`).

---

## Branching & Git Practices

- Work on **feature branches** (`feat/…`, `fix/…`, `docs/…`, etc.).
- Keep changes **small** and **focused**; one logical change per branch/PR.
- Write **meaningful commits** following the changelog categories where useful.
- **No direct changes to production**; changes flow through review.
- Use **pull-request-style review** before merge.
- **Never** commit secrets, `.env` files, credentials, or tokens.

## Pull-Request Expectations

- Reference the relevant requirement/roadmap item.
- Include tests for meaningful behavior.
- Record any architectural decision as an ADR.
- Update status docs (`PROJECT_STATUS`, `CHANGELOG`, `TEST_STATUS`) as needed.

## Specialist Review

See `AGENTS.md` for the mapping of change → specialists. High-risk areas:

- Trading / risk / financial logic → **Quant** review.
- Security-sensitive changes → **Security** review.
- Deployment / infrastructure changes → **DevOps** review.

## Documentation

- After substantial work, update affected `docs/` files.
- Add ADRs for architectural decisions.
- Record test results in `docs/TEST_STATUS.md`.

## Definition of Done

See the **Completion Rule** in `AGENTS.md`: Implementation → Tests →
Verification (actually executed) → Required specialist review → Documentation →
Status update. Nothing is COMPLETE without actual verification.