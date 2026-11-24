import type { ClassExport, ClassMember, MemberCall, Refused } from '../host-face-contracts.js';
import { REASON } from '../host-face-shared.js';

export function classCalls(e: ClassExport): MemberCall[] {
  const out: MemberCall[] = [];
  if (e.ctor !== undefined && 'fn' in e.ctor) out.push(e.ctor);
  for (const m of e.members) {
    if (e.abstract && !m.static) continue;
    if (m.kind === 'method' && 'fn' in m.call) out.push(m.call);
    if (m.kind === 'accessor') for (const h of [m.get, m.set]) if (h !== undefined) out.push(h);
  }
  return out;
}

export function generatedClass(e: ClassExport, generated: (fn: string) => boolean): ClassExport {
  const ok = <T extends MemberCall | Refused>(call: T): T | Refused =>
    'fn' in call && !generated(call.fn) ? { reason: REASON.fallback } : call;
  const members = e.members.map((m): ClassMember => {
    if (m.kind === 'method') return { ...m, call: ok(m.call) };
    const halves = [m.get, m.set].filter((h): h is MemberCall => h !== undefined);
    const lost = halves.find((h) => !generated(h.fn));
    return lost === undefined
      ? m
      : {
          kind: 'accessor',
          name: m.name,
          static: m.static,
          abstract: m.abstract,
          reason: REASON.fallback,
        };
  });
  const ctor = e.ctor === undefined || !('fn' in e.ctor) ? e.ctor : ok(e.ctor);
  return { ...e, ...(ctor !== undefined ? { ctor } : {}), members };
}
