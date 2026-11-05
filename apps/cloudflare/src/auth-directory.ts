/** D1 holds identities and routing indexes; a directory row never grants inventory access. */
export class AuthDirectory {
  constructor(private readonly db: D1Database) {}

  async principal(userId: string) {
    const row = await this.db.prepare('SELECT id,name,auth_version FROM user WHERE id=? AND enabled=1 AND emailVerified=1')
      .bind(userId).first<{ id: string; name: string; auth_version: number }>();
    return row;
  }

  async routeMembership(userId: string, membershipId: string) {
    return this.db.prepare(`SELECT m.id,m.household_id FROM membership_directory m
      JOIN household_directory h ON h.id=m.household_id
      WHERE m.id=? AND m.user_id=? AND m.deleted=0 AND h.state='ACTIVE'`)
      .bind(membershipId, userId).first<{ id: string; household_id: string }>();
  }

  async projectHousehold(event: { id: string; name: string; state: 'PENDING' | 'ACTIVE' | 'DISABLED'; revision: string }) {
    revision(event.revision);
    await this.db.prepare(`INSERT INTO household_directory VALUES(?,?,?,CAST(? AS INTEGER))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,state=excluded.state,revision=excluded.revision
      WHERE excluded.revision>household_directory.revision`)
      .bind(event.id, event.name, event.state, event.revision).run();
  }

  async projectMembership(event: { id: string; householdId: string; userId: string; deleted: boolean; revision: string }) {
    revision(event.revision);
    // Stable membership IDs must not be reassigned to another user/household.
    // A tombstone is retained so delayed queue messages cannot resurrect a revoked index.
    await this.db.prepare(`INSERT INTO membership_directory VALUES(?,?,?, ?,CAST(? AS INTEGER))
      ON CONFLICT(id) DO UPDATE SET deleted=excluded.deleted,revision=excluded.revision
      WHERE excluded.revision>membership_directory.revision
        AND excluded.user_id=membership_directory.user_id
        AND excluded.household_id=membership_directory.household_id`)
      .bind(event.id, event.householdId, event.userId, Number(event.deleted), event.revision).run();
  }
}
function revision(value: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value)>9223372036854775807n) throw new Error('Invalid directory revision');
}
