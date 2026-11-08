/** The part of a Phaser pointer a click handler looks at. */
export interface PointerButton {
  readonly button: number;
}

/**
 * Runs a click handler only for the primary button, which is also what a touch reports. The right
 * button is the partner skill and the middle button the reject stamp (design doc 5.2), and since
 * the browser's context menu is cancelled (KeyboardInput), a right or middle click on a menu row,
 * a reply, a card or a plate would otherwise choose it as a left click does.
 */
export const primary = (run: () => void) => (pointer: PointerButton): void => {
  if (pointer.button === 0) run();
};
