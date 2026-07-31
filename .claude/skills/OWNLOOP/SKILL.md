```markdown
# OWNLOOP Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development patterns, coding conventions, and workflows used in the OWNLOOP TypeScript codebase. OWNLOOP is organized as a multi-package repository with a focus on contract-driven development, CLI tooling, database migrations, and thorough documentation. The repository emphasizes modularity, testability, and clarity in both code and process.

## Coding Conventions

OWNLOOP follows consistent conventions to ensure readability and maintainability.

### File Naming

- **Style:** kebab-case
- **Example:**  
  `event-source-handler.ts`, `user-contract.test.ts`

### Import Style

- **Relative imports** are used throughout.
- **Example:**
  ```typescript
  import { UserContract } from './user-contract'
  import { createFixture } from '../../test-fixtures/src/create-fixture'
  ```

### Export Style

- **Named exports** are preferred.
- **Example:**
  ```typescript
  // Good
  export function createUser() { ... }
  export type UserContract = { ... }

  // Avoid default exports
  ```

### Commit Patterns

- **Type:** ticket-reference (commits reference tickets/issues)
- **Prefixes:** `docs` for documentation changes
- **Average message length:** ~45 characters

## Workflows

### Feature Development with Contracts, Tests, and Fixtures

**Trigger:** When adding a new Codex contract or event source  
**Command:** `/new-codex-contract`

1. **Add contract/type file(s):**  
   Create new TypeScript files in `packages/contracts/src/` for your contract or type.
   ```typescript
   // packages/contracts/src/user-contract.ts
   export type UserContract = { id: string; name: string }
   ```
2. **Add fixtures:**  
   Add corresponding fixture files in `packages/test-fixtures/src/`.
   ```typescript
   // packages/test-fixtures/src/user-contract.fixture.ts
   export const userFixture = { id: 'u1', name: 'Alice' }
   ```
3. **Write tests:**  
   Place test files in `packages/contracts/tests/` or `packages/event-model/tests/`.
   ```typescript
   // packages/contracts/tests/user-contract.test.ts
   import { describe, it, expect } from 'vitest'
   import { UserContract } from '../src/user-contract'

   describe('UserContract', () => {
     it('should have required fields', () => {
       const user: UserContract = { id: 'u1', name: 'Alice' }
       expect(user.id).toBeTypeOf('string')
     })
   })
   ```
4. **Expose in index files:**  
   Export your new contract or fixture in the relevant `index.ts`.
   ```typescript
   // packages/contracts/src/index.ts
   export * from './user-contract'
   ```

---

### CLI or Adapter Tooling Development

**Trigger:** When adding or extending a CLI or adapter tool for Codex  
**Command:** `/new-cli-tool`

1. **Add or update configuration:**  
   Edit `package.json` and `tsconfig.json` in the tool's workspace.
2. **Implement core logic:**  
   Add implementation files in `src/`.
   ```typescript
   // tools/codex-hook-adapter/src/cli.ts
   export function runCli() { /* ... */ }
   ```
3. **Add CLI entrypoint:**  
   Create or update `src/index.ts` as the entrypoint.
   ```typescript
   // tools/codex-hook-adapter/src/index.ts
   import { runCli } from './cli'
   runCli()
   ```
4. **Write tests:**  
   Place test files as `*.test.ts` in the tool directory.
5. **Document the tool:**  
   Update or create `README.md` in the tool directory.

---

### Database Migration Development and Finalization

**Trigger:** When introducing or finalizing a new database migration  
**Command:** `/new-migration`

1. **Stage migration patch:**  
   Add a patch file in `.ol027-transfer/`.
   ```
   .ol027-transfer/add-user-table.patch
   ```
2. **Update migration definitions:**  
   Edit files in `apps/daemon/src/persistence/`, such as `migration-definitions.ts`.
3. **Write or update migration tests:**  
   Add or update tests like `migration-v2.test.ts` or `migrations.test.ts`.
4. **Update/create CI workflow:**  
   Add or modify workflow files in `.github/workflows/` (e.g., `finalize-ol027-migration-v2.yml`).
5. **Iterate until finalized:**  
   Refine patch and workflow files as needed.

---

### Documentation and Architecture Recording

**Trigger:** When documenting new architecture, research, or tool boundaries  
**Command:** `/record-architecture`

1. **Write ADR or research markdown:**  
   Add files to `docs/adr/` or `docs/research/`.
2. **Document tool boundaries or architecture:**  
   Update the relevant `README.md` in the tool's directory.
3. **Link related documentation:**  
   Cross-reference between `README.md` and ADR/research documents.

---

## Testing Patterns

- **Framework:** [Vitest](https://vitest.dev/)
- **Test files:** Named with `.test.ts` suffix, placed alongside or near the code under test.
- **Example:**
  ```typescript
  // packages/contracts/tests/user-contract.test.ts
  import { describe, it, expect } from 'vitest'
  import { UserContract } from '../src/user-contract'

  describe('UserContract', () => {
    it('should have required fields', () => {
      const user: UserContract = { id: 'u1', name: 'Alice' }
      expect(user.name).toBe('Alice')
    })
  })
  ```

## Commands

| Command               | Purpose                                                      |
|-----------------------|--------------------------------------------------------------|
| /new-codex-contract   | Start a new contract/event source with types, fixtures, tests|
| /new-cli-tool         | Scaffold or extend a CLI or adapter tool                     |
| /new-migration        | Begin a new database migration workflow                      |
| /record-architecture  | Record architecture decisions or research documentation      |
```