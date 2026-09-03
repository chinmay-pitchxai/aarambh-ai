// Shared typed fixtures for tests. Mirrors the columns used by the modules under
// test (see src/backend/db/schema.ts). Kept intentionally narrow so fixtures do
// not drift with every schema change.

export interface MockTenant {
  id: string;
  name: string;
  slug: string;
  onboardingCompletedAt: Date | null;
}

export const mockTenants: MockTenant[] = [
  { id: "tenant-1", name: "Acme Inc", slug: "acme", onboardingCompletedAt: null },
  { id: "tenant-2", name: "Globex", slug: "globex", onboardingCompletedAt: new Date("2026-08-15T00:00:00.000Z") },
];

export interface MockUser {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export const mockUsers: MockUser[] = [
  {
    id: "user-1",
    email: "alice@acme.com",
    name: "Alice",
    passwordHash: "hash-placeholder",
    emailVerifiedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  },
];

export interface MockLead {
  id: string;
  phoneE164: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  title: string | null;
  city: string | null;
  industry: string | null;
  companySize: string | null;
  sourceRef: string | null;
  sourceCost: number | null;
  rawData: unknown;
  icpTags: unknown;
  freshness: Date | null;
  dnc: number | null;
  createdAt: Date | null;
}

export const mockLeads: MockLead[] = [
  {
    id: "lead-1",
    phoneE164: "+919800000001",
    email: "priya@acme.com",
    firstName: "Priya",
    lastName: "Sharma",
    company: "Acme Inc",
    title: "VP Sales",
    city: "Bangalore",
    industry: "SaaS software",
    companySize: "1001",
    sourceRef: "apollo-1",
    sourceCost: 1200,
    rawData: {},
    icpTags: ["vp-sales", "saas", "bangalore"],
    freshness: new Date("2026-08-25T00:00:00.000Z"),
    dnc: 0,
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
  },
];

export interface MockOrg {
  id: string;
  name: string;
  slug: string | null;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
}

export const mockOrgs: MockOrg[] = [
  { id: "org-1", name: "Acme Inc", slug: "acme", onboardingCompletedAt: null, createdAt: new Date("2026-08-01T00:00:00.000Z") },
  { id: "org-2", name: "Globex", slug: "globex", onboardingCompletedAt: new Date("2026-08-15T00:00:00.000Z"), createdAt: new Date("2026-08-02T00:00:00.000Z") },
];
