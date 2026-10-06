/** Imperative bridge so global shortcuts, the assistant and the tour can drive the active player. */
export interface PlayerControls {
  toggle: () => void
  seek: (t: number) => void
  seekRel: (d: number) => void
  markIn: () => void
  markOut: () => void
  bookmark: () => void
  snapshot: () => void
  pause: () => void
}

export const player: { current: PlayerControls | null } = { current: null }
