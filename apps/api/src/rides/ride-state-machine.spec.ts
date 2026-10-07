import { canTransition, RIDE_TRANSITIONS, type RideStatus } from './ride-state-machine';

const ALL_STATUSES = Object.keys(RIDE_TRANSITIONS) as RideStatus[];

describe('canTransition / RIDE_TRANSITIONS', () => {
  it('round-trips every declared transition through canTransition', () => {
    for (const from of ALL_STATUSES) {
      for (const to of RIDE_TRANSITIONS[from]) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  it('rejects every pair not declared in RIDE_TRANSITIONS', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const declared = RIDE_TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(declared);
      }
    }
  });

  it('every terminal status has no outgoing transitions', () => {
    const terminal: RideStatus[] = [
      'COMPLETED',
      'CANCELLED_BY_USER',
      'CANCELLED_BY_DRIVER',
      'CANCELLED_BY_SYSTEM',
      'NO_DRIVER_AVAILABLE',
    ];
    for (const status of terminal) {
      expect(RIDE_TRANSITIONS[status]).toEqual([]);
    }
  });

  it('rejects COMPLETED -> REQUESTED', () => {
    expect(canTransition('COMPLETED', 'REQUESTED')).toBe(false);
  });

  it('rejects RIDE_STARTED -> CANCELLED_BY_USER (not cancellable once started)', () => {
    expect(canTransition('RIDE_STARTED', 'CANCELLED_BY_USER')).toBe(false);
  });

  it('rejects skipping straight from REQUESTED to DRIVER_ASSIGNED', () => {
    expect(canTransition('REQUESTED', 'DRIVER_ASSIGNED')).toBe(false);
  });

  it('allows SEARCHING_DRIVER -> DRIVER_ASSIGNED and -> NO_DRIVER_AVAILABLE (for a future Dispatch module)', () => {
    expect(canTransition('SEARCHING_DRIVER', 'DRIVER_ASSIGNED')).toBe(true);
    expect(canTransition('SEARCHING_DRIVER', 'NO_DRIVER_AVAILABLE')).toBe(true);
  });
});
