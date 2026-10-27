/**
 * The company building of semester mode (design doc 8.4): five floors, each with a load of 0 to
 * 100 and a light derived from it. The liver is the only floor whose light never comes on
 * (8.6); the player reads it through the clues in liver.ts instead.
 */
export const FLOORS = ['brain', 'immune', 'stomach', 'liver', 'gut'] as const;
export type FloorId = (typeof FLOORS)[number];

export const LIVER: FloorId = 'liver';

export type Light = 'off' | 'yellow' | 'orange' | 'red';

export type Loads = Readonly<Record<FloorId, number>>;

export const EMPTY_LOADS: Loads = Object.freeze({ brain: 0, immune: 0, stomach: 0, liver: 0, gut: 0 });

export interface FloorThresholds {
  readonly floorYellowAt: number;
  readonly floorOrangeAt: number;
  readonly floorRedAt: number;
}

export function mapFloors<T>(f: (floor: FloorId) => T): Readonly<Record<FloorId, T>> {
  return Object.fromEntries(FLOORS.map((fl) => [fl, f(fl)])) as Record<FloorId, T>;
}

/** The light of a floor. The liver's button stays dark at any load, which is the point of 8.6. */
export function lightOf(floor: FloorId, load: number, k: FloorThresholds): Light {
  if (floor === LIVER) return 'off';
  if (load >= k.floorRedAt) return 'red';
  if (load >= k.floorOrangeAt) return 'orange';
  if (load >= k.floorYellowAt) return 'yellow';
  return 'off';
}

export interface ElevatorButton {
  readonly floor: FloorId;
  readonly light: Light;
  /** The fixed smiley note pasted on the liver's button; the view picks its text. */
  readonly note?: 'liver_ok';
}

export interface ElevatorPanel {
  readonly buttons: readonly ElevatorButton[];
  /** A floor marked for a routine patrol when fewer than two floors are lit (design doc 8.4). */
  readonly routine?: FloorId;
}

/**
 * What the elevator shows before the player picks a floor. It carries lights only, never a
 * load, so a strategy or a view built on it cannot read the liver by accident.
 *
 * The routine marker skips the liver: its load is the one thing the building hides, and "the
 * highest-load unlit floor" would point at it whenever it is the heaviest.
 */
export function elevatorPanel(loads: Loads, k: FloorThresholds): ElevatorPanel {
  const buttons = FLOORS.map((floor): ElevatorButton => {
    const light = lightOf(floor, loads[floor], k);
    return floor === LIVER ? { floor, light, note: 'liver_ok' } : { floor, light };
  });
  const lit = buttons.filter((b) => b.light !== 'off').length;
  if (lit >= 2) return { buttons };
  let routine: FloorId | undefined;
  for (const b of buttons) {
    if (b.floor === LIVER || b.light !== 'off') continue;
    if (routine === undefined || loads[b.floor] > loads[routine]) routine = b.floor;
  }
  return routine === undefined ? { buttons } : { buttons, routine };
}

export const litFloors = (panel: ElevatorPanel): FloorId[] => panel.buttons.filter((b) => b.light !== 'off').map((b) => b.floor);
