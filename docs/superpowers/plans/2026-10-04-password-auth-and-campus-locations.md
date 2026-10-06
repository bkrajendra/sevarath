# Password Auth & Real Campus Locations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Flutter user app's mock data with a real, working login (mobile/email + password, self-hosted — no Firebase dependency required) and real campus-locations data from `apps/api`, completing the actually-achievable part of the Phase 3 "wire the Flutter app to apps/api" deliverable.

**Architecture:** Every `apps/api` endpoint (including `GET /campus/locations`) requires a bearer JWT, and the only way to get one today is `POST /auth/login` with a Firebase ID token — which the Flutter client has no way to obtain (no Firebase client config exists, and standing one up requires external Firebase Console access this plan doesn't have). Per a live decision with the project owner, we add a second, parallel auth path: `POST /auth/register` and `POST /auth/login/password`, both backed by a bcrypt-hashed password column on `users`. Firebase/OTP login stays in the codebase untouched as a dormant "enable only" path for a later phase — nothing about it is removed. Once a token can be obtained, the Flutter app gets a thin network layer (Dio + flutter_secure_storage), Login/Register screens, router-level auth gating, and campus locations fetched for real instead of from `mock_campus_data.dart`.

**Tech Stack:** NestJS (Drizzle ORM, class-validator, bcryptjs), Flutter (Riverpod `Notifier`, `go_router`, `dio`, `flutter_secure_storage`).

**Spec:** [docs/architecture.md §9.4](../../architecture.md#94-identity-layer), [docs/plan.md Phase 3](../../plan.md#phase-3---campus-map--location-selection) — this plan also amends both (Task 5) to record the password-auth decision, since neither currently mentions it.

## Global Constraints

- Every new backend endpoint follows the existing DTO + `class-validator` + Swagger (`@ApiProperty`) convention already used throughout `apps/api/src/campus` and `apps/api/src/auth`.
- Backend tests that touch Postgres are integration-spec style (`apps/api/test/*.integration-spec.ts`, direct service instantiation against `process.env.DATABASE_URL`, `describe.skip`'d when that env var is absent) — matching `users.service.integration-spec.ts` and `campus.integration-spec.ts`. Do not introduce a different testing style (e.g. full Nest `TestingModule` HTTP e2e) for this work.
- `firebaseUid` becomes nullable but is never dropped — existing Firebase-login code paths (`AuthService.loginWithFirebaseToken`, `FirebaseStrategy`) must keep working unmodified.
- Flutter: no `riverpod_generator`/codegen is in this project; use plain `Notifier`/`Provider` classes, matching how the rest of `apps/mobile` is written (plain `StatefulWidget`s, no codegen anywhere).
- Flutter: `flutter analyze` must report "No issues found" after every task (this project has held that bar all session — don't be the one to break it).
- Run `dart format <changed files>` before every commit (established convention this session).

## Review Focus

- Registering with a mobile number or email that's already in use must be rejected with a clear error, not a silent duplicate row or a 500. (Task 2)
- Logging in with the wrong password must be rejected — and must not leak whether the account exists (`identifier` wrong vs. `password` wrong should give the same message). (Task 2)
- A legacy/Firebase-only account (no `password_hash` set) attempting password login must be rejected cleanly, not crash on `bcrypt.compare(password, null)`. (Task 2)
- The campus-locations screens must handle the loading and error/unreachable-API states, not just the happy path with data — `select_destination_screen.dart` and `home_screen.dart` currently assume a synchronous, always-present list. (Task 14)
- `select_destination_screen.dart`'s filter chips ("Gates"/"Buildings"/"Facilities") currently match on hardcoded mock IDs like `'main-gate'`, which will never match a real UUID — this would silently break filtering once real data lands if not fixed. (Task 14)

---

## Task 1: Users schema — nullable `firebase_uid`, add `password_hash`

**Files:**
- Modify: `apps/api/src/db/schema/users.ts`
- Generate: `apps/api/src/db/migrations/0001_*.sql` (name chosen by drizzle-kit)

**Interfaces:**
- Produces: `User.passwordHash: string | null`, `User.firebaseUid: string | null`, `NewUser.passwordHash?: string | null`, `NewUser.firebaseUid?: string | null` — consumed by Task 2.

- [ ] **Step 1: Edit the schema**

```ts
// apps/api/src/db/schema/users.ts
import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { userRoleEnum, userStatusEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    mobile: text('mobile').notNull(),
    email: text('email'),
    passwordHash: text('password_hash'),
    role: userRoleEnum('role').notNull().default('USER'),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    firebaseUid: text('firebase_uid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mobileIdx: uniqueIndex('users_mobile_idx').on(table.mobile),
    firebaseUidIdx: uniqueIndex('users_firebase_uid_idx').on(table.firebaseUid),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

Only two lines changed from the current file: `firebaseUid: text('firebase_uid')` (dropped `.notNull()`) and the new `passwordHash: text('password_hash')` line. Postgres unique indexes allow multiple NULLs, so making `firebase_uid` nullable doesn't weaken the uniqueness guarantee for rows that do have one.

- [ ] **Step 2: Start local Postgres and generate the migration**

```bash
cd /c/projects/sevarath
docker compose up -d postgres
cd apps/api
pnpm db:generate
```

Expected: a new file appears under `src/db/migrations/`, e.g. `0001_<two-word-name>.sql`, containing roughly:
```sql
ALTER TABLE "users" ALTER COLUMN "firebase_uid" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "password_hash" text;
```

- [ ] **Step 3: Apply the migration**

```bash
pnpm db:migrate
```

Expected output: `Migrations applied`.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/users.ts src/db/migrations
git commit -m "feat(api): make firebase_uid optional and add password_hash to users"
```

---

## Task 2: Password registration and login endpoints

**Files:**
- Create: `apps/api/src/auth/dto/register.dto.ts`
- Create: `apps/api/src/auth/dto/password-login.dto.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/package.json` (add `bcryptjs`, `@types/bcryptjs`)
- Test: `apps/api/test/auth-password.integration-spec.ts`

**Interfaces:**
- Consumes: `UsersService.findByMobileOrEmail(mobile?, email?)`, `UsersService.create(data: NewUser)` (both already exist, unchanged).
- Produces: `AuthService.register(dto: RegisterDto): Promise<TokenResponseDto>`, `AuthService.loginWithPassword(dto: PasswordLoginDto): Promise<TokenResponseDto>` — consumed by Task 14 (Flutter `AuthRepository` calls `POST /auth/register` and `POST /auth/login/password`, which return the same `TokenResponseDto` shape as the existing Firebase login).

- [ ] **Step 1: Add the password-hashing dependency**

```bash
cd /c/projects/sevarath/apps/api
pnpm add bcryptjs
pnpm add -D @types/bcryptjs
```

- [ ] **Step 2: Write the DTOs**

```ts
// apps/api/src/auth/dto/register.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({
    example: '+911234567890',
    description: 'E.164-ish mobile number - the primary account identifier',
  })
  @Matches(/^\+?[1-9]\d{7,14}$/, {
    message: 'mobile must be a valid phone number, e.g. +911234567890',
  })
  mobile!: string;

  @ApiPropertyOptional({ example: 'jane@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password!: string;
}
```

```ts
// apps/api/src/auth/dto/password-login.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class PasswordLoginDto {
  @ApiProperty({ example: '+911234567890 or jane@example.com', description: 'Mobile number or email' })
  @IsString()
  @MinLength(3)
  identifier!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;
}
```

- [ ] **Step 3: Write the failing integration test**

```ts
// apps/api/test/auth-password.integration-spec.ts
import 'reflect-metadata';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as schema from '../src/db/schema';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';

/**
 * Requires a real Postgres (see .github/workflows/ci.yml's `postgres` service and
 * DATABASE_URL) - password hashing/verification and the duplicate-account check are
 * cheap to get subtly wrong and worth proving against real inserts, not mocks.
 */
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('AuthService password auth (integration)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let usersService: UsersService;
  let authService: AuthService;
  const testMobile = '+910000000098';

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    usersService = new UsersService(db);
    const config = new ConfigService({
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      JWT_REFRESH_TTL: '30d',
    });
    authService = new AuthService(usersService, new JwtService({}), config);
  });

  afterEach(async () => {
    await db.delete(schema.users).where(eq(schema.users.mobile, testMobile));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('registers a new user, hashes the password, and issues tokens', async () => {
    const result = await authService.register({
      name: 'Password Test User',
      mobile: testMobile,
      email: 'password-auth-test@example.com',
      password: 'correct horse battery staple',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.role).toBe('USER');

    const stored = await usersService.findByMobileOrEmail(testMobile);
    expect(stored?.passwordHash).toBeDefined();
    expect(stored?.passwordHash).not.toBe('correct horse battery staple');
  });

  it('rejects registration with a mobile number that is already in use', async () => {
    await authService.register({ name: 'First', mobile: testMobile, password: 'password one' });

    await expect(
      authService.register({ name: 'Second', mobile: testMobile, password: 'password two' }),
    ).rejects.toThrow('An account with this mobile number or email already exists');
  });

  it('logs in with the correct password using mobile as the identifier', async () => {
    await authService.register({ name: 'Login Test', mobile: testMobile, password: 'correct horse battery staple' });

    const result = await authService.loginWithPassword({
      identifier: testMobile,
      password: 'correct horse battery staple',
    });

    expect(result.accessToken).toBeDefined();
  });

  it('rejects an incorrect password', async () => {
    await authService.register({ name: 'Wrong Pw Test', mobile: testMobile, password: 'correct horse battery staple' });

    await expect(
      authService.loginWithPassword({ identifier: testMobile, password: 'wrong password' }),
    ).rejects.toThrow('Invalid mobile/email or password');
  });

  it('rejects password login for a Firebase-only account with no password set', async () => {
    await usersService.create({
      name: 'Firebase Only',
      mobile: testMobile,
      role: 'USER',
      status: 'ACTIVE',
      firebaseUid: 'some-firebase-uid-for-test',
    });

    await expect(
      authService.loginWithPassword({ identifier: testMobile, password: 'anything' }),
    ).rejects.toThrow('Invalid mobile/email or password');
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
cd /c/projects/sevarath/apps/api
DATABASE_URL=postgres://sevarath:sevarath@localhost:5433/sevarath pnpm test -- auth-password
```

Expected: FAIL — `authService.register is not a function`.

- [ ] **Step 5: Implement `AuthService.register` and `AuthService.loginWithPassword`**

```ts
// apps/api/src/auth/auth.service.ts
// Add to the existing imports:
import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { RegisterDto } from './dto/register.dto';
import type { PasswordLoginDto } from './dto/password-login.dto';

// Add near the top of the class, alongside other private members:
const SALT_ROUNDS = 10;

// Add these two methods to AuthService (anywhere after the constructor, e.g. before `refresh`):

  /**
   * Self-hosted mobile/email + password registration - the primary sign-up
   * path for now. Firebase/OTP (loginWithFirebaseToken above) stays wired up
   * as a dormant, optional path; see docs/architecture.md §9.4.
   */
  async register(dto: RegisterDto): Promise<TokenResponseDto> {
    const existing = await this.usersService.findByMobileOrEmail(dto.mobile, dto.email);
    if (existing) {
      throw new ConflictException('An account with this mobile number or email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const created = await this.usersService.create({
      name: dto.name,
      mobile: dto.mobile,
      email: dto.email,
      role: 'USER',
      status: 'ACTIVE',
      passwordHash,
    });
    return this.issueTokens(created);
  }

  async loginWithPassword(dto: PasswordLoginDto): Promise<TokenResponseDto> {
    const user = await this.usersService.findByMobileOrEmail(dto.identifier, dto.identifier);
    // Same message whether the account doesn't exist, has no password set
    // (Firebase-only), or the password is wrong - don't leak which case it is.
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid mobile/email or password');
    }

    const matches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid mobile/email or password');
    }

    return this.issueTokens(user);
  }
```

Note `ConflictException` must be added to the existing `@nestjs/common` import line at the top of the file (currently `import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';`).

- [ ] **Step 6: Add the controller endpoints**

```ts
// apps/api/src/auth/auth.controller.ts
// Add to imports:
import { RegisterDto } from './dto/register.dto';
import { PasswordLoginDto } from './dto/password-login.dto';

// Add these two methods to AuthController, after the existing `login` method:

  /** Self-hosted registration - mobile + email + password. No Firebase required. */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ type: RegisterDto })
  @ApiOkResponse({ type: TokenResponseDto })
  async register(@Body() dto: RegisterDto): Promise<TokenResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login/password')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: PasswordLoginDto })
  @ApiOkResponse({ type: TokenResponseDto })
  async loginWithPassword(@Body() dto: PasswordLoginDto): Promise<TokenResponseDto> {
    return this.authService.loginWithPassword(dto);
  }
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd /c/projects/sevarath/apps/api
DATABASE_URL=postgres://sevarath:sevarath@localhost:5433/sevarath pnpm test -- auth-password
```

Expected: PASS, 5/5 tests.

- [ ] **Step 8: Run the full API test suite and lint to make sure nothing else broke**

```bash
DATABASE_URL=postgres://sevarath:sevarath@localhost:5433/sevarath pnpm test
pnpm build
```

Expected: all tests pass, build succeeds (this also catches any TypeScript error from the `firebaseUid`/`passwordHash` schema change rippling elsewhere).

- [ ] **Step 9: Commit**

```bash
git add src/auth package.json pnpm-lock.yaml test/auth-password.integration-spec.ts
git commit -m "feat(api): add mobile/email + password registration and login"
```

---

## Task 3: Enable CORS

Needed so a browser-run Flutter web build (what this session has been using for all testing, given local Android builds OOM on this machine) can call the API from a different origin/port.

**Files:**
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: Add CORS**

```ts
// apps/api/src/main.ts
// Immediately after `const app = await NestFactory.create(AppModule);`:
  // Permissive for now (internal/on-prem system, pre-production) - tighten to an
  // explicit origin allowlist before any public-facing deployment.
  app.enableCors({ origin: true, credentials: true });
```

- [ ] **Step 2: Verify the API still boots**

```bash
cd /c/projects/sevarath/apps/api
pnpm build
```

Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(api): enable CORS for browser-based clients"
```

---

## Task 4: Campus locations seed script

Without this, `GET /campus/locations` returns an empty array and there's nothing to verify the Flutter wiring against — no seed script exists anywhere in the repo yet.

**Files:**
- Create: `apps/api/src/db/seed.ts`
- Modify: `apps/api/package.json` (add `db:seed` script)

- [ ] **Step 1: Write the seed script**

```ts
// apps/api/src/db/seed.ts
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { campusLocations, type NewCampusLocation } from './schema';

// Same nine campus locations the Flutter app's mock data used, with real
// coordinates in the Abu Road / Shantivan bbox already referenced elsewhere
// in the app (e.g. apps/mobile lib/features/ride/confirm_ride_screen.dart).
const locations: NewCampusLocation[] = [
  { name: 'Main Gate', type: 'GATE', latitude: 24.4828, longitude: 72.782, description: 'Headquarters' },
  { name: 'Reception', type: 'RECEPTION', latitude: 24.4832, longitude: 72.7825, description: 'Administration' },
  { name: 'Shantivan', type: 'BUILDING', latitude: 24.485, longitude: 72.785, description: 'Meditation Complex' },
  { name: 'Gyan Sarovar', type: 'OTHER', latitude: 24.4815, longitude: 72.7808, description: 'Lake Area' },
  { name: 'Tapovan', type: 'RESIDENCE', latitude: 24.4841, longitude: 72.7838, description: 'Accommodation' },
  { name: 'Dining Hall', type: 'DINING', latitude: 24.4836, longitude: 72.7816, description: 'Food Court' },
  { name: 'Hospital', type: 'MEDICAL', latitude: 24.4822, longitude: 72.7831, description: 'Medical Services' },
  { name: 'Parking Area', type: 'PARKING', latitude: 24.4826, longitude: 72.7812, description: 'EV Parking' },
  { name: 'Om Shanti Bhawan', type: 'BUILDING', latitude: 24.4845, longitude: 72.7822, description: 'Conference Hall' },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const existing = await db.select().from(campusLocations).limit(1);
  if (existing.length > 0) {
    console.log('campus_locations already has data - skipping seed');
    await pool.end();
    return;
  }

  await db.insert(campusLocations).values(locations);
  console.log(`Seeded ${locations.length} campus locations`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

```json
// apps/api/package.json - add next to the existing "db:generate"/"db:migrate" lines:
    "db:seed": "tsx src/db/seed.ts"
```

- [ ] **Step 3: Run it**

```bash
cd /c/projects/sevarath/apps/api
pnpm db:seed
```

Expected: `Seeded 9 campus locations`. Running it again should print `campus_locations already has data - skipping seed`.

- [ ] **Step 4: Commit**

```bash
git add src/db/seed.ts package.json
git commit -m "feat(api): add campus locations seed script"
```

---

## Task 5: Update architecture/plan docs for the password-auth decision

**Files:**
- Modify: `docs/architecture.md` (§9.4 Identity Layer)
- Modify: `docs/plan.md` (Phase 3 checklist + Open Decisions)

- [ ] **Step 1: Amend architecture.md §9.4**

In `docs/architecture.md`, replace the §9.4 paragraph (currently starting "NestJS Passport strategies sit directly in front of the Auth module:") with:

```markdown
### 9.4 Identity Layer

NestJS Passport strategies sit directly in front of the Auth module. Two independent paths both terminate in the same JWT issuance (`AuthService.issueTokens`), so downstream RBAC/guards are identical regardless of how the user authenticated:

* **Mobile/email + password (primary, self-hosted).** `POST /auth/register` and `POST /auth/login/password`, backed by a bcrypt-hashed `password_hash` column on `users`. Chosen over Firebase as the default path to keep the system fully on-premise/open-source and avoid Firebase's paid tiers for production SMS delivery. No OTP verification yet - mobile numbers are taken at face value on registration; OTP verification is a follow-up phase.
* **Firebase (Google OAuth SSO + Phone-OTP) - optional, not currently wired into either Flutter app's UI.** The code (`FirebaseStrategy`, `POST /auth/login` with a Firebase ID token) is untouched and still works end-to-end once a Firebase project's client config is added to the Flutter apps; it's simply not the default sign-up/sign-in flow right now. `DRIVER`/`ADMIN`/`OPERATOR` accounts via this path still must be pre-provisioned by an Admin, as before.

**Concrete provider for the optional path: Firebase Authentication**, as previously described - handled client-side by the Firebase Auth SDK, verified server-side via `firebase-admin`.
```

- [ ] **Step 2: Update plan.md's Phase 3 checklist item**

In `docs/plan.md`, find the line:
```
* [ ] Wire the Flutter app to apps/api (real auth, campus locations, booking) - currently mock data
```
Replace it with:
```
* [x] Wire the Flutter app to apps/api - real mobile/email+password auth and real campus locations (see docs/architecture.md §9.4 for the password-vs-Firebase decision). Booking is still mock data - blocked on Phase 4 (`rides`/`dispatch` are empty scaffold modules, not yet implemented).
```

- [ ] **Step 3: Add a row to the Open Decisions table**

In `docs/plan.md`'s Open Decisions table (section 1), add a row:
```
| Mobile OTP verification | Deferred - registration currently trusts the mobile number as entered, no SMS verification | Before production rollout |
```

- [ ] **Step 4: Commit**

```bash
cd /c/projects/sevarath
git add docs/architecture.md docs/plan.md
git commit -m "docs: record the password-auth-as-primary decision"
```

---

## Task 6: Flutter networking foundation — config, token storage, API client

**Files:**
- Modify: `apps/mobile/pubspec.yaml`
- Create: `apps/mobile/lib/core/config/api_config.dart`
- Create: `apps/mobile/lib/core/network/token_storage.dart`
- Create: `apps/mobile/lib/core/network/api_client.dart`
- Test: `apps/mobile/test/token_storage_test.dart`

**Interfaces:**
- Produces: `TokenStorage.save({accessToken, refreshToken})`, `.readAccessToken()`, `.readRefreshToken()`, `.clear()`; `ApiClient.dio` (a configured `Dio` instance) — consumed by Task 8 (`AuthRepository`) and Task 14 (`CampusLocationsRepository`).

- [ ] **Step 1: Add dependencies**

**Do not pin `flutter_secure_storage` to `^9.2.2`** — that line requires `win32 ^5.0.0` via `flutter_secure_storage_windows`, which conflicts with the `win32 ^6.0.0` this project's existing `geolocator: ^14.1.1` already forces (via `geolocator_linux` → `package_info_plus`). Add it unpinned and let pub resolve whatever's actually compatible today (confirmed to land on the 10.x/11.x line, both of which resolve `flutter_secure_storage_platform_interface` to `2.1.1`):

```bash
cd /c/projects/sevarath/apps/mobile
flutter pub add dio:^5.7.0
flutter pub add flutter_secure_storage
```

Step 3's test fakes `flutter_secure_storage`'s platform interface directly. That package is currently only a *transitive* dependency (pulled in by `flutter_secure_storage`), and this project's `flutter_lints` preset includes `depend_on_referenced_packages`, which flags importing a package not listed directly in `pubspec.yaml`. Add it explicitly as a dev dependency too, so `flutter analyze` stays clean:

```bash
flutter pub add --dev flutter_secure_storage_platform_interface
```

This resolves to `flutter_secure_storage_platform_interface 2.1.1`, whose abstract `FlutterSecureStoragePlatform` class declares three more fully-abstract methods beyond `write`/`read`/`delete`: `containsKey`, `readAll`, `deleteAll` (`checkUpgradeStatus` has a default body and does not need overriding). Step 3's `_FakeSecureStorage` below already includes all three.

- [ ] **Step 2: API base URL config**

```dart
// apps/mobile/lib/core/config/api_config.dart
/// Base URL for apps/api. Override at build/run time with
/// `--dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1` for the Android
/// emulator (which can't reach the host via `localhost`), or similarly for a
/// physical device or real deployment.
class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );
}
```

- [ ] **Step 3: Write the failing test for TokenStorage**

```dart
// apps/mobile/test/token_storage_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';
import 'package:sevarath_mobile/core/network/token_storage.dart';

class _FakeSecureStorage extends FlutterSecureStoragePlatform {
  final Map<String, String> _data = {};

  @override
  Future<void> write({
    required String key,
    required String? value,
    required Map<String, String> options,
  }) async {
    if (value == null) {
      _data.remove(key);
    } else {
      _data[key] = value;
    }
  }

  @override
  Future<String?> read({required String key, required Map<String, String> options}) async =>
      _data[key];

  @override
  Future<bool> containsKey({required String key, required Map<String, String> options}) async =>
      _data.containsKey(key);

  @override
  Future<void> delete({required String key, required Map<String, String> options}) async {
    _data.remove(key);
  }

  @override
  Future<Map<String, String>> readAll({required Map<String, String> options}) async =>
      Map<String, String>.from(_data);

  @override
  Future<void> deleteAll({required Map<String, String> options}) async {
    _data.clear();
  }
}

void main() {
  late TokenStorage storage;

  setUp(() {
    FlutterSecureStoragePlatform.instance = _FakeSecureStorage();
    storage = TokenStorage();
  });

  test('save then read round-trips both tokens', () async {
    await storage.save(accessToken: 'access-123', refreshToken: 'refresh-456');

    expect(await storage.readAccessToken(), 'access-123');
    expect(await storage.readRefreshToken(), 'refresh-456');
  });

  test('clear removes both tokens', () async {
    await storage.save(accessToken: 'access-123', refreshToken: 'refresh-456');
    await storage.clear();

    expect(await storage.readAccessToken(), isNull);
    expect(await storage.readRefreshToken(), isNull);
  });
}
```

- [ ] **Step 4: Run it to verify it fails**

```bash
cd /c/projects/sevarath/apps/mobile
flutter test test/token_storage_test.dart
```

Expected: FAIL — `token_storage.dart` doesn't exist yet.

- [ ] **Step 5: Implement TokenStorage**

```dart
// apps/mobile/lib/core/network/token_storage.dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the access/refresh JWT pair issued by POST /auth/register and
/// /auth/login/*. Backed by flutter_secure_storage (Keystore/Keychain on
/// mobile; browser storage on web - acceptable for this app's threat model
/// at this stage).
class TokenStorage {
  TokenStorage({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _accessKey = 'sevarath_access_token';
  static const _refreshKey = 'sevarath_refresh_token';

  Future<void> save({required String accessToken, required String refreshToken}) async {
    await _storage.write(key: _accessKey, value: accessToken);
    await _storage.write(key: _refreshKey, value: refreshToken);
  }

  Future<String?> readAccessToken() => _storage.read(key: _accessKey);

  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  Future<void> clear() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
flutter test test/token_storage_test.dart
```

Expected: PASS, 2/2.

- [ ] **Step 7: Implement ApiClient (auth header + 401 refresh-and-retry)**

```dart
// apps/mobile/lib/core/network/api_client.dart
import 'package:dio/dio.dart';
import '../config/api_config.dart';
import 'token_storage.dart';

/// Thrown when the stored refresh token is missing or the server rejects
/// it - callers should route to /login when they see this surface as a
/// DioException's `error`.
class SessionExpiredException implements Exception {}

class ApiClient {
  ApiClient({TokenStorage? tokenStorage})
    : _tokenStorage = tokenStorage ?? TokenStorage(),
      _dio = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl)) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _tokenStorage.readAccessToken();
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final isAuthEndpoint = error.requestOptions.path.contains('/auth/');
          if (error.response?.statusCode == 401 && !isAuthEndpoint) {
            try {
              await _refreshTokens();
              final retried = await _dio.fetch(error.requestOptions);
              handler.resolve(retried);
              return;
            } catch (_) {
              await _tokenStorage.clear();
              handler.reject(
                DioException(requestOptions: error.requestOptions, error: SessionExpiredException()),
              );
              return;
            }
          }
          handler.next(error);
        },
      ),
    );
  }

  final Dio _dio;
  final TokenStorage _tokenStorage;

  Dio get dio => _dio;

  Future<void> _refreshTokens() async {
    final refreshToken = await _tokenStorage.readRefreshToken();
    if (refreshToken == null) {
      throw SessionExpiredException();
    }
    final response = await _dio.post('/auth/refresh', data: {'refreshToken': refreshToken});
    final data = response.data as Map<String, dynamic>;
    await _tokenStorage.save(
      accessToken: data['accessToken'] as String,
      refreshToken: data['refreshToken'] as String,
    );
  }
}
```

- [ ] **Step 8: Analyze and format**

```bash
dart format lib/core/config/api_config.dart lib/core/network/token_storage.dart lib/core/network/api_client.dart test/token_storage_test.dart
flutter analyze
```

Expected: "No issues found!".

- [ ] **Step 9: Commit**

```bash
git add pubspec.yaml pubspec.lock lib/core/config/api_config.dart lib/core/network test/token_storage_test.dart
git commit -m "feat(mobile): add Dio API client with token storage and auto-refresh"
```

---

## Task 7: Auth models and repository

**Files:**
- Create: `apps/mobile/lib/features/auth/models/auth_tokens.dart`
- Create: `apps/mobile/lib/features/auth/models/user_profile.dart`
- Create: `apps/mobile/lib/features/auth/data/auth_repository.dart`
- Test: `apps/mobile/test/auth_repository_test.dart`

**Interfaces:**
- Consumes: `ApiClient.dio`, `TokenStorage` (Task 6).
- Produces: `AuthRepository.register(...)`, `.login(...)`, `.getCurrentUser()`, `.hasValidSession()`, `.logout()`; `AuthException(message)` — consumed by Task 9 (`AuthController`).

- [ ] **Step 1: Write the models**

```dart
// apps/mobile/lib/features/auth/models/auth_tokens.dart
class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.role,
    required this.userId,
  });

  factory AuthTokens.fromJson(Map<String, dynamic> json) => AuthTokens(
    accessToken: json['accessToken'] as String,
    refreshToken: json['refreshToken'] as String,
    role: json['role'] as String,
    userId: json['userId'] as String,
  );

  final String accessToken;
  final String refreshToken;
  final String role;
  final String userId;
}
```

```dart
// apps/mobile/lib/features/auth/models/user_profile.dart
class UserProfile {
  const UserProfile({
    required this.id,
    required this.name,
    required this.mobile,
    this.email,
    required this.role,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
    id: json['id'] as String,
    name: json['name'] as String,
    mobile: json['mobile'] as String,
    email: json['email'] as String?,
    role: json['role'] as String,
  );

  final String id;
  final String name;
  final String mobile;
  final String? email;
  final String role;
}
```

- [ ] **Step 2: Write the failing test for AuthRepository's error-message mapping**

This is the one piece of genuinely trIcky logic in the repository (turning a NestJS validation/exception response into a readable string) - everything else is thin HTTP plumbing, so this is the test worth writing first.

```dart
// apps/mobile/test/auth_repository_test.dart
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sevarath_mobile/features/auth/data/auth_repository.dart';

void main() {
  group('AuthRepository error-message mapping', () {
    test('joins a validation-error array into one message', () {
      final dioError = DioException(
        requestOptions: RequestOptions(path: '/auth/register'),
        response: Response(
          requestOptions: RequestOptions(path: '/auth/register'),
          statusCode: 400,
          data: {
            'statusCode': 400,
            'message': ['password must be at least 8 characters', 'mobile must be a valid phone number'],
          },
        ),
      );

      expect(
        messageForAuthError(dioError),
        'password must be at least 8 characters, mobile must be a valid phone number',
      );
    });

    test('passes through a single string message', () {
      final dioError = DioException(
        requestOptions: RequestOptions(path: '/auth/login/password'),
        response: Response(
          requestOptions: RequestOptions(path: '/auth/login/password'),
          statusCode: 401,
          data: {'statusCode': 401, 'message': 'Invalid mobile/email or password'},
        ),
      );

      expect(messageForAuthError(dioError), 'Invalid mobile/email or password');
    });

    test('falls back to a generic message when the response has no body', () {
      final dioError = DioException(requestOptions: RequestOptions(path: '/auth/login/password'));

      expect(messageForAuthError(dioError), 'Something went wrong. Please try again.');
    });
  });
}
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd /c/projects/sevarath/apps/mobile
flutter test test/auth_repository_test.dart
```

Expected: FAIL — `auth_repository.dart` doesn't exist yet.

- [ ] **Step 4: Implement AuthRepository**

```dart
// apps/mobile/lib/features/auth/data/auth_repository.dart
import 'package:dio/dio.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/token_storage.dart';
import '../models/auth_tokens.dart';
import '../models/user_profile.dart';

class AuthException implements Exception {
  AuthException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Extracts a human-readable message from a failed auth call. NestJS's
/// ValidationPipe returns `message` as a string array for field-validation
/// failures, and as a plain string for thrown exceptions like
/// ConflictException/UnauthorizedException - handle both.
String messageForAuthError(DioException error) {
  final data = error.response?.data;
  if (data is Map && data['message'] != null) {
    final message = data['message'];
    if (message is List) return message.join(', ');
    return message.toString();
  }
  return 'Something went wrong. Please try again.';
}

class AuthRepository {
  AuthRepository({ApiClient? apiClient, TokenStorage? tokenStorage})
    : _apiClient = apiClient ?? ApiClient(),
      _tokenStorage = tokenStorage ?? TokenStorage();

  final ApiClient _apiClient;
  final TokenStorage _tokenStorage;

  Future<AuthTokens> register({
    required String name,
    required String mobile,
    String? email,
    required String password,
  }) async {
    try {
      final response = await _apiClient.dio.post(
        '/auth/register',
        data: {
          'name': name,
          'mobile': mobile,
          if (email != null && email.isNotEmpty) 'email': email,
          'password': password,
        },
      );
      final tokens = AuthTokens.fromJson(response.data as Map<String, dynamic>);
      await _tokenStorage.save(accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
      return tokens;
    } on DioException catch (e) {
      throw AuthException(messageForAuthError(e));
    }
  }

  Future<AuthTokens> login({required String identifier, required String password}) async {
    try {
      final response = await _apiClient.dio.post(
        '/auth/login/password',
        data: {'identifier': identifier, 'password': password},
      );
      final tokens = AuthTokens.fromJson(response.data as Map<String, dynamic>);
      await _tokenStorage.save(accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
      return tokens;
    } on DioException catch (e) {
      throw AuthException(messageForAuthError(e));
    }
  }

  Future<UserProfile> getCurrentUser() async {
    final response = await _apiClient.dio.get('/users/me');
    return UserProfile.fromJson(response.data as Map<String, dynamic>);
  }

  Future<bool> hasValidSession() async {
    final token = await _tokenStorage.readAccessToken();
    return token != null;
  }

  Future<void> logout() => _tokenStorage.clear();
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
flutter test test/auth_repository_test.dart
```

Expected: PASS, 3/3.

- [ ] **Step 6: Analyze and format**

```bash
dart format lib/features/auth/models lib/features/auth/data test/auth_repository_test.dart
flutter analyze
```

- [ ] **Step 7: Commit**

```bash
git add lib/features/auth/models lib/features/auth/data test/auth_repository_test.dart
git commit -m "feat(mobile): add AuthRepository for register/login/current-user"
```

---

## Task 8: Auth state (Riverpod) and router bridge

**Files:**
- Create: `apps/mobile/lib/core/router/auth_router_notifier.dart`
- Create: `apps/mobile/lib/features/auth/providers/auth_provider.dart`

**Interfaces:**
- Consumes: `AuthRepository` (Task 7).
- Produces: `authControllerProvider` (`NotifierProvider<AuthController, AuthState>`), `AuthState{status, errorMessage, user}`, `AuthStatus{unknown, authenticated, unauthenticated}`, `authRouterNotifier` (a `Listenable` singleton) — consumed by Task 10 (router redirect), Task 11/12 (Login/Register screens), Task 13 (Profile/Home screens).

- [ ] **Step 1: Router bridge**

`appRouter` is a plain top-level singleton (`lib/core/router/app_router.dart`), not built inside the widget tree, so it can't use `ref.listen` directly. This small `ChangeNotifier` singleton is the bridge: `AuthController` calls `.refresh()` on it after every state change, and `GoRouter`'s `refreshListenable` picks that up to re-run `redirect`.

```dart
// apps/mobile/lib/core/router/auth_router_notifier.dart
import 'package:flutter/foundation.dart';

/// Bridges AuthController's Riverpod state to GoRouter's `refreshListenable`.
/// `notifyListeners()` is `@protected` on ChangeNotifier, so this subclass
/// exposes it as `refresh()` for callers outside the class.
class AuthRouterNotifier extends ChangeNotifier {
  void refresh() => notifyListeners();
}

final authRouterNotifier = AuthRouterNotifier();
```

- [ ] **Step 2: Auth state and controller**

```dart
// apps/mobile/lib/features/auth/providers/auth_provider.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/router/auth_router_notifier.dart';
import '../data/auth_repository.dart';
import '../models/user_profile.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  const AuthState({this.status = AuthStatus.unknown, this.errorMessage, this.user});

  final AuthStatus status;
  final String? errorMessage;
  final UserProfile? user;

  AuthState copyWith({AuthStatus? status, String? errorMessage, UserProfile? user}) => AuthState(
    status: status ?? this.status,
    errorMessage: errorMessage,
    user: user ?? this.user,
  );
}

final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepository());

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    _bootstrap();
    return const AuthState();
  }

  AuthRepository get _repository => ref.read(authRepositoryProvider);

  Future<void> _bootstrap() async {
    final hasSession = await _repository.hasValidSession();
    state = AuthState(status: hasSession ? AuthStatus.authenticated : AuthStatus.unauthenticated);
    if (hasSession) await _loadUser();
    authRouterNotifier.refresh();
  }

  Future<bool> register({
    required String name,
    required String mobile,
    String? email,
    required String password,
  }) async {
    try {
      await _repository.register(name: name, mobile: mobile, email: email, password: password);
      state = const AuthState(status: AuthStatus.authenticated);
      await _loadUser();
      authRouterNotifier.refresh();
      return true;
    } on AuthException catch (e) {
      state = AuthState(status: AuthStatus.unauthenticated, errorMessage: e.message);
      return false;
    }
  }

  Future<bool> login({required String identifier, required String password}) async {
    try {
      await _repository.login(identifier: identifier, password: password);
      state = const AuthState(status: AuthStatus.authenticated);
      await _loadUser();
      authRouterNotifier.refresh();
      return true;
    } on AuthException catch (e) {
      state = AuthState(status: AuthStatus.unauthenticated, errorMessage: e.message);
      return false;
    }
  }

  Future<void> logout() async {
    await _repository.logout();
    state = const AuthState(status: AuthStatus.unauthenticated);
    authRouterNotifier.refresh();
  }

  Future<void> _loadUser() async {
    try {
      final user = await _repository.getCurrentUser();
      state = state.copyWith(user: user);
    } catch (_) {
      // Non-fatal - Home/Profile fall back to a generic label if this is null.
    }
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);
```

- [ ] **Step 3: Analyze and format**

```bash
cd /c/projects/sevarath/apps/mobile
dart format lib/core/router/auth_router_notifier.dart lib/features/auth/providers
flutter analyze
```

- [ ] **Step 4: Commit**

```bash
git add lib/core/router/auth_router_notifier.dart lib/features/auth/providers
git commit -m "feat(mobile): add Riverpod AuthController and router bridge"
```

---

## Task 9: Login screen

**Files:**
- Create: `apps/mobile/lib/features/auth/login_screen.dart`

**Interfaces:**
- Consumes: `authControllerProvider` (Task 8).

- [ ] **Step 1: Implement the screen**

```dart
// apps/mobile/lib/features/auth/login_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'providers/auth_provider.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifierController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _identifierController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    final success = await ref
        .read(authControllerProvider.notifier)
        .login(identifier: _identifierController.text.trim(), password: _passwordController.text);
    if (!mounted) return;
    setState(() => _submitting = false);
    if (success) context.go('/home');
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authControllerProvider);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Welcome back', style: AppTextStyles.headline.copyWith(fontSize: 28)),
                  const SizedBox(height: 6),
                  Text('Sign in to continue', style: AppTextStyles.secondary),
                  const SizedBox(height: 32),
                  TextFormField(
                    controller: _identifierController,
                    decoration: const InputDecoration(labelText: 'Mobile number or email'),
                    keyboardType: TextInputType.emailAddress,
                    validator: (value) =>
                        (value == null || value.trim().isEmpty) ? 'Enter your mobile number or email' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _passwordController,
                    decoration: const InputDecoration(labelText: 'Password'),
                    obscureText: true,
                    validator: (value) => (value == null || value.isEmpty) ? 'Enter your password' : null,
                  ),
                  if (authState.errorMessage != null) ...[
                    const SizedBox(height: 12),
                    Text(authState.errorMessage!, style: const TextStyle(color: AppColors.error)),
                  ],
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: _submitting ? null : _submit,
                    child: _submitting
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Log In'),
                  ),
                  const SizedBox(height: 16),
                  TextButton(
                    onPressed: () => context.push('/register'),
                    child: const Text("Don't have an account? Create one"),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: Analyze and format**

```bash
cd /c/projects/sevarath/apps/mobile
dart format lib/features/auth/login_screen.dart
flutter analyze
```

- [ ] **Step 3: Commit**

```bash
git add lib/features/auth/login_screen.dart
git commit -m "feat(mobile): add login screen"
```

---

## Task 10: Register screen

**Files:**
- Create: `apps/mobile/lib/features/auth/register_screen.dart`

**Interfaces:**
- Consumes: `authControllerProvider` (Task 8).

- [ ] **Step 1: Implement the screen**

```dart
// apps/mobile/lib/features/auth/register_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'providers/auth_provider.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _mobileController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _nameController.dispose();
    _mobileController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    final success = await ref
        .read(authControllerProvider.notifier)
        .register(
          name: _nameController.text.trim(),
          mobile: _mobileController.text.trim(),
          email: _emailController.text.trim().isEmpty ? null : _emailController.text.trim(),
          password: _passwordController.text,
        );
    if (!mounted) return;
    setState(() => _submitting = false);
    if (success) context.go('/home');
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authControllerProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Create Account')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Join Sevarath', style: AppTextStyles.headline.copyWith(fontSize: 24)),
                const SizedBox(height: 24),
                TextFormField(
                  controller: _nameController,
                  decoration: const InputDecoration(labelText: 'Full name'),
                  validator: (value) => (value == null || value.trim().isEmpty) ? 'Enter your name' : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _mobileController,
                  decoration: const InputDecoration(labelText: 'Mobile number', hintText: '+911234567890'),
                  keyboardType: TextInputType.phone,
                  validator: (value) =>
                      (value == null || value.trim().isEmpty) ? 'Enter your mobile number' : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _emailController,
                  decoration: const InputDecoration(labelText: 'Email (optional)'),
                  keyboardType: TextInputType.emailAddress,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _passwordController,
                  decoration: const InputDecoration(labelText: 'Password'),
                  obscureText: true,
                  validator: (value) =>
                      (value == null || value.length < 8) ? 'At least 8 characters' : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _confirmController,
                  decoration: const InputDecoration(labelText: 'Confirm password'),
                  obscureText: true,
                  validator: (value) =>
                      value != _passwordController.text ? 'Passwords do not match' : null,
                ),
                if (authState.errorMessage != null) ...[
                  const SizedBox(height: 12),
                  Text(authState.errorMessage!, style: const TextStyle(color: AppColors.error)),
                ],
                const SizedBox(height: 24),
                ElevatedButton(
                  onPressed: _submitting ? null : _submit,
                  child: _submitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('Create Account'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: Analyze and format**

```bash
cd /c/projects/sevarath/apps/mobile
dart format lib/features/auth/register_screen.dart
flutter analyze
```

- [ ] **Step 3: Commit**

```bash
git add lib/features/auth/register_screen.dart
git commit -m "feat(mobile): add registration screen"
```

---

## Task 11: Router auth-gating

**Files:**
- Modify: `apps/mobile/lib/core/router/app_router.dart`

**Interfaces:**
- Consumes: `authControllerProvider`, `AuthStatus` (Task 8), `authRouterNotifier` (Task 8), `LoginScreen` (Task 9), `RegisterScreen` (Task 10).

- [ ] **Step 1: Add the new routes and redirect logic**

```dart
// apps/mobile/lib/core/router/app_router.dart
// Add to imports:
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/auth/login_screen.dart';
import '../../features/auth/register_screen.dart';
import '../../features/auth/providers/auth_provider.dart';
import 'auth_router_notifier.dart';

// Add two new top-level GoRoutes, alongside the existing /select-destination etc.
// (anywhere in the `routes:` list, e.g. right after the '/splash' route):
    GoRoute(
      path: '/login',
      parentNavigatorKey: rootNavigatorKey,
      builder: (context, state) => const LoginScreen(),
    ),
    GoRoute(
      path: '/register',
      parentNavigatorKey: rootNavigatorKey,
      builder: (context, state) => const RegisterScreen(),
    ),

// Add `refreshListenable` and `redirect` to the GoRouter(...) constructor call,
// alongside the existing `navigatorKey`/`initialLocation`/`routes` arguments:
  refreshListenable: authRouterNotifier,
  redirect: (context, state) {
    final authState = ProviderScope.containerOf(context).read(authControllerProvider);
    final isAuthed = authState.status == AuthStatus.authenticated;
    final isLoading = authState.status == AuthStatus.unknown;
    final goingToAuthScreen = state.matchedLocation == '/login' || state.matchedLocation == '/register';
    final goingToSplash = state.matchedLocation == '/splash';

    if (isLoading) {
      return goingToSplash ? null : '/splash';
    }
    if (!isAuthed && !goingToAuthScreen) {
      return '/login';
    }
    if (isAuthed && (goingToAuthScreen || goingToSplash)) {
      return '/home';
    }
    return null;
  },
```

- [ ] **Step 2: Analyze and format**

```bash
cd /c/projects/sevarath/apps/mobile
dart format lib/core/router/app_router.dart
flutter analyze
```

- [ ] **Step 3: Commit**

```bash
git add lib/core/router/app_router.dart
git commit -m "feat(mobile): gate the app behind login via GoRouter redirect"
```

---

## Task 12: Wire Profile and Home screens to the real logged-in user

**Files:**
- Modify: `apps/mobile/lib/features/profile/profile_screen.dart`
- Modify: `apps/mobile/lib/features/home/home_screen.dart`

- [ ] **Step 1: Profile screen - real name, working Sign Out**

```dart
// apps/mobile/lib/features/profile/profile_screen.dart
// Change the class declaration and imports:
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../auth/providers/auth_provider.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            children: [
              const CircleAvatar(
                radius: 32,
                backgroundColor: AppColors.surfaceTint,
                child: Icon(Icons.person_rounded, size: 36, color: AppColors.brandGreen),
              ),
              const SizedBox(width: 16),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(user?.name ?? 'Sevarath user', style: AppTextStyles.headline.copyWith(fontSize: 20)),
                  Text('View and manage your profile', style: AppTextStyles.secondary),
                ],
              ),
            ],
          ),
          const SizedBox(height: 24),
          _MenuTile(
            icon: Icons.directions_car_filled_rounded,
            label: 'My Rides',
            onTap: () => StatefulNavigationShell.of(context).goBranch(1),
          ),
          const _MenuTile(icon: Icons.favorite_border_rounded, label: 'Favourite Locations'),
          const _MenuTile(icon: Icons.notifications_none_rounded, label: 'Notifications'),
          const _MenuTile(icon: Icons.help_outline_rounded, label: 'Help & Support'),
          const _MenuTile(icon: Icons.settings_outlined, label: 'App Settings'),
          const _MenuTile(icon: Icons.info_outline_rounded, label: 'About Sevarath'),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: () async {
                await ref.read(authControllerProvider.notifier).logout();
                if (context.mounted) context.go('/login');
              },
              style: OutlinedButton.styleFrom(foregroundColor: AppColors.error),
              child: const Text('Sign Out'),
            ),
          ),
        ],
      ),
    );
  }
}
```

The `_MenuTile` private widget class below it is unchanged - leave it exactly as-is (it already takes an optional `onTap`, from a prior fix this session).

- [ ] **Step 2: Home screen greeting - real name**

```dart
// apps/mobile/lib/features/home/home_screen.dart
// Change the class declaration and imports:
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../auth/providers/auth_provider.dart';
import 'widgets/quick_location_chip.dart';
import 'widgets/where_to_card.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
```

Then, inside the existing `Row` with the greeting `Column`, change:
```dart
Text('Rajendra', style: AppTextStyles.headline.copyWith(fontSize: 20)),
```
to:
```dart
Text(user?.name ?? 'there', style: AppTextStyles.headline.copyWith(fontSize: 20)),
```

The rest of `home_screen.dart`'s body (quick locations, recent places) is addressed in Task 13 - don't touch the `mockCampusLocations` lines yet in this task.

- [ ] **Step 3: Analyze and format**

```bash
cd /c/projects/sevarath/apps/mobile
dart format lib/features/profile/profile_screen.dart lib/features/home/home_screen.dart
flutter analyze
```

- [ ] **Step 4: Commit**

```bash
git add lib/features/profile/profile_screen.dart lib/features/home/home_screen.dart
git commit -m "feat(mobile): show the real logged-in user on Home and Profile"
```

---

## Task 13: Real campus locations

**Files:**
- Modify: `apps/mobile/lib/features/ride/models/ride_models.dart` (add `type` field to `CampusLocationUi`)
- Create: `apps/mobile/lib/features/destination/data/campus_locations_repository.dart`
- Modify: `apps/mobile/lib/features/destination/select_destination_screen.dart`
- Modify: `apps/mobile/lib/features/home/home_screen.dart`
- Modify: `apps/mobile/lib/features/ride/models/mock_campus_data.dart` (remove now-unused `mockCampusLocations`)
- Test: `apps/mobile/test/campus_locations_repository_test.dart`

**Interfaces:**
- Consumes: `ApiClient` (Task 6).
- Produces: `campusLocationsProvider` (`FutureProvider<List<CampusLocationUi>>`) — consumed by `select_destination_screen.dart` and `home_screen.dart`.

- [ ] **Step 1: Add `type` to `CampusLocationUi`**

```dart
// apps/mobile/lib/features/ride/models/ride_models.dart
// In the CampusLocationUi class, add a `type` field (used for filtering by
// the real backend's enum - mock data can leave it null):
class CampusLocationUi {
  const CampusLocationUi({
    required this.id,
    required this.name,
    required this.category,
    required this.icon,
    required this.badgeColor,
    this.subtitle,
    this.type,
  });

  final String id;
  final String name;
  final String category;
  final IconData icon;
  final Color badgeColor;
  final String? subtitle;
  final String? type;
```

(Keep the rest of the file, including any other classes in it, unchanged.)

- [ ] **Step 2: Write the failing test for the type→icon/title-case mapping**

```dart
// apps/mobile/test/campus_locations_repository_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:sevarath_mobile/features/destination/data/campus_locations_repository.dart';

void main() {
  group('campusLocationUiFromJson', () {
    test('uses description as the category when present', () {
      final loc = campusLocationUiFromJson({
        'id': 'abc-123',
        'name': 'Main Gate',
        'type': 'GATE',
        'description': 'Headquarters',
      }, 0);

      expect(loc.name, 'Main Gate');
      expect(loc.category, 'Headquarters');
      expect(loc.type, 'GATE');
    });

    test('title-cases the type as a fallback category when description is null', () {
      final loc = campusLocationUiFromJson({
        'id': 'def-456',
        'name': 'EV Charging Point',
        'type': 'EV_STOP',
        'description': null,
      }, 1);

      expect(loc.category, 'Ev Stop');
    });
  });
}
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd /c/projects/sevarath/apps/mobile
flutter test test/campus_locations_repository_test.dart
```

Expected: FAIL — `campus_locations_repository.dart` doesn't exist yet.

- [ ] **Step 4: Implement the repository**

```dart
// apps/mobile/lib/features/destination/data/campus_locations_repository.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../ride/models/ride_models.dart';

/// Maps the backend's campus_location_type enum to a presentation icon - the
/// API has no notion of Flutter IconData, so this lookup lives client-side.
const Map<String, IconData> _typeIcons = {
  'GATE': Icons.account_balance,
  'BUILDING': Icons.apartment,
  'OFFICE': Icons.business_center,
  'RESIDENCE': Icons.holiday_village,
  'DINING': Icons.restaurant,
  'PARKING': Icons.local_parking,
  'EV_STOP': Icons.ev_station,
  'MEDICAL': Icons.local_hospital,
  'RECEPTION': Icons.apartment,
  'OTHER': Icons.place,
};

String _titleCase(String enumValue) {
  final words = enumValue.toLowerCase().split('_');
  return words.map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}').join(' ');
}

/// [index] only drives the badge color cycling (AppColors.categoryBadges),
/// so results stay visually varied regardless of list order.
CampusLocationUi campusLocationUiFromJson(Map<String, dynamic> json, int index) {
  final type = json['type'] as String? ?? 'OTHER';
  final description = json['description'] as String?;
  return CampusLocationUi(
    id: json['id'] as String,
    name: json['name'] as String,
    category: (description != null && description.isNotEmpty) ? description : _titleCase(type),
    icon: _typeIcons[type] ?? Icons.place,
    badgeColor: AppColors.categoryBadges[index % AppColors.categoryBadges.length],
    type: type,
  );
}

class CampusLocationsRepository {
  CampusLocationsRepository({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  Future<List<CampusLocationUi>> fetchAll() async {
    final response = await _apiClient.dio.get('/campus/locations');
    final data = response.data as List<dynamic>;
    return [
      for (var i = 0; i < data.length; i++) campusLocationUiFromJson(data[i] as Map<String, dynamic>, i),
    ];
  }
}

final campusLocationsProvider = FutureProvider<List<CampusLocationUi>>((ref) {
  return CampusLocationsRepository().fetchAll();
});
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
flutter test test/campus_locations_repository_test.dart
```

Expected: PASS, 2/2.

- [ ] **Step 6: Wire `select_destination_screen.dart`**

Replace the mock import and the whole class with the `ConsumerStatefulWidget` version, using `AsyncValue.when` so loading/error are handled (not just the data path), and fixing the filter chips to match on `type` instead of the old hardcoded mock IDs:

```dart
// apps/mobile/lib/features/destination/select_destination_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../ride/models/ride_models.dart';
import 'data/campus_locations_repository.dart';

class SelectDestinationScreen extends ConsumerStatefulWidget {
  const SelectDestinationScreen({super.key});

  @override
  ConsumerState<SelectDestinationScreen> createState() => _SelectDestinationScreenState();
}

class _SelectDestinationScreenState extends ConsumerState<SelectDestinationScreen> {
  final _searchController = TextEditingController();
  String _filter = 'All';
  final _favorites = <String>{};

  static const _filters = ['All', 'Buildings', 'Gates', 'Facilities'];
  static const _facilityTypes = {'PARKING', 'MEDICAL', 'DINING', 'EV_STOP'};

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<CampusLocationUi> _filtered(List<CampusLocationUi> all) {
    final query = _searchController.text.trim().toLowerCase();
    return all.where((loc) {
      final matchesQuery = query.isEmpty || loc.name.toLowerCase().contains(query);
      final matchesFilter =
          _filter == 'All' ||
          (_filter == 'Gates' && loc.type == 'GATE') ||
          (_filter == 'Facilities' && _facilityTypes.contains(loc.type)) ||
          (_filter == 'Buildings' && loc.type != 'GATE' && !_facilityTypes.contains(loc.type));
      return matchesQuery && matchesFilter;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final locationsAsync = ref.watch(campusLocationsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Select Destination')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _searchController,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                hintText: 'Search building or location...',
                prefixIcon: Icon(Icons.search_rounded, color: AppColors.textSecondary),
              ),
            ),
          ),
          SizedBox(
            height: 40,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: _filters.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final f = _filters[index];
                final selected = f == _filter;
                return ChoiceChip(
                  label: Text(f),
                  selected: selected,
                  onSelected: (_) => setState(() => _filter = f),
                  selectedColor: AppColors.brandGreen,
                  labelStyle: AppTextStyles.secondary.copyWith(
                    color: selected ? Colors.white : AppColors.textPrimary,
                    fontWeight: FontWeight.w600,
                  ),
                  backgroundColor: AppColors.surfaceTint,
                  side: BorderSide.none,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: locationsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, stackTrace) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.wifi_off_rounded, size: 40, color: AppColors.textSecondary),
                      const SizedBox(height: 12),
                      Text('Could not load locations', style: AppTextStyles.bodyStrong),
                      const SizedBox(height: 8),
                      OutlinedButton(
                        onPressed: () => ref.invalidate(campusLocationsProvider),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              ),
              data: (locations) {
                final filtered = _filtered(locations);
                return ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  itemCount: filtered.length + 1,
                  itemBuilder: (context, index) {
                    if (index == filtered.length) {
                      return ListTile(
                        leading: const Icon(Icons.add_location_alt_outlined, color: AppColors.brandGreen),
                        title: const Text('Additional Location'),
                        subtitle: const Text('Enter custom location'),
                        trailing: const Icon(Icons.chevron_right_rounded),
                        onTap: () => context.push('/confirm-ride'),
                      );
                    }
                    final loc = filtered[index];
                    final isFavorite = _favorites.contains(loc.id);
                    return ListTile(
                      leading: Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          color: loc.badgeColor.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(loc.icon, color: loc.badgeColor, size: 20),
                      ),
                      title: Text(loc.name, style: AppTextStyles.bodyStrong),
                      subtitle: Text(loc.category, style: AppTextStyles.secondary),
                      trailing: IconButton(
                        icon: Icon(
                          isFavorite ? Icons.star_rounded : Icons.star_border_rounded,
                          color: isFavorite ? AppColors.ratingGold : AppColors.textSecondary,
                        ),
                        onPressed: () => setState(() {
                          isFavorite ? _favorites.remove(loc.id) : _favorites.add(loc.id);
                        }),
                      ),
                      onTap: () => context.push('/confirm-ride'),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 7: Wire `home_screen.dart`'s quick locations / recent places**

```dart
// apps/mobile/lib/features/home/home_screen.dart
// Add import:
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../destination/data/campus_locations_repository.dart';

// Inside build(), replace the two mock-data lines:
//   final quickLocations = mockCampusLocations.take(6).toList();
//   final recentPlaces = mockCampusLocations.skip(1).take(3).toList();
// with an AsyncValue read:
    final locationsAsync = ref.watch(campusLocationsProvider);
```

Then wrap the `GridView.builder` (Quick Locations) and the `...recentPlaces.map(...)` (Recent Places) sections in `locationsAsync.when(...)`, same loading/error/data pattern as Task 13 Step 6's `select_destination_screen.dart`. Concretely, replace:

```dart
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: quickLocations.length,
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                mainAxisExtent: 104,
              ),
              itemBuilder: (context, index) {
                final loc = quickLocations[index];
                return QuickLocationChip(
                  location: loc,
                  onTap: () => context.push('/select-destination'),
                );
              },
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Recent Places', style: AppTextStyles.title),
                TextButton(onPressed: () {}, child: const Text('View All')),
              ],
            ),
            ...recentPlaces.map(
              (loc) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceTint,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.location_on_outlined, color: AppColors.brandGreen),
                  ),
                  title: Text(loc.name, style: AppTextStyles.bodyStrong),
                  subtitle: Text(loc.category, style: AppTextStyles.secondary),
                  onTap: () => context.push('/select-destination'),
                ),
              ),
            ),
```

with:

```dart
            locationsAsync.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, stackTrace) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Column(
                  children: [
                    Text('Could not load locations', style: AppTextStyles.secondary),
                    TextButton(
                      onPressed: () => ref.invalidate(campusLocationsProvider),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
              data: (locations) {
                final quickLocations = locations.take(6).toList();
                final recentPlaces = locations.skip(1).take(3).toList();
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    GridView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      itemCount: quickLocations.length,
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 3,
                        mainAxisExtent: 104,
                      ),
                      itemBuilder: (context, index) {
                        final loc = quickLocations[index];
                        return QuickLocationChip(
                          location: loc,
                          onTap: () => context.push('/select-destination'),
                        );
                      },
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Recent Places', style: AppTextStyles.title),
                        TextButton(onPressed: () {}, child: const Text('View All')),
                      ],
                    ),
                    ...recentPlaces.map(
                      (loc) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: Container(
                            width: 40,
                            height: 40,
                            decoration: BoxDecoration(
                              color: AppColors.surfaceTint,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: const Icon(Icons.location_on_outlined, color: AppColors.brandGreen),
                          ),
                          title: Text(loc.name, style: AppTextStyles.bodyStrong),
                          subtitle: Text(loc.category, style: AppTextStyles.secondary),
                          onTap: () => context.push('/select-destination'),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
```

- [ ] **Step 8: Remove the now-unused mock locations**

```dart
// apps/mobile/lib/features/ride/models/mock_campus_data.dart
// Delete the entire `mockCampusLocations` list (the import of `Icons`/`AppColors`
// and the `mockDriver` constant below it stay - mockDriver is still used by the
// ride screens, which are out of scope for this plan).
```

After deleting it, the file should contain only the `mockDriver` constant and its imports (drop the `Icons`/`AppColors` imports from the top of the file if they become unused after deleting `mockCampusLocations` - check with `flutter analyze`).

- [ ] **Step 9: Analyze and format**

```bash
cd /c/projects/sevarath/apps/mobile
dart format lib/features/ride/models/ride_models.dart lib/features/destination lib/features/home/home_screen.dart lib/features/ride/models/mock_campus_data.dart test/campus_locations_repository_test.dart
flutter analyze
```

Expected: "No issues found!" — this will also catch it if Step 8 left an unused import behind.

- [ ] **Step 10: Run the full test suite**

```bash
flutter test
```

Expected: all pass, including the existing `test/widget_test.dart` splash-screen tests.

- [ ] **Step 11: Commit**

```bash
git add lib/features/ride/models/ride_models.dart lib/features/destination lib/features/home/home_screen.dart lib/features/ride/models/mock_campus_data.dart test/campus_locations_repository_test.dart
git commit -m "feat(mobile): replace mock campus locations with real API data"
```

---

## Task 14: End-to-end manual verification

No new files - this task proves Tasks 1-13 actually work together, not just in isolation.

- [ ] **Step 1: Bring up the backend**

```bash
cd /c/projects/sevarath
docker compose up -d postgres
cd apps/api
pnpm db:migrate
pnpm db:seed
pnpm start:dev
```

Expected: `SevaRath API listening on http://localhost:3000`, and `GET http://localhost:3000/api-docs` shows `register`/`login/password` under the `auth` tag.

- [ ] **Step 2: Run the Flutter web app against it**

```bash
cd /c/projects/sevarath/apps/mobile
flutter run -d web-server -t lib/main_user.dart --web-port=8765
```

- [ ] **Step 3: Walk the flow in the browser** (`http://localhost:8765`)

1. App should land on `/login` (not `/home`) - confirms the redirect gate works for a fresh/unauthenticated session.
2. Tap "Don't have an account? Create one" → fill in name/mobile/password → Create Account.
3. Expected: lands on Home, greeting shows the real name just entered (not "Rajendra"), Quick Locations shows the 9 seeded locations (not the old mock set - compare against `apps/api/src/db/seed.ts`'s list to confirm it's really coming from the API, e.g. check "Om Shanti Bhawan" is present since it wasn't in the original mock-data ordering).
4. Tap "Select destination" → confirm the Gates/Buildings/Facilities filter chips each show at least one result (this is the filter-by-`type` fix from Task 13 - if broken, one or more chips will show an empty list).
5. Go to Profile tab → confirm the name matches, tap Sign Out → should land back on `/login`.
6. Log back in with the same mobile/password on the Login screen → should reach Home again with the same name.

- [ ] **Step 4: Stop the dev server and report results**

If any step in Step 3 doesn't match its expected outcome, that's a bug to fix before considering this plan done - don't move on with a known-broken flow.

---

## Self-Review

**Spec coverage:** Every unchecked Phase 3 sub-item this plan claims to address is covered: real auth (Tasks 1-2, 6-11), campus locations (Task 13). Booking and driver-flavor/build-flavor items are explicitly out of scope (stated in the Goal/Architecture sections) since their backend/tooling prerequisites don't exist yet - not silently dropped.

**Placeholder scan:** No "TBD"/"handle errors appropriately"/"similar to Task N" found - every step has complete, runnable code.

**Type consistency:** `TokenResponseDto`/`AuthTokens` both use `accessToken`/`refreshToken`/`role`/`userId`. `CampusLocationResponseDto`'s `type`/`description` fields are consumed exactly as named by `campusLocationUiFromJson`. `AuthRepository.register`/`.login` both return `AuthTokens` and are both called the same way from `AuthController`. `StatefulNavigationShell.goBranch(1)` in Task 12 matches the branch order already fixed earlier this session (`/home`=0, `/rides`=1, `/profile`=2) in `app_router.dart`.

**Review Focus:** all five items have an owning task and test (duplicate registration, wrong password, Firebase-only account, locations loading/error states, filter-chip type matching) - see the Review Focus section above for exact line-ups.
