import { createHash } from 'node:crypto';
import { DomainError, requireFact } from '../../../packages/domain/src/index.js';
import { NativeDatabase } from './inventory/db.js';

export type HouseholdTask = {
  id: string;
  user_id: string;
  actor_name: string;
  action: 'rename' | 'invite' | 'revoke' | 'leave' | 'join';
  household_id: string;
  name?: string;
  token_hash?: string;
  invitation_id?: string;
  membership_id?: string;
  actor_id?: string;
  expires_at?: string;
};
export type DirectoryEvent = {
  id: string;
  household: { id: string; name: string; state: 'ACTIVE'; revision: string };
  memberships: {
    id: string;
    householdId: string;
    userId: string;
    deleted: boolean;
    revision: string;
  }[];
  invitations: { token_hash: string; household_id: string; expires_at: string }[];
};
export function directoryEvent(
  db: NativeDatabase,
  id: string,
  householdId: string,
  deleted: any[] = [],
) {
  const row = db.query(
    'UPDATE cf_directory_clock SET revision=CAST(revision AS INTEGER)+1 WHERE singleton=1 RETURNING CAST(revision AS TEXT) AS revision',
  ).rows[0];
  const household = db.query('SELECT id,name FROM households WHERE id=?1', [householdId]).rows[0];
  const event: DirectoryEvent = {
    id,
    household: { ...household, state: 'ACTIVE', revision: row.revision },
    memberships: [
      ...db
        .query('SELECT * FROM household_members WHERE household_id=?1', [householdId])
        .rows.map((m) => ({ ...m, deleted: false })),
      ...deleted.map((m) => ({ ...m, deleted: true })),
    ].map((m) => ({
      id: m.id,
      householdId,
      userId: m.user_id,
      deleted: m.deleted,
      revision: row.revision,
    })),
    invitations: db.query(
      'SELECT token_hash,household_id,expires_at FROM household_invitations WHERE household_id=?1',
      [householdId],
    ).rows,
  };
  db.query("INSERT INTO cf_outbox(id,kind,payload) VALUES(?1,'DIRECTORY_PROJECT',?2)", [
    id,
    JSON.stringify(event),
  ]);
  return event;
}
export type AccountResult = { ok?: boolean; household_id?: string; id?: string };
export function householdTask(db: NativeDatabase, input: HouseholdTask): AccountResult {
  return db.transaction(() => {
    const state = db.query('SELECT * FROM cf_store_state WHERE singleton=1').rows[0];
    requireFact(
      state?.household_id === input.household_id && state.status === 'ACTIVE',
      'STATE_CONFLICT',
      'Household is unavailable.',
    );
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const prior = db.query('SELECT * FROM cf_account_receipts WHERE id=?1', [input.id]).rows[0];
    if (prior) {
      requireFact(
        prior.user_id === input.user_id && prior.fingerprint === fingerprint,
        'STATE_CONFLICT',
        'Account task does not match.',
      );
      return JSON.parse(prior.response);
    }
    const members = db.query('SELECT * FROM household_members WHERE household_id=?1', [
      input.household_id,
    ]).rows;
    const member = members.find((m) => m.user_id === input.user_id);
    const deleted: any[] = [];
    let result: any = { ok: true };
    if (input.action === 'join') {
      requireFact(!member, 'BAD_REQUEST', '你已经是这个家庭的成员。');
      const invite = db.query(
        'SELECT * FROM household_invitations WHERE token_hash=?1 AND household_id=?2 AND revoked=0 AND used_by IS NULL AND expires_at>?3',
        [input.token_hash, input.household_id, new Date().toISOString()],
      ).rows[0];
      requireFact(invite, 'BAD_REQUEST', '邀请已过期、撤销或使用。');
      db.query('INSERT INTO actors(id,household_id,name) VALUES(?1,?2,?3)', [
        input.actor_id,
        input.household_id,
        input.actor_name,
      ]);
      db.query(
        'INSERT INTO household_members(id,user_id,household_id,actor_id) VALUES(?1,?2,?3,?4)',
        [input.membership_id, input.user_id, input.household_id, input.actor_id],
      );
      db.query('UPDATE household_invitations SET used_by=?1 WHERE id=?2', [
        input.user_id,
        invite.id,
      ]);
      result = { household_id: input.household_id };
    } else {
      requireFact(member, 'FORBIDDEN', 'Household membership is no longer active.');
      switch (input.action) {
        case 'rename':
          requireFact(
            typeof input.name === 'string' &&
              input.name.trim().length > 0 &&
              input.name.length <= 80,
            'BAD_REQUEST',
            'Invalid household name.',
          );
          db.query(
            'UPDATE households SET name=?1,updated_at=(SELECT now FROM cf_clock) WHERE id=?2',
            [input.name, input.household_id],
          );
          break;
        case 'leave':
          requireFact(members.length > 1, 'BAD_REQUEST', '最后一名成员不能退出家庭。');
          db.query('DELETE FROM household_members WHERE id=?1', [member.id]);
          deleted.push(member);
          break;
        case 'invite':
          requireFact(
            !!input.token_hash && !!input.invitation_id && !!input.expires_at,
            'BAD_REQUEST',
            'Invalid invitation.',
          );
          db.query(
            'INSERT INTO household_invitations(id,token_hash,household_id,created_by,expires_at) VALUES(?1,?2,?3,?4,?5)',
            [
              input.invitation_id,
              input.token_hash,
              input.household_id,
              input.user_id,
              input.expires_at,
            ],
          );
          result = { id: input.invitation_id };
          break;
        case 'revoke':
          db.query('UPDATE household_invitations SET revoked=1 WHERE id=?1 AND household_id=?2', [
            input.invitation_id,
            input.household_id,
          ]);
          break;
        default:
          throw new DomainError('BAD_REQUEST', 'Invalid household action.');
      }
    }
    directoryEvent(db, input.id, input.household_id, deleted);
    db.query(
      'INSERT INTO cf_account_receipts(id,user_id,fingerprint,response) VALUES(?1,?2,?3,?4)',
      [input.id, input.user_id, fingerprint, JSON.stringify(result)],
    );
    return result;
  });
}
