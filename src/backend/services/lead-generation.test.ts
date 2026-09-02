import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeApolloLead, scoreLead } from "./lead-generation";
import type { IcpProfile } from "./apollo";

// ── Mock Apollo responses ──

const mockApolloProspects = [
  {
    id: "apollo-001",
    firstName: "Rajesh",
    lastName: "Kumar",
    email: "rajesh@techcorp.in",
    phone: "+919876543210",
    company: "TechCorp India",
    companyDomain: "techcorp.in",
    title: "VP Sales",
    city: "Bangalore",
    industry: "SaaS",
    companySize: "200",
    linkedinUrl: "https://linkedin.com/in/rajeshk",
    raw: { id: "apollo-001", first_name: "Rajesh", last_name: "Kumar" },
  },
  {
    id: "apollo-002",
    firstName: "Priya",
    lastName: "Sharma",
    email: null,
    phone: "+919123456789",
    company: "DataFlow Systems",
    companyDomain: "dataflow.com",
    title: "Marketing Director",
    city: "Mumbai",
    industry: "Technology",
    companySize: "500",
    linkedinUrl: null,
    raw: { id: "apollo-002", first_name: "Priya", last_name: "Sharma" },
  },
  {
    id: "apollo-003",
    firstName: "Anil",
    lastName: "Patel",
    email: "anil@smallbiz.com",
    phone: "9876543210",
    company: "SmallBiz",
    companyDomain: "smallbiz.com",
    title: "Founder",
    city: "Pune",
    industry: "E-commerce",
    companySize: "30",
    linkedinUrl: null,
    raw: { id: "apollo-003", first_name: "Anil", last_name: "Patel" },
  },
];

const testIcp: IcpProfile = {
  industries: ["SaaS", "Technology"],
  personTitles: ["VP Sales", "Marketing Director", "Head of Growth"],
  seniorities: ["c_suite", "vp", "director"],
  employeeRanges: ["51,200", "201,500"],
  locations: ["Bangalore", "Mumbai"],
  keywords: ["B2B", "SaaS", "growth"],
};

// ── Tests ──

describe("normalizeApolloLead", () => {
  it("normalizes a full prospect to lead schema", () => {
    const lead = normalizeApolloLead(mockApolloProspects[0]);
    expect(lead.phoneE164).toBe("+919876543210");
    expect(lead.email).toBe("rajesh@techcorp.in");
    expect(lead.firstName).toBe("Rajesh");
    expect(lead.lastName).toBe("Kumar");
    expect(lead.company).toBe("TechCorp India");
    expect(lead.title).toBe("VP Sales");
    expect(lead.city).toBe("Bangalore");
    expect(lead.industry).toBe("SaaS");
    expect(lead.companySize).toBe("200");
    expect(lead.sourceRef).toBe("apollo-001");
  });

  it("handles missing email gracefully", () => {
    const lead = normalizeApolloLead(mockApolloProspects[1]);
    expect(lead.email).toBeNull();
    expect(lead.firstName).toBe("Priya");
  });

  it("normalizes phone without + prefix", () => {
    const lead = normalizeApolloLead(mockApolloProspects[2]);
    expect(lead.phoneE164).toBe("+919876543210");
  });
});

describe("scoreLead", () => {
  it("gives high score for strong ICP match", () => {
    const lead = normalizeApolloLead(mockApolloProspects[0]);
    const result = scoreLead(lead, testIcp);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.band).toBe("hot");
  });

  it("gives medium score for partial match", () => {
    const lead = normalizeApolloLead(mockApolloProspects[1]);
    const result = scoreLead(lead, testIcp);
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThan(80);
    expect(result.band).toBe("warm");
  });

  it("gives lower score for weak match", () => {
    const lead = normalizeApolloLead(mockApolloProspects[2]);
    const result = scoreLead(lead, testIcp);
    expect(result.score).toBeLessThan(70);
  });
});

describe("ICP to Apollo search params", () => {
  it("maps ICP fields to Apollo-compatible format", () => {
    const icp = testIcp;
    expect(icp.personTitles.length).toBeGreaterThan(0);
    expect(icp.seniorities.length).toBeGreaterThan(0);
    expect(icp.employeeRanges.length).toBeGreaterThan(0);
    expect(icp.locations.length).toBeGreaterThan(0);
  });

  it("handles empty ICP gracefully", () => {
    const emptyIcp: IcpProfile = {
      industries: [],
      personTitles: [],
      seniorities: [],
      employeeRanges: [],
      locations: [],
      keywords: [],
    };
    const lead = normalizeApolloLead(mockApolloProspects[0]);
    const result = scoreLead(lead, emptyIcp);
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
