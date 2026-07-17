import * as Progression   from './progression.js';
import * as Inventory      from './inventory.js';
import * as Stats          from './stats.js';
import * as PlacedObjects  from './placedObjects.js';
import * as DayNight       from './daynight.js';

const SAVE_KEY = 'smitelife_v1';

// 敵モジュールはインスタンス（create()の戻り値）なので main.js から登録する
let _enemies = null;
export function setEnemies(inst) { _enemies = inst; }

export function save() {
  const data = {
    v: 1,
    progression: Progression.serialize(),
    inventory:   Inventory.serialize(),
    stats:       Stats.serialize(),
    placed:      PlacedObjects.serialize(),
    tamed:       _enemies ? _enemies.serialize() : [],
    tamedOrder:  _enemies ? _enemies.getTamedOrder() : 'attack',
    tamedMove:   _enemies ? _enemies.getTamedMove() : 'follow',
    time:        DayNight.serialize(),
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* quota */ }
}

// セーブを読み込んで各モジュールに反映。
// 順序が重要: Progression → Stats（maxHp確定後にHPを上書き）→ Inventory
export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.v !== 1) return false;
    Progression.deserialize(data.progression ?? {});
    Stats.deserialize(data.stats ?? {});
    Inventory.deserialize(data.inventory ?? {});
    PlacedObjects.deserialize(data.placed ?? []);
    _enemies?.deserialize(data.tamed ?? []);
    _enemies?.setTamedOrder(data.tamedOrder ?? 'attack');
    _enemies?.setTamedMove(data.tamedMove ?? 'follow');
    DayNight.deserialize(data.time ?? {});
    return true;
  } catch { return false; }
}

export function hasSave() { return !!localStorage.getItem(SAVE_KEY); }
export function deleteSave() { localStorage.removeItem(SAVE_KEY); }
