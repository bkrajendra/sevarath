# SevaRath - Frontend Guidelines (Admin App)

> Back to [README](../README.md) · See also [Architecture & Design](./architecture.md)

These rules apply to the Admin web app: **React + Tailwind CSS + shadcn/ui + Base Web (baseui)**. They are conventions for anyone writing or reviewing frontend code in this repo, not aspirational guidance - treat deviations as review blockers.

## 1. Component Philosophy

For each page provide modern and best user experience with:
- page transitions
- expanding/collapsing sections
- dropdowns
- dialogs
- buttons
- hover states
- loading states
- success states
- validation feedback

Use the improve-animations and review-animations and apple-design skills.
and make use if these skills to enhance the user experience 

* Everything under `src/components/ui/` (shadcn/ui primitives) is **owned code**, not a third-party dependency. Edit it directly when a component needs to change - do not wrap it in an extra abstraction layer "to keep it swappable."
* Use the `cn()` utility for all conditional class composition and class-conflict resolution. Don't hand-roll template-string class concatenation or ad-hoc conditionals.
* Styling is Tailwind utility classes only:
  * No inline `style={{ ... }}` for anything expressible as a utility class.
  * No external `.css`/`.scss` stylesheets for component styling.
  * Tokens/theme values (color, spacing, radius) come from the Tailwind config, not hard-coded literals.

## 2. State & API Contracts

* Never hand-write request/response types for backend endpoints. Types are derived from the backend's OpenAPI schema (see [architecture.md §6](./architecture.md#6-api-design--versioning)) and consumed at the fetch layer - this is what keeps the Admin app honest to the actual contract instead of a stale assumption of it.
* All server data fetching, caching, and loading/error state goes through **TanStack Query** (or an equivalent data-fetching lifecycle utility) - not ad-hoc `useEffect` + `useState` fetch chains. Loading/error UI should be driven by the query's own status, not a separately tracked boolean that can drift out of sync.
* Mutations (ride actions, driver/vehicle edits) invalidate the relevant query keys rather than manually patching cached state, unless there's a specific, justified optimistic-update case.

## 3. Scope

These rules govern the Admin app today. If User/Driver experiences ever move to the web (currently Flutter - see [architecture.md §7.2](./architecture.md#72-user--driver-flutter)), this document is the starting point for that frontend too.
