export const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  interact: false,
  attack: false,
  inventory: false,
  useFood: false,
  dodge: false,
  status: false,
  craft: false,
  throw: false,
  castFire: false,
  petStatus: false,
  petOrder: false,
  petMove: false,
  placeRotateLeft: false,
  placeRotateRight: false,
};

const KEY_MAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'backward', ArrowDown: 'backward',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyE: 'interact',
  KeyF: 'attack',
  KeyI: 'inventory',
  Digit1: 'useFood',
  KeyQ: 'dodge',
  KeyC: 'status',
  KeyG: 'craft',
  KeyT: 'throw',
  KeyR: 'castFire',
  KeyL: 'petStatus',
  KeyP: 'petOrder',
  KeyO: 'petMove',
  KeyZ: 'placeRotateLeft',
  KeyX: 'placeRotateRight',
};

// 「押した瞬間」を1回だけ取り出すためのエッジ管理
const justPressed = new Set();

window.addEventListener('keydown', (e) => {
  const action = KEY_MAP[e.code];
  if (action) {
    e.preventDefault();
    if (!keys[action]) justPressed.add(action); // リピート連打を無視
    keys[action] = true;
  }
});

window.addEventListener('keyup', (e) => {
  const action = KEY_MAP[e.code];
  if (action) keys[action] = false;
});

// その操作が「今フレームで押された」かを一度だけ返す
export function consumePress(action) {
  if (justPressed.has(action)) {
    justPressed.delete(action);
    return true;
  }
  return false;
}
