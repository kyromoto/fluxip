import type { Config } from "../../config/env.js";
import type { EventStore } from "../../ports/event-store.js";
import { buildDomainEvent } from "../cloud-events.js";
import { loadAggregate } from "../replay.js";
import { accountReducer, initialAccountState, type AccountState } from "./account-aggregate.js";
import {
  ACCOUNT_AGGREGATE_TYPE,
  AccountEventName,
  type AccountDeviceLimitOverriddenData,
  type AccountRegisteredData,
} from "./events.js";

export class AccountService {
  constructor(
    private readonly eventStore: EventStore,
    private readonly config: Config,
  ) {}

  /**
   * Auto-provisions the FluxIP-side `account` aggregate the first time a
   * verified tenant is seen. The aggregate ID IS the tenant ID (= Logto
   * subject), so this is idempotent: if the stream is non-empty, nothing
   * is appended. Registration/login itself is entirely Logto's — this only
   * creates FluxIP's own record of the tenant (data-model.md `account`).
   */
  async ensureProvisioned(tenantId: string): Promise<AccountState> {
    const { state, events } = await loadAggregate(
      this.eventStore,
      { tenantId, aggregateType: ACCOUNT_AGGREGATE_TYPE, aggregateId: tenantId },
      initialAccountState,
      accountReducer,
    );

    if (events.length > 0) {
      return state;
    }

    const data: AccountRegisteredData = {
      accountId: tenantId,
      deviceLimit: this.config.defaultIpClientLimit,
      registeredAt: new Date().toISOString(),
    };
    const built = buildDomainEvent(this.config, ACCOUNT_AGGREGATE_TYPE, AccountEventName.Registered, data);

    await this.eventStore.append({
      id: built.id,
      aggregateType: ACCOUNT_AGGREGATE_TYPE,
      aggregateId: tenantId,
      tenantId,
      expectedSequenceNumber: 1,
      eventName: AccountEventName.Registered,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });

    return { accountId: tenantId, deviceLimit: this.config.defaultIpClientLimit, status: "active" };
  }

  async getState(tenantId: string): Promise<AccountState> {
    const { state } = await loadAggregate(
      this.eventStore,
      { tenantId, aggregateType: ACCOUNT_AGGREGATE_TYPE, aggregateId: tenantId },
      initialAccountState,
      accountReducer,
    );
    return state;
  }

  /** Administrator-only (FR-034); the caller's role is checked by the admin-guard middleware, not here. */
  async overrideDeviceLimit(
    accountId: string,
    newLimit: number,
    overriddenBy: string,
  ): Promise<AccountState | null> {
    const { state, version } = await loadAggregate(
      this.eventStore,
      { tenantId: accountId, aggregateType: ACCOUNT_AGGREGATE_TYPE, aggregateId: accountId },
      initialAccountState,
      accountReducer,
    );
    if (!state.accountId) return null;

    const data: AccountDeviceLimitOverriddenData = {
      accountId,
      previousLimit: state.deviceLimit,
      newLimit,
      overriddenBy,
      overriddenAt: new Date().toISOString(),
    };
    const built = buildDomainEvent(this.config, ACCOUNT_AGGREGATE_TYPE, AccountEventName.DeviceLimitOverridden, data);

    await this.eventStore.append({
      id: built.id,
      aggregateType: ACCOUNT_AGGREGATE_TYPE,
      aggregateId: accountId,
      tenantId: accountId,
      expectedSequenceNumber: version + 1,
      eventName: AccountEventName.DeviceLimitOverridden,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });

    return { ...state, deviceLimit: newLimit };
  }
}
