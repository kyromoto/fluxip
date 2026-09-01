import { describe, expect, it } from "vitest";
import { matchFirewallRule, type HetznerFirewallRule } from "../../../src/domain/action/firewall-rule-selector.js";

const sshRule: HetznerFirewallRule = {
  direction: "in",
  protocol: "tcp",
  port: "22",
  source_ips: ["10.0.0.0/8"],
  description: "SSH",
};

describe("matchFirewallRule", () => {
  it("returns the single rule when exactly one matches", () => {
    const result = matchFirewallRule([sshRule], { direction: "in", protocol: "tcp", port: "22", description: "SSH" });
    expect(result).toEqual({ rule: sshRule });
  });

  it("returns a no_match error when nothing matches", () => {
    const result = matchFirewallRule([sshRule], { direction: "in", protocol: "tcp", port: "443", description: "SSH" });
    expect(result).toEqual({ error: "no_match" });
  });

  it("returns an ambiguous_match error when two rules share direction/protocol/port but differ only in description", () => {
    const otherSshRule: HetznerFirewallRule = { ...sshRule, description: "SSH (backup)", source_ips: [] };
    const result = matchFirewallRule([sshRule, otherSshRule], {
      direction: "in",
      protocol: "tcp",
      port: "22",
      description: "SSH",
    });
    // description disambiguates — only "SSH" should match, not "SSH (backup)".
    expect(result).toEqual({ rule: sshRule });
  });

  it("flags true ambiguity when direction/protocol/port/description are all identical across two rules", () => {
    const duplicateRule: HetznerFirewallRule = { ...sshRule, source_ips: ["192.0.2.0/24"] };
    const result = matchFirewallRule([sshRule, duplicateRule], {
      direction: "in",
      protocol: "tcp",
      port: "22",
      description: "SSH",
    });
    expect(result).toEqual({ error: "ambiguous_match", matchCount: 2 });
  });

  it("matches a rule with no port (e.g. icmp) when the selector also omits it", () => {
    const icmpRule: HetznerFirewallRule = { direction: "in", protocol: "icmp", source_ips: [], description: "Ping" };
    const result = matchFirewallRule([icmpRule], { direction: "in", protocol: "icmp", description: "Ping" });
    expect(result).toEqual({ rule: icmpRule });
  });
});
