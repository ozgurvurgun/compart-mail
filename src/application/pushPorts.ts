export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userEmail: string;
};

export interface PushStore {
  save(record: PushSubscriptionRecord): Promise<void>;
  remove(endpoint: string): Promise<void>;
  list(): Promise<PushSubscriptionRecord[]>;
}
