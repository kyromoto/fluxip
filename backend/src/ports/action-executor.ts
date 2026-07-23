export interface ActionExecutionIpValues {
  ipv4?: string;
  ipv6?: string;
}

export interface ActionExecutionResult {
  summary: string;
}

/**
 * One implementation per Action type (research.md's Structure Decision: this
 * is a real, imminent-multi-implementation seam — Hetzner DNS today, Hetzner
 * firewall and other providers later, per FR-009).
 */
export interface ActionExecutor<TResolvedConfig = unknown> {
  readonly type: string;
  execute(config: TResolvedConfig, ipValues: ActionExecutionIpValues): Promise<ActionExecutionResult>;
}
