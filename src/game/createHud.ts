import {
  CanvasTextMetrics,
  Container,
  Graphics,
  NineSliceSprite,
  Rectangle,
  Sprite,
  Text,
} from 'pixi.js';
import type { FederatedPointerEvent, Texture } from 'pixi.js';
import type { GameContent, GameState } from './types';
import type { Bounds } from './transforms';
import { contains, sceneFrame } from './hudLayout';
import { hudArt } from './hudArt';
import type { AlphaMask } from './hitTest';

export interface InventoryPointer {
  pointerId: number;
  button: number;
  clientX: number;
  clientY: number;
  element: HTMLCanvasElement;
}
export interface HudDrag {
  id: string;
  x: number;
  y: number;
  target: { type: 'item' | 'hotspot'; id: string } | null;
}
export interface HudState {
  content: GameContent;
  state: GameState;
  selectedItem: string | null;
  drag: HudDrag | null;
  journal: boolean;
  menu: boolean;
  objectsOpen: boolean;
}
export interface HudControl {
  id: string;
  label: string;
  bounds: Bounds;
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  itemId?: string;
  image?: string;
}
export interface HudLayout {
  width: number;
  height: number;
  controls: HudControl[];
  inventory: Bounds;
  book?: Bounds;
}
export interface HudPickup {
  image?: string;
  icon: string;
  itemId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}
export interface HudCallbacks {
  onAction: (id: string, pointer: boolean) => void;
  onItemDown: (id: string, event: InventoryPointer) => void;
  onLayout: (layout: HudLayout) => void;
  onEffects: (effects: {
    dragging: boolean;
    pickups: number;
    pickupImage?: string;
  }) => void;
}
export interface HudController {
  blocksPointer: (clientX: number, clientY: number) => boolean;
  itemAt: (clientX: number, clientY: number) => string | null;
  activate: (id: string) => void;
  focus: (id: string | null) => void;
  pickup: (pickup: HudPickup) => void;
}

// A small screen-space layer, not another scene or a second game state.
export function createHud(
  canvas: HTMLCanvasElement,
  textures: ReadonlyMap<string, Texture>,
  initial: HudState,
  callbacks: HudCallbacks,
  render: () => void,
  syncPlayback: () => void,
  shelfMask: AlphaMask,
) {
  const root = new Container({ label: 'game-hud' });
  const panels = root.addChild(new Container());
  const effects = root.addChild(new Container());
  effects.eventMode = 'none';
  const focusRing = root.addChild(new Graphics());
  focusRing.eventMode = 'none';
  let snapshot = initial;
  let width = 1,
    height = 1;
  let inventoryPage = 0,
    journalScroll = 0,
    journalMaxScroll = 0;
  let focused: string | null = null;
  let layout: HudLayout = {
    width,
    height,
    controls: [],
    inventory: { x: 0, y: 0, width: 0, height: 0 },
  };
  const tooltip = root.addChild(new Container());
  tooltip.eventMode = 'none';
  let hoverId: string | null = null;
  let shelfBounds: Bounds | null = null;
  let ghost: Container | null = null;
  let ghostId: string | null = null;
  let structuralKey = '';
  const flights: { view: Container; pickup: HudPickup; time: number }[] = [];

  function text(
    parent: Container,
    value: string,
    x: number,
    y: number,
    size = 14,
    color = 0xefdbaf,
    wrap?: number,
  ) {
    const view = new Text({
      text: value,
      style: {
        fontFamily: 'Georgia, serif',
        fontSize: size,
        fill: color,
        fontWeight: 'bold',
        wordWrap: wrap !== undefined,
        wordWrapWidth: wrap,
        breakWords: true,
        lineHeight: size * 1.45,
      },
    });
    view.position.set(x, y);
    view.eventMode = 'none';
    parent.addChild(view);
    return view;
  }
  function art(parent: Container, url: string, bounds: Bounds) {
    const sprite = parent.addChild(new Sprite(textures.get(url)!));
    sprite.position.set(bounds.x, bounds.y);
    sprite.width = bounds.width;
    sprite.height = bounds.height;
    sprite.eventMode = 'none';
    return sprite;
  }
  function shelfContains(x: number, y: number) {
    const b = shelfBounds;
    if (!b || !contains(b, x, y)) return false;
    // Invert the same nine-slice stretch used by the timber sprite: its carved
    // ends keep their proportions, only the middle plank changes length.
    const scale = b.height / 116;
    const localX = (x - b.x) / scale,
      localWidth = b.width / scale;
    const sourceX =
      localX < 70
        ? localX
        : localX >= localWidth - 90
          ? 900 - (localWidth - localX)
          : 70 + ((localX - 70) / Math.max(1, localWidth - 160)) * 740;
    const px = Math.min(
      shelfMask.width - 1,
      Math.floor((sourceX / 900) * shelfMask.width),
    );
    const py = Math.floor(((y - b.y) / b.height) * shelfMask.height);
    return shelfMask.alpha[py * shelfMask.width + px]! >= 32;
  }
  function syncTooltip() {
    tooltip
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    if (snapshot.journal || snapshot.menu || snapshot.drag) return;
    const control = layout.controls.find((c) => c.id === (hoverId ?? focused));
    if (!control || control.disabled) return;
    const title = text(
      tooltip,
      control.label,
      0,
      0,
      13,
      0xffedbd,
      Math.min(200, width - 30),
    );
    title.style.stroke = { color: 0x211c22, width: 4, join: 'round' };
    title.position.set(
      Math.max(
        8,
        Math.min(
          width - title.width - 8,
          control.bounds.x + control.bounds.width / 2 - title.width / 2,
        ),
      ),
      control.bounds.y + control.bounds.height + 9,
    );
  }
  function activate(id: string, pointer = false) {
    const control = layout.controls.find((c) => c.id === id);
    if (!control || control.disabled) return;
    if (id === 'inventory-prev' || id === 'inventory-next') {
      inventoryPage += id === 'inventory-prev' ? -1 : 1;
      rebuild();
    } else if (id === 'journal-up' || id === 'journal-down') {
      journalScroll = Math.max(
        0,
        Math.min(
          journalMaxScroll,
          journalScroll +
            (id === 'journal-up' ? -1 : 1) * Math.max(60, height * 0.35),
        ),
      );
      rebuild();
    } else callbacks.onAction(id, pointer);
  }
  function button(
    control: HudControl,
    label = control.label,
    size = 14,
    skin: 'tag' | 'bare' | 'notebook' = 'tag',
  ) {
    layout.controls.push(control);
    const c = panels.addChild(new Container());
    const b = control.bounds;
    c.position.set(b.x, b.y);
    c.hitArea = new Rectangle(0, 0, b.width, b.height);
    c.eventMode = 'static';
    c.cursor = 'pointer';
    const bg =
      skin === 'bare'
        ? c.addChild(
            new Graphics()
              .ellipse(b.width / 2, b.height - 7, b.width * 0.37, 7)
              .fill({
                color: control.pressed ? 0xf2cf80 : 0x19171a,
                alpha: control.pressed ? 0.6 : 0.22,
              }),
          )
        : art(c, skin === 'notebook' ? hudArt.notebook : hudArt.tag, {
            x: 0,
            y: 0,
            width: b.width,
            height: b.height,
          });
    if (control.pressed && skin === 'bare')
      c.addChild(
        new Graphics()
          .ellipse(b.width / 2, b.height / 2, b.width * 0.4, b.height * 0.4)
          .stroke({ color: 0xf4d18a, width: 2 }),
      );
    const caption = text(c, label, 0, 0, size);
    if (caption.width > b.width - 10)
      caption.scale.set((b.width - 10) / caption.width);
    caption.position.set(
      (b.width - caption.width) / 2,
      (b.height - caption.height) / 2,
    );
    if (control.disabled) c.alpha = 0.45;
    c.on('pointerover', (event: FederatedPointerEvent) => {
      if (event.pointerType === 'touch') return;
      hoverId = control.id;
      bg.tint = 0xffe2b3;
      syncTooltip();
      render();
    });
    c.on('pointerout', () => {
      hoverId = null;
      bg.tint = 0xffffff;
      syncTooltip();
      render();
    });
    let origin: { x: number; y: number; id: number } | null = null;
    c.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (control.disabled) return;
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
      if (control.itemId)
        callbacks.onItemDown(control.itemId, {
          pointerId: e.pointerId,
          button: e.button,
          clientX: e.clientX,
          clientY: e.clientY,
          element: canvas,
        });
    });
    // pointerup works for mouse and touch, without depending on compatibility clicks.
    c.on('pointerup', (e: FederatedPointerEvent) => {
      e.stopPropagation();
      const start = origin;
      origin = null;
      if (
        start &&
        start.id === e.pointerId &&
        e.button === 0 &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 7
      )
        activate(control.id, true);
    });
    c.on('pointerupoutside', () => {
      origin = null;
    });
    c.on('pointercancel', () => {
      origin = null;
    });
    return c;
  }
  function image(
    parent: Container,
    url: string | undefined,
    icon: string,
    box: Bounds,
  ) {
    const texture = url ? textures.get(url) : undefined;
    if (texture) {
      const view = new Sprite(texture);
      const scale = Math.min(
        box.width / texture.orig.width,
        box.height / texture.orig.height,
      );
      view.scale.set(scale);
      view.position.set(
        box.x + (box.width - view.width) / 2,
        box.y + (box.height - view.height) / 2,
      );
      view.eventMode = 'none';
      parent.addChild(view);
    } else
      text(
        parent,
        icon,
        box.x + 5,
        box.y,
        Math.min(box.width, box.height) * 0.7,
      );
  }
  function drawFocus() {
    focusRing.clear();
    const control = layout.controls.find((c) => c.id === focused);
    if (control && !control.disabled) {
      const b = control.bounds;
      focusRing
        .roundRect(b.x + 2, b.y + 2, b.width - 4, b.height - 4, 5)
        .stroke({ width: 3, color: 0xffe2a1 });
    }
  }
  function rebuild() {
    // Destroyed controls cannot emit pointerout. Never retain their tooltip
    // when opening a menu, dropping an item or moving between dialogue phases.
    hoverId = null;
    panels
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    const scene = snapshot.content.scenes.find(
      (s) => s.id === snapshot.state.sceneId,
    )!;
    const frame = sceneFrame(width, height, scene);
    const top = frame.y + 6;
    const inventoryWidth = Math.max(
      75,
      Math.min(
        700,
        Math.max(310, 100 + snapshot.state.inventory.length * 68),
        frame.width - 180,
      ),
    );
    const inventory = {
      x: frame.x + 8,
      y: top,
      width: inventoryWidth,
      height: 78,
    };
    layout = { width, height, controls: [], inventory };
    shelfBounds = inventory;
    const shelfScale = inventory.height / 116;
    const shelf = panels.addChild(
      new NineSliceSprite({
        texture: textures.get(hudArt.shelf)!,
        leftWidth: 70,
        rightWidth: 90,
        topHeight: 0,
        bottomHeight: 0,
        width: inventory.width / shelfScale,
        height: 116,
      }),
    );
    shelf.position.set(inventory.x, inventory.y);
    shelf.scale.set(shelfScale);
    shelf.eventMode = 'static';
    shelf.hitArea = {
      contains: (x: number, y: number) =>
        shelfContains(
          inventory.x + x * shelfScale,
          inventory.y + y * shelfScale,
        ),
    };
    const blocked = Boolean(
      snapshot.state.dialogue || snapshot.menu || snapshot.journal,
    );
    const active = Object.values(snapshot.state.tasks).filter(
      (status) => status === 'active',
    ).length;
    const right = frame.x + frame.width - 6;
    const compact = frame.width < 600;
    const toolsX = compact ? inventory.x + inventory.width - 94 : right - 160;
    const toolsY = compact ? top + 60 : top + 4;
    const notebook = { x: right - 60, y: top - 2, width: 60, height: 72 };
    button(
      {
        id: 'journal',
        label: 'Denník ' + active,
        bounds: notebook,
        expanded: snapshot.journal,
      },
      '',
      14,
      'notebook',
    );
    if (active) {
      const badge = panels.addChild(
        new Graphics()
          .circle(notebook.x + 49, notebook.y + 12, 10)
          .fill(0x793f33)
          .stroke({ width: 2, color: 0xe0c994 }),
      );
      badge.eventMode = 'none';
      const count = text(panels, String(active), 0, notebook.y + 3, 12);
      count.x = notebook.x + 49 - count.width / 2;
    }
    button(
      {
        id: 'objects',
        label: 'Objekty',
        bounds: { x: toolsX, y: toolsY, width: 44, height: 48 },
        expanded: snapshot.objectsOpen,
        disabled: blocked,
      },
      '◉',
      22,
    );
    button(
      {
        id: 'menu',
        label: 'Menu',
        bounds: { x: toolsX + 50, y: toolsY, width: 44, height: 48 },
        expanded: snapshot.menu,
      },
      '≡',
      28,
    );
    const slots = Math.max(1, Math.floor((inventoryWidth - 40) / 65));
    inventoryPage = Math.max(
      0,
      Math.min(
        inventoryPage,
        Math.ceil(snapshot.state.inventory.length / slots) - 1,
      ),
    );
    const paged = snapshot.state.inventory.length > slots;
    const inset = paged ? 37 : 18;
    if (!snapshot.state.inventory.length) {
      const empty = text(
        panels,
        'Prázdne vrecká… zatiaľ.',
        inventory.x + 24,
        top + 22,
        inventoryWidth < 220 ? 11 : 13,
        0xebd4a0,
      );
      empty.style.stroke = { color: 0x312723, width: 3, join: 'round' };
    }
    if (paged) {
      button(
        {
          id: 'inventory-prev',
          label: 'Predchádzajúce predmety',
          bounds: { x: inventory.x - 1, y: top + 7, width: 36, height: 48 },
          disabled: inventoryPage === 0 || blocked,
        },
        '‹',
        26,
      );
      button(
        {
          id: 'inventory-next',
          label: 'Ďalšie predmety',
          bounds: {
            x: inventory.x + inventoryWidth - 35,
            y: top + 7,
            width: 36,
            height: 48,
          },
          disabled:
            (inventoryPage + 1) * slots >= snapshot.state.inventory.length ||
            blocked,
        },
        '›',
        26,
      );
    }
    const visibleItems = snapshot.state.inventory.slice(
      inventoryPage * slots,
      (inventoryPage + 1) * slots,
    );
    const slotWidth = Math.min(
      78,
      (inventoryWidth - inset * 2) / Math.max(1, visibleItems.length),
    );
    visibleItems.forEach((id, index) => {
      const item = snapshot.content.items.find((i) => i.id === id)!;
      const b = {
        x: inventory.x + inset + index * slotWidth,
        y: top + 1,
        width: slotWidth - 3,
        height: 52,
      };
      const c = button(
        {
          id: 'item:' + id,
          itemId: id,
          label: item.label,
          image: item.image,
          bounds: b,
          disabled: blocked,
          pressed: snapshot.selectedItem === id,
        },
        '',
        14,
        'bare',
      );
      image(c, item.image, item.icon, {
        x: 6,
        y: 0,
        width: b.width - 12,
        height: 44,
      });
      if (snapshot.drag?.id === id) c.alpha = 0.4;
      if (
        snapshot.drag?.target?.type === 'item' &&
        snapshot.drag.target.id === id &&
        snapshot.drag.id !== id
      )
        c.addChild(
          new Graphics()
            .ellipse(b.width / 2, 25, b.width * 0.45, 24)
            .stroke({ width: 3, color: 0xc7e597 }),
        ).eventMode = 'none';
    });
    if (snapshot.journal) drawBook();
    drawFocus();
    syncTooltip();
    callbacks.onLayout(layout);
    render();
  }
  function drawBook() {
    const dim = panels.addChild(
      new Graphics()
        .rect(0, 0, width, height)
        .fill({ color: 0x100d15, alpha: 0.7 }),
    );
    dim.eventMode = 'static';
    dim.on('pointertap', () => callbacks.onAction('journal-close', true));
    const bw = Math.max(
        1,
        Math.min(590, width - 16, ((height - 16) * 620) / 650),
      ),
      bh = (bw * 650) / 620;
    const b = {
      x: (width - bw) / 2,
      y: (height - bh) / 2,
      width: bw,
      height: bh,
    };
    const left = b.x + bw * 0.12,
      right = b.x + bw * 0.91;
    const contentTop = b.y + bh * 0.25,
      contentBottom = b.y + bh * 0.83;
    const fontSize = Math.max(13, Math.min(20, bw / 26));
    layout.book = b;
    const paper = art(panels, hudArt.journal, b);
    paper.eventMode = 'static';
    paper.on('pointertap', (e) => e.stopPropagation());
    text(
      panels,
      'ZÁPISKY PRE PRÍPAD AMNÉZIE',
      left,
      b.y + bh * 0.065,
      Math.max(7, Math.min(10, bw / 48)),
      0x80513b,
    );
    const title = text(
      panels,
      'Môj pochybný plán',
      left,
      b.y + bh * 0.11,
      Math.min(28, bw / 17),
      0x392920,
    );
    if (title.width > right - left - 44)
      title.scale.set((right - left - 44) / title.width);
    const remaining = Object.values(snapshot.state.tasks).filter(
      (s) => s === 'active',
    ).length;
    text(
      panels,
      remaining
        ? 'Ešte vybaviť: ' + remaining
        : Object.keys(snapshot.state.tasks).length
          ? 'Všetko odškrtnuté. Zatiaľ.'
          : 'Čakám na prvý dobrý nápad.',
      left,
      b.y + bh * 0.19,
      Math.min(12, bw / 28),
      0x78533d,
    );
    layout.controls = [];
    button(
      {
        id: 'journal-close',
        label: 'Zavrieť denník',
        bounds: { x: right - 40, y: b.y + bh * 0.08, width: 40, height: 44 },
      },
      '×',
      25,
    );
    const page = panels.addChild(new Container());
    const mask = panels.addChild(
      new Graphics()
        .rect(left, contentTop, right - left, contentBottom - contentTop)
        .fill(0xffffff),
    );
    mask.eventMode = 'none';
    page.mask = mask;
    let rowY = contentTop + 3 - journalScroll;
    const entries = (snapshot.content.tasks ?? []).filter((task) =>
      Object.hasOwn(snapshot.state.tasks, task.id),
    );
    if (!entries.length)
      text(
        page,
        'Zatiaľ nemám nič zapísané.\nTo je samo osebe podozrivé.',
        left + 4,
        rowY + 12,
        fontSize,
        0x82634d,
        right - left - 8,
      );
    for (const task of entries) {
      const done = snapshot.state.tasks[task.id] === 'completed';
      text(
        page,
        done ? '✓' : '○',
        left + 2,
        rowY + 4,
        fontSize,
        done ? 0x526045 : 0x723c2f,
      );
      const label = text(
        page,
        task.text,
        left + 26,
        rowY + 4,
        fontSize,
        done ? 0x71614d : 0x392920,
        right - left - 30,
      );
      const metrics = CanvasTextMetrics.measureText(task.text, label.style);
      const lines = page.addChild(new Graphics());
      lines.eventMode = 'none';
      if (done)
        metrics.lineWidths.forEach((lineWidth, i) => {
          const y =
            rowY + 5 + metrics.lineHeight * i + metrics.lineHeight * 0.48;
          lines
            .moveTo(left + 25, y)
            .lineTo(left + 26 + lineWidth, y - 1)
            .stroke({ color: 0x8c4534, width: 2 });
        });
      rowY += Math.max(38, label.height + 20);
      lines
        .moveTo(left, rowY - 4)
        .lineTo(right, rowY - 4)
        .stroke({ color: 0x805f3d, alpha: 0.25, width: 1 });
    }
    journalMaxScroll = Math.max(0, rowY + journalScroll - contentBottom);
    if (journalScroll > journalMaxScroll) {
      page.y += journalScroll - journalMaxScroll;
      journalScroll = journalMaxScroll;
    }
    if (journalMaxScroll > 0) {
      button(
        {
          id: 'journal-up',
          label: 'Posunúť denník nahor',
          bounds: { x: right - 94, y: b.y + bh * 0.85, width: 44, height: 44 },
          disabled: journalScroll === 0,
        },
        '↑',
        20,
      );
      button(
        {
          id: 'journal-down',
          label: 'Posunúť denník nadol',
          bounds: { x: right - 44, y: b.y + bh * 0.85, width: 44, height: 44 },
          disabled: journalScroll >= journalMaxScroll,
        },
        '↓',
        20,
      );
    }
    if (bw > 370 || journalMaxScroll === 0)
      text(
        panels,
        'Nestratiť. Nezjesť. Nezabudnúť.',
        left,
        b.y + bh * 0.9,
        bw < 370 ? 8 : 10,
        0x956747,
      );
  }
  function syncGhost() {
    const drag = snapshot.drag;
    if (ghostId !== drag?.id) {
      ghost?.destroy({ children: true });
      ghost = null;
      ghostId = drag?.id ?? null;
      if (drag) {
        const item = snapshot.content.items.find((i) => i.id === drag.id)!;
        ghost = effects.addChild(new Container());
        image(ghost, item.image, item.icon, {
          x: -26,
          y: -26,
          width: 52,
          height: 52,
        });
        text(ghost, item.label, 24, 25, 13);
      }
    }
    if (ghost && drag) {
      ghost.position.set(drag.x, drag.y);
      ghost.alpha =
        drag.target &&
        !(drag.target.type === 'item' && drag.target.id === drag.id)
          ? 1
          : 0.7;
    }
  }
  function canvasPoint(clientX: number, clientY: number) {
    const b = canvas.getBoundingClientRect();
    return {
      x: ((clientX - b.x) * width) / b.width,
      y: ((clientY - b.y) * height) / b.height,
    };
  }
  const controller: HudController = {
    blocksPointer(clientX, clientY) {
      const p = canvasPoint(clientX, clientY);
      return (
        snapshot.journal ||
        snapshot.menu ||
        layout.controls.some((c) => contains(c.bounds, p.x, p.y)) ||
        shelfContains(p.x, p.y)
      );
    },
    itemAt(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      const x = ((clientX - box.x) * width) / box.width,
        y = ((clientY - box.y) * height) / box.height;
      return (
        layout.controls.find(
          (c) => c.itemId && !c.disabled && contains(c.bounds, x, y),
        )?.itemId ?? null
      );
    },
    activate,
    focus(id) {
      focused = id;
      drawFocus();
      syncTooltip();
      render();
    },
    pickup(pickup) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const view = effects.addChild(new Container());
      image(view, pickup.image, pickup.icon, {
        x: -pickup.width / 2,
        y: -pickup.height / 2,
        width: pickup.width,
        height: pickup.height,
      });
      view.position.set(
        pickup.x + pickup.width / 2,
        pickup.y + pickup.height / 2,
      );
      flights.push({ view, pickup, time: 0 });
      callbacks.onEffects({
        dragging: Boolean(snapshot.drag),
        pickups: flights.length,
        pickupImage: pickup.image,
      });
      syncPlayback();
    },
  };
  return {
    root,
    controller,
    get active() {
      return flights.length > 0;
    },
    resize(w: number, h: number) {
      width = w;
      height = h;
      rebuild();
    },
    update(next: HudState) {
      const key = JSON.stringify([
        next.state.inventory,
        next.state.tasks,
        next.state.dialogue,
        next.selectedItem,
        next.menu,
        next.journal,
        next.objectsOpen,
        next.drag?.id,
        next.drag?.target,
      ]);
      const wasJournal = snapshot.journal;
      snapshot = next;
      effects.visible = !next.journal && !next.menu;
      if (!wasJournal && next.journal) journalScroll = 0;
      if (key !== structuralKey) {
        structuralKey = key;
        rebuild();
      }
      syncGhost();
      callbacks.onEffects({
        dragging: Boolean(next.drag),
        pickups: flights.length,
        pickupImage: flights[0]?.pickup.image,
      });
      render();
    },
    resetEffects() {
      for (const flight of flights) flight.view.destroy({ children: true });
      flights.length = 0;
      callbacks.onEffects({ dragging: Boolean(snapshot.drag), pickups: 0 });
      render();
    },
    animate(deltaMs: number) {
      for (let i = flights.length - 1; i >= 0; i--) {
        const flight = flights[i]!;
        flight.time += deltaMs;
        const t = Math.min(1, flight.time / 680),
          ease = 1 - (1 - t) ** 3;
        const p = flight.pickup;
        const target =
          layout.controls.find((c) => c.itemId === p.itemId)?.bounds ??
          layout.inventory;
        const startX = p.x + p.width / 2,
          startY = p.y + p.height / 2;
        flight.view.position.set(
          startX + (target.x + target.width / 2 - startX) * ease,
          startY +
            (target.y + target.height / 2 - startY) * ease -
            Math.sin(t * Math.PI) * 26,
        );
        flight.view.scale.set(
          1 +
            Math.sin(t * Math.PI) * 0.12 -
            t * (1 - Math.min(1, 42 / Math.max(p.width, p.height))),
        );
        flight.view.rotation = ((p.rotation * Math.PI) / 180) * (1 - t);
        flight.view.alpha = 1 - t;
        if (t === 1) {
          flight.view.destroy({ children: true });
          flights.splice(i, 1);
        }
      }
      callbacks.onEffects({
        dragging: Boolean(snapshot.drag),
        pickups: flights.length,
        pickupImage: flights[0]?.pickup.image,
      });
      if (!flights.length) syncPlayback();
    },
  };
}
