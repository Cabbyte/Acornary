export interface TrialScope {
  accountId: string;
  householdId: string;
  // Legacy fixture key retained for saved trial worlds. It simulates capability
  // scenarios only; the real account contract has no member role hierarchy.
  role: 'owner' | 'member' | 'viewer';
  generation: number;
  signedIn: boolean;
}
export const isTrial = () =>
  typeof window !== 'undefined' && document.documentElement.dataset.acornaryTrial === 'true';
const initial: TrialScope = {
  accountId: 'trial-owner',
  householdId: 'preview-home-wutong',
  role: 'owner',
  generation: 0,
  signedIn: true,
};
let scope = { ...initial };
const listeners = new Set<() => void>();
export function initializeTrialScope() {
  try {
    const saved = JSON.parse(localStorage.getItem('acornary-trial-scope') || 'null');
    if (saved && ['preview-home-wutong', 'preview-home-weekend'].includes(saved.householdId))
      scope = { ...initial, ...saved };
  } catch {
    /* initial read-only fallback */
  }
}
export const getTrialScope = () => scope;
export function subscribeTrialScope(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
let guard = () => false;
export function setTrialNavigationGuard(fn: () => boolean) {
  guard = fn;
}
export function switchTrialHousehold(id: string) {
  if (guard()) throw Error('任务正在提交，请完成后切换家庭。');
  if (!['preview-home-wutong', 'preview-home-weekend'].includes(id))
    throw Error('示例家庭不可访问');
  const next = {
    ...scope,
    householdId: id,
    role: (id === 'preview-home-weekend' ? 'viewer' : 'owner') as TrialScope['role'],
    generation: scope.generation + 1,
  };
  localStorage.setItem('acornary-trial-scope', JSON.stringify(next));
  scope = next;
  listeners.forEach((fn) => fn());
}

export function setTrialSignedIn(signedIn: boolean) {
  if (guard()) throw Error('任务正在提交，请完成后切换身份。');
  const next = { ...scope, signedIn, generation: scope.generation + 1 };
  localStorage.setItem('acornary-trial-scope', JSON.stringify(next));
  scope = next;
  listeners.forEach((fn) => fn());
}
export function setTrialRole(role: TrialScope['role']) {
  if (guard()) throw Error('任务正在提交');
  const next = { ...scope, role, generation: scope.generation + 1 };
  localStorage.setItem('acornary-trial-scope', JSON.stringify(next));
  scope = next;
  listeners.forEach((fn) => fn());
}
