export const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  interact: false,
};

const KEY_MAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'backward', ArrowDown: 'backward',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyE: 'interact',
};

window.addEventListener('keydown', (e) => {
  const action = KEY_MAP[e.code];
  if (action) {
    e.preventDefault();
    keys[action] = true;
  }
});

window.addEventListener('keyup', (e) => {
  const action = KEY_MAP[e.code];
  if (action) keys[action] = false;
});
