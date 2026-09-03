const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";

export interface IcpProfile {
  industries: string[];
  personTitles: string[];
  seniorities: string[];
  employeeRanges: string[];
  locations: string[];
  keywords: string[];
}

export interface ApolloOrganization {
  id?: string;
  name?: string;
  websiteUrl?: string;
  industry?: string;
  estimatedNumEmployees?: number;
  city?: string;
  state?: string;
  country?: string;
  shortDescription?: string;
  raw: unknown;
}

export interface ApolloProspect {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  companyDomain: string | null;
  title: string | null;
  city: string | null;
  industry: string | null;
  companySize: string | null;
  linkedinUrl: string | null;
  raw: unknown;
}

function apolloKey(): string {
  const key = process.env.APOLLO_API_KEY?.trim();
  if (!key) throw new Error("Apollo is not configured. Add APOLLO_API_KEY to continue lead discovery.");
  return key;
}

async function apolloFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${APOLLO_BASE_URL}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": apolloKey(),
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Apollo request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return response.json();
}

function websiteDomain(website: string) {
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

export async function enrichApolloOrganization(input: { companyName: string; website: string }): Promise<ApolloOrganization | null> {
  const params = new URLSearchParams({
    name: input.companyName,
    website: input.website,
    domain: websiteDomain(input.website),
  });

  const data = await apolloFetch(`/organizations/enrich?${params}`);
  const org = data.organization;
  if (!org) return null;

  return {
    id: org.id,
    name: org.name,
    websiteUrl: org.website_url,
    industry: org.industry,
    estimatedNumEmployees: org.estimated_num_employees,
    city: org.city,
    state: org.state,
    country: org.country,
    shortDescription: org.short_description,
    raw: org,
  };
}

function appendArray(params: URLSearchParams, key: string, values: string[]) {
  values.filter(Boolean).forEach((value) => params.append(`${key}[]`, value));
}

function firstPhone(person: any): string | null {
  const values = [
    ...(Array.isArray(person.phone_numbers) ? person.phone_numbers.map((p: any) => p?.sanitized_number || p?.raw_number) : []),
    person.phone,
    person.organization?.phone,
  ];
  return values.find((value) => typeof value === "string" && value.trim()) || null;
}

function mapProspect(person: any): ApolloProspect | null {
  if (!person?.id) return null;
  const organization = person.organization || person.employment_history?.[0]?.organization || {};
  return {
    id: String(person.id),
    firstName: person.first_name || null,
    lastName: person.last_name || null,
    email: person.email || null,
    phone: firstPhone(person),
    company: organization.name || person.organization_name || null,
    companyDomain: organization.primary_domain || organization.website_url || null,
    title: person.title || null,
    city: person.city || organization.city || null,
    industry: organization.industry || null,
    companySize: organization.estimated_num_employees ? String(organization.estimated_num_employees) : null,
    linkedinUrl: person.linkedin_url || null,
    raw: person,
  };
}

async function bulkEnrichPeople(people: any[]): Promise<any[]> {
  const enriched: any[] = [];
  for (let index = 0; index < people.length; index += 10) {
    const batch = people.slice(index, index + 10);
    try {
      const result = await apolloFetch("/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=false", {
        method: "POST",
        body: JSON.stringify({ details: batch.map((person) => ({ id: person.id })) }),
      });
      const byId = new Map((result.matches || []).filter(Boolean).map((person: any) => [String(person.id), person]));
      enriched.push(...batch.map((person) => ({ ...person, ...(byId.get(String(person.id)) || {}) })));
    } catch (error) {
      console.warn("[apollo] enrichment skipped for one batch", error);
      enriched.push(...batch);
    }
  }
  return enriched;
}

export async function searchApolloProspects(icp: IcpProfile, limit = 20): Promise<ApolloProspect[]> {
  const requested = Math.max(1, Math.min(limit, 100));

  try {
    const params = new URLSearchParams({ page: "1", per_page: String(requested), include_similar_titles: "true" });
    appendArray(params, "person_titles", icp.personTitles.slice(0, 8));
    appendArray(params, "person_seniorities", icp.seniorities.slice(0, 8));
    appendArray(params, "organization_num_employees_ranges", icp.employeeRanges.slice(0, 5));
    appendArray(params, "organization_locations", icp.locations.slice(0, 5));
    if (icp.keywords.length > 0) params.set("q_keywords", icp.keywords.slice(0, 8).join(" "));

    const search = await apolloFetch(`/mixed_people/api_search?${params}`, { method: "POST", body: "{}" });
    const people = Array.isArray(search.people) ? search.people : [];

    if (people.length > 0) {
      const enriched = await bulkEnrichPeople(people.slice(0, requested));
      return enriched.map(mapProspect).filter((lead: ApolloProspect | null): lead is ApolloProspect => Boolean(lead));
    }
  } catch (error) {
    console.warn("[apollo] people search failed, falling back to organization search", error);
  }

  return fallbackFromOrganizations(icp, requested);
}

async function fallbackFromOrganizations(icp: IcpProfile, limit: number): Promise<ApolloProspect[]> {
  const params = new URLSearchParams({ page: "1", per_page: String(Math.min(limit, 25)) });
  if (icp.locations.length > 0) params.set("q_organization_locations", icp.locations[0]);
  const searchKeywords = [...icp.industries.slice(0, 2), ...icp.keywords.slice(0, 3)];
  if (searchKeywords.length > 0) params.set("q_keywords", searchKeywords.join(" "));
  appendArray(params, "organization_num_employees_ranges", icp.employeeRanges.slice(0, 3));

  try {
    const search = await apolloFetch(`/mixed_companies/search?${params}`, { method: "POST", body: "{}" });
    const orgs: any[] = Array.isArray(search.organizations) ? search.organizations : [];

    const prospects: ApolloProspect[] = [];
    for (const org of orgs.slice(0, Math.min(limit, 10))) {
      if (!org?.id) continue;
      try {
        const peopleParams = new URLSearchParams({
          organization_ids: String(org.id),
          per_page: "5",
          page: "1",
          person_titles: (icp.personTitles.slice(0, 3)).join("|"),
        });
        const peopleResult = await apolloFetch(`/mixed_people/api_search?${peopleParams}`, { method: "POST", body: "{}" });
        const people: any[] = Array.isArray(peopleResult.people) ? peopleResult.people : [];
        for (const person of people) {
          const mapped = mapProspect(person);
          if (mapped) prospects.push(mapped);
          if (prospects.length >= limit) break;
        }
      } catch {
        // skip this org
      }
      if (prospects.length >= limit) break;
    }
    return prospects;
  } catch (error) {
    console.warn("[apollo] organization fallback also failed", error);
    return [];
  }
}

export async function searchApolloOrganizations(keywords: string[], locations: string[], employeeRanges: string[], limit = 10): Promise<ApolloOrganization[]> {
  const params = new URLSearchParams({ page: "1", per_page: String(Math.min(limit, 25)) });
  if (keywords.length > 0) params.set("q_keywords", keywords.slice(0, 5).join(" "));
  if (locations.length > 0) params.set("q_organization_locations", locations[0]);
  appendArray(params, "organization_num_employees_ranges", employeeRanges.slice(0, 3));

  const search = await apolloFetch(`/mixed_companies/search?${params}`, { method: "POST", body: "{}" });
  const orgs: any[] = Array.isArray(search.organizations) ? search.organizations : [];
  return orgs.filter(Boolean).map((org: any) => ({
    id: org.id,
    name: org.name,
    websiteUrl: org.website_url,
    industry: org.industry,
    estimatedNumEmployees: org.estimated_num_employees,
    city: org.city,
    state: org.state,
    country: org.country,
    shortDescription: org.short_description,
    raw: org,
  }));
}
